import { computed, ref, shallowRef } from 'vue';
import { warehouseApplicationApi as api, type ApplicationObject, type BoxMaterials } from '../services/warehouseApplication';
import type { MaterialLine } from '../services/vehicleLoading';
import type { LocationContainer } from '../services/locationBinding';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { usePendingSubmission, validSubmission, type SubmissionInput } from './usePendingSubmission';

export function useWarehouseApplication() {
  const object = shallowRef<ApplicationObject | null>(null);
  const detail = shallowRef<BoxMaterials | null>(null);
  const busy = ref(false);
  const writing = ref(false);
  const saved = usePendingSubmission<SubmissionInput>('warehouse-applications', validSubmission);
  const { pending, storageError } = saved;
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || writing.value || !!detail.value || !!pending.value || !!storageError.value);
  const canSubmit = computed(() => !busy.value && !writing.value && !detail.value && !storageError.value &&
    (!!pending.value || !!object.value?.eligibility.allowed && object.value.totalMaterialQuantity > 0));
  const materials = computed(() => object.value?.object.containerType === 'BOX' ? object.value.boxes.flatMap((box) => box.materials) : []);
  let generation = 0;
  let active = true;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function resetView() { generation++; object.value = null; detail.value = null; busy.value = false; notice.value = null; }
  function clear() { if (!pending.value && !storageError.value && !writing.value) resetView(); }
  function pause() { active = false; resetView(); }
  function resume() { active = true; if (!writing.value) saved.restore(); }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active || !saved.sameScope()) return;
    const id = generation;
    busy.value = true;
    notice.value = null;
    try { await action(() => active && id === generation && saved.sameScope()); }
    catch (error) { if (active && id === generation && saved.sameScope()) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  function text(value: unknown, max = 128): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max; }
  function optionalText(value: unknown) { return value === undefined || text(value); }
  function integer(value: unknown, min = 1) { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647; }
  function validContainer(value: LocationContainer | undefined) {
    return !!value && ['BOX', 'VEHICLE'].includes(value.containerType) && text(value.containerCode) && integer(value.version) && optionalText(value.containerName) &&
      (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
      (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) &&
      (value.location === undefined || value.location && text(value.location.locationCode) && text(value.location.locationName) &&
        [value.location.locationType, value.location.floorCode, value.location.floorName, value.location.areaCode, value.location.areaName].every(optionalText));
  }
  function validMaterials(rows: MaterialLine[], total: number) {
    return Array.isArray(rows) && integer(total, 0) && rows.every((row) => row && text(row.orderNo) && text(row.materialCode) &&
      [row.materialName, row.unit, row.materialBatch, row.orderLineNo].every(optionalText) &&
      (row.lineType === 'PANEL' ? text(row.panelCode) && row.quantity === 1 : row.lineType === 'QUANTITY' && row.panelCode === undefined && integer(row.quantity))) &&
      new Set(rows.filter(row => row.lineType === 'PANEL').map(row => row.panelCode)).size === rows.filter(row => row.lineType === 'PANEL').length &&
      rows.reduce((sum, row) => sum + row.quantity, 0) === total;
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    clear();
    const code = raw.trim();
    if (!text(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const result = await api.getObject(code);
      if (!current()) return;
      if (!result || !validContainer(result.object) || !['BOX', 'VEHICLE'].includes(result.scanType) || result.scanCode !== code ||
        result.scanType !== result.object.containerType || !Array.isArray(result.boxes) || !integer(result.totalMaterialQuantity, 0) ||
        typeof result.eligibility?.allowed !== 'boolean' || (!result.eligibility.allowed && !text(result.eligibility.reason, 500)) ||
        result.boxes.some((box) => !box || !text(box.boxCode) || !integer(box.version) || !validMaterials(box.materials, box.materialQuantity)) ||
        new Set(result.boxes.map((box) => box.boxCode)).size !== result.boxes.length ||
        new Set(result.boxes.flatMap(box => box.materials.filter(row => row.lineType === 'PANEL').map(row => row.panelCode))).size !==
          result.boxes.reduce((sum, box) => sum + box.materials.filter(row => row.lineType === 'PANEL').length, 0) ||
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
    if (disabled.value || !active || object.value?.object.containerType !== 'VEHICLE' || !object.value.boxes.some((box) => box.boxCode === boxCode)) return;
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
    if (!canSubmit.value || !active || !saved.sameScope()) return;
    const replay = !!pending.value;
    const value = object.value?.object;
    const input = pending.value?.input || { requestId: requestId(), object: { containerType: value!.containerType, containerCode: value!.containerCode }, version: value!.version };
    await run(async (current) => {
      saved.save(input, pending.value?.reason || '正在确认本次缴库申请结果');
      writing.value = true;
      try {
        let result;
        try { result = await api.submit(input.object, input.version, input.requestId); }
        catch (error) {
          // 409 also covers partial/unknown processing; it does not prove that no SAP/WMS work happened.
          if (!replay && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && ![408, 409].includes(error.statusCode)) saved.finish(input.requestId);
          throw error;
        }
        if (!result || typeof result !== 'object' || 'resultType' in result || result.requestId !== input.requestId || result.wmsPendingCreated !== true || !text(result.applicationNo) || !Array.isArray(result.sapDocumentNos) ||
          !result.sapDocumentNos.length || result.sapDocumentNos.length > 1000 || !result.sapDocumentNos.every(no => text(no)) ||
          !text(result.processedTime) || !Number.isFinite(Date.parse(result.processedTime))) throw new Error('申请结果不完整，未能确认全部处理成功，请核实后重试');
        saved.finish(input.requestId);
        if (!current()) return;
        resetView();
        notify(`缴库申请成功，缴库单号：${result.sapDocumentNos.join('、')}`);
      } catch (error) { saved.failed(error); throw error; }
      finally { writing.value = false; }
    });
  }
  return { pending, storageError, object, materials, detail, busy, disabled, canSubmit, notice, notify, clear, pause, resume, scan, openMaterials, closeMaterials, submit };
}
