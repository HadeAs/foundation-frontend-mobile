import { computed, ref, shallowRef } from 'vue';
import { warehouseLogisticsApi as api, type WarehouseLogisticsOptions, type WarehouseLogisticsRequest } from '../services/warehouseLogistics';
import type { LocationCandidate } from '../services/logistics';
import type { BoxMaterials } from '../services/warehouseApplication';
import type { MaterialLine } from '../services/vehicleLoading';
import { requestId } from '../services/nariRequest';

const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 128;
const integer = (v: unknown, min = 1): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
function validMaterials(rows: MaterialLine[], total: number) {
  return Array.isArray(rows) && integer(total, 0) && rows.every((row) => row && [row.orderNo, row.materialCode, row.materialName, row.unit].every(text) &&
    integer(row.quantity) && (row.lineType === 'PANEL' ? text(row.panelCode) : row.lineType === 'QUANTITY' && row.panelCode === undefined)) &&
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
  const canSubmit = computed(() => !disabled.value && options.value?.object.containerType === 'VEHICLE' && !!destination.value);
  let generation = 0;
  function notify(message: string, error = false) { notice.value = { text: message, error }; }
  function clear() {
    generation++; options.value = null; scanCode.value = ''; scanType.value = 'VEHICLE'; destination.value = null;
    detail.value = null; choosing.value = false; busy.value = false; notice.value = null;
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => id === generation); }
    catch (cause) { if (id === generation) notify(cause instanceof Error ? cause.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  async function scan(raw: string) {
    if (disabled.value) return;
    clear(); const code = raw.trim();
    if (!text(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const result = await api.getOptions(code);
      if (!current()) return;
      if (result?.eligibility?.allowed === false) throw new Error(result.eligibility.reason || '当前对象不满足缴库发起条件');
      if (result?.object?.containerType === 'BOX') throw new Error('当前位置绑定的是料箱，不允许缴库发起');
      if (!result || result.eligibility?.allowed !== true || !text(result.object?.containerCode) || !['VEHICLE', 'BOX'].includes(result.object.containerType) ||
        !integer(result.object.version) || !text(result.origin?.locationCode) || !text(result.origin.locationName) ||
        !['STANDARD', 'HIKVISION'].includes(result.vendor) || !['GENERAL', 'PROCESS_ROUTE'].includes(result.taskType) ||
        result.vendor === 'HIKVISION' && result.taskType !== 'GENERAL' || !Array.isArray(result.destinations) || !result.destinations.length ||
        !Array.isArray(result.boxes) || !integer(result.totalMaterialQuantity, 0) ||
        result.boxes.some((box) => !box || !text(box.boxCode) || !integer(box.version) || !validMaterials(box.materials, box.materialQuantity)) ||
        new Set(result.boxes.map((box) => box.boxCode)).size !== result.boxes.length ||
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
        if (!location || ![location.locationCode, location.locationName, location.floorCode, location.floorName, location.areaCode, location.areaName].every(text) ||
            typeof item.recommended !== 'boolean' || codes.has(location.locationCode)) throw new Error('目标地点层级或候选信息不完整，请重新扫描');
        const areaKey = JSON.stringify([location.floorCode, location.areaCode]);
        if (floors.has(location.floorCode) && floors.get(location.floorCode) !== location.floorName || areas.has(areaKey) && areas.get(areaKey) !== location.areaName) throw new Error('目标地点层级信息不一致，请重新扫描');
        floors.set(location.floorCode, location.floorName); areas.set(areaKey, location.areaName); codes.add(location.locationCode);
      }
      const recommended = result.destinations.filter((item) => item.recommended);
      const fields: (keyof LocationCandidate)[] = ['locationCode', 'locationName', 'floorCode', 'floorName', 'areaCode', 'areaName'];
      if (recommended.length !== 1 || !result.recommendedDestination || fields.some((key) => recommended[0].location[key] !== result.recommendedDestination[key])) {
        throw new Error('推荐目标地点与候选集合不一致，请重新扫描');
      }
      options.value = result; scanCode.value = code; scanType.value = isLocation ? 'LOCATION' : 'VEHICLE'; destination.value = recommended[0].location;
    });
  }
  function openChoice() { if (!disabled.value && candidates.value.length > 1) choosing.value = true; }
  function closeChoice() { choosing.value = false; }
  function choose(value: LocationCandidate) {
    if (!choosing.value || busy.value) return;
    const match = candidates.value.find((item) => item.locationCode === value.locationCode && item.floorCode === value.floorCode && item.areaCode === value.areaCode);
    if (match) { destination.value = match; choosing.value = false; }
  }
  async function openMaterials(boxCode: string) {
    if (disabled.value || !options.value?.boxes.some((box) => box.boxCode === boxCode)) return;
    await run(async (current) => {
      const result = await api.getMaterials(boxCode);
      if (!current()) return;
      if (!result || result.box?.containerType !== 'BOX' || result.box.containerCode !== boxCode || !integer(result.box.version) ||
          !['LES', 'WMS'].includes(result.sourceSystem) || !validMaterials(result.materials, result.totalQuantity)) throw new Error('箱内物料信息不完整，请重试');
      detail.value = result;
    });
  }
  function closeMaterials() { if (!busy.value) detail.value = null; }
  async function submit() {
    if (!canSubmit.value || !options.value || !destination.value) return;
    const source = options.value;
    const input: WarehouseLogisticsRequest = { requestId: requestId(), scanType: scanType.value, scanCode: scanCode.value,
      object: { containerType: source.object.containerType, containerCode: source.object.containerCode },
      version: source.object.version, destinationLocationCode: destination.value.locationCode };
    await run(async (current) => {
      const result = await api.create(input);
      if (!current()) return;
      if (!result || result.requestId !== input.requestId || !text(result.task?.taskNo) || typeof result.task.taskId !== 'string' ||
          !/^[1-9][0-9]{0,18}$/.test(result.task.taskId) || !text(result.task.statusName) || result.task.container?.containerCode !== input.object.containerCode ||
          result.task.container.containerType !== input.object.containerType || result.task.origin?.locationCode !== source.origin.locationCode ||
          result.task.destination?.locationCode !== input.destinationLocationCode) throw new Error('任务创建结果不完整，请核实后重试');
      clear(); notify(`缴库物流任务创建成功，任务编号：${result.task.taskNo}`);
    });
  }
  return { options, scanCode, scanType, destination, candidates, detail, choosing, busy, disabled, canSubmit, notice,
    notify, clear, scan, openChoice, closeChoice, choose, openMaterials, closeMaterials, submit };
}
