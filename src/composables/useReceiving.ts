import { computed, ref, shallowRef } from 'vue';
import { receivingApi as api, type ReceivingResult, type ReceivingRequest, type ReceivingOperationReceipt } from '../services/receiving';
import { ApiRequestError, requestId } from '../services/nariRequest';
import type { BoxMaterials } from '../services/warehouseApplication';
import type { MaterialLine } from '../services/vehicleLoading';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';
import { usePendingSubmission, validSubmission } from './usePendingSubmission';

export function useReceiving() {
  const result = shallowRef<ReceivingResult | null>(null);
  const detail = shallowRef<BoxMaterials | null>(null);
  const confirmingClear = ref(false);
  const remark = ref('');
  const busy = ref(false);
  const cleaning = ref(false);
  const cleanup = usePendingSubmission<ReceivingRequest>('wms-cleanup', (value): value is ReceivingRequest =>
    validSubmission(value, ['taskId']) && typeof (value as ReceivingRequest).taskId === 'string' && /^[1-9][0-9]{0,18}$/.test((value as ReceivingRequest).taskId));
  const { pending, storageError } = cleanup;
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || cleaning.value || !!detail.value || confirmingClear.value || !!pending.value || !!storageError.value);
  const canReceive = computed(() => !disabled.value && result.value?.task?.eligibility.allowed === true &&
    result.value.task.receivedBoxCount < result.value.task.totalBoxCount && remark.value.trim().length <= 500);
  // WMS cleanup is independent of receiving eligibility; the backend checks cleanup conditions.
  const canClearWms = computed(() => !busy.value && !cleaning.value && !detail.value && !confirmingClear.value && !storageError.value && (!!pending.value || !!result.value?.task));
  const materials = computed(() => result.value?.object.containerType === 'BOX' ? result.value.boxes.flatMap((box) => box.materials) : []);
  let generation = 0;
  let active = true;
  const known = new Map<string, { taskId: string; version: number }>();
  let attempt: { input: ReceivingRequest; fingerprint: string } | null = null;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function resetView() { generation++; result.value = null; detail.value = null; confirmingClear.value = false; remark.value = ''; busy.value = false; notice.value = null; attempt = null; }
  function clear() { if (!pending.value && !storageError.value && !cleaning.value) resetView(); }
  function pause() { active = false; resetView(); }
  function resume() { active = true; if (!cleaning.value) cleanup.restore(); }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active || !cleanup.sameScope()) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => active && id === generation && cleanup.sameScope()); }
    catch (error) { if (active && id === generation && cleanup.sameScope()) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
  const optionalText = (value: unknown) => value === undefined || text(value);
  const integer = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
  const count = (value: unknown, min = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
  function validLocation(value: LocationSummary) {
    return value && text(value.locationCode) && text(value.locationName) &&
      [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
  }
  function validContainer(value: LocationContainer) {
    return value && ['BOX', 'VEHICLE'].includes(value.containerType) && text(value.containerCode) && integer(value.version) && optionalText(value.containerName) &&
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
  function validResult(data: ReceivingResult, code: string, taskId?: string) {
    if (!data || !validContainer(data.object) || data.object.containerCode !== code || !Array.isArray(data.boxes) || !integer(data.totalMaterialQuantity, 0) ||
      data.boxes.some(box => !box || !text(box.boxCode) || !integer(box.version) || !validMaterials(box.materials, box.materialQuantity)) ||
      new Set(data.boxes.map(box => box.boxCode)).size !== data.boxes.length || data.boxes.reduce((sum, box) => sum + box.materialQuantity, 0) !== data.totalMaterialQuantity) return false;
    const panels = data.boxes.flatMap(box => box.materials.filter(row => row.lineType === 'PANEL'));
    if (new Set(panels.map(row => row.panelCode)).size !== panels.length) return false;
    const task = data.task;
    if (task === undefined) return taskId === undefined && !data.boxes.length && data.totalMaterialQuantity === 0;
    return task && text(task.taskId, 20) && /^[1-9][0-9]{0,18}$/.test(task.taskId) && (taskId === undefined || task.taskId === taskId) && text(task.taskNo) && integer(task.version) &&
      validContainer(task.object) && task.object.containerType === data.object.containerType && task.object.containerCode === code && task.object.version === data.object.version &&
      (task.location === undefined || validLocation(task.location)) && text(task.statusName) && typeof task.createdTime === 'string' && Number.isFinite(Date.parse(task.createdTime)) &&
      typeof task.eligibility?.allowed === 'boolean' && (task.eligibility.allowed || text(task.eligibility.reason, 500)) &&
      count(task.totalBoxCount, 1) && count(task.receivedBoxCount) && task.receivedBoxCount <= task.totalBoxCount &&
      (task.status === 'PENDING' ? task.receivedBoxCount === 0 : task.status === 'PARTIAL' ? task.receivedBoxCount > 0 && task.receivedBoxCount < task.totalBoxCount :
        task.status === 'RECEIVED' && task.receivedBoxCount === task.totalBoxCount) &&
      (data.object.containerType === 'BOX' ? data.boxes.length === 1 && data.boxes[0].boxCode === code : data.boxes.length === task.totalBoxCount);
  }
  function remember(code: string, taskId: string, version: number) {
    for (const value of known.values()) if (value.taskId === taskId) value.version = Math.max(value.version, version);
    known.set(code, { taskId, version });
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    clear();
    const code = raw.trim();
    if (!text(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      let data = await api.query(code);
      if (!current()) return;
      if (!validResult(data, code)) throw new Error('接收任务或物料信息不完整，请重新扫描');
      const previous = known.get(code);
      if (!data.task && previous) {
        data = await api.query(code, previous.taskId); if (!current()) return;
        if (!validResult(data, code, previous.taskId)) throw new Error('原运输接收范围不完整，请重新核实');
      }
      const task = data.task;
      if (task) {
        if ([...known.values()].some(value => value.taskId === task.taskId && value.version > task.version)) throw new Error('接收任务版本已过期，请重新查询');
        remember(code, task.taskId, task.version);
        for (const box of data.boxes) remember(box.boxCode, task.taskId, task.version);
      }
      result.value = data;
      if (!task) notify(`当前${data.object.containerType === 'BOX' ? '箱子' : '载具'}无接收任务`, true);
      else if (!task.eligibility.allowed) notify(task.eligibility.reason!, true);
    });
  }
  async function openMaterials(boxCode: string) {
    if (disabled.value || !active || result.value?.object.containerType !== 'VEHICLE' || !result.value.boxes.some((box) => box.boxCode === boxCode)) return;
    await run(async (current) => {
      const data = await api.getMaterials(boxCode);
      if (!current()) return;
      if (!data || !validContainer(data.box) || data.box.containerType !== 'BOX' || data.box.containerCode !== boxCode ||
        !['LES', 'WMS'].includes(data.sourceSystem) || !validMaterials(data.materials, data.totalQuantity)) throw new Error('箱内物料信息不完整，请重试');
      detail.value = data;
    });
  }
  function closeMaterials() { if (!busy.value) detail.value = null; }
  function askClearWms() { if (active && canClearWms.value) { notice.value = null; confirmingClear.value = true; } }
  function cancelClearWms() { if (!busy.value) confirmingClear.value = false; }
  async function submitCleanup() {
    if (!active || !cleanup.sameScope() || !confirmingClear.value || busy.value || cleaning.value || storageError.value) return;
    const data = result.value;
    if (!pending.value && !data?.task) return;
    const replay = !!pending.value;
    const input = pending.value?.input || { requestId: requestId(), taskId: data!.task!.taskId, version: data!.task!.version,
      object: { containerType: data!.object.containerType, containerCode: data!.object.containerCode } };
    await run(async (current) => {
      cleanup.save(input, pending.value?.reason || '正在确认本次 WMS 清理结果');
      cleaning.value = true;
      let completed = false;
      let failure = '';
      try {
        const receipt = await api.clearWms(input);
        if (!receipt || typeof receipt !== 'object' || 'resultType' in receipt || receipt.requestId !== input.requestId || !integer(receipt.affectedCount, 0) ||
          typeof receipt.processedTime !== 'string' || !Number.isFinite(Date.parse(receipt.processedTime))) throw new Error('清理结果不完整，请核实后重试原请求');
        cleanup.finish(input.requestId);
        completed = true;
      } catch (error) {
        if (!replay && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) cleanup.finish(input.requestId);
        cleanup.failed(error);
        failure = error instanceof Error ? error.message : '清理失败，请核实结果';
      } finally { cleaning.value = false; }
      if (!current()) return;
      // Both registration and result persistence can advance the task version, even on failure.
      // Refresh only this transport scope; never substitute another pending task or rewrite the saved request.
      try {
        const fresh = await api.query(input.object.containerCode, input.taskId);
        if (!current()) return;
        if (!validResult(fresh, input.object.containerCode, input.taskId) || fresh.object.containerType !== input.object.containerType ||
          fresh.task!.version < input.version || [...known.values()].some(value => value.taskId === input.taskId && value.version > fresh.task!.version)) throw new Error('任务版本或清理范围不一致');
        remember(input.object.containerCode, input.taskId, fresh.task!.version);
        for (const box of fresh.boxes) remember(box.boxCode, input.taskId, fresh.task!.version);
        result.value = fresh;
      } catch (error) {
        if (!current()) return;
        result.value = null;
        failure += `${failure ? '；' : ''}任务刷新失败，请重新核实：${error instanceof Error ? error.message : '查询失败'}`;
      }
      confirmingClear.value = false;
      if (completed) { resetView(); notify(`当前对象的 WMS 历史已清空${failure ? '；' + failure : ''}`, !!failure); }
      else notify(failure, true);
    });
  }
  async function submit(cleanup = false) {
    if (cleanup) { await submitCleanup(); return; }
    if (!active || detail.value || !canReceive.value) return;
    const data = result.value;
    if (!data?.task) return;
    const body = { taskId: data.task.taskId, version: data.task.version, object: { containerType: data.object.containerType, containerCode: data.object.containerCode },
      ...(remark.value.trim() ? { remark: remark.value.trim() } : {}) };
    const fingerprint = JSON.stringify({ cleanup, body });
    const pending = attempt?.fingerprint === fingerprint ? attempt : { input: { requestId: requestId(), ...body }, fingerprint };
    attempt = pending;
    const input = pending.input;
    await run(async (current) => {
      let receipt;
      try { receipt = await api.confirm(input); }
      catch (error) {
        if (attempt === pending && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      if (!receipt || typeof receipt !== 'object' || 'resultType' in receipt || receipt.requestId !== input.requestId || !integer(receipt.affectedCount, 0) ||
        typeof receipt.processedTime !== 'string' || !Number.isFinite(Date.parse(receipt.processedTime))) throw new Error('处理结果不完整，未能确认成功，请核实后重试原请求');
      const confirmed = receipt as ReceivingOperationReceipt;
      const expected = data.object.containerType === 'BOX' ? 1 : data.task!.totalBoxCount - data.task!.receivedBoxCount;
      if (confirmed.taskId !== input.taskId || confirmed.object?.containerType !== input.object.containerType || confirmed.object.containerCode !== input.object.containerCode ||
        !integer(confirmed.version) || confirmed.version <= input.version || confirmed.affectedCount !== expected) throw new Error('接收回执与本次范围或最新版本不一致，未能确认成功，请核实后重试原请求');
      remember(data.object.containerCode, confirmed.taskId, confirmed.version);
      clear();
      notify('接收完成，当前接收流程已结束');
    });
  }
  return { pending, storageError, result, materials, detail, confirmingClear, remark, busy, disabled, canReceive, canClearWms, notice, notify, clear, pause, resume, scan,
    openMaterials, closeMaterials, askClearWms, cancelClearWms, submit };
}
