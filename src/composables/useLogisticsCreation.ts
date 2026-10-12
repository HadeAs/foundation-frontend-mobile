import { computed, ref, shallowRef } from 'vue';
import { logisticsApi as api, type LogisticsOptions, type LocationCandidate, type CreateLogisticsRequest, type ReturnLogisticsRequest } from '../services/logistics';
import { ApiRequestError, requestId } from '../services/nariRequest';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';

export function useLogisticsCreation() {
  const options = shallowRef<LogisticsOptions | null>(null);
  const destination = shallowRef<LocationCandidate | null>(null);
  const choosing = ref(false);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || choosing.value);
  const candidates = computed(() => options.value?.destinations.map((item) => item.location) || []);
  const canSubmit = computed(() => !disabled.value && !!options.value?.eligibility.allowed && !!destination.value);
  const canReturn = computed(() => !disabled.value && options.value?.object.containerType === 'VEHICLE');
  let generation = 0;
  let active = true;
  let shippingNo: string | undefined;
  let attempt: CreateLogisticsRequest | ReturnLogisticsRequest | null = null;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() { generation++; options.value = null; destination.value = null; choosing.value = false; busy.value = false; shippingNo = undefined; notice.value = null; attempt = null; }
  function pause() { active = false; clear(); }
  function resume() { active = true; }
  const validText = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 128;
  const validReason = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 500;
  const optionalText = (v: unknown) => v === undefined || validText(v);
  const validVersion = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 2147483647;
  function validLocation(value: LocationSummary | undefined) {
    return !!value && validText(value.locationCode) && validText(value.locationName) &&
      [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
  }
  function validContainer(value: LocationContainer | undefined) {
    return !!value && ['BOX', 'VEHICLE'].includes(value.containerType) && validText(value.containerCode) && validVersion(value.version) && optionalText(value.containerName) &&
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
  async function scan(raw: string, sourceShippingNo?: string) {
    if (disabled.value || !active) return;
    clear();
    const code = raw.trim();
    if (!validText(code) || sourceShippingNo !== undefined && !validText(sourceShippingNo)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const result = await api.getOptions(code);
      if (!current()) return;
      if (!result || !validContainer(result.object) || !validLocation(result.origin) ||
        !['STANDARD', 'HIKVISION'].includes(result.vendor) || result.taskType !== 'GENERAL' || !Array.isArray(result.destinations) ||
        typeof result.eligibility?.allowed !== 'boolean' || result.eligibility.reason !== undefined && !validReason(result.eligibility.reason) ||
        !result.eligibility.allowed && !validReason(result.eligibility.reason)) throw new Error('物流任务信息不完整，请重新扫描');
      const floors = new Map<string, string>();
      const areas = new Map<string, string>();
      const codes = new Set<string>();
      for (const item of result.destinations) {
        const location = item?.location;
        if (!validLocation(location) || ![location.floorCode, location.floorName, location.areaCode, location.areaName].every(validText) ||
          typeof item.recommended !== 'boolean' || codes.has(location.locationCode)) throw new Error('目标位置层级或候选信息不完整，请重新扫描');
        const areaKey = JSON.stringify([location.floorCode, location.areaCode]);
        if (floors.has(location.floorCode) && floors.get(location.floorCode) !== location.floorName || areas.has(areaKey) && areas.get(areaKey) !== location.areaName) throw new Error('目标位置层级信息不一致，请重新扫描');
        floors.set(location.floorCode, location.floorName); areas.set(areaKey, location.areaName); codes.add(location.locationCode);
      }
      if (result.recommendedDestination !== undefined) {
        const recommended = result.recommendedDestination;
        if (!validLocation(recommended) || !result.destinations.some(({ location }) =>
          ['locationCode', 'locationName', 'floorCode', 'floorName', 'areaCode', 'areaName'].every(key => location[key as keyof LocationCandidate] === recommended[key as keyof LocationCandidate]))) {
          throw new Error('推荐目标不在完整候选范围内，请重新扫描');
        }
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
  function openChoice() { if (active && !disabled.value && options.value?.eligibility.allowed && candidates.value.length) choosing.value = true; }
  function closeChoice() { if (active && !busy.value) choosing.value = false; }
  function choose(value: LocationCandidate) {
    if (!active || !choosing.value || busy.value) return;
    const selected = candidates.value.find((item) => item.locationCode === value.locationCode && item.floorCode === value.floorCode && item.areaCode === value.areaCode);
    if (selected) { destination.value = selected; choosing.value = false; }
  }
  async function createTask(input: CreateLogisticsRequest | ReturnLogisticsRequest, label: string) {
    if (attempt) {
      const { requestId: _previousId, ...previous } = attempt;
      const { requestId: _newId, ...next } = input;
      if (JSON.stringify(previous) === JSON.stringify(next)) input = attempt;
    }
    attempt = input;
    await run(async (current) => {
      let result;
      try { result = await (input.destinationMode === 'RETURN_LINE_SIDE' ? api.returnToWarehouse(input) : api.create(input)); }
      catch (error) {
        if (attempt === input && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      const task = result?.task;
      if (!result || 'resultType' in result || result.requestId !== input.requestId || !task || !validText(task.taskNo) || typeof task.taskId !== 'string' ||
        !/^[1-9][0-9]{0,18}$/.test(task.taskId) || !validVersion(task.version) || task.vendor !== input.vendor || task.taskType !== input.taskType ||
        !validContainer(task.container) || task.container.version < input.version || task.container.containerCode !== input.object.containerCode || task.container.containerType !== input.object.containerType ||
        !validLocation(task.origin) || task.origin.locationCode !== input.originLocationCode || !validLocation(task.destination) ||
        input.destinationMode !== 'RETURN_LINE_SIDE' && task.destination.locationCode !== input.destinationLocationCode ||
        !['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(task.status) || !validText(task.statusName) ||
        !validText(task.triggerMode) || typeof task.createdTime !== 'string' || !Number.isFinite(Date.parse(task.createdTime))) {
        throw new Error(`${label}创建结果不完整，未能确认任务已创建，请核实后重试原请求`);
      }
      clear(); notify(`${label}创建成功，任务编号：${task.taskNo}（${task.statusName}）`);
    });
  }
  async function submit() {
    if (!active || !canSubmit.value || !options.value || !destination.value) return;
    const source = options.value;
    await createTask({ requestId: requestId(), object: { containerType: source.object.containerType, containerCode: source.object.containerCode },
      version: source.object.version, vendor: source.vendor, taskType: source.taskType, originLocationCode: source.origin.locationCode,
      destinationLocationCode: destination.value.locationCode, ...(shippingNo ? { shippingNo } : {}) }, '物流任务');
  }
  async function returnToWarehouse() {
    if (!active || !canReturn.value || !options.value) return;
    const source = options.value;
    await createTask({ requestId: requestId(),
      object: { containerType: source.object.containerType, containerCode: source.object.containerCode },
      version: source.object.version, vendor: source.vendor, taskType: source.taskType,
      originLocationCode: source.origin.locationCode, destinationMode: 'RETURN_LINE_SIDE' }, '回库任务');
  }
  return { options, destination, candidates, choosing, busy, disabled, notice, canSubmit, canReturn, notify, clear, pause, resume, scan, openChoice, closeChoice, choose, submit, returnToWarehouse };
}
