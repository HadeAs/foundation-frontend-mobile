import { computed, ref } from 'vue';
import { logisticsCancellationApi as api, type CancellationResult } from '../services/logisticsCancellation';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { getCurrentApiBaseUrl, getCurrentUser } from '../services/auth';
import { isMockApi } from '../services/apiTransport';
import { getMockSessionId } from '../services/mockApi';
import type { LogisticsTask } from '../services/logistics';

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
  const page = ref(0);
  const pages = ref(0);
  const hasMore = computed(() => page.value < pages.value);
  // Keep only unresolved correlation IDs, isolated by environment/account; never store tokens.
  const storageKey = `foundation.cancellations.${isMockApi() ? 'mock' : 'real'}.${getCurrentApiBaseUrl()}.${getCurrentUser()?.account || ''}`;
  const mockSessionId = isMockApi() ? getMockSessionId() : undefined;
  const stored: unknown = uni.getStorageSync(storageKey);
  // Mock data resets on reload. Restore only requests from that same mock session;
  // real-mode correlation IDs still survive reloads and must never be discarded.
  const restored = mockSessionId === undefined ? stored : stored && typeof stored === 'object' &&
    'sessionId' in stored && stored.sessionId === mockSessionId && 'attempts' in stored ? stored.attempts : [];
  if (Array.isArray(restored)) attempts.value = restored.filter((item): item is Attempt => item &&
    typeof item.taskId === 'string' && /^[1-9][0-9]{0,18}$/.test(item.taskId) && typeof item.taskNo === 'string' &&
    typeof item.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(item.requestId) &&
    ['ACCEPTED', 'UNKNOWN'].includes(item.status) && typeof item.reason === 'string');
  let active = true;
  let revision = 0;
  let filter = '';
  let failedPage = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const message = (text: string, failed = true) => { notice.value = { message: text, error: failed }; };
  const save = () => uni.setStorageSync(storageKey, JSON.parse(JSON.stringify(mockSessionId === undefined
    ? attempts.value : { sessionId: mockSessionId, attempts: attempts.value })));
  const isPending = (taskId: string) => attempts.value.some((item) => item.taskId === taskId);

  async function load(target: number) {
    const current = ++revision;
    loading.value = true; error.value = '';
    try {
      const result = await api.query(filter, target);
      if (!active || current !== revision) return;
      if (!Array.isArray(result.records) || result.current !== target || result.size !== 20 ||
          !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isInteger(result.pages) || result.pages < 0 ||
          result.records.some((task) => typeof task.taskId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(task.taskId))) throw new Error('分页数据异常，请刷新后重试');
      const merged = new Map((target === 1 ? [] : items.value).map((task) => [task.taskId, task]));
      result.records.forEach((task) => merged.set(task.taskId, task));
      items.value = [...merged.values()]; total.value = result.total;
      page.value = target; pages.value = result.pages;
    } catch (cause) {
      if (!active || current !== revision) return;
      failedPage = target; error.value = cause instanceof Error ? cause.message : '加载失败，请重试'; message(error.value);
    } finally {
      if (current === revision) { loading.value = false; refreshing.value = false; }
    }
  }
  async function query() {
    const value = keyword.value.trim();
    if (value.length > 128) { message('查询条件不能超过128个字符'); return; }
    keyword.value = value; filter = value;
    items.value = []; total.value = 0; page.value = 0; pages.value = 0;
    await load(1);
  }
  async function refresh() { if (!refreshing.value) { refreshing.value = true; await load(1); } }
  async function loadMore() { if (!loading.value && !error.value && hasMore.value) await load(page.value + 1); }
  async function retry() { if (!loading.value && error.value) await load(failedPage); }

  function schedule() {
    clearTimeout(timer);
    if (active && attempts.value.some((item) => item.status === 'ACCEPTED')) {
      timer = setTimeout(async () => {
        await Promise.all(attempts.value.filter((item) => item.status === 'ACCEPTED').map((item) => check(item.taskId)));
        schedule();
      }, 3000);
    }
  }
  async function applyResult(attempt: Attempt, result: CancellationResult) {
    if (!result || result.requestId !== attempt.requestId || result.taskId !== attempt.taskId || result.taskNo !== attempt.taskNo ||
        !['ACCEPTED', 'CANCELLED', 'FAILED', 'UNKNOWN'].includes(result.cancelStatus) ||
        (['FAILED', 'UNKNOWN'].includes(result.cancelStatus) && !result.reason?.trim())) throw new Error('取消结果异常，暂无法确认，请刷新结果');
    if (result.cancelStatus === 'ACCEPTED' || result.cancelStatus === 'UNKNOWN') {
      attempt.status = result.cancelStatus;
      attempt.reason = result.cancelStatus === 'ACCEPTED' ? '取消已受理，正在确认最终结果' : result.reason!;
    } else {
      attempts.value = attempts.value.filter((item) => item.requestId !== attempt.requestId);
    }
    save();
    if (active && result.cancelStatus === 'CANCELLED') {
      items.value = items.value.filter((item) => item.taskId !== attempt.taskId);
      message(`任务 ${attempt.taskNo} 取消成功`, false);
      // Deletion shifts offset pages: restart from page one, preserving applied filters.
      await load(1);
    } else if (active && result.cancelStatus === 'FAILED') message(result.reason!);
    else if (active && result.cancelStatus === 'UNKNOWN') message(result.reason!);
  }
  async function check(taskId: string) {
    const attempt = attempts.value.find((item) => item.taskId === taskId);
    if (!active || !attempt || checking.value.includes(taskId) || submitting.value === taskId) return;
    checking.value.push(taskId);
    try { await applyResult(attempt, await api.result(taskId, attempt.requestId)); }
    catch (cause) {
      attempt.status = 'UNKNOWN';
      attempt.reason = cause instanceof Error ? cause.message : '取消结果查询失败，请刷新结果';
      save(); if (active) message(attempt.reason);
    } finally { checking.value = checking.value.filter((id) => id !== taskId); schedule(); }
  }
  function open(task: LogisticsTask) { if (!submitting.value && !isPending(task.taskId)) selected.value = task; }
  function close() { if (!submitting.value) selected.value = null; }
  async function confirm() {
    const task = selected.value;
    if (!task || submitting.value || isPending(task.taskId)) return;
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
      selected.value = null;
      await applyResult(current, result);
    } catch (cause) {
      // Explicit client/business rejection can be retried. Timeout/5xx/malformed receipts remain uncertain.
      if (cause instanceof ApiRequestError && cause.statusCode >= 400 && cause.statusCode < 500 && cause.statusCode !== 408) {
        attempts.value = attempts.value.filter((item) => item.requestId !== current.requestId);
      } else {
        current.status = 'UNKNOWN'; current.reason = '取消结果暂无法确认，请刷新结果，勿重复取消'; selected.value = null;
      }
      save(); if (active) message(cause instanceof Error ? cause.message : '取消失败，请重试');
    } finally { submitting.value = ''; schedule(); }
  }
  function pause() { active = false; revision++; clearTimeout(timer); loading.value = false; refreshing.value = false; notice.value = null; selected.value = null; }
  async function resume() { active = true; await refresh(); schedule(); }
  return { keyword, items, total, loading, refreshing, error, notice, selected, submitting, checking, attempts,
    hasMore, page, query, refresh, loadMore, retry, isPending, open, close, confirm, check, pause, resume };
}
