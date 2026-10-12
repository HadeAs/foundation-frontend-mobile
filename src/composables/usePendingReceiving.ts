import { computed, ref } from 'vue';
import { pendingReceivingApi, type PendingFilters, type ReceivingTask } from '../services/pendingReceiving';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';

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
  let active = true;

  const text = (value: unknown, max = 128) => typeof value === 'string' && !!value.trim() && value.length <= max;
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
  function validTask(task: ReceivingTask) {
    return task && typeof task.taskId === 'string' && /^[1-9][0-9]{0,18}$/.test(task.taskId) && text(task.taskNo) && integer(task.version) &&
      validContainer(task.object) && (task.location === undefined || validLocation(task.location)) && text(task.statusName) &&
      typeof task.createdTime === 'string' && Number.isFinite(Date.parse(task.createdTime)) &&
      typeof task.eligibility?.allowed === 'boolean' && (task.eligibility.reason === undefined || text(task.eligibility.reason, 500)) &&
      (task.eligibility.allowed || text(task.eligibility.reason, 500)) &&
      count(task.totalBoxCount, 1) && count(task.receivedBoxCount) && task.receivedBoxCount <= task.totalBoxCount &&
      (task.status === 'PENDING' ? task.receivedBoxCount === 0 : task.status === 'PARTIAL' ? task.receivedBoxCount > 0 && task.receivedBoxCount < task.totalBoxCount :
        task.status === 'RECEIVED' && task.receivedBoxCount === task.totalBoxCount);
  }

  async function load(target: number) {
    if (!active) return;
    const requestRevision = ++revision;
    loading.value = true;
    error.value = '';
    notice.value = '';
    try {
      const result = await pendingReceivingApi.query(filters, target);
      if (requestRevision !== revision) return;
      if (!result || !Array.isArray(result.records) || result.current !== target || !integer(result.current) || !count(result.total) ||
          !integer(result.pages, 0) || result.size !== 20 || result.pages !== Math.ceil(result.total / result.size) ||
          result.records.length > Math.min(result.size, result.total) || (result.current > result.pages && result.records.length)) {
        throw new Error('分页数据异常，请刷新后重试');
      }
      if (!result.records.every(validTask)) throw new Error('任务数据异常，请刷新后重试');
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
    if (!active) return;
    const vehicle = vehicleCode.value.trim();
    const location = locationCode.value.trim();
    if (vehicle.length > 128 || location.length > 128) { notice.value = '载具号和库位号不能超过128个字符'; return; }
    vehicleCode.value = vehicle; locationCode.value = location;
    filters = { ...(vehicle ? { vehicleCode: vehicle } : {}), ...(location ? { locationCode: location } : {}) };
    items.value = []; total.value = 0; page.value = 0; pages.value = 0;
    await load(1);
  }
  async function refresh() {
    if (!active || refreshing.value) return;
    refreshing.value = true;
    await load(1);
  }
  async function loadMore() {
    if (!active || loading.value || error.value || !hasMore.value) return;
    await load(page.value + 1);
  }
  async function retry() { if (active && !loading.value && error.value) await load(failedPage); }
  function resume() { active = true; }
  function dispose() { active = false; revision++; loading.value = false; refreshing.value = false; notice.value = ''; }

  return { vehicleCode, locationCode, items, total, loading, refreshing, error, notice, hasMore, page, query, refresh, loadMore, retry, resume, dispose };
}
