import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLineSideInboundRecords } from '../../composables/useLineSideInboundRecords';
import { lineSideInboundRecordsApi as api, type InboundSummary, type InboundDetail } from '../lineSideInboundRecords';

const row = (id: string): InboundSummary => ({ id, boxCode: 'BOX-1', totalQuantity: 2, inboundMode: 'MANUAL', syncStatus: 'PENDING' });
const page = (records: InboundSummary[], current = 1, total = records.length) =>
  ({ records, current, size: 20, pages: Math.ceil(total / 20), total });
const history: InboundDetail = { ...row('9007199254741021'), materials: [
  { panelCode: 'PANEL-1', materialCode: 'MAT-2', orderNo: 'SO-3', materialBatch: '00031', quantity: 2 }
] };
afterEach(() => vi.restoreAllMocks());

describe('line-side inbound history', () => {
  it('loads all inbound modes and sync states by default and retains distinct records for the same box', async () => {
    const rows = [history, { ...history, id: '9007199254741022', inboundMode: 'AGV' as const }];
    const list = vi.spyOn(api, 'list').mockResolvedValue(page(rows));
    const flow = useLineSideInboundRecords(); await flow.resume();
    expect(list).toHaveBeenCalledWith({}, 1); expect(flow.items.value).toEqual(rows);
    expect(flow.listError.value).toBe('');
  });
  it('applies normalized filters only on search and preserves applied filters during pagination, refresh and retry', async () => {
    const list = vi.spyOn(api, 'list').mockResolvedValueOnce(page([row('1')], 1, 21)).mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce(page([row('1'), row('2')], 2, 21)).mockResolvedValueOnce(page([]));
    const flow = useLineSideInboundRecords();
    flow.boxCode.value = ' 箱1 '; flow.inboundMode.value = 'AGV'; flow.syncStatus.value = 'WAIT_CONFIRM';
    flow.fromDate.value = flow.toDate.value = '2026-11-19'; flow.fromTime.value = '09:30'; flow.toTime.value = '10:40';
    await flow.query();
    const filters = { boxCode: '箱1', inboundMode: 'AGV', syncStatus: 'WAIT_CONFIRM', inboundFrom: new Date(2026,10,19,9,30).toISOString(),
      inboundTo: new Date(2026,10,19,10,40,59,999).toISOString() };
    flow.boxCode.value = '未应用'; await flow.loadMore();
    expect(flow.items.value).toHaveLength(1); expect(flow.listError.value).toBe('网络不可用');
    await flow.retryList(); expect(flow.items.value.map(r => r.id)).toEqual(['1','2']);
    await flow.refresh(); expect(flow.items.value).toEqual([]);
    expect(list.mock.calls).toEqual([[filters,1], [filters,2], [filters,2], [filters,1]]);
  });
  it('rejects reversed time bounds and long box codes without replacing the current list', async () => {
    const list = vi.spyOn(api, 'list').mockResolvedValue(page([history]));
    const flow = useLineSideInboundRecords(); await flow.resume();
    flow.fromDate.value = '2026-11-20'; flow.toDate.value = '2026-11-19'; await flow.query();
    expect(flow.notice.value).toContain('开始时间'); flow.boxCode.value = 'a'.repeat(129); await flow.query();
    expect(flow.notice.value).toContain('箱码'); expect(list).toHaveBeenCalledTimes(1); expect(flow.items.value).toEqual([history]);
  });
  it('opens the fixed snapshot by textual record ID and never treats PENDING as awaiting a receipt', async () => {
    const get = vi.spyOn(api, 'detail').mockResolvedValue(history);
    const flow = useLineSideInboundRecords(); await flow.openDetail(row(history.id));
    expect(get).toHaveBeenCalledWith(history.id); expect(flow.detail.value).toEqual(history);
    flow.closeDetail(); expect(flow.selected.value).toBeNull(); expect(flow.detail.value).toBeNull();
  });
  it('reports detail failures inside the selected record and retries its exact ID', async () => {
    const get = vi.spyOn(api, 'detail').mockResolvedValueOnce({ ...history, id: '6' })
      .mockRejectedValueOnce(new Error('查询失败')).mockResolvedValueOnce({ ...history, materials: [] });
    const flow = useLineSideInboundRecords(); await flow.openDetail(history);
    expect(flow.detail.value).toBeNull(); expect(flow.detailError.value).toContain('记录');
    await flow.openDetail(history); expect(flow.detailError.value).toBe('查询失败');
    await flow.openDetail(history); expect(flow.detail.value?.materials).toEqual([]);
    expect(get.mock.calls).toEqual([[history.id],[history.id],[history.id]]);
  });
  it('ignores late responses after a replacement search, a closed detail or leaving the page', async () => {
    let resolvePage!: (result: ReturnType<typeof page>) => void;
    let resolveDetail!: (result: InboundDetail) => void;
    const list = vi.spyOn(api, 'list').mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }))
      .mockResolvedValueOnce(page([row('2')]));
    vi.spyOn(api, 'detail').mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve; })).mockResolvedValueOnce(history);
    const flow = useLineSideInboundRecords(); const first = flow.resume(); flow.boxCode.value = 'B'; await flow.query();
    resolvePage(page([row('1')])); await first; expect(flow.items.value[0].id).toBe('2');
    const detail = flow.openDetail(row('2')); flow.closeDetail(); await flow.openDetail(history);
    resolveDetail({ ...history, id: '2' }); await detail; expect(flow.detail.value?.id).toBe(history.id);
    flow.pause(); await flow.refresh(); await flow.query(); expect(list).toHaveBeenCalledTimes(2); expect(flow.selected.value).toBeNull();
  });
});
