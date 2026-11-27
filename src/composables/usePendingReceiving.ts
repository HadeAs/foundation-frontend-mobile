import { computed, ref } from 'vue';
import { pendingReceivingApi, type PendingFilters, type PendingApplication, type ApplicationMaterialSummary, type NotShelvingItem, type NotShelvingSubmission, type NotShelvingReceipt } from '../services/pendingReceiving';
import { isReceivingId } from '../services/receiving';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { usePendingSubmission } from './usePendingSubmission';
import type { LocationContainer, LocationSummary } from '../services/locationBinding';

function validSubmission(value: unknown): value is NotShelvingSubmission {
  const data = value as NotShelvingSubmission | null;
  return !!data && typeof data.requestId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.requestId) &&
    typeof data.reason === 'string' && !!data.reason.trim() && data.reason.length <= 500 &&
    Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 1000 &&
    data.items.every(item => item && isReceivingId(item.applicationId) && Number.isInteger(item.version) && item.version > 0 && item.version <= 2147483647) &&
    new Set(data.items.map(item => item.applicationId)).size === data.items.length;
}

function matchesReceipt(receipt: NotShelvingReceipt, input: NotShelvingSubmission) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || 'resultType' in receipt ||
    (receipt.requestId !== undefined && receipt.requestId !== input.requestId) ||
    (receipt.affectedApplicationCount !== undefined && receipt.affectedApplicationCount !== input.items.length) ||
    (receipt.affectedBoxCount !== undefined && (!Number.isSafeInteger(receipt.affectedBoxCount) || receipt.affectedBoxCount < input.items.length))) return false;
  if (receipt.items === undefined) return true;
  if (!Array.isArray(receipt.items) || receipt.items.length !== input.items.length) return false;
  const remaining = new Set(input.items.map(item => item.applicationId));
  let boxCount = 0;
  for (const item of receipt.items) {
    if (!item || !remaining.delete(item.applicationId)) return false;
    if (item.affectedBoxCount !== undefined) {
      if (!Number.isSafeInteger(item.affectedBoxCount) || item.affectedBoxCount < 1) return false;
      boxCount += item.affectedBoxCount;
    }
  }
  return receipt.affectedBoxCount === undefined || receipt.items.some(item => item.affectedBoxCount === undefined) ||
    boxCount === receipt.affectedBoxCount;
}

