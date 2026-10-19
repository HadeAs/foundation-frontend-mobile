import { computed, ref } from 'vue';
import { logisticsCancellationApi as api, cancellationPendingMessage, cancellationQueryErrorMessage, type CancellationResult } from '../services/logisticsCancellation';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { getCurrentApiBaseUrl, getCurrentUser } from '../services/auth';
import type { LogisticsTask } from '../services/logistics';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';

interface Attempt {
  taskId: string; taskNo: string; requestId: string;
  status: 'ACCEPTED' | 'UNKNOWN'; reason: string;
}

export function useLogisticsCancellation() {
  const keyword = ref('');
  const items = ref<LogisticsTask[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref('');
  const notice = ref<{ message: string; error: boolean } | null>(null);
  const selected = ref<LogisticsTask | null>(null);
  const submitting = ref('');
  const checking = ref<string[]>([]);
  const attempts = ref<Attempt[]>([]);
  const storageError = ref(false);
  const page = ref(0);
  const pages = ref(0);
  const hasMore = computed(() => page.value < pages.value);
  // Keep only unresolved correlation IDs, isolated by environment/account; never store tokens.
  const environment = getCurrentApiBaseUrl();
  const account = getCurrentUser()?.account || '';
  const storageKey = `foundation.cancellations.real.${environment}.${account}`;
  let active = true;
  let visibility = 0;
  let revision = 0;
  let filter = '';
  let failedPage = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disabled = computed(() => loading.value || !!selected.value || !!submitting.value || !!checking.value.length);
  const sameScope = () => environment === getCurrentApiBaseUrl() && account === (getCurrentUser()?.account || '');
  const available = () => active && sameScope();
  const message = (text: string, failed = true) => { notice.value = { message: text, error: failed }; };
  const isPending = (taskId: string) => attempts.value.some((item) => item.taskId === taskId);
  const text = (value: unknown, max = 128) => typeof value === 'string' && !!value.trim() && value.length <= max;
  const optionalText = (value: unknown) => value === undefined || text(value);
  const version = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
  const identifier = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
  function restore() {
    try {
      const stored: unknown = uni.getStorageSync(storageKey);
      if (stored === '' || stored === undefined) { attempts.value = []; storageError.value = false; return; }
      if (!Array.isArray(stored) || !stored.every((item: Attempt) => item && identifier(item.taskId) && text(item.taskNo) &&
        typeof item.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.requestId) &&
        ['ACCEPTED', 'UNKNOWN'].includes(item.status) && typeof item.reason === 'string') ||
        new Set(stored.map(item => item.taskId)).size !== stored.length || new Set(stored.map(item => item.requestId)).size !== stored.length) {
        throw new Error('本地取消记录异常，请保留记录并核实，勿重复取消');
      }
      attempts.value = stored.map(item => item.status === 'ACCEPTED' ? { ...item, reason: cancellationPendingMessage } : item); storageError.value = false;
    } catch (cause) { storageError.value = true; message(cause instanceof Error ? cause.message : '无法读取取消记录，请核实原请求'); }
  }
  function save(next = attempts.value) {
    try { uni.setStorageSync(storageKey, JSON.parse(JSON.stringify(next))); attempts.value = next; storageError.value = false; }
    catch { storageError.value = true; throw new Error('无法保存取消记录，请核实原请求，勿重复取消'); }
  }
  restore();
  function validLocation(value: LocationSummary) {
    return value && text(value.locationCode) && text(value.locationName) &&
      [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
  }
  function validContainer(value: LocationContainer) {
    return value && ['BOX', 'VEHICLE'].includes(value.containerType) && text(value.containerCode) && version(value.version) && optionalText(value.containerName) &&
      (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
      (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) &&
      (value.location === undefined || validLocation(value.location));
  }
  function validTask(task: LogisticsTask) {
    return task && identifier(task.taskId) && text(task.taskNo) && version(task.version) && ['STANDARD', 'HIKVISION'].includes(task.vendor) && task.taskType === 'GENERAL' &&
      validContainer(task.container) && validLocation(task.origin) && validLocation(task.destination) && [task.agvCode, task.agvName].every(optionalText) &&
      ['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(task.status) && text(task.statusName) && text(task.triggerMode) &&
      typeof task.createdTime === 'string' && Number.isFinite(Date.parse(task.createdTime));
  }

  async function load(target: number) {
    if (!available()) return;
    const current = ++revision;
    loading.value = true; error.value = '';
    try {
      const result = await api.query(filter, target);
      if (!available() || current !== revision) return;
      if (!result || !Array.isArray(result.records) || result.current !== target || !version(result.current) || result.size !== 20 ||
          !Number.isSafeInteger(result.total) || result.total < 0 || !version(result.pages, 0) || result.pages !== Math.ceil(result.total / result.size) ||
          result.records.length > Math.min(result.size, Math.max(0, result.total - (target - 1) * result.size)) ||
          new Set(result.records.map(task => task?.taskId)).size !== result.records.length) throw new Error('分页数据异常，请刷新后重试');
      if (!result.records.every(validTask)) throw new Error('任务信息不完整，请刷新后重试');
      const merged = new Map((target === 1 ? [] : items.value).map((task) => [task.taskId, task]));
      result.records.forEach((task) => merged.set(task.taskId, task));
      items.value = [...merged.values()]; total.value = result.total;
      page.value = target; pages.value = result.pages;
    } catch (cause) {
      if (!available() || current !== revision) return;
      failedPage = target; error.value = cause instanceof Error ? cause.message : '加载失败，请重试'; message(error.value);
    } finally {
      if (current === revision) { loading.value = false; refreshing.value = false; }
    }
  }
  async function query() {
    if (!available() || selected.value || submitting.value || checking.value.length) return;
    const value = keyword.value.trim();
    if (value.length > 128) { message('查询条件不能超过128个字符'); return; }
    keyword.value = value; filter = value;
    items.value = []; total.value = 0; page.value = 0; pages.value = 0;
    await load(1);
  }
  async function refresh() { if (available() && !disabled.value) { refreshing.value = true; await load(1); } }
  async function loadMore() { if (available() && !disabled.value && !error.value && hasMore.value) await load(page.value + 1); }
  async function retry() { if (available() && !disabled.value && error.value) await load(failedPage); }

  function schedule() {
    clearTimeout(timer);
    if (available() && !storageError.value && !selected.value && !submitting.value && attempts.value.some((item) => item.status === 'ACCEPTED')) {
      timer = setTimeout(async () => {
        await Promise.all(attempts.value.filter((item) => item.status === 'ACCEPTED').map((item) => check(item.taskId)));
        schedule();
      }, 3000);
    }
  }
  async function applyResult(attempt: Attempt, result: CancellationResult, query: boolean, current: () => boolean) {
    if (!result || result.requestId !== attempt.requestId || result.taskId !== attempt.taskId || result.taskNo !== attempt.taskNo ||
        !(query ? ['ACCEPTED', 'CANCELLED', 'FAILED', 'UNKNOWN'] : ['ACCEPTED', 'CANCELLED']).includes(result.cancelStatus) ||
        typeof result.processedTime !== 'string' || !Number.isFinite(Date.parse(result.processedTime)) ||
        (result.reason !== undefined && (typeof result.reason !== 'string' || !result.reason.trim())) ||
        (['FAILED', 'UNKNOWN'].includes(result.cancelStatus) && !result.reason?.trim())) throw new Error('取消结果异常，暂无法确认，请刷新结果');
    const saved = attempts.value.find(item => item.requestId === attempt.requestId && item.taskId === attempt.taskId);
    if (!saved) return;
    if (result.cancelStatus === 'ACCEPTED' || result.cancelStatus === 'UNKNOWN') {
      saved.status = result.cancelStatus;
      saved.reason = result.cancelStatus === 'ACCEPTED' ? cancellationPendingMessage : result.reason!;
      save();
    } else {
      save(attempts.value.filter((item) => item.requestId !== attempt.requestId));
    }
    if (result.cancelStatus === 'CANCELLED') {
      items.value = items.value.filter((item) => item.taskId !== attempt.taskId);
    }
    if (!current()) return;
    if (result.cancelStatus === 'CANCELLED') {
      message(`任务 ${attempt.taskNo} 取消成功`, false);
      // Deletion shifts offset pages: restart from page one, preserving applied filters.
      await load(1);
    } else if (result.cancelStatus === 'FAILED') message(result.reason!);
    else if (result.cancelStatus === 'UNKNOWN') message(result.reason!);
  }
  async function check(taskId: string) {
    const attempt = attempts.value.find((item) => item.taskId === taskId);
    if (!available() || selected.value || submitting.value || loading.value || storageError.value || !attempt || checking.value.includes(taskId)) return;
    const generation = visibility;
    const current = () => available() && generation === visibility;
    checking.value.push(taskId);
    try { await applyResult(attempt, await api.result(taskId, attempt.requestId), true, current); }
    catch (cause) {
      const saved = attempts.value.find(item => item.requestId === attempt.requestId);
      if (saved) {
        saved.status = 'UNKNOWN'; saved.reason = cancellationQueryErrorMessage(cause);
        try { save(); } catch { /* Keep the last saved correlation and block further writes. */ }
        if (current()) message(saved.reason);
      }
    } finally { checking.value = checking.value.filter((id) => id !== taskId); schedule(); }
  }
  function open(task: LogisticsTask) {
    if (available() && !disabled.value && !storageError.value && validTask(task) && !isPending(task.taskId)) {
      clearTimeout(timer); notice.value = null; selected.value = task;
    }
  }
  function close() { if (!submitting.value) { selected.value = null; schedule(); } }
  async function confirm() {
    const task = selected.value;
    if (!available() || storageError.value || loading.value || checking.value.length || !task || submitting.value || isPending(task.taskId) || !validTask(task)) return;
    const generation = visibility;
    const visible = () => available() && generation === visibility;
    submitting.value = task.taskId;
    const attempt: Attempt = { taskId: task.taskId, taskNo: task.taskNo, requestId: requestId(), status: 'UNKNOWN', reason: '提交中，正在确认取消结果' };
    attempts.value.push(attempt);
    // Use the reactive item so async results also update the result card.
    const current = attempts.value[attempts.value.length - 1];
    try { save(); } catch {
      attempts.value = attempts.value.filter((item) => item !== current);
      submitting.value = ''; message('无法保存请求标识，未提交取消，请检查本地存储'); return;
    }
    try {
      const result = await api.cancel(task.taskId, { requestId: current.requestId, version: task.version });
      if (visible()) selected.value = null;
      await applyResult(current, result, false, visible);
    } catch (cause) {
      // 404 cannot prove that cancellation was never sent. Keep its original correlation as well.
      if (cause instanceof ApiRequestError && cause.statusCode >= 400 && cause.statusCode < 500 && ![404, 408].includes(cause.statusCode)) {
        try { save(attempts.value.filter((item) => item.requestId !== current.requestId)); } catch { /* Preserve pending IDs if local storage is unavailable. */ }
      } else {
        const saved = attempts.value.find(item => item.requestId === current.requestId);
        if (saved) { saved.status = 'UNKNOWN'; saved.reason = '取消结果暂无法确认，请刷新结果，勿重复取消'; }
        if (visible()) selected.value = null;
        try { save(); } catch { /* Preserve pending IDs if local storage is unavailable. */ }
      }
      if (visible()) message(cause instanceof Error ? cause.message : '取消失败，请重试');
    } finally { submitting.value = ''; schedule(); }
  }
  function pause() { active = false; visibility++; revision++; clearTimeout(timer); loading.value = false; refreshing.value = false; notice.value = null; selected.value = null; }
  async function resume() {
    active = true;
    if (!sameScope()) { items.value = []; message('账号或环境已变化，请重新进入取消任务页面'); return; }
    restore(); refreshing.value = true; await load(1); schedule();
  }
  return { keyword, items, total, loading, refreshing, error, notice, selected, submitting, checking, attempts, disabled, storageError,
    hasMore, page, query, refresh, loadMore, retry, isPending, open, close, confirm, check, pause, resume };
}
