import { computed, ref, shallowRef } from 'vue';
import { emptyVehicleApi as api, type EmptyVehicleOptions, type EmptyVehicleOrigin, type CallEmptyVehicleRequest } from '../services/emptyVehicle';
import type { LocationCandidate } from '../services/logistics';
import { requestId } from '../services/nariRequest';

export function useEmptyVehicle() {
  const options = shallowRef<EmptyVehicleOptions | null>(null);
  const origin = shallowRef<EmptyVehicleOrigin | null>(null);
  const choosing = ref(false);
  const replacement = ref('');
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || choosing.value || !!replacement.value);
  const candidates = computed(() => options.value?.origins.map((item) => item.origin) || []);
  const canSubmit = computed(() => !disabled.value && !!options.value && !!origin.value);
  let generation = 0;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() { generation++; options.value = null; origin.value = null; choosing.value = false; replacement.value = ''; busy.value = false; notice.value = null; }
  const validText = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 128;
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => id === generation); }
    catch (error) { if (id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  async function load(code: string) {
    clear();
    await run(async (current) => {
      const result = await api.getOrigins(code);
      if (!current()) return;
      if (!result || result.destination?.locationCode !== code || !validText(result.destination.locationName) || !Array.isArray(result.origins)) throw new Error('目标位置或候选信息不完整，请重新扫描');
      const floors = new Map<string, string>();
      const areas = new Map<string, string>();
      const codes = new Set<string>();
      const vehicles = new Set<string>();
      for (const item of result.origins) {
        const location = item?.origin; const vehicle = item?.vehicle;
        if (!location || ![location.locationCode, location.locationName, location.floorCode, location.floorName, location.areaCode, location.areaName].every(validText) ||
          location.locationCode === code || codes.has(location.locationCode) || vehicle?.containerType !== 'VEHICLE' || !validText(vehicle.containerCode) ||
          vehicles.has(vehicle.containerCode) || !Number.isInteger(vehicle.version) || vehicle.version < 1 || vehicle.version > 2147483647) throw new Error('起始位置或空载具信息不完整，请重新扫描');
        const areaKey = JSON.stringify([location.floorCode, location.areaCode]);
        if (floors.has(location.floorCode) && floors.get(location.floorCode) !== location.floorName || areas.has(areaKey) && areas.get(areaKey) !== location.areaName) throw new Error('起始位置层级信息不一致，请重新扫描');
        floors.set(location.floorCode, location.floorName); areas.set(areaKey, location.areaName);
        codes.add(location.locationCode); vehicles.add(vehicle.containerCode);
      }
      options.value = result; origin.value = result.origins[0] || null;
    });
  }
  async function scan(raw: string) {
    if (disabled.value) return;
    const code = raw.trim();
    if (!validText(code)) { notify('请输入有效目标位置编码（最多128个字符）', true); return; }
    if (options.value) { replacement.value = code; return; }
    await load(code);
  }
  function cancelReplacement() { replacement.value = ''; }
  async function confirmReplacement() { if (replacement.value && !busy.value) await load(replacement.value); }
  function openChoice() { if (!disabled.value && candidates.value.length) choosing.value = true; }
  function closeChoice() { choosing.value = false; }
  function choose(value: LocationCandidate) {
    if (!choosing.value || busy.value) return;
    const selected = options.value?.origins.find((item) => item.origin.locationCode === value.locationCode && item.origin.floorCode === value.floorCode && item.origin.areaCode === value.areaCode);
    if (selected) { origin.value = selected; choosing.value = false; }
  }
  async function submit() {
    if (!canSubmit.value || !options.value || !origin.value) return;
    const input: CallEmptyVehicleRequest = { requestId: requestId(), originLocationCode: origin.value.origin.locationCode,
      destinationLocationCode: options.value.destination.locationCode, vehicleCode: origin.value.vehicle.containerCode, version: origin.value.vehicle.version };
    await run(async (current) => {
      const result = await api.call(input);
      if (!current()) return;
      if (!result || result.requestId !== input.requestId || !validText(result.task?.taskNo) || typeof result.task.taskId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(result.task.taskId) ||
        result.task.container?.containerType !== 'VEHICLE' || result.task.container.containerCode !== input.vehicleCode ||
        result.task.origin?.locationCode !== input.originLocationCode || result.task.destination?.locationCode !== input.destinationLocationCode) throw new Error('呼叫结果不完整，请核实后重试');
      clear(); notify('呼叫成功');
    });
  }
  return { options, origin, candidates, choosing, replacement, busy, disabled, canSubmit, notice, notify, clear, scan,
    cancelReplacement, confirmReplacement, openChoice, closeChoice, choose, submit };
}
