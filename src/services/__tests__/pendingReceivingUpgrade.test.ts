import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingReceivingApi as api, type PendingApplication, type ReceivingTaskPage } from '../pendingReceiving';
import { usePendingReceiving } from '../../composables/usePendingReceiving';
import { ApiRequestError } from '../nariRequest';
import { seedTestSession } from './helpers/authSession';

const task = (id = '9007199254741001'): PendingApplication => ({ applicationId: id, applicationNo: 'WL-' + id, version: 7,
  object: { containerType: 'VEHICLE', containerCode: 'CAR-1', version: 3 }, status: 'PARTIAL', statusName: '部分接收',
  totalBoxCount: 3, receivedBoxCount: 1, createdTime: '2026-10-12T01:00:00Z' });
const page = (records: PendingApplication[], current = 1, total = records.length): ReceivingTaskPage => ({ records, current, total, size: 20, pages: Math.ceil(total / 20) });
afterEach(() => { vi.restoreAllMocks(); });

describe('pending applications not shelving', () => {
  const rows = [task(), task('9007199254741002')];
  beforeEach(() => {
    const storage = new Map<string, unknown>();
    vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
    seedTestSession();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads every sorted record page with the exact application ID and sums quantities by material and order', async () => {
    const id = '9223372036854775806';
    const row = { materialCode: '00031', orderNo: '000062', quantity: 2 };
    const first = Array.from({ length: 100 }, () => row);
    const second = [row, { ...row, orderNo: '000063' }, { ...row, materialCode: '00032' }];
    const get = vi.fn((options: UniNamespace.RequestOptions) => {
      const { page } = options.data as { page: number };
      options.success!({ statusCode: 200, header: {}, cookies: [], data: { code: 0,
        data: { records: page === 1 ? first : second, current: page, pages: 2, total: 103, size: 100 } } });
    });
    vi.stubGlobal('uni', { ...uni, request: get });
    const flow = usePendingReceiving(); await flow.openDetail(task(id));
    expect(get).toHaveBeenCalledTimes(2);
    for (const page of [1, 2]) {
      expect(get.mock.calls[page - 1][0]).toMatchObject({
        url: expect.stringMatching(/\/api\/v1\/business\/nari-warehouse-record-box$/), method: 'GET',
        header: { Authorization: expect.stringMatching(/^Bearer /) },
        data: { warehouseRecordId: id, page, size: 100, sortBy: 'id', sortOrder: 'ASC' }
      });
    }
    expect(flow.detailRows.value).toEqual([{ ...row, quantity: 202 }, second[1], second[2]]);
  });

  it('discards partial totals after a failed page and can retry an empty result without changing the selection', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(page(rows));
    const line = { materialCode: 'MAT', orderNo: 'SO', quantity: 1 };
    const details = vi.spyOn(api, 'details').mockResolvedValueOnce({ records: Array(100).fill(line), current: 1, pages: 2, total: 101, size: 100 })
      .mockRejectedValueOnce(new Error('无权读取申请明细')).mockResolvedValueOnce({ records: [], current: 1, pages: 0, total: 0, size: 100 });
    const flow = usePendingReceiving(); await flow.query(); flow.toggle(rows[0]); await flow.openDetail(rows[0]);
    expect(flow.detailError.value).toBe('无权读取申请明细'); expect(flow.detailRows.value).toEqual([]);
    await flow.openDetail(rows[0]);
    expect(details.mock.calls.map(call => call[1])).toEqual([1, 2, 1]);
    expect(flow.detailError.value).toBe(''); expect(flow.detailRows.value).toEqual([]); flow.closeDetail();
    expect([...flow.selectedIds.value]).toEqual([rows[0].applicationId]);
  });

  it('ignores a late first page after closing and reopening another application', async () => {
    const line = { materialCode: 'MAT', orderNo: 'SO', quantity: 3 };
    let resolve!: (value: ReceivingTaskPage<typeof line>) => void;
    const details = vi.spyOn(api, 'details').mockReturnValueOnce(new Promise(done => { resolve = done; }))
      .mockResolvedValueOnce({ records: [line], current: 1, pages: 1, total: 1, size: 100 });
    const flow = usePendingReceiving(); const old = flow.openDetail(rows[0]);
    flow.closeDetail(); await flow.openDetail(rows[1]);
    resolve({ records: Array(100).fill(line), current: 1, pages: 2, total: 101, size: 100 }); await old;
    expect(details).toHaveBeenCalledTimes(2); expect(flow.detailApplication.value?.applicationId).toBe(rows[1].applicationId);
    expect(flow.detailRows.value).toEqual([line]); flow.dispose(); expect(flow.detailApplication.value).toBeNull();
  });

  it('requires an explicit confirmation with a nonblank reason and at least one pending application', async () => {
    const completed = { ...task('7'), status: 'RECEIVED', receivedBoxCount: 3 };
    vi.spyOn(api, 'query').mockResolvedValue(page([...rows, completed]));
    const send = vi.spyOn(api, 'notShelve');
    const flow = usePendingReceiving();
    await flow.query(); flow.toggle(completed); flow.askNotShelve();
    expect(flow.confirming.value).toBe(false);
    flow.toggle(rows[0]); flow.askNotShelve();
    for (const reason of [' ', '料'.repeat(501)]) { flow.reason.value = reason; await flow.confirmNotShelve(); }
    flow.reason.value = '物料复核'; flow.cancelNotShelve(); await flow.confirmNotShelve();
    expect(flow.selectedIds.value.has(rows[0].applicationId)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([1, 2])('submits %i selected applications once and refreshes page one with the applied filters', async n => {
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page(rows)).mockResolvedValueOnce(page([]));
    const send = vi.spyOn(api, 'notShelve').mockImplementation(async input => ({ requestId: input.requestId,
      affectedApplicationCount: n, affectedBoxCount: n * 2, items: [...input.items].reverse() }));
    const flow = usePendingReceiving();
    flow.vehicleCode.value = 'CAR-1'; await flow.query(); flow.vehicleCode.value = '未查询的输入';
    rows.slice(0, n).forEach(flow.toggle); flow.askNotShelve(); flow.reason.value = ' 待复检 ';
    await Promise.all([flow.confirmNotShelve(), flow.confirmNotShelve()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ requestId: expect.any(String), reason: '待复检', items: rows.slice(0, n).map(({ applicationId, version }) => ({ applicationId, version })) });
    expect(query).toHaveBeenLastCalledWith({ vehicleCode: 'CAR-1' }, 1);
    expect(flow.selectedIds.value.size).toBe(0); expect(flow.reason.value).toBe(''); expect(flow.confirming.value).toBe(false);
    expect(flow.items.value).toEqual([]); expect(flow.noticeError.value).toBe(false);
  });
  it('keeps the selection and reason after a version conflict, then drops a stale selection on refresh', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValue(page(rows));
    vi.spyOn(api, 'notShelve').mockRejectedValue(new ApiRequestError('申请版本已变化', 409));
    const flow = usePendingReceiving(); await flow.query();
    flow.toggle(rows[0]); flow.askNotShelve(); flow.reason.value = '待复检'; await flow.confirmNotShelve();
    expect(flow.notice.value).toBe('申请版本已变化'); expect(flow.confirming.value).toBe(true);
    expect(flow.reason.value).toBe('待复检'); expect(flow.pending.value).toBeNull();
    expect(flow.selectedIds.value.size).toBe(1); expect(query).toHaveBeenCalledTimes(1);
    flow.cancelNotShelve(); query.mockResolvedValue(page([{ ...rows[0], version: 8 }])); await flow.refresh();
    expect(flow.selectedIds.value.size).toBe(0);
  });
  it('replays an uncertain batch only on manual confirmation, including after the page is reopened', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(page(rows));
    const send = vi.spyOn(api, 'notShelve').mockRejectedValueOnce(new Error('网络超时'))
      .mockResolvedValueOnce({ requestId: 'wrong-receipt' }).mockImplementationOnce(async input => ({ requestId: input.requestId, items: input.items }));
    let flow = usePendingReceiving(); await flow.query(); rows.forEach(flow.toggle);
    flow.askNotShelve(); flow.reason.value = '异常材料'; await flow.confirmNotShelve();
    expect(flow.pending.value?.input).toEqual(send.mock.calls[0][0]);
    flow.dispose(); flow = usePendingReceiving(); flow.resume(); await flow.query();
    expect(send).toHaveBeenCalledTimes(1);
    flow.askNotShelve(); expect(flow.reason.value).toBe('异常材料'); await flow.confirmNotShelve();
    expect(flow.pending.value).not.toBeNull(); await flow.confirmNotShelve();
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]); expect(send.mock.calls[2]).toEqual(send.mock.calls[0]);
    expect(flow.pending.value).toBeNull();
  });
  it('blocks batches over 1000 remaining boxes before opening the dialog', async () => {
    const large = { ...rows[0], totalBoxCount: 1001 };
    vi.spyOn(api, 'query').mockResolvedValue(page([large, rows[1]]));
    const flow = usePendingReceiving(); await flow.query();
    flow.toggle(large); flow.toggle(rows[1]); flow.askNotShelve();
    expect(flow.confirming.value).toBe(false); expect(flow.notice.value).toContain('1000');
  });
  it('keeps selection across pages, checks a partial batch receipt, and clears selection on a new search', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page([rows[0]], 1, 21)).mockResolvedValueOnce(page([rows[1]], 2, 21));
    vi.spyOn(api, 'notShelve').mockImplementation(async input => ({ requestId: input.requestId, items: [input.items[0]] }));
    const flow = usePendingReceiving(); await flow.query(); flow.toggle(rows[0]); await flow.loadMore(); flow.toggle(rows[1]);
    expect(flow.selectedIds.value.size).toBe(2);
    flow.askNotShelve(); flow.reason.value = '复检'; await flow.confirmNotShelve();
    expect(flow.notice.value).toContain('回执'); expect(flow.pending.value?.input.items).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(2);
    flow.cancelNotShelve(); query.mockResolvedValueOnce(page([])); await flow.query();
    expect(flow.selectedIds.value.size).toBe(0); expect(flow.pending.value?.input.items).toHaveLength(2);
  });
  it('retries only the list when refreshing after a committed operation fails', async () => {
    vi.spyOn(api, 'query').mockResolvedValueOnce(page(rows)).mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce(page([]));
    const send = vi.spyOn(api, 'notShelve').mockImplementation(async input => ({ requestId: input.requestId }));
    const flow = usePendingReceiving(); await flow.query(); flow.toggle(rows[0]); flow.askNotShelve();
    flow.reason.value = '复检'; await flow.confirmNotShelve();
    expect(flow.notice.value).toContain('不予上架成功，清单刷新失败'); expect(flow.items.value).toEqual([]);
    expect(flow.pending.value).toBeNull(); await flow.retry(); expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('pending receiving 2026-10-12.1', () => {
  it('rejects a malformed task identity without replacing the already loaded list', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(page([task()], 1, 21));
    const flow = usePendingReceiving(); await flow.query();
    const invalid = task(); Object.assign(invalid, { applicationId: 9007199254741001, object: null });
    query.mockResolvedValueOnce(page([invalid], 2, 21)); await flow.loadMore();
    expect(flow.items.value).toHaveLength(1); expect(flow.page.value).toBe(1); expect(flow.notice.value).toContain('申请数据异常');
  });
  it('rejects inconsistent received-box progress instead of displaying a valid partial task', async () => {
    const invalid = task(); invalid.receivedBoxCount = 4;
    vi.spyOn(api, 'query').mockResolvedValue(page([invalid]));
    const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([]); expect(flow.error.value).toContain('申请数据异常');
  });
  it('does not issue requests from hidden-page refresh, pagination or query events', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValue(page([task()], 1, 21));
    const flow = usePendingReceiving(); await flow.query(); flow.dispose();
    await flow.refresh(); await flow.loadMore(); await flow.query(); await flow.retry();
    expect(query).toHaveBeenCalledOnce(); expect(flow.loading.value).toBe(false);
  });
  it('accepts partial BOX tasks and omitted optional summaries without inventing location or actual content', async () => {
    const value = task(); value.object = { containerType: 'BOX', containerCode: 'BOX-1', version: 3 };
    vi.spyOn(api, 'query').mockResolvedValue(page([value])); const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([value]); expect(flow.items.value[0].object.location).toBeUndefined();
    expect(flow.items.value[0].object.contentState).toBeUndefined(); expect(flow.notice.value).toBe('');
  });
  it('does not locally filter coherent backend records by eligibility or completed status', async () => {
    const value = task(); Object.assign(value, { status: 'RECEIVED', statusName: '已接收', receivedBoxCount: 3,
      eligibility: { allowed: false, reason: '该运输已接收' } });
    vi.spyOn(api, 'query').mockResolvedValue(page([value])); const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([value]); expect(flow.total.value).toBe(1);
  });
  it.each(['identity', 'version', 'object', 'location', 'application number', 'time', 'status', 'missing count', 'zero count'])('rejects invalid required task data: %s', async field => {
    const value = task();
    if (field === 'identity') value.applicationId = '01';
    if (field === 'version') value.version = 0;
    if (field === 'object') Object.assign(value, { object: null });
    if (field === 'location') value.object.location = { locationCode: 'KW-1', locationName: '' };
    if (field === 'application number') value.applicationNo = '';
    if (field === 'time') value.createdTime = 'not a date';
    if (field === 'status') value.status = 'PENDING';
    if (field === 'missing count') delete (value as { totalBoxCount?: number }).totalBoxCount;
    if (field === 'zero count') value.totalBoxCount = 0;
    vi.spyOn(api, 'query').mockResolvedValue(page([value])); const flow = usePendingReceiving(); await flow.query();
    expect(flow.items.value).toEqual([]); expect(flow.error.value).toContain('申请数据异常');
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
    expect(flow.items.value.map(value => value.applicationId)).toEqual([first.applicationId, second.applicationId]); expect(flow.items.value[1].receivedBoxCount).toBe(2);
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
