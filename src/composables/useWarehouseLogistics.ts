import { computed, ref, shallowRef } from 'vue';
import { warehouseLogisticsApi as api, type WarehouseLogisticsOptions, type WarehouseLogisticsRequest } from '../services/warehouseLogistics';
import type { LocationCandidate } from '../services/logistics';
import type { BoxMaterials } from '../services/warehouseApplication';
import type { MaterialLine } from '../services/vehicleLoading';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';
import { ApiRequestError, requestId } from '../services/nariRequest';

const text = (v: unknown, max = 128): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const optionalText = (v: unknown) => v === undefined || text(v);
const integer = (v: unknown, min = 1): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
function validLocation(value: LocationSummary | undefined) {
  return !!value && text(value.locationCode) && text(value.locationName) &&
    [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
}
function validContainer(value: LocationContainer | undefined) {
  return !!value && ['BOX', 'VEHICLE'].includes(value.containerType) && text(value.containerCode) && integer(value.version) && optionalText(value.containerName) &&
    (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
    (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) &&
    (value.location === undefined || validLocation(value.location));
}
function validMaterials(rows: MaterialLine[], total: number) {
  return Array.isArray(rows) && integer(total, 0) && rows.every((row) => row && text(row.orderNo) && text(row.materialCode) &&
    [row.materialName, row.unit, row.materialBatch, row.orderLineNo].every(optionalText) &&
    (row.lineType === 'PANEL' ? text(row.panelCode) && row.quantity === 1 : row.lineType === 'QUANTITY' && row.panelCode === undefined && integer(row.quantity))) &&
    new Set(rows.filter(row => row.lineType === 'PANEL').map(row => row.panelCode)).size === rows.filter(row => row.lineType === 'PANEL').length &&
    rows.reduce((sum, row) => sum + row.quantity, 0) === total;
}

export function useWarehouseLogistics() {
  const options = shallowRef<WarehouseLogisticsOptions | null>(null);
  const scanCode = ref('');
  const scanType = ref<WarehouseLogisticsRequest['scanType']>('VEHICLE');
  const destination = shallowRef<LocationCandidate | null>(null);
  const detail = shallowRef<BoxMaterials | null>(null);
  const choosing = ref(false);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || choosing.value || !!detail.value);
  const candidates = computed(() => options.value?.destinations.map((item) => item.location) || []);
  const canSubmit = computed(() => !disabled.value && !!options.value?.eligibility.allowed && options.value?.object.containerType === 'VEHICLE' && !!destination.value);
  let generation = 0;
  let active = true;
  let attempt: WarehouseLogisticsRequest | null = null;
  function notify(message: string, error = false) { if (active) notice.value = { text: message, error }; }
  function clear() {
    generation++; options.value = null; scanCode.value = ''; scanType.value = 'VEHICLE'; destination.value = null;
    detail.value = null; choosing.value = false; busy.value = false; notice.value = null; attempt = null;
  }
  function pause() { active = false; clear(); }
  function resume() { active = true; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => active && id === generation); }
    catch (cause) { if (active && id === generation) notify(cause instanceof Error ? cause.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    clear(); const code = raw.trim();
    if (!text(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const result = await api.getOptions(code);
      if (!current()) return;
      if (result?.eligibility?.allowed === false && text(result.eligibility.reason, 500)) throw new Error(result.eligibility.reason);
      if (result?.object?.containerType === 'BOX') throw new Error('当前位置绑定的是料箱，不允许缴库发起');
      if (!result || result.eligibility?.allowed !== true || result.eligibility.reason !== undefined && !text(result.eligibility.reason, 500) ||
        !validContainer(result.object) || !validLocation(result.origin) || !['STANDARD', 'HIKVISION'].includes(result.vendor) || result.taskType !== 'GENERAL' ||
        !Array.isArray(result.destinations) || !result.destinations.length ||
        !Array.isArray(result.boxes) || !integer(result.totalMaterialQuantity, 0) ||
        result.boxes.some((box) => !box || !text(box.boxCode) || !integer(box.version) || !validMaterials(box.materials, box.materialQuantity)) ||
        new Set(result.boxes.map((box) => box.boxCode)).size !== result.boxes.length ||
        new Set(result.boxes.flatMap(box => box.materials.filter(row => row.lineType === 'PANEL').map(row => row.panelCode))).size !==
          result.boxes.reduce((sum, box) => sum + box.materials.filter(row => row.lineType === 'PANEL').length, 0) ||
        result.boxes.reduce((sum, box) => sum + box.materialQuantity, 0) !== result.totalMaterialQuantity) {
        throw new Error('缴库发起信息不完整，请重新扫描');
      }
      // The query schema omits scanType: match returned identities, never guess from barcode prefixes.
      const isVehicle = result.object.containerType === 'VEHICLE' && result.object.containerCode === code;
      const isLocation = result.origin.locationCode === code;
      if (isVehicle === isLocation) throw new Error('扫描编码与返回对象无法唯一匹配，请核实接口数据');
      const floors = new Map<string, string>(); const areas = new Map<string, string>(); const codes = new Set<string>();
      for (const item of result.destinations) {
        const location = item?.location;
        if (!validLocation(location) || ![location.floorCode, location.floorName, location.areaCode, location.areaName].every(value => text(value)) ||
            typeof item.recommended !== 'boolean' || codes.has(location.locationCode)) throw new Error('目标地点层级或候选信息不完整，请重新扫描');
        const areaKey = JSON.stringify([location.floorCode, location.areaCode]);
        if (floors.has(location.floorCode) && floors.get(location.floorCode) !== location.floorName || areas.has(areaKey) && areas.get(areaKey) !== location.areaName) throw new Error('目标地点层级信息不一致，请重新扫描');
        floors.set(location.floorCode, location.floorName); areas.set(areaKey, location.areaName); codes.add(location.locationCode);
      }
      const recommended = result.destinations.filter((item) => item.recommended);
      const fields: (keyof LocationCandidate)[] = ['locationCode', 'locationName', 'floorCode', 'floorName', 'areaCode', 'areaName'];
      if (recommended.length !== 1 || !validLocation(result.recommendedDestination) || fields.some((key) => recommended[0].location[key] !== result.recommendedDestination[key])) {
        throw new Error('推荐目标地点与候选集合不一致，请重新扫描');
      }
      options.value = result; scanCode.value = code; scanType.value = isLocation ? 'LOCATION' : 'VEHICLE'; destination.value = recommended[0].location;
    });
  }
  function openChoice() { if (active && !disabled.value && candidates.value.length > 1) { notice.value = null; choosing.value = true; } }
  function closeChoice() { if (active && !busy.value) choosing.value = false; }
  function choose(value: LocationCandidate) {
    if (!active || !choosing.value || busy.value) return;
    const match = candidates.value.find((item) => item.locationCode === value.locationCode && item.floorCode === value.floorCode && item.areaCode === value.areaCode);
    if (match) { if (match !== destination.value) attempt = null; destination.value = match; choosing.value = false; }
  }
  async function openMaterials(boxCode: string) {
    if (!active || disabled.value || !options.value?.boxes.some((box) => box.boxCode === boxCode)) return;
    await run(async (current) => {
      const result = await api.getMaterials(boxCode);
      if (!current()) return;
      if (!result || !validContainer(result.box) || result.box.containerType !== 'BOX' || result.box.containerCode !== boxCode ||
          !['LES', 'WMS'].includes(result.sourceSystem) || !validMaterials(result.materials, result.totalQuantity)) throw new Error('箱内物料信息不完整，请重试');
      detail.value = result;
    });
  }
  function closeMaterials() { if (active && !busy.value) detail.value = null; }
  async function submit() {
    if (!active || !canSubmit.value || !options.value || !destination.value) return;
    const source = options.value;
    const input: WarehouseLogisticsRequest = attempt || { requestId: requestId(), scanType: scanType.value, scanCode: scanCode.value,
      object: { containerType: source.object.containerType, containerCode: source.object.containerCode },
      version: source.object.version, destinationLocationCode: destination.value.locationCode };
    attempt = input;
    await run(async (current) => {
      let result;
      try { result = await api.create(input); }
      catch (cause) {
        if (attempt === input && cause instanceof ApiRequestError && cause.statusCode >= 400 && cause.statusCode < 500 && cause.statusCode !== 408) attempt = null;
        throw cause;
      }
      if (!current()) return;
      const task = result?.task;
      if (!result || typeof result !== 'object' || 'resultType' in result || result.requestId !== input.requestId || !task || !text(task.taskNo) ||
          typeof task.taskId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(task.taskId) || !integer(task.version) || task.vendor !== source.vendor || task.taskType !== source.taskType ||
          !validContainer(task.container) || task.container.version < input.version || task.container.containerCode !== input.object.containerCode || task.container.containerType !== input.object.containerType ||
          !validLocation(task.origin) || task.origin.locationCode !== source.origin.locationCode || !validLocation(task.destination) || task.destination.locationCode !== input.destinationLocationCode ||
          !['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(task.status) || !text(task.statusName) ||
          !text(task.triggerMode) || !optionalText(task.agvCode) || !optionalText(task.agvName) || typeof task.createdTime !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(task.createdTime) || !Number.isFinite(Date.parse(task.createdTime))) {
        throw new Error('任务创建结果不完整，未能确认任务已创建，请核实后重试原请求');
      }
      clear(); notify(`缴库物流任务创建成功，任务编号：${task.taskNo}（${task.statusName}）`);
    });
  }
  return { options, scanCode, scanType, destination, candidates, detail, choosing, busy, disabled, canSubmit, notice,
    notify, clear, pause, resume, scan, openChoice, closeChoice, choose, openMaterials, closeMaterials, submit };
}
