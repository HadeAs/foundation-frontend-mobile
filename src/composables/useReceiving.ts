import { computed, ref, shallowRef } from 'vue';
import { receivingApi as api, type ReceivingResult, type ReceivingRequest } from '../services/receiving';
import { requestId } from '../services/nariRequest';
import type { BoxMaterials } from '../services/warehouseApplication';
import type { MaterialLine } from '../services/vehicleLoading';

export function useReceiving() {
  const result = shallowRef<ReceivingResult | null>(null);
  const detail = shallowRef<BoxMaterials | null>(null);
  const confirmingClear = ref(false);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!detail.value || confirmingClear.value);
  const canReceive = computed(() => !disabled.value && result.value?.task?.eligibility.allowed === true);
  // WMS cleanup is independent of receiving eligibility; the backend checks cleanup conditions.
  const canClearWms = computed(() => !disabled.value && !!result.value?.task);
  const materials = computed(() => result.value?.object.containerType === 'BOX' ? result.value.boxes.flatMap((box) => box.materials) : []);
  let generation = 0;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() { generation++; result.value = null; detail.value = null; confirmingClear.value = false; busy.value = false; notice.value = null; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => id === generation); }
    catch (error) { if (id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  const text = (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= 128;
  const integer = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
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
      const data = await api.query(code);
      if (!current()) return;
      const task = data?.task;
      if (!data || !['BOX', 'VEHICLE'].includes(data.object?.containerType) || data.object.containerCode !== code || !integer(data.object.version) ||
        !Array.isArray(data.boxes) || !integer(data.totalMaterialQuantity, 0) ||
        data.boxes.some((box) => !box || !text(box.boxCode) || !integer(box.version) || !validMaterials(box.materials, box.materialQuantity)) ||
        new Set(data.boxes.map((box) => box.boxCode)).size !== data.boxes.length ||
        data.boxes.reduce((sum, box) => sum + box.materialQuantity, 0) !== data.totalMaterialQuantity ||
        (task === undefined ? data.boxes.length !== 0 || data.totalMaterialQuantity !== 0 :
          !task || typeof task.taskId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(task.taskId) || !text(task.taskNo) || !integer(task.version) ||
          task.object?.containerType !== data.object.containerType || task.object.containerCode !== code || task.object.version !== data.object.version ||
          !text(task.status) || !text(task.statusName) || !Number.isFinite(Date.parse(task.createdTime)) ||
          typeof task.eligibility?.allowed !== 'boolean' || (!task.eligibility.allowed && !task.eligibility.reason?.trim()) || !data.boxes.length ||
          (data.object.containerType === 'BOX' && (data.boxes.length !== 1 || data.boxes[0].boxCode !== code)))) {
        throw new Error('接收任务或物料信息不完整，请重新扫描');
      }
      result.value = data;
      if (!task) notify(`当前${data.object.containerType === 'BOX' ? '箱子' : '载具'}无接收任务`, true);
      else if (!task.eligibility.allowed) notify(task.eligibility.reason!, true);
    });
  }
  async function openMaterials(boxCode: string) {
    if (disabled.value || result.value?.object.containerType !== 'VEHICLE' || !result.value.boxes.some((box) => box.boxCode === boxCode)) return;
    await run(async (current) => {
      const data = await api.getMaterials(boxCode);
      if (!current()) return;
      if (!data || data.box?.containerType !== 'BOX' || data.box.containerCode !== boxCode || !integer(data.box.version) ||
        !['LES', 'WMS'].includes(data.sourceSystem) || !validMaterials(data.materials, data.totalQuantity)) throw new Error('箱内物料信息不完整，请重试');
      detail.value = data;
    });
  }
  function closeMaterials() { if (!busy.value) detail.value = null; }
  function askClearWms() { if (canClearWms.value) confirmingClear.value = true; }
  function cancelClearWms() { if (!busy.value) confirmingClear.value = false; }
  async function submit(cleanup = false) {
    if (cleanup ? !confirmingClear.value || busy.value : !canReceive.value) return;
    const data = result.value;
    if (!data?.task) return;
    const input: ReceivingRequest = { requestId: requestId(), taskId: data.task.taskId, version: data.task.version };
    await run(async (current) => {
      const receipt = cleanup ? await api.clearWms({ ...input, object: { containerType: data.object.containerType, containerCode: data.object.containerCode } }) : await api.confirm(input);
      if (!current()) return;
      if (!receipt || receipt.requestId !== input.requestId || !text(receipt.operationNo) || !integer(receipt.affectedCount, 0) ||
        !Number.isFinite(Date.parse(receipt.processedTime))) throw new Error('处理结果不完整，未能确认成功，请核实后重试');
      clear();
      notify(cleanup ? '当前对象的 WMS 历史已清空' : '接收完成，当前接收流程已结束');
    });
  }
  return { result, materials, detail, confirmingClear, busy, disabled, canReceive, canClearWms, notice, notify, clear, scan,
    openMaterials, closeMaterials, askClearWms, cancelClearWms, submit };
}
