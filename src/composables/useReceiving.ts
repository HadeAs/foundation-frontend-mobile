import { useReceivingVehicleRelease } from './useReceivingVehicleRelease';
import { computed, ref, shallowRef } from 'vue';
import { receivingApi as api, isReceivingId, receivingIdentity, type ClearWmsRequest, type ReceivingIdentity, type ReceivingResult, type ReceivingRequest, type ReceivingTask } from '../services/receiving';
import { ApiRequestError, requestId } from '../services/nariRequest';
import type { BoxMaterials } from '../services/warehouseApplication';
import type { MaterialLine } from '../services/vehicleLoading';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';
import { usePendingSubmission, validSubmission } from './usePendingSubmission';

type ReceivingSubmission = ReceivingRequest & { expectedCount: number };

export function useReceiving() {
  const result = shallowRef<ReceivingResult | null>(null);
  const detail = shallowRef<BoxMaterials | null>(null);
  const confirmingClear = ref(false);
  const remark = ref('');
  const busy = ref(false);
  const cleaning = ref(false);
  const submitting = ref(false);
  const cleanup = usePendingSubmission<ClearWmsRequest>('wms-cleanup', (value): value is ClearWmsRequest =>
    validSubmission(value, ['taskId']) && isReceivingId((value as ClearWmsRequest).taskId));
  const confirmation = usePendingSubmission<ReceivingSubmission>('receiving-confirm', (value): value is ReceivingSubmission => {
    const input = value as ReceivingSubmission;
    return validSubmission(input, ['taskId', 'applicationId', 'remark', 'expectedCount']) &&
      ('applicationId' in input ? isReceivingId(input.applicationId) && !('taskId' in input) : isReceivingId(input.taskId)) &&
      (input.remark === undefined || (typeof input.remark === 'string' && !!input.remark.trim() && input.remark.length <= 500)) &&
      integer(input.expectedCount);
  });
  const { pending } = cleanup;
  const { pending: pendingConfirmation } = confirmation;
  const storageError = computed(() => confirmation.storageError.value || cleanup.storageError.value);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const release = useReceivingVehicleRelease('receiving', text => notify(text));
  const operationBlocked = computed(() => release.visible.value || busy.value || cleaning.value || submitting.value || !!detail.value || confirmingClear.value || !!storageError.value);
  const disabled = computed(() => operationBlocked.value || !!pending.value || !!pendingConfirmation.value);
  const originalVehicleMismatch = computed(() => {
    const data = result.value;
    return !!data?.task?.applicationId && data.object.containerType === 'VEHICLE' &&
      (data.task.object.containerType !== 'VEHICLE' || data.task.object.containerCode !== data.object.containerCode);
  });
  const canReceive = computed(() => !operationBlocked.value && !pending.value &&
    (!!pendingConfirmation.value || (!originalVehicleMismatch.value && result.value?.task?.eligibility.allowed === true &&
      result.value.task.receivedBoxCount < result.value.task.totalBoxCount && remark.value.trim().length <= 500)));
  // WMS cleanup is independent of receiving eligibility; the backend checks cleanup conditions.
  const canClearWms = computed(() => !operationBlocked.value && !pendingConfirmation.value && (!!pending.value || !!result.value?.task?.taskId));
  const materials = computed(() => result.value?.object.containerType === 'BOX' ? result.value.boxes.flatMap((box) => box.materials) : []);
  let generation = 0;
  let active = true;
  const known = new Map<string, { taskId: string; version: number }>();
  const applicationVersions = new Map<string, number>();
  const unresolvedCode = ref('');
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function resetView() { generation++; result.value = null; detail.value = null; confirmingClear.value = false; remark.value = ''; unresolvedCode.value = ''; busy.value = false; notice.value = null; }
  function clear() { if (!pending.value && !pendingConfirmation.value && !storageError.value && !cleaning.value && !submitting.value) resetView(); }
  function pause() { active = false; resetView(); }
  function resume() {
    release.restore();
    active = true;
    if (!cleaning.value) cleanup.restore();
    if (!submitting.value) confirmation.restore();
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active || !cleanup.sameScope()) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => active && id === generation && cleanup.sameScope()); }
    catch (error) { if (active && id === generation && cleanup.sameScope()) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
  const optionalText = (value: unknown) => value == null || text(value);
  function integer(value: unknown, min = 1) { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647; }
  function validLocation(value: LocationSummary) {
    return value && text(value.locationCode) && text(value.locationName) &&
      [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
  }
  function validContainer(value: LocationContainer) {
    return value && ['BOX', 'VEHICLE'].includes(value.containerType) && text(value.containerCode) && integer(value.version) && optionalText(value.containerName) &&
      (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
      (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) &&
      (value.location == null || validLocation(value.location));
  }
  function validMaterials(rows: MaterialLine[], total: number) {
    return Array.isArray(rows) && integer(total, 0) && rows.every((row) => row && text(row.orderNo) && text(row.materialCode) &&
      [row.materialName, row.unit, row.materialBatch, row.orderLineNo].every(optionalText) &&
      (row.lineType === 'PANEL' ? text(row.panelCode) && row.quantity === 1 : row.lineType === 'QUANTITY' && row.panelCode === undefined && integer(row.quantity))) &&
      new Set(rows.filter(row => row.lineType === 'PANEL').map(row => row.panelCode)).size === rows.filter(row => row.lineType === 'PANEL').length &&
      rows.reduce((sum, row) => sum + row.quantity, 0) === total;
  }
  function validProgress(task: ReceivingTask) {
    const { status, receivedBoxCount, totalBoxCount } = task;
    if (!integer(totalBoxCount) || !integer(receivedBoxCount, 0) || receivedBoxCount > totalBoxCount) return false;
    switch (status) {
      case 'PENDING': return receivedBoxCount === 0;
      case 'PARTIAL': return receivedBoxCount > 0 && receivedBoxCount < totalBoxCount;
      case 'RECEIVED': return receivedBoxCount === totalBoxCount;
      case 'NOT_SHELVED': return !task.eligibility.allowed && receivedBoxCount === 0;
      case 'PROCESSED': return !task.eligibility.allowed && receivedBoxCount > 0 && receivedBoxCount < totalBoxCount;
      default: return false;
    }
  }
  function validResult(data: ReceivingResult, code: string, expected?: ReceivingIdentity) {
    if (!data || !validContainer(data.object) || data.object.containerCode !== code || !Array.isArray(data.boxes) || !integer(data.totalMaterialQuantity, 0) ||
      data.boxes.some(box => !box || !text(box.boxCode) || !integer(box.version) || !validMaterials(box.materials, box.materialQuantity)) ||
      new Set(data.boxes.map(box => box.boxCode)).size !== data.boxes.length || data.boxes.reduce((sum, box) => sum + box.materialQuantity, 0) !== data.totalMaterialQuantity) return false;
    const panels = data.boxes.flatMap(box => box.materials.filter(row => row.lineType === 'PANEL'));
    if (new Set(panels.map(row => row.panelCode)).size !== panels.length) return false;
    const task = data.task;
    if (task == null) return !expected && !data.boxes.length && data.totalMaterialQuantity === 0;
    const identity = receivingIdentity(task);
    if (!identity || (expected && (identity.applicationId !== expected.applicationId || identity.taskId !== expected.taskId))) return false;
    const sameObject = task.object?.containerType === data.object.containerType && task.object.containerCode === code &&
      (identity.applicationId !== undefined || task.object.version === data.object.version);
    const boxInApplication = !!identity.applicationId && task.object?.containerType === 'VEHICLE' && data.object.containerType === 'BOX';
    const otherOriginalObject = !!identity.applicationId && data.object.containerType === 'VEHICLE' && task.object?.containerCode !== code;
    return (identity.applicationId ? optionalText(task.applicationNo) : text(task.taskNo)) && integer(task.version) &&
      validContainer(task.object) && (sameObject || boxInApplication || otherOriginalObject) &&
      (task.location == null || validLocation(task.location)) && text(task.statusName) && typeof task.createdTime === 'string' && Number.isFinite(Date.parse(task.createdTime)) &&
      typeof task.eligibility?.allowed === 'boolean' && (task.eligibility.allowed || task.eligibility.reason === undefined || text(task.eligibility.reason, 500)) &&
      validProgress(task) &&
      (data.object.containerType === 'BOX' ? data.boxes.length === 1 && data.boxes[0].boxCode === code : data.boxes.length === task.totalBoxCount);
  }
  function remember(code: string, taskId: string, version: number) {
    for (const value of known.values()) if (value.taskId === taskId) value.version = Math.max(value.version, version);
    known.set(code, { taskId, version });
  }
  async function scan(raw: string, applicationId?: string) {
    if (disabled.value || !active) return;
    clear();
    const code = raw.trim();
    if (!text(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    if (applicationId !== undefined && !isReceivingId(applicationId)) { notify('缴库申请标识无效，请重新选择', true); return; }
    const source = applicationId ? { applicationId } : undefined;
    await run(async (current) => {
      let data: ReceivingResult;
      try { data = source ? await api.query(code, source) : await api.query(code); }
      catch (error) {
        if (current() && error instanceof ApiRequestError && [200, 400, 409].includes(error.statusCode)) unresolvedCode.value = code;
        throw error;
      }
      if (!current()) return;
      if (!validResult(data, code, source)) throw new Error('接收范围或物料信息不完整，请重新扫描');
      const previous = known.get(code);
      if (!source && !data.task && previous) {
        data = await api.query(code, previous.taskId); if (!current()) return;
        if (!validResult(data, code, { taskId: previous.taskId })) throw new Error('原运输接收范围不完整，请重新核实');
      }
      const task = data.task;
      if (task?.applicationId) {
        if ((applicationVersions.get(task.applicationId) ?? 0) > task.version) throw new Error('缴库申请版本已过期，请重新查询');
        applicationVersions.set(task.applicationId, task.version);
      } else if (task?.taskId) {
        if ([...known.values()].some(value => value.taskId === task.taskId && value.version > task.version)) throw new Error('接收任务版本已过期，请重新查询');
        remember(code, task.taskId, task.version);
        for (const box of data.boxes) remember(box.boxCode, task.taskId, task.version);
      }
      result.value = data;
      if (!task) notify(`当前${data.object.containerType === 'BOX' ? '箱子' : '载具'}无接收任务`, true);
      else if (!task.eligibility.allowed) notify(task.eligibility.reason || '当前对象不可接收', true);
      else if (originalVehicleMismatch.value) notify(`请扫描原申请对象 ${task.object.containerCode} 接收`, true);
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
    if (!active || !cleanup.sameScope() || !confirmingClear.value || busy.value || cleaning.value || submitting.value || pendingConfirmation.value || storageError.value) return;
    const data = result.value;
    if (!pending.value && !data?.task?.taskId) return;
    const replay = !!pending.value;
    const input = pending.value?.input || { requestId: requestId(), taskId: data!.task!.taskId!, version: data!.task!.version,
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
        if (!validResult(fresh, input.object.containerCode, { taskId: input.taskId }) || fresh.object.containerType !== input.object.containerType ||
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
    if (!active || !canReceive.value || !confirmation.sameScope()) return;
    const saved = pendingConfirmation.value;
    let submission = saved?.input;
    if (!submission) {
      const data = result.value;
      if (!data?.task) return;
      const identity = receivingIdentity(data.task);
      if (!identity) return;
      const submittedRemark = remark.value.trim();
      submission = {
        requestId: requestId(),
        ...identity,
        version: data.task.version,
        object: { containerType: data.object.containerType, containerCode: data.object.containerCode },
        expectedCount: data.object.containerType === 'BOX' ? 1 : data.task.totalBoxCount - data.task.receivedBoxCount,
        ...(submittedRemark ? { remark: submittedRemark } : {})
      };
    }
    const { expectedCount, ...input } = submission;
    await run(async (current) => {
      confirmation.save(submission, saved?.reason || '正在确认本次接收结果');
      submitting.value = true;
      try {
        const receipt = await api.confirm(input);
        if (!receipt || typeof receipt !== 'object' || 'resultType' in receipt || receipt.requestId !== input.requestId ||
          typeof receipt.processedTime !== 'string' || !Number.isFinite(Date.parse(receipt.processedTime))) {
          throw new Error('处理结果不完整，未能确认成功，请核实后重试原请求');
        }
        const identity = receivingIdentity(receipt);
        if (!identity || identity.taskId !== input.taskId || identity.applicationId !== input.applicationId ||
          receipt.object?.containerType !== input.object.containerType || receipt.object.containerCode !== input.object.containerCode ||
          !integer(receipt.version) || receipt.version <= input.version || receipt.affectedCount !== expectedCount) {
          throw new Error('接收回执与本次范围或最新版本不一致，未能确认成功，请核实后重试原请求');
        }
        if (confirmation.finish(input.requestId)) release.offer(input.requestId);
        else release.restore();
        if (!current()) return;
        if (identity.applicationId) applicationVersions.set(identity.applicationId, receipt.version);
        else if (identity.taskId) remember(input.object.containerCode, identity.taskId, receipt.version);
        resetView();
        notify('接收完成，当前接收流程已结束');
      } catch (error) {
        // A conflict can also represent an unresolved WMS write or a failed local completion.
        if (!saved && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && ![408, 409].includes(error.statusCode)) {
          confirmation.finish(input.requestId);
        }
        confirmation.failed(error);
        throw error;
      } finally { submitting.value = false; }
    });
  }
  return { release, pending, pendingConfirmation, storageError, result, materials, detail, confirmingClear, unresolvedCode, remark, busy, disabled, canReceive, canClearWms, notice, notify, clear, pause, resume, scan,
    openMaterials, closeMaterials, askClearWms, cancelClearWms, submit };
}
