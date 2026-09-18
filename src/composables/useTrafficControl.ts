import { computed, ref } from 'vue';
import { trafficApi, type TrafficArea, type TrafficFilters, type TrafficStatus } from '../services/traffic';
import { requestId } from '../services/nariRequest';

function validArea(area: TrafficArea) {
  return area && typeof area.areaCode === 'string' && !!area.areaCode.trim() && area.areaCode.length <= 128 &&
    typeof area.areaName === 'string' && !!area.areaName.trim() && area.areaName.length <= 128 &&
    Number.isInteger(area.version) && area.version > 0 && area.version <= 2147483647 &&
    (area.status === 'FREE' || area.status === 'OCCUPIED');
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

  async function load(target: number) {
    const current = ++revision;
    loading.value = true; error.value = '';
    try {
      const result = await trafficApi.query(filters, target);
      if (current !== revision) return;
      if (!Array.isArray(result.records) || result.records.some((area) => !validArea(area)) ||
          result.current !== target || result.size !== 20 || !Number.isSafeInteger(result.total) || result.total < 0 ||
          !Number.isInteger(result.pages) || result.pages < 0) throw new Error('区域列表数据异常，请刷新后重试');
      const merged = new Map((target === 1 ? [] : items.value).map((area) => [area.areaCode, area]));
      result.records.forEach((area) => merged.set(area.areaCode, area));
      items.value = [...merged.values()]; page.value = result.current; pages.value = result.pages;
    } catch (cause) {
      if (current !== revision) return;
      failedPage = target;
      error.value = cause instanceof Error ? cause.message : '区域查询失败，请重试';
      notice.value = { message: error.value, error: true };
    } finally {
      if (current === revision) { loading.value = false; refreshing.value = false; }
    }
  }
  async function query() {
    if (selected.value || submitting.value) return;
    const value = keyword.value.trim();
    if (value.length > 128) { notice.value = { message: '查询条件不能超过128个字符', error: true }; return; }
    keyword.value = value;
    filters = { ...(value ? { keyword: value } : {}), ...(status.value ? { status: status.value } : {}) };
    items.value = []; page.value = 0; pages.value = 0; notice.value = null;
    await load(1);
  }
  async function refresh() {
    if (loading.value || selected.value || submitting.value) return;
    refreshing.value = true; notice.value = null;
    await load(1);
  }
  async function loadMore() {
    if (loading.value || selected.value || submitting.value || error.value || !hasMore.value) return;
    await load(page.value + 1);
  }
  async function retry() {
    if (!loading.value && !selected.value && !submitting.value && error.value) await load(failedPage);
  }
  function open(area: TrafficArea) {
    if (loading.value || submitting.value || selected.value) return;
    selected.value = { ...area }; notice.value = null;
  }
  function close() { if (!submitting.value) selected.value = null; }
  async function confirm() {
    if (!selected.value || submitting.value) return;
    const area = selected.value;
    const action = area.status === 'FREE' ? 'lock' : 'release';
    const expected = area.status === 'FREE' ? 'OCCUPIED' : 'FREE';
    const label = actionName.value;
    const current = ++revision;
    const currentOperation = ++operation;
    submitting.value = true; notice.value = null;
    try {
      const result = await trafficApi.act(area.areaCode, action, { requestId: requestId(), version: area.version });
      if (current !== revision) return;
      if (!validArea(result) || result.areaCode !== area.areaCode || result.version <= area.version || result.status !== expected) {
        throw new Error('操作结果数据异常，请关闭弹窗并刷新核实状态');
      }
      items.value = items.value.map((item) => item.areaCode === result.areaCode ? result : item);
      selected.value = null;
      notice.value = { message: `${label}成功`, error: false };
      // Status filtering changes offsets. Re-query page one instead of skipping records on the next page.
      if (filters.status && result.status !== filters.status) {
        items.value = items.value.filter((item) => item.areaCode !== result.areaCode);
        await load(1);
      }
    } catch (cause) {
      if (current !== revision) return;
      notice.value = { message: cause instanceof Error ? cause.message : `${label}失败，请重试`, error: true };
    } finally {
      if (currentOperation === operation) submitting.value = false;
    }
  }
  function dispose() {
    revision++; operation++; loading.value = false; refreshing.value = false; submitting.value = false;
    selected.value = null; notice.value = null;
  }
  return { keyword, status, items, loading, refreshing, submitting, selected, error, notice, hasMore, actionName,
    query, refresh, loadMore, retry, open, close, confirm, dispose };
}
