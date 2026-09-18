import { computed, ref, shallowRef } from 'vue';
import { warehouseApplicationApi as api, type ApplicationObject, type BoxMaterials } from '../services/warehouseApplication';
import type { MaterialLine } from '../services/vehicleLoading';
import type { LocationContainer } from '../services/locationBinding';

export function useWarehouseApplication() {
  const object = shallowRef<ApplicationObject | null>(null);
  const detail = shallowRef<BoxMaterials | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!detail.value);
  const canSubmit = computed(() => !disabled.value && !!object.value?.eligibility.allowed && object.value.totalMaterialQuantity > 0);
  const materials = computed(() => object.value?.object.containerType === 'BOX' ? object.value.boxes.flatMap((box) => box.materials) : []);
  let generation = 0;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() { generation++; object.value = null; detail.value = null; busy.value = false; notice.value = null; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = generation;
    busy.value = true;
    notice.value = null;
    try { await action(() => id === generation); }
    catch (error) { if (id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  function text(value: unknown) { return typeof value === 'string' && !!value.trim() && value.length <= 128; }
  function integer(value: unknown, min = 1) { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647; }
  function validContainer(value: LocationContainer | undefined) {
    return !!value && ['BOX', 'VEHICLE'].includes(value.containerType) && text(value.containerCode) && integer(value.version);
  }
  function validMaterials(rows: MaterialLine[], total: number) {
    return Array.isArray(rows) && integer(total, 0) && rows.every((row) => row && text(row.orderNo) && text(row.materialCode) && text(row.materialName) &&
      text(row.unit) && integer(row.quantity) && (row.lineType === 'PANEL' ? text(row.panelCode) : row.lineType === 'QUANTITY' && row.panelCode === undefined)) &&
      rows.reduce((sum, row) => sum + row.quantity, 0) === total;
  }
  async function scan(raw: string) {
    if (disabled.value) return;
    clear();
    const code = raw.trim();
    if (!text(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const result = await api.getObject(code);
      if (!current()) return;
      if (!result || !validContainer(result.object) || !['BOX', 'VEHICLE'].includes(result.scanType) || result.scanCode !== code ||
        result.scanType !== result.object.containerType || !Array.isArray(result.boxes) || !integer(result.totalMaterialQuantity, 0) ||
        typeof result.eligibility?.allowed !== 'boolean' || (!result.eligibility.allowed && !result.eligibility.reason?.trim()) ||
        result.boxes.some((box) => !box || !text(box.boxCode) || !integer(box.version) || !validMaterials(box.materials, box.materialQuantity)) ||
        new Set(result.boxes.map((box) => box.boxCode)).size !== result.boxes.length ||
        result.boxes.reduce((sum, box) => sum + box.materialQuantity, 0) !== result.totalMaterialQuantity ||
        (result.object.containerType === 'BOX' && (result.boxes.length > 1 || result.boxes.some((box) => box.boxCode !== result.object.containerCode || box.version !== result.object.version)))) {
        throw new Error('对象或物料信息不完整，请重新扫描');
      }
      object.value = result;
      if (!result.eligibility.allowed) notify(result.eligibility.reason!, true);
      else if (!result.totalMaterialQuantity) notify('当前对象无可处理物料', true);
    });
  }
  async function openMaterials(boxCode: string) {
    if (disabled.value || object.value?.object.containerType !== 'VEHICLE' || !object.value.boxes.some((box) => box.boxCode === boxCode)) return;
    const selected = object.value;
    await run(async (current) => {
      const result = await api.getMaterials(boxCode);
      if (!current() || object.value !== selected) return;
      if (!result || !validContainer(result.box) || result.box.containerType !== 'BOX' || result.box.containerCode !== boxCode ||
        !['LES', 'WMS'].includes(result.sourceSystem) || !validMaterials(result.materials, result.totalQuantity)) throw new Error('箱内物料信息不完整，请重试');
      // Detail query is read-only and must not replace the submission snapshot/version.
      detail.value = result;
    });
  }
  function closeMaterials() { if (!busy.value) detail.value = null; }
  async function submit() {
    if (!canSubmit.value || !object.value) return;
    const target = object.value.object;
    await run(async (current) => {
      const result = await api.submit({ containerType: target.containerType, containerCode: target.containerCode }, target.version);
      if (!current()) return;
      if (!result || result.wmsPendingCreated !== true || !text(result.applicationNo) || !Array.isArray(result.sapDocumentNos) ||
        !result.sapDocumentNos.length || result.sapDocumentNos.length > 1000 || !result.sapDocumentNos.every(text) || !text(result.requestId) ||
        !text(result.processedTime) || !Number.isFinite(Date.parse(result.processedTime))) throw new Error('申请结果不完整，未能确认全部处理成功，请核实后重试');
      clear();
      notify(`缴库申请成功，缴库单号：${result.sapDocumentNos.join('、')}`);
    });
  }
  return { object, materials, detail, busy, disabled, canSubmit, notice, notify, clear, scan, openMaterials, closeMaterials, submit };
}