export function usePendingReceiving() {
  const vehicleCode = ref('');
  const locationCode = ref('');
  const items = ref<PendingApplication[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref('');
  const notice = ref('');
  const noticeError = ref(true);
  const selected = ref<NotShelvingItem[]>([]);
  const selectedIds = computed(() => new Set(selected.value.map(item => item.applicationId)));
  const reason = ref('');
  const confirming = ref(false);
  const submitting = ref(false);
  const detailApplication = ref<PendingApplication | null>(null);
  const detailRows = ref<ApplicationMaterialSummary[]>([]);
  const detailLoading = ref(false);
  const detailError = ref('');
  let detailRevision = 0;
  const submission = usePendingSubmission<NotShelvingSubmission>('receiving-not-shelving', validSubmission);
  const { pending, storageError } = submission;
  const selectionLocked = computed(() => loading.value || !!detailApplication.value || confirming.value || submitting.value || !!pending.value || !!storageError.value);
  const page = ref(0);
  const pages = ref(0);
  const hasMore = computed(() => page.value < pages.value);
  let filters: PendingFilters = {};
  let revision = 0;
  let failedPage = 1;
  let active = true;

  function resetSelection() { selected.value = []; reason.value = ''; confirming.value = false; }
  function notify(message: string, isError = true) { noticeError.value = isError; notice.value = message; }
  function closeDetail() {
    detailRevision++;
    if (notice.value === detailError.value) notice.value = '';
    detailApplication.value = null; detailRows.value = []; detailLoading.value = false; detailError.value = '';
  }
  async function openDetail(task: PendingApplication) {
    if (!active || confirming.value || submitting.value || detailLoading.value) return;
    const current = ++detailRevision;
    notice.value = '';
    detailApplication.value = task; detailLoading.value = true; detailRows.value = []; detailError.value = '';
    const groups = new Map<string, ApplicationMaterialSummary>();
    let total: number | undefined;
    try {
      for (let page = 1; ; page++) {
        const data = await pendingReceivingApi.details(task.applicationId, page);
        if (current !== detailRevision) return;
        if (total !== undefined && total !== data.total) throw new Error('申请明细已变化，请重新查询');
        total = data.total;
        for (const row of data.records) {
          if (!row || typeof row.materialCode !== 'string' || !row.materialCode.trim() ||
            typeof row.orderNo !== 'string' || !row.orderNo.trim() || !Number.isSafeInteger(row.quantity) || row.quantity < 0) {
            throw new Error('申请明细缺少有效的物料编码、订单号或数量，请核实后重试');
          }
          const key = JSON.stringify([row.materialCode, row.orderNo]);
          const group = groups.get(key);
          if (group) group.quantity += row.quantity;
          else groups.set(key, { materialCode: row.materialCode, orderNo: row.orderNo, quantity: row.quantity });
        }
        if (page >= data.pages) break;
      }
      detailRows.value = [...groups.values()];
    } catch (cause) {
      if (current === detailRevision) {
        detailError.value = cause instanceof Error ? cause.message : '申请明细加载失败';
        notify(detailError.value);
      }
    } finally { if (current === detailRevision) detailLoading.value = false; }
  }
  function toggle(task: PendingApplication) {
    if (!active || selectionLocked.value || !items.value.some(row => row.applicationId === task.applicationId && row.version === task.version) ||
      task.receivedBoxCount === task.totalBoxCount) return;
    if (selectedIds.value.has(task.applicationId)) selected.value = selected.value.filter(item => item.applicationId !== task.applicationId);
    else selected.value.push({ applicationId: task.applicationId, version: task.version });
  }
  function askNotShelve() {
    if (!active || detailApplication.value || loading.value || submitting.value || storageError.value) return;
    if (pending.value) reason.value = pending.value.input.reason;
    else {
      if (!selected.value.length) return;
      const boxes = items.value.reduce((sum, row) => selectedIds.value.has(row.applicationId) ? sum + row.totalBoxCount - row.receivedBoxCount : sum, 0);
      if (selected.value.length > 1 && (selected.value.length > 1000 || boxes > 1000)) {
        notify('批量不予上架最多支持 1000 笔申请、1000 个剩余箱，请减少勾选'); return;
      }
    }
    notice.value = ''; confirming.value = true;
  }
  function cancelNotShelve() { if (!submitting.value) confirming.value = false; }

  const text = (value: unknown, max = 128) => typeof value === 'string' && !!value.trim() && value.length <= max;
  const optionalText = (value: unknown) => value == null || text(value);
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
      (value.location == null || validLocation(value.location));
  }
  function validApplication(task: PendingApplication) {
    return task && isReceivingId(task.applicationId) && text(task.applicationNo) && integer(task.version) &&
      validContainer(task.object) && text(task.statusName) &&
      typeof task.createdTime === 'string' && Number.isFinite(Date.parse(task.createdTime)) &&
      count(task.totalBoxCount, 1) && count(task.receivedBoxCount) && task.receivedBoxCount <= task.totalBoxCount &&
      (task.status === 'PENDING' ? task.receivedBoxCount === 0 : task.status === 'PARTIAL' ? task.receivedBoxCount > 0 && task.receivedBoxCount < task.totalBoxCount :
        task.status === 'RECEIVED' && task.receivedBoxCount === task.totalBoxCount);
  }

  async function load(target: number) {
    if (!active) return;
    const requestRevision = ++revision;
    loading.value = true;
    noticeError.value = true;
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
      if (!result.records.every(validApplication)) throw new Error('申请数据异常，请刷新后重试');
      // Offset pagination can overlap while applications change; keep string IDs intact.
      const merged = new Map((target === 1 ? [] : items.value).map((task) => [task.applicationId, task]));
      result.records.forEach((task) => merged.set(task.applicationId, task));
      items.value = [...merged.values()];
      selected.value = selected.value.filter(item => {
        const latest = merged.get(item.applicationId);
        return latest && latest.version === item.version && latest.receivedBoxCount < latest.totalBoxCount;
      });
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
    if (!active || detailApplication.value || confirming.value || submitting.value) return;
    const vehicle = vehicleCode.value.trim();
    const location = locationCode.value.trim();
    if (vehicle.length > 128 || location.length > 128) { notify('箱号、载具号和库位号不能超过128个字符'); return; }
    vehicleCode.value = vehicle; locationCode.value = location;
    filters = { ...(vehicle ? { vehicleCode: vehicle } : {}), ...(location ? { locationCode: location } : {}) };
    resetSelection();
    items.value = []; total.value = 0; page.value = 0; pages.value = 0;
    await load(1);
  }
  async function refresh() {
    if (!active || detailApplication.value || refreshing.value || confirming.value || submitting.value) return;
    refreshing.value = true;
    await load(1);
  }
  async function loadMore() {
    if (!active || detailApplication.value || confirming.value || submitting.value || loading.value || error.value || !hasMore.value) return;
    await load(page.value + 1);
  }
  async function retry() { if (active && !detailApplication.value && !loading.value && !confirming.value && !submitting.value && error.value) await load(failedPage); }
  async function confirmNotShelve() {
    if (!active || !confirming.value || submitting.value || storageError.value || !submission.sameScope()) return;
    const replay = pending.value?.input;
    const input = replay || { requestId: requestId(), items: selected.value.slice(), reason: reason.value.trim() };
    if (!validSubmission(input)) return;
    submitting.value = true;
    try {
      submission.save(input, '正在确认不予上架结果');
      const receipt = await pendingReceivingApi.notShelve(input);
      if (!matchesReceipt(receipt, input)) throw new Error('不予上架回执与本次申请不一致，请核实后重试原请求');
      submission.finish(input.requestId);
    } catch (cause) {
      if (!replay && cause instanceof ApiRequestError && [400, 401, 403, 404, 409].includes(cause.statusCode)) submission.finish(input.requestId);
      submission.failed(cause);
      if (active && submission.sameScope()) notify(cause instanceof Error ? cause.message : '不予上架失败，请重试');
      return;
    } finally { submitting.value = false; }
    if (!active || !submission.sameScope()) return;
    resetSelection();
    items.value = []; total.value = 0; page.value = 0; pages.value = 0;
    const refresh = load(1);
    const refreshRevision = revision;
    await refresh;
    if (active && revision === refreshRevision && submission.sameScope()) {
      notify(error.value ? '不予上架成功，清单刷新失败，请重试查询' : '不予上架成功', !!error.value);
    }
  }
  function resume() { active = true; if (!submitting.value) submission.restore(); }
  function dispose() { active = false; revision++; closeDetail(); resetSelection(); loading.value = false; refreshing.value = false; notice.value = ''; }

  return { vehicleCode, locationCode, items, total, loading, refreshing, error, notice, noticeError, hasMore, page, query, refresh, loadMore, retry, resume, dispose,
    detailApplication, detailRows, detailLoading, detailError, openDetail, closeDetail,
    selectedIds, reason, confirming, submitting, selectionLocked, pending, storageError, toggle, askNotShelve, cancelNotShelve, confirmNotShelve };
}
