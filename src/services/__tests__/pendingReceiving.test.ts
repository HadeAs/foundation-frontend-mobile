import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { pendingReceivingApi as api, displayTaskTime, type ReceivingTaskPage } from '../pendingReceiving';
import { usePendingReceiving } from '../../composables/usePendingReceiving';

const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock'); vi.useFakeTimers();
  storage.clear(); network.mockClear(); resetMockData();
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('pending receiving list', () => {
  it('loads all pages once, preserves string IDs, backend order and BOX records', async () => {
    const flow = usePendingReceiving();
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.query());
    expect(transport.mock.lastCall?.[0].data).toEqual({ page: 1, size: 20 });
    expect(flow.items.value).toHaveLength(20);
    expect(flow.items.value[0].taskNo).toBe('RCV-20260917-0047');
    expect(flow.items.value[0].object.containerType).toBe('BOX');
    expect(flow.items.value[0].taskId).toBe('9007199254741047');
    await finish(Promise.all([flow.loadMore(), flow.loadMore()]));
    expect(flow.items.value).toHaveLength(40);
    await finish(flow.loadMore());
    expect(flow.items.value).toHaveLength(47);
    expect(new Set(flow.items.value.map((item) => item.taskId)).size).toBe(47);
    await flow.loadMore();
    expect(transport).toHaveBeenCalledTimes(3);
    expect(flow.hasMore.value).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
  it('uses trimmed exact filters only on query, resets pages and supports empty results', async () => {
    const flow = usePendingReceiving();
    await finish(flow.query());
    flow.vehicleCode.value = ' CAR-NR-0098 ';
    flow.locationCode.value = ' KW-03-01 ';
    // Editing fields does not change the active pagination query.
    await finish(flow.loadMore());
    expect(flow.items.value).toHaveLength(40);
    await finish(flow.query());
    expect(flow.page.value).toBe(1);
    expect(flow.items.value.length).toBeGreaterThan(0);
    expect(flow.items.value.every((item) => item.object.containerCode === 'CAR-NR-0098' && item.location?.locationCode === 'KW-03-01')).toBe(true);
    flow.vehicleCode.value = 'CAR-NR';
    await finish(flow.query());
    expect(flow.items.value).toEqual([]);
    expect(flow.total.value).toBe(0);
    expect(flow.hasMore.value).toBe(false);
    const get = vi.spyOn(api, 'query');
    flow.vehicleCode.value = 'X'.repeat(129);
    await flow.query();
    expect(get).not.toHaveBeenCalled();
    expect(flow.notice.value).toContain('128');
  });
  it('retains previous pages on failure and retries the failed page without automatic requests', async () => {
    const flow = usePendingReceiving();
    await finish(flow.query());
    vi.spyOn(api, 'query').mockRejectedValueOnce(new Error('加载下一页失败，请重试'));
    await finish(flow.loadMore());
    expect(flow.error.value).toBe('加载下一页失败，请重试');
    expect(flow.items.value).toHaveLength(20);
    expect(flow.page.value).toBe(1);
    const get = vi.spyOn(api, 'query');
    get.mockClear();
    await flow.loadMore();
    expect(get).not.toHaveBeenCalled();
    await finish(flow.retry());
    expect(get).toHaveBeenCalledWith({}, 2);
    expect(flow.items.value).toHaveLength(40);
    expect(flow.error.value).toBe('');
    await finish(flow.refresh());
    expect(flow.items.value).toHaveLength(20);
    expect(flow.page.value).toBe(1);
    expect(flow.refreshing.value).toBe(false);
  });
  it('shows backend errors and ignores requests superseded by a query or leaving the page', async () => {
    const flow = usePendingReceiving();
    flow.vehicleCode.value = 'CAR-QUERY-FAIL';
    await finish(flow.query());
    expect(flow.notice.value).toBe('待接收物料清单查询失败，请稍后重试');
    let resolveOld!: (page: ReceivingTaskPage) => void;
    vi.spyOn(api, 'query').mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const old = flow.query();
    flow.vehicleCode.value = 'NONE';
    await finish(flow.query());
    resolveOld({ records: [], total: 123, current: 1, size: 20, pages: 7 });
    await old;
    expect(flow.total.value).toBe(0);
    expect(flow.notice.value).toBe('');
    flow.vehicleCode.value = '';
    const leaving = flow.query();
    flow.dispose();
    await finish(leaving);
    expect(flow.items.value).toEqual([]);
    expect(flow.loading.value).toBe(false);
  });
  it('refreshes from page one, retains data on refresh failure, and rejects malformed pagination', async () => {
    const flow = usePendingReceiving();
    await finish(flow.query()); await finish(flow.loadMore());
    vi.spyOn(api, 'query').mockRejectedValueOnce(new Error('刷新失败'));
    await flow.refresh();
    expect(flow.items.value).toHaveLength(40);
    expect(flow.notice.value).toBe('刷新失败');
    await finish(flow.retry());
    expect(flow.items.value).toHaveLength(20);
    vi.spyOn(api, 'query').mockResolvedValueOnce({ records: [], total: 0, current: 7, size: 20, pages: 0 });
    await flow.loadMore();
    expect(flow.notice.value).toContain('分页数据异常');
    expect(flow.page.value).toBe(1);
  });
  it('deduplicates overlapping pages by taskId and displays UTC times in local time', async () => {
    const flow = usePendingReceiving();
    await finish(flow.query());
    const repeated = flow.items.value[0];
    vi.spyOn(api, 'query').mockResolvedValueOnce({ records: [repeated], total: 21, current: 2, size: 20, pages: 2 });
    await flow.loadMore();
    expect(flow.items.value).toHaveLength(20);
    expect(flow.hasMore.value).toBe(false);
    const local = new Date(2026, 8, 17, 10, 2, 3);
    expect(displayTaskTime(local.toISOString())).toBe('2026-09-17 10:02:03');
    expect(displayTaskTime('not a date')).toBe('—');
  });
});
