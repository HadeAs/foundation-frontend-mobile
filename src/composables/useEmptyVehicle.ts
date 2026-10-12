import { computed, ref, shallowRef } from 'vue';
import { emptyVehicleApi as api, type EmptyVehicleOptions, type EmptyVehicleOrigin, type CallEmptyVehicleRequest } from '../services/emptyVehicle';
import type { LocationCandidate } from '../services/logistics';
import { ApiRequestError, requestId } from '../services/nariRequest';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';

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
  let active = true;
  let attempt: CallEmptyVehicleRequest | null = null;
  function notify(text: string, error = false) { if (active) notice.value = { text, error }; }
  function clear() { generation++; options.value = null; origin.value = null; choosing.value = false; replacement.value = ''; busy.value = false; notice.value = null; attempt = null; }
  function pause() { active = false; clear(); }
  function resume() { active = true; }
  const validText = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 128;
  const optionalText = (v: unknown) => v === undefined || validText(v);
  const validVersion = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 2147483647;
  function validLocation(value: LocationSummary | undefined) {
    return !!value && validText(value.locationCode) && validText(value.locationName) &&
      [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
  }
  function validVehicle(value: LocationContainer | undefined) {
    return !!value && value.containerType === 'VEHICLE' && validText(value.containerCode) && validVersion(value.version) && optionalText(value.containerName) &&
      (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
      (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) &&
      (value.location === undefined || validLocation(value.location));
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => active && id === generation); }
    catch (error) { if (active && id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  async function load(code: string) {
    clear();
    await run(async (current) => {
      const result = await api.getOrigins(code);
      if (!current()) return;
      if (!result || !validLocation(result.destination) || result.destination.locationCode !== code || !Array.isArray(result.origins)) throw new Error('目标位置或候选信息不完整，请重新扫描');
      const floors = new Map<string, string>();
      const areas = new Map<string, string>();
      const codes = new Set<string>();
      const vehicles = new Set<string>();
      for (const item of result.origins) {
        const location = item?.origin; const vehicle = item?.vehicle;
        if (!validLocation(location) || ![location.floorCode, location.floorName, location.areaCode, location.areaName].every(validText) ||
          location.locationCode === code || codes.has(location.locationCode) || !validVehicle(vehicle) || vehicles.has(vehicle.containerCode) ||
          vehicle.location !== undefined && vehicle.location.locationCode !== location.locationCode) throw new Error('起始位置或空载具信息不完整，请重新扫描');
        const areaKey = JSON.stringify([location.floorCode, location.areaCode]);
        if (floors.has(location.floorCode) && floors.get(location.floorCode) !== location.floorName || areas.has(areaKey) && areas.get(areaKey) !== location.areaName) throw new Error('起始位置层级信息不一致，请重新扫描');
        floors.set(location.floorCode, location.floorName); areas.set(areaKey, location.areaName);
        codes.add(location.locationCode); vehicles.add(vehicle.containerCode);
      }
      options.value = result; origin.value = result.origins[0] || null;
    });
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    const code = raw.trim();
    if (!validText(code)) { notify('请输入有效目标位置编码（最多128个字符）', true); return; }
    if (options.value) { notice.value = null; replacement.value = code; return; }
    await load(code);
  }
  function cancelReplacement() { if (active && !busy.value) replacement.value = ''; }
  async function confirmReplacement() { if (active && replacement.value && !busy.value) await load(replacement.value); }
  function openChoice() { if (active && !disabled.value && candidates.value.length) { notice.value = null; choosing.value = true; } }
  function closeChoice() { if (active && !busy.value) choosing.value = false; }
  function choose(value: LocationCandidate) {
    if (!active || !choosing.value || busy.value) return;
    const selected = options.value?.origins.find((item) => item.origin.locationCode === value.locationCode && item.origin.floorCode === value.floorCode && item.origin.areaCode === value.areaCode);
    if (selected) {
      if (selected !== origin.value) attempt = null;
      origin.value = selected; choosing.value = false;
    }
  }
  async function submit() {
    if (!active || !canSubmit.value || !options.value || !origin.value) return;
    const input: CallEmptyVehicleRequest = attempt || { requestId: requestId(), originLocationCode: origin.value.origin.locationCode,
      destinationLocationCode: options.value.destination.locationCode, vehicleCode: origin.value.vehicle.containerCode, version: origin.value.vehicle.version };
    attempt = input;
    await run(async (current) => {
      let result;
      try { result = await api.call(input); }
      catch (error) {
        if (attempt === input && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      const task = result?.task;
      if (!result || typeof result !== 'object' || 'resultType' in result || result.requestId !== input.requestId || !task || !validText(task.taskNo) ||
        typeof task.taskId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(task.taskId) || !validVersion(task.version) ||
        !['STANDARD', 'HIKVISION'].includes(task.vendor) || task.taskType !== 'GENERAL' || !validVehicle(task.container) ||
        task.container.containerCode !== input.vehicleCode || task.container.version < input.version ||
        !validLocation(task.origin) || task.origin.locationCode !== input.originLocationCode ||
        !validLocation(task.destination) || task.destination.locationCode !== input.destinationLocationCode ||
        !['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(task.status) ||
        !validText(task.statusName) || !validText(task.triggerMode) || !optionalText(task.agvCode) || !optionalText(task.agvName) ||
        typeof task.createdTime !== 'string' || !Number.isFinite(Date.parse(task.createdTime))) throw new Error('呼叫结果不完整，未能确认任务已创建，请核实后重试原请求');
      clear(); notify('呼叫成功');
    });
  }
  return { options, origin, candidates, choosing, replacement, busy, disabled, canSubmit, notice, notify, clear, pause, resume, scan,
    cancelReplacement, confirmReplacement, openChoice, closeChoice, choose, submit };
}
