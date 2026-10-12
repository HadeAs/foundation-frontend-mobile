import { afterEach, describe, expect, it, vi } from 'vitest';
import { pendingReceivingApi as api, type ReceivingTask, type ReceivingTaskPage } from '../pendingReceiving';
import { usePendingReceiving } from '../../composables/usePendingReceiving';

const task = (id = '9007199254741001'): ReceivingTask => ({ taskId: id, taskNo: 'WL-' + id, version: 7,
  object: { containerType: 'VEHICLE', containerCode: 'CAR-1', version: 3 }, status: 'PARTIAL', statusName: '部分接收',
  totalBoxCount: 3, receivedBoxCount: 1, createdTime: '2026-10-12T01:00:00Z', eligibility: { allowed: true } });
const page = (records: ReceivingTask[], current = 1, total = records.length): ReceivingTaskPage => ({ records, current, total, size: 20, pages: Math.ceil(total / 20) });
afterEach(() => { vi.restoreAllMocks(); });

describe('pending receiving 2026-10-12.1', () => {
  it('rejects a malformed task identity without replacing the already loaded list', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page([task()], 1, 21));
    const flow = usePendingReceiving(); await flow.query();
    const invalid = task(); Object.assign(invalid, { taskId: 9007199254741001, object: null });
    query.mockResolvedValueOnce(page([invalid], 2, 21)); await flow.loadMore();
    expect(flow.items.value).toHaveLength(1); expect(flow.page.value).toBe(1); expect(flow.notice.value).toContain('任务数据异常');
  });
  it('rejects inconsistent received-box progress instead of displaying a valid partial task', async () => {
    const invalid = task(); invalid.receivedBoxCount = 4;
    vi.spyOn(api, 'query').mockResolvedValue(page([invalid]));
    const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([]); expect(flow.error.value).toContain('任务数据异常');
  });
  it('does not issue requests from hidden-page refresh, pagination or query events', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValue(page([task()], 1, 21));
    const flow = usePendingReceiving(); await flow.query(); flow.dispose();
    await flow.refresh(); await flow.loadMore(); await flow.query(); await flow.retry();
    expect(query).toHaveBeenCalledOnce(); expect(flow.loading.value).toBe(false);
  });
  it('accepts partial BOX tasks and omitted optional summaries without inventing location or actual content', async () => {
    const value = task(); value.object = { containerType: 'BOX', containerCode: 'BOX-1', version: 3 };
    value.eligibility = { allowed: false, reason: '该箱已接收，整批仍有剩余' };
    vi.spyOn(api, 'query').mockResolvedValue(page([value])); const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([value]); expect(flow.items.value[0].location).toBeUndefined();
    expect(flow.items.value[0].object.contentState).toBeUndefined(); expect(flow.notice.value).toBe('');
  });
  it('does not locally filter coherent backend records by eligibility or completed status', async () => {
    const value = task(); Object.assign(value, { status: 'RECEIVED', statusName: '已接收', receivedBoxCount: 3,
      eligibility: { allowed: false, reason: '该运输已接收' } });
    vi.spyOn(api, 'query').mockResolvedValue(page([value])); const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([value]); expect(flow.total.value).toBe(1);
  });
  it.each(['identity', 'version', 'object', 'location', 'eligibility', 'time', 'status', 'missing count', 'zero count'])('rejects invalid required task data: %s', async field => {
    const value = task();
    if (field === 'identity') value.taskId = '01';
    if (field === 'version') value.version = 0;
    if (field === 'object') Object.assign(value, { object: null });
    if (field === 'location') value.location = { locationCode: 'KW-1', locationName: '' };
    if (field === 'eligibility') value.eligibility = { allowed: false };
    if (field === 'time') value.createdTime = 'not a date';
    if (field === 'status') value.status = 'PENDING';
    if (field === 'missing count') delete (value as { totalBoxCount?: number }).totalBoxCount;
    if (field === 'zero count') value.totalBoxCount = 0;
    vi.spyOn(api, 'query').mockResolvedValue(page([value])); const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([]); expect(flow.error.value).toContain('任务数据异常');
  });
  it.each(['oversized', 'pages', 'total', 'page limit'])('rejects invalid pagination without applying partial records: %s', async field => {
    const value = page([task()]);
    if (field === 'oversized') { value.records = Array.from({ length: 21 }, (_, index) => task(String(index + 1))); value.total = 21; value.pages = 2; }
    if (field === 'pages') value.pages = 2;
    if (field === 'total') value.total = Number.MAX_SAFE_INTEGER + 1;
    if (field === 'page limit') value.pages = 2147483648;
    vi.spyOn(api, 'query').mockResolvedValue(value); const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([]); expect(flow.page.value).toBe(0); expect(flow.error.value).toContain('分页数据异常');
  });
  it('keeps the applied filters on refresh and failed-page retry even when draft fields change', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page([task()], 1, 21)).mockRejectedValueOnce(new Error('刷新失败')).mockResolvedValueOnce(page([task()]));
    const flow = usePendingReceiving(); flow.vehicleCode.value = ' CAR-1 '; flow.locationCode.value = ' KW-1 '; await flow.query();
    flow.vehicleCode.value = 'CAR-DRAFT'; flow.locationCode.value = 'KW-DRAFT'; await flow.refresh(); await flow.retry();
    expect(query.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ vehicleCode: 'CAR-1', locationCode: 'KW-1' }, 1]));
    query.mockResolvedValue(page([])); await flow.query(); expect(query.mock.lastCall).toEqual([{ vehicleCode: 'CAR-DRAFT', locationCode: 'KW-DRAFT' }, 1]);
  });
  it('retains an invalid next page for manual retry of that page only without auto-loading', async () => {
    const invalid = task('2'); invalid.receivedBoxCount = 4;
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page([task()], 1, 21)).mockResolvedValueOnce(page([invalid], 2, 21)).mockResolvedValueOnce(page([task('2')], 2, 21));
    const flow = usePendingReceiving(); await flow.query(); await flow.loadMore(); await flow.loadMore();
    expect(query).toHaveBeenCalledTimes(2); expect(flow.items.value).toHaveLength(1); await flow.retry();
    expect(query.mock.lastCall).toEqual([{}, 2]); expect(flow.items.value).toHaveLength(2); expect(flow.error.value).toBe('');
  });
  it('keeps original backend order and replaces overlapped progress without losing text IDs', async () => {
    const first = task('9007199254741002'); const second = task(); const updated = { ...second, version: 8, receivedBoxCount: 2 };
    vi.spyOn(api, 'query').mockResolvedValueOnce(page([first, second], 1, 21)).mockResolvedValueOnce(page([updated], 2, 21));
    const flow = usePendingReceiving(); await flow.query(); await flow.loadMore();
    expect(flow.items.value.map(value => value.taskId)).toEqual([first.taskId, second.taskId]); expect(flow.items.value[1].receivedBoxCount).toBe(2);
  });
  it('accepts an empty beyond-last page when tasks disappear during pagination and waits for explicit refresh', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page([task()], 1, 21)).mockResolvedValueOnce(page([], 2));
    const flow = usePendingReceiving(); await flow.query(); await flow.loadMore(); await flow.loadMore();
    expect(flow.error.value).toBe(''); expect(flow.hasMore.value).toBe(false); expect(query).toHaveBeenCalledTimes(2);
  });
  it('drops late refresh failures after hide, then resumes with a fresh query without a write', async () => {
    let reject!: (error: Error) => void;
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page([task()])).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValueOnce(page([]));
    const flow = usePendingReceiving(); await flow.query(); const pending = flow.refresh(); flow.dispose();
    reject(new Error('过期失败')); await pending; expect(flow.notice.value).toBe(''); expect(flow.loading.value).toBe(false);
    flow.resume(); await flow.query(); expect(flow.items.value).toEqual([]); expect(query).toHaveBeenCalledTimes(3);
  });
});
