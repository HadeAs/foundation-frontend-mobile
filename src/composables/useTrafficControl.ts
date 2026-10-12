import { computed, ref } from 'vue';
import { trafficApi, type TrafficArea, type TrafficFilters, type TrafficStatus, type TrafficAction, type TrafficActionRequest } from '../services/traffic';
import { ApiRequestError, requestId } from '../services/nariRequest';

const validText = (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= 128;
const validTime = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));

function validArea(area: TrafficArea) {
  return !!area && typeof area === 'object' && validText(area.areaCode) && validText(area.areaName) &&
    Number.isInteger(area.version) && area.version > 0 && area.version <= 2147483647 &&
    (area.status === 'FREE' || area.status === 'OCCUPIED') &&
    (area.lastOperatorName === undefined || validText(area.lastOperatorName)) &&
    (area.lastOperationTime === undefined || validTime(area.lastOperationTime));
}

export function useTrafficControl() {
  const keyword = ref('');
  const status = ref<TrafficStatus | ''>('');
  const items = ref<TrafficArea[]>([]);
  const loading = ref(false);
  const refreshing = ref(false);
  const submitting = ref(false);
  const selected = ref<TrafficArea | null>(null);
  const error = ref('');
  const notice = ref<{ message: string; error: boolean } | null>(null);
  const page = ref(0);
  const pages = ref(0);
  const hasMore = computed(() => page.value < pages.value);
  const actionName = computed(() => selected.value?.status === 'FREE' ? '锁定' : '释放');
  let filters: TrafficFilters = {};
  let revision = 0;
  let operation = 0;
  let failedPage = 1;
  let active = true;
  let attempt: { areaCode: string; action: TrafficAction; input: TrafficActionRequest } | null = null;

  async function load(target: number) {
    if (!active) return;
    const current = ++revision;
    loading.value = true; error.value = '';
    try {
      const result = await trafficApi.query(filters, target);
      if (!active || current !== revision) return;
      if (!result || !Array.isArray(result.records) || result.records.some((area) => !validArea(area)) ||
          result.current !== target || result.size !== 20 || !Number.isSafeInteger(result.total) || result.total < 0 ||
          !Number.isInteger(result.current) || result.current < 1 || result.current > 2147483647 ||
          !Number.isInteger(result.pages) || result.pages < 0 || result.pages > 2147483647 || result.pages !== Math.ceil(result.total / result.size) ||
          result.records.length > Math.min(result.size, Math.max(0, result.total - (target - 1) * result.size)) ||
          new Set(result.records.map(area => area.areaCode)).size !== result.records.length) throw new Error('区域列表数据异常，请刷新后重试');
      const merged = new Map((target === 1 ? [] : items.value).map((area) => [area.areaCode, area]));
      result.records.forEach((area) => merged.set(area.areaCode, area));
      items.value = [...merged.values()]; page.value = result.current; pages.value = result.pages;
    } catch (cause) {
      if (!active || current !== revision) return;
      failedPage = target;
      error.value = cause instanceof Error ? cause.message : '区域查询失败，请重试';
      notice.value = { message: error.value, error: true };
    } finally {
      if (current === revision) { loading.value = false; refreshing.value = false; }
    }
  }
  async function query() {
    if (!active || selected.value || submitting.value) return;
    const value = keyword.value.trim();
    if (value.length > 128) { notice.value = { message: '查询条件不能超过128个字符', error: true }; return; }
    keyword.value = value;
    filters = { ...(value ? { keyword: value } : {}), ...(status.value ? { status: status.value } : {}) };
    notice.value = null;
    await load(1);
  }
  async function refresh() {
    if (!active || loading.value || selected.value || submitting.value) return;
    refreshing.value = true; notice.value = null;
    await load(1);
  }
  async function loadMore() {
    if (!active || loading.value || selected.value || submitting.value || error.value || !hasMore.value) return;
    await load(page.value + 1);
  }
  async function retry() {
    if (active && !loading.value && !selected.value && !submitting.value && error.value) await load(failedPage);
  }
  function open(area: TrafficArea) {
    if (!active || loading.value || submitting.value || selected.value) return;
    const current = items.value.find(item => item.areaCode === area.areaCode);
    if (current) { selected.value = { ...current }; notice.value = null; }
  }
  function close() { if (active && !submitting.value) selected.value = null; }
  async function confirm() {
    if (!active || !selected.value || submitting.value) return;
    const area = selected.value;
    const action = area.status === 'FREE' ? 'lock' : 'release';
    const expected = area.status === 'FREE' ? 'OCCUPIED' : 'FREE';
    const label = actionName.value;
    const current = ++revision;
    const currentOperation = ++operation;
    if (!attempt || attempt.areaCode !== area.areaCode || attempt.action !== action || attempt.input.version !== area.version) {
      attempt = { areaCode: area.areaCode, action, input: { requestId: requestId(), version: area.version } };
    }
    const original = attempt;
    submitting.value = true; notice.value = null;
    try {
      let result;
      try { result = await trafficApi.act(original.areaCode, original.action, original.input); }
      catch (cause) {
        if (attempt === original && cause instanceof ApiRequestError && cause.statusCode >= 400 && cause.statusCode < 500 && cause.statusCode !== 408) attempt = null;
        throw cause;
      }
      if (!active || current !== revision) return;
      if (!validArea(result) || 'resultType' in result || result.areaCode !== area.areaCode || result.version <= area.version || result.status !== expected) {
        throw new Error('操作结果数据异常，请关闭弹窗并刷新核实状态');
      }
      attempt = null;
      items.value = items.value.map((item) => item.areaCode === result.areaCode ? result : item);
      selected.value = null;
      notice.value = { message: `${label}成功`, error: false };
      // Status filtering changes offsets. Re-query page one instead of skipping records on the next page.
      if (filters.status && result.status !== filters.status) {
        items.value = items.value.filter((item) => item.areaCode !== result.areaCode);
        await load(1);
      }
    } catch (cause) {
      if (!active || current !== revision) return;
      notice.value = { message: cause instanceof Error ? cause.message : `${label}失败，请重试`, error: true };
    } finally {
      if (currentOperation === operation) submitting.value = false;
    }
  }
  function dispose() {
    active = false; revision++; operation++; loading.value = false; refreshing.value = false; submitting.value = false;
    selected.value = null; notice.value = null; error.value = ''; attempt = null;
  }
  function resume() { active = true; }
  return { keyword, status, items, loading, refreshing, submitting, selected, error, notice, hasMore, actionName,
    query, refresh, loadMore, retry, open, close, confirm, dispose, resume };
}
