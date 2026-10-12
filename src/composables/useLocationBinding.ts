import { computed, ref, shallowRef } from 'vue';
import { locationBindingApi as api, type LocationContainers, type LocationContainer, type LocationOperation, type LocationSummary } from '../services/locationBinding';
import { logisticsCancellationApi as cancellationApi, type CancelTaskRequest, type CancellationResult } from '../services/logisticsCancellation';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { getCurrentApiBaseUrl, getCurrentUser } from '../services/auth';
import type { Eligibility } from '../services/panelPacking';

const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const version = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
const optionalText = (value: unknown) => value === undefined || text(value);
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const validEligibility = (value: Eligibility) => value && typeof value.allowed === 'boolean' && (value.allowed || text(value.reason, 500));
function validSummary(value: LocationSummary) {
  return value && text(value.locationCode) && text(value.locationName) &&
    [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
}
function validContainer(value: LocationContainer | undefined) {
  return value && ['BOX', 'VEHICLE'].includes(value.containerType) && text(value.containerCode) && version(value.version) && optionalText(value.containerName) &&
    (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
    (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) &&
    (value.location === undefined || validSummary(value.location));
}
function validLocation(value: LocationContainers, code: string) {
  return value && validSummary(value.location) && value.location.locationCode === code && version(value.version) && typeof value.occupied === 'boolean' &&
    validEligibility(value.eligibility) && validEligibility(value.unbindEligibility) && (value.occupied ? validContainer(value.container) : value.container === undefined) &&
    Array.isArray(value.relatedTasks) && value.relatedTasks.every(task => task && text(task.taskId, 20) && /^[1-9][0-9]{0,18}$/.test(task.taskId) &&
      text(task.taskNo) && version(task.version) && ['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(task.status) &&
      typeof task.settled === 'boolean' && validEligibility(task.cancellationEligibility)) &&
    new Set(value.relatedTasks.map(task => task.taskId)).size === value.relatedTasks.length;
}
interface CancellationAttempt {
  taskId: string; taskNo: string; input: CancelTaskRequest & { unbindContext: LocationOperation };
  status: CancellationResult['cancelStatus']; reason: string;
}

export function useLocationBinding() {
  const location = shallowRef<LocationContainers | null>(null);
  const pending = shallowRef<LocationContainer | null>(null);
  const container = computed(() => location.value?.container || pending.value);
  const confirmation = ref(false);
  const confirmingTasks = ref(false);
  const busy = ref(false);
  const stale = ref(false);
  const storageError = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const records = ref<CancellationAttempt[]>([]);
  const relatedTasks = computed(() => location.value?.relatedTasks || []);
  const cancellationRecords = computed(() => {
    const value = location.value;
    if (!value?.container) return [];
    return records.value.filter(record => record.input.unbindContext.locationCode === value.location.locationCode &&
      record.input.unbindContext.container.containerType === value.container!.containerType &&
      record.input.unbindContext.container.containerCode === value.container!.containerCode);
  });
  const unresolved = computed(() => cancellationRecords.value.some(record => ['ACCEPTED', 'UNKNOWN'].includes(record.status)));
  const disabled = computed(() => busy.value || confirmation.value);
  const scanDisabled = computed(() => disabled.value || stale.value || !!container.value || location.value?.eligibility.allowed === false);
  const canBind = computed(() => !disabled.value && !stale.value && !!pending.value && location.value?.occupied === false && location.value.eligibility.allowed);
  const unbindReady = computed(() => !stale.value && !storageError.value && !!location.value?.container && location.value.occupied &&
    location.value.unbindEligibility.allowed && !relatedTasks.value.length && !unresolved.value);
  const canUnbind = computed(() => !disabled.value && unbindReady.value);
  const canCancelTasks = computed(() => !stale.value && !storageError.value && !!location.value?.container && !unresolved.value &&
    !cancellationRecords.value.some(record => record.status === 'FAILED') && relatedTasks.value.some(task => task.cancellationEligibility.allowed &&
      !cancellationRecords.value.some(record => record.taskId === task.taskId && record.status === 'CANCELLED')));
  const canRequestUnbind = computed(() => !disabled.value && (unbindReady.value || canCancelTasks.value));
  const storageKey = 'foundation.location-cancellations.real.' + getCurrentApiBaseUrl() + '.' + (getCurrentUser()?.account || '');
  let generation = 0;
  let active = true;
  let attempt: { id: string; fingerprint: string; data: LocationOperation } | null = null;
  function notify(value: string, error = false) { notice.value = { text: value, error }; }
  function restore() {
    try {
      const stored: unknown = uni.getStorageSync(storageKey);
      if (!stored) { records.value = []; storageError.value = false; return; }
      if (!Array.isArray(stored) || !stored.every((record: CancellationAttempt) => record && text(record.taskId, 20) && /^[1-9][0-9]{0,18}$/.test(record.taskId) &&
        text(record.taskNo) && record.input && uuid.test(record.input.requestId) && version(record.input.version) && ['ACCEPTED', 'CANCELLED', 'FAILED', 'UNKNOWN'].includes(record.status) &&
        typeof record.reason === 'string' && text(record.input.unbindContext?.locationCode) && version(record.input.unbindContext.version) &&
        ['BOX', 'VEHICLE'].includes(record.input.unbindContext.container?.containerType) && text(record.input.unbindContext.container.containerCode) && version(record.input.unbindContext.containerVersion))) {
        throw new Error('本地取消记录异常，请保留记录并核实，不能重新取消');
      }
      records.value = stored; storageError.value = false;
    } catch (error) { storageError.value = true; notify(error instanceof Error ? error.message : '无法读取取消请求记录，请核实', true); }
  }
  function save() {
    try { uni.setStorageSync(storageKey, JSON.parse(JSON.stringify(records.value))); }
    catch { storageError.value = true; throw new Error('无法保存取消请求记录，请核实原请求'); }
  }
  restore();
  function clear() {
    generation++; location.value = null; pending.value = null; confirmation.value = false; confirmingTasks.value = false;
    busy.value = false; stale.value = false; notice.value = null; attempt = null;
  }
  function pause() { active = false; clear(); }
  function resume() { active = true; restore(); }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    const id = generation; busy.value = true; notice.value = null;
    try { await action(() => active && id === generation); }
    catch (error) { if (active && id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  function operation(value: LocationContainers, target: LocationContainer): LocationOperation {
    return { locationCode: value.location.locationCode, version: value.version,
      container: { containerType: target.containerType, containerCode: target.containerCode }, containerVersion: target.version };
  }
  function showEligibility() {
    const value = location.value!;
    if (value.occupied && storageError.value) notify('本地取消记录不可用，请核实原请求后再操作', true);
    else if (value.occupied && !value.unbindEligibility.allowed) notify(value.unbindEligibility.reason!, true);
    else if (!value.occupied && !value.eligibility.allowed) notify(value.eligibility.reason!, true);
    else if (unresolved.value) notify('存在未确认的取消请求，请核实并刷新，勿重新取消', true);
  }
  async function scan(raw: string) {
    if (scanDisabled.value || !active) return;
    const code = raw.trim(); if (!text(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async current => {
      if (!location.value) {
        const result = await api.getLocation(code); if (!current()) return;
        if (!validLocation(result, code)) throw new Error('库位信息不完整，请重新扫描');
        location.value = result; showEligibility();
      } else {
        const result = await api.getContainer(code); if (!current()) return;
        if (!result || !validContainer(result.container) || !validEligibility(result.eligibility)) throw new Error('容器信息不完整，请重新扫描');
        if (!result.eligibility.allowed) throw new Error(result.eligibility.reason!);
        // Type and canonical code are supplied by the backend, not inferred from scan prefixes.
        pending.value = result.container;
      }
    });
  }
  function requestUnbind() {
    if (!active || !canRequestUnbind.value) return;
    notice.value = null; confirmingTasks.value = relatedTasks.value.length > 0; confirmation.value = true;
  }
  function cancel() { if (!busy.value) { confirmation.value = false; confirmingTasks.value = false; } }
  function applyCancellation(record: CancellationAttempt, result: CancellationResult, query: boolean) {
    if (!result || result.requestId !== record.input.requestId || result.taskId !== record.taskId || result.taskNo !== record.taskNo ||
      !(query ? ['ACCEPTED', 'CANCELLED', 'FAILED', 'UNKNOWN'] : ['ACCEPTED', 'CANCELLED']).includes(result.cancelStatus) ||
      typeof result.processedTime !== 'string' || !Number.isFinite(Date.parse(result.processedTime)) ||
      (['FAILED', 'UNKNOWN'].includes(result.cancelStatus) && (typeof result.reason !== 'string' || !result.reason.trim()))) {
      throw new Error('取消回执异常，请核实原取消结果');
    }
    record.status = result.cancelStatus;
    record.reason = result.reason || (result.cancelStatus === 'ACCEPTED' ? '取消已受理，尚未确认最终结果' : '取消成功，仍需核实实物及解绑资格');
    save();
  }
  async function refreshSnapshot(current: () => boolean, before: LocationContainers) {
    const result = await api.getLocation(before.location.locationCode); if (!current()) return;
    if (!validLocation(result, before.location.locationCode)) throw new Error('刷新库位信息不完整，请重新核实');
    if (result.occupied !== before.occupied || result.container?.containerType !== before.container?.containerType || result.container?.containerCode !== before.container?.containerCode) {
      stale.value = true; throw new Error('当前位置绑定关系已变化，请清空后重新扫描');
    }
    location.value = result;
    const currentRecords = cancellationRecords.value;
    records.value = records.value.filter(record => !currentRecords.includes(record) || ['ACCEPTED', 'UNKNOWN'].includes(record.status) ||
      (record.status === 'CANCELLED' && result.relatedTasks.some(task => task.taskId === record.taskId)));
    save();
  }
  async function verifyAndRefresh() {
    if (!active || disabled.value || !location.value) return;
    restore(); if (storageError.value) return;
    const before = location.value;
    await run(async current => {
      for (const record of cancellationRecords.value.filter(item => ['ACCEPTED', 'UNKNOWN'].includes(item.status))) {
        try {
          const result = await cancellationApi.result(record.taskId, record.input.requestId); if (!current()) return;
          applyCancellation(record, result, true);
        } catch (error) {
          if (!current()) return;
          record.status = 'UNKNOWN'; record.reason = error instanceof Error ? error.message : '取消结果查询失败'; save(); throw error;
        }
      }
      const failure = cancellationRecords.value.find(record => record.status === 'FAILED')?.reason;
      await refreshSnapshot(current, before); if (!current()) return;
      if (failure) notify(failure, true);
      else if (unresolved.value) notify('取消结果仍未确认，不能解绑，请继续核实', true);
      else if (!unbindReady.value) notify(location.value!.unbindEligibility.reason || '仍存在未结算任务，不能解绑', true);
      else notify('已刷新最新位置与容器版本，请再次确认解绑');
    });
  }
  async function cancelBlockingTasks() {
    if (!active || !canCancelTasks.value || !location.value) return;
    const before = location.value;
    const targets = before.relatedTasks.filter(task => task.cancellationEligibility.allowed &&
      !cancellationRecords.value.some(record => record.taskId === task.taskId && record.status === 'CANCELLED'));
    const context = operation(before, before.container!);
    await run(async current => {
      for (const task of targets) {
        const input = { requestId: requestId(), version: task.version, unbindContext: context };
        records.value.push({ taskId: task.taskId, taskNo: task.taskNo, input, status: 'UNKNOWN', reason: '取消请求待核实' });
        const record = records.value[records.value.length - 1];
        try { save(); } catch (error) { records.value.pop(); throw error; }
        try {
          const result = await cancellationApi.cancel(task.taskId, input); if (!current()) return;
          applyCancellation(record, result, false);
        } catch (error) {
          if (!current()) return;
          record.status = error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 ? 'FAILED' : 'UNKNOWN';
          record.reason = error instanceof Error ? error.message : '取消请求失败'; save(); throw error;
        }
      }
      confirmation.value = false; confirmingTasks.value = false;
      if (unresolved.value) notify('取消已受理，请核实最终结果后再解绑');
      else {
        await refreshSnapshot(current, before); if (!current()) return;
        if (!unbindReady.value) notify(location.value!.unbindEligibility.reason || '取消成功，但仍存在未结算阻塞，不能解绑', true);
        else notify('任务已取消并刷新，请再次确认解绑');
      }
    });
  }
  async function submit() {
    if (!active || busy.value || !location.value || !container.value) return;
    if (confirmation.value && confirmingTasks.value) { await cancelBlockingTasks(); return; }
    const unbinding = confirmation.value;
    if (unbinding ? !unbindReady.value : !canBind.value) return;
    const data = operation(location.value, container.value);
    const fingerprint = JSON.stringify({ unbinding, data });
    const input = attempt?.fingerprint === fingerprint ? attempt : { id: requestId(), fingerprint, data };
    attempt = input;
    await run(async current => {
      let result;
      try { result = unbinding ? await api.unbind(input.data, input.id) : await api.bind(input.data, input.id); }
      catch (error) {
        if (attempt === input && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      if (!result || typeof result !== 'object' || 'resultType' in result || result.requestId !== input.id || !text(result.operationNo) || result.affectedCount !== 1 ||
        typeof result.processedTime !== 'string' || !Number.isFinite(Date.parse(result.processedTime))) throw new Error('位置操作回执不完整或不一致，请核实后重试原请求');
      clear(); notify(unbinding ? '解绑成功' : '位置绑定成功');
    });
  }
  return { location, pending, container, confirmation, confirmingTasks, busy, disabled, scanDisabled, canBind, canUnbind, canRequestUnbind, canCancelTasks,
    relatedTasks, cancellationRecords, notice, notify, clear, pause, resume, scan, requestUnbind, cancel, submit, verifyAndRefresh };
}
