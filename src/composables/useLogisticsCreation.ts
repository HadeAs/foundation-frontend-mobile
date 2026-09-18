import { computed, ref, shallowRef } from 'vue';
import { logisticsApi as api, type LogisticsOptions, type LocationCandidate, type CreateLogisticsRequest } from '../services/logistics';
import { requestId } from '../services/nariRequest';

export function useLogisticsCreation() {
  const options = shallowRef<LogisticsOptions | null>(null);
  const destination = shallowRef<LocationCandidate | null>(null);
  const choosing = ref(false);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || choosing.value);
  const candidates = computed(() => options.value?.destinations.map((item) => item.location) || []);
  const canSubmit = computed(() => !disabled.value && !!options.value?.eligibility.allowed && !!destination.value);
  let generation = 0;
  let shippingNo: string | undefined;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() { generation++; options.value = null; destination.value = null; choosing.value = false; busy.value = false; shippingNo = undefined; notice.value = null; }
  const validText = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 128;
  const validReason = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 500;
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => id === generation); }
    catch (error) { if (id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  async function scan(raw: string, sourceShippingNo?: string) {
    if (disabled.value) return;
    clear();
    const code = raw.trim();
    if (!validText(code) || sourceShippingNo !== undefined && !validText(sourceShippingNo)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const result = await api.getOptions(code);
      if (!current()) return;
      if (!result || !validText(result.object?.containerCode) || !['BOX', 'VEHICLE'].includes(result.object.containerType) ||
        !Number.isInteger(result.object.version) || result.object.version < 1 || !validText(result.origin?.locationCode) || !validText(result.origin.locationName) ||
        !['STANDARD', 'HIKVISION'].includes(result.vendor) || !['GENERAL', 'PROCESS_ROUTE'].includes(result.taskType) ||
        result.vendor === 'HIKVISION' && result.taskType !== 'GENERAL' || !Array.isArray(result.destinations) ||
        typeof result.eligibility?.allowed !== 'boolean' || !result.eligibility.allowed && !validReason(result.eligibility.reason)) throw new Error('物流任务信息不完整，请重新扫描');
      const floors = new Map<string, string>();
      const areas = new Map<string, string>();
      const codes = new Set<string>();
      for (const item of result.destinations) {
        const location = item?.location;
        if (!location || ![location.locationCode, location.locationName, location.floorCode, location.floorName, location.areaCode, location.areaName].every(validText) ||
          typeof item.recommended !== 'boolean' || codes.has(location.locationCode)) throw new Error('目标位置层级或候选信息不完整，请重新扫描');
        const areaKey = JSON.stringify([location.floorCode, location.areaCode]);
        if (floors.has(location.floorCode) && floors.get(location.floorCode) !== location.floorName || areas.has(areaKey) && areas.get(areaKey) !== location.areaName) throw new Error('目标位置层级信息不一致，请重新扫描');
        floors.set(location.floorCode, location.floorName); areas.set(areaKey, location.areaName); codes.add(location.locationCode);
      }
      if (sourceShippingNo && (result.object.containerType !== 'VEHICLE' || result.object.containerCode !== code)) throw new Error('发货料车信息不一致，请重新扫描');
      options.value = result;
      shippingNo = sourceShippingNo;
      const recommended = result.destinations.filter((item) => item.recommended);
      if (result.eligibility.allowed && recommended.length === 1) destination.value = recommended[0].location;
      if (!result.eligibility.allowed) notify(result.eligibility.reason!, true);
      else if (!result.destinations.length) notify('当前对象暂无可达目标位置', true);
    });
  }
  function openChoice() { if (!disabled.value && options.value?.eligibility.allowed && candidates.value.length) choosing.value = true; }
  function closeChoice() { choosing.value = false; }
  function choose(value: LocationCandidate) {
    if (!choosing.value || busy.value) return;
    const selected = candidates.value.find((item) => item.locationCode === value.locationCode && item.floorCode === value.floorCode && item.areaCode === value.areaCode);
    if (selected) { destination.value = selected; choosing.value = false; }
  }
  async function submit() {
    if (!canSubmit.value || !options.value || !destination.value) return;
    const source = options.value;
    const input: CreateLogisticsRequest = { requestId: requestId(), object: { containerType: source.object.containerType, containerCode: source.object.containerCode },
      version: source.object.version, vendor: source.vendor, taskType: source.taskType, originLocationCode: source.origin.locationCode,
      destinationLocationCode: destination.value.locationCode, ...(shippingNo ? { shippingNo } : {}) };
    await run(async (current) => {
      const result = await api.create(input);
      if (!current()) return;
      if (!result || result.requestId !== input.requestId || !validText(result.task?.taskNo) || typeof result.task.taskId !== 'string' ||
        !/^[1-9][0-9]{0,18}$/.test(result.task.taskId) || !validText(result.task.statusName) ||
        result.task.container?.containerCode !== input.object.containerCode || result.task.container?.containerType !== input.object.containerType ||
        result.task.origin?.locationCode !== input.originLocationCode || result.task.destination?.locationCode !== input.destinationLocationCode) throw new Error('任务创建结果不完整，请核实后重试');
      clear(); notify(`物流任务创建成功，任务编号：${result.task.taskNo}（${result.task.statusName}）`);
    });
  }
  return { options, destination, candidates, choosing, busy, disabled, notice, canSubmit, notify, clear, scan, openChoice, closeChoice, choose, submit };
}
