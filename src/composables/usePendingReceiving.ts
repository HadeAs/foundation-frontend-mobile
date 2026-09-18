import { computed, ref } from 'vue';
import { pendingReceivingApi, type PendingFilters, type ReceivingTask } from '../services/pendingReceiving';

export function usePendingReceiving() {
  const vehicleCode = ref('');
  const locationCode = ref('');
  const items = ref<ReceivingTask[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref('');
  const notice = ref('');
  const page = ref(0);
  const pages = ref(0);
  const hasMore = computed(() => page.value < pages.value);
  let filters: PendingFilters = {};
  let revision = 0;
  let failedPage = 1;

  async function load(target: number) {
    const requestRevision = ++revision;
    loading.value = true;
    error.value = '';
    notice.value = '';
    try {
      const result = await pendingReceivingApi.query(filters, target);
      if (requestRevision !== revision) return;
      if (!Array.isArray(result.records) || result.current !== target || !Number.isSafeInteger(result.total) || result.total < 0 ||
          !Number.isInteger(result.pages) || result.pages < 0 || result.size !== 20) {
        throw new Error('分页数据异常，请刷新后重试');
      }
      // Offset pagination can overlap while tasks change; keep string IDs intact.
      const merged = new Map((target === 1 ? [] : items.value).map((task) => [task.taskId, task]));
      result.records.forEach((task) => merged.set(task.taskId, task));
      items.value = [...merged.values()];
      total.value = result.total;
      page.value = result.current;
      pages.value = result.pages;
    } catch (cause) {
      if (requestRevision !== revision) return;
      failedPage = target;
      error.value = cause instanceof Error ? cause.message : '加载失败，请重试';
      notice.value = error.value;
    } finally {
      if (requestRevision === revision) { loading.value = false; refreshing.value = false; }
    }
  }

  async function query() {
    const vehicle = vehicleCode.value.trim();
    const location = locationCode.value.trim();
    if (vehicle.length > 128 || location.length > 128) { notice.value = '载具号和库位号不能超过128个字符'; return; }
    vehicleCode.value = vehicle; locationCode.value = location;
    filters = { ...(vehicle ? { vehicleCode: vehicle } : {}), ...(location ? { locationCode: location } : {}) };
    items.value = []; total.value = 0; page.value = 0; pages.value = 0;
    await load(1);
  }
  async function refresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    await load(1);
  }
  async function loadMore() {
    if (loading.value || error.value || !hasMore.value) return;
    await load(page.value + 1);
  }
  async function retry() { if (!loading.value && error.value) await load(failedPage); }
  function dispose() { revision++; loading.value = false; refreshing.value = false; notice.value = ''; }

  return { vehicleCode, locationCode, items, total, loading, refreshing, error, notice, hasMore, page, query, refresh, loadMore, retry, dispose };
}
