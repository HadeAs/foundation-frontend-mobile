import { computed, ref, shallowRef } from 'vue';
import { inboundPageSize, lineSideInboundRecordsApi as api, type InboundDetail, type InboundFilters, type InboundSummary } from '../services/lineSideInboundRecords';

export function useLineSideInboundRecords() {
  const boxCode = ref('');
  const inboundMode = ref<InboundFilters['inboundMode']>();
  const syncStatus = ref<InboundFilters['syncStatus']>();
  const fromDate = ref(''), toDate = ref('');
  const fromTime = ref('00:00'), toTime = ref('23:59');
  const items = shallowRef<InboundSummary[]>([]);
  const total = ref(0), page = ref(0), pages = ref(0);
  const loading = ref(false), refreshing = ref(false);
  const listError = ref(''), notice = ref('');
  const selected = shallowRef<InboundSummary | null>(null);
  const detail = shallowRef<InboundDetail | null>(null);
  const detailError = ref('');
  const hasMore = computed(() => page.value < pages.value);
  let filters: InboundFilters = {};
  let active = true, listRevision = 0, detailRevision = 0, failedPage = 1;

  async function load(target: number) {
    const revision = ++listRevision;
    loading.value = true; listError.value = ''; notice.value = '';
    try {
      const data = await api.list(filters, target);
      if (revision !== listRevision) return;
      if (!data || data.current !== target || data.size !== inboundPageSize || !Number.isSafeInteger(data.total) ||
        data.total < 0 || data.pages !== Math.ceil(data.total / data.size) || !Array.isArray(data.records) ||
        data.records.length > Math.min(data.total, data.size) ||
        !data.records.every(row => row && typeof row.id === 'string' && /^[1-9]\d*$/.test(row.id))) {
        throw new Error('入库记录分页数据异常，请重试');
      }
      const merged = new Map((target === 1 ? [] : items.value).map(row => [row.id, row]));
      for (const row of data.records) merged.set(row.id, row);
      items.value = [...merged.values()]; total.value = data.total; page.value = target; pages.value = data.pages;
    } catch (error) {
      if (revision !== listRevision) return;
      failedPage = target;
      listError.value = error instanceof Error ? error.message : '入库记录查询失败';
      notice.value = listError.value;
    } finally {
      if (revision === listRevision) { loading.value = false; refreshing.value = false; }
    }
  }

  async function query() {
    if (!active || selected.value) return;
    const code = boxCode.value.trim();
    if (code.length > 128) { notice.value = '箱码不能超过128个字符'; return; }
    // Native pickers supply local dates and minutes. Include the entire selected end minute.
    const from = fromDate.value ? new Date(`${fromDate.value}T${fromTime.value}:00`) : null;
    const to = toDate.value ? new Date(`${toDate.value}T${toTime.value}:59.999`) : null;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
      notice.value = '请选择有效的入库时间'; return;
    }
    if (from && to && from > to) { notice.value = '开始时间不能晚于结束时间'; return; }
    filters = { ...(code && { boxCode: code }), ...(inboundMode.value && { inboundMode: inboundMode.value }),
      ...(syncStatus.value && { syncStatus: syncStatus.value }), ...(from && { inboundFrom: from.toISOString() }),
      ...(to && { inboundTo: to.toISOString() }) };
    boxCode.value = code; items.value = []; total.value = 0; page.value = 0; pages.value = 0;
    await load(1);
  }
  function refresh() {
    if (!active || loading.value || selected.value) return;
    refreshing.value = true; return load(1);
  }
  function loadMore() {
    if (active && !loading.value && !selected.value && !listError.value && hasMore.value) return load(page.value + 1);
  }
  function retryList() {
    if (active && !loading.value && !selected.value && listError.value) return load(failedPage);
  }
  async function openDetail(row: InboundSummary) {
    if (!active || (selected.value && !detailError.value)) return;
    const revision = ++detailRevision;
    selected.value = row; detail.value = null; detailError.value = ''; notice.value = '';
    try {
      const result = await api.detail(row.id);
      if (revision !== detailRevision) return;
      if (!result || result.id !== row.id || !Array.isArray(result.materials) ||
        !result.materials.every(line => line && typeof line === 'object')) throw new Error('入库记录或物料快照不完整，请重试');
      detail.value = result;
    } catch (error) {
      if (revision === detailRevision) detailError.value = error instanceof Error ? error.message : '入库明细查询失败';
    }
  }
  function closeDetail() { detailRevision++; selected.value = null; detail.value = null; detailError.value = ''; }
  function pause() { active = false; listRevision++; loading.value = false; refreshing.value = false; notice.value = ''; closeDetail(); }
  function resume() { active = true; return load(1); }
  return { boxCode, inboundMode, syncStatus, fromDate, fromTime, toDate, toTime, items, total, loading, refreshing, hasMore, listError,
    notice, selected, detail, detailError, query, refresh, loadMore, retryList, openDetail, closeDetail, pause, resume };
}
