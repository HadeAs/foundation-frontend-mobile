import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TrafficPage from '../../pages/traffic-control/index.vue';
import { useTrafficControl } from '../../composables/useTrafficControl';
import { trafficApi as api, type TrafficArea } from '../traffic';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { requestId } from '../nariRequest';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (callback: () => void) => hooks.show.push(callback), onHide: () => {} }));
const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock'); vi.useFakeTimers(); storage.clear(); network.mockClear(); resetMockData(); hooks.show.length = 0;
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('traffic control', () => {
  it('loads sorted pages, trims filters and omits all-status/empty-keyword parameters', async () => {
    const flow = useTrafficControl(); const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.query());
    expect(transport.mock.lastCall?.[0].data).toEqual({ page: 1, size: 20 });
    expect(flow.items.value).toHaveLength(20); expect(flow.items.value[0].areaCode).toBe('TC-01');
    await finish(flow.loadMore()); await finish(flow.loadMore());
    expect(flow.items.value).toHaveLength(49); expect(flow.hasMore.value).toBe(false);
    flow.keyword.value = ' 总装 '; flow.status.value = 'FREE'; await finish(flow.query());
    expect(transport.mock.lastCall?.[0].data).toEqual({ keyword: '总装', status: 'FREE', page: 1, size: 20 });
    expect(flow.items.value.map((area) => area.areaCode)).toEqual(['TC-01']); expect(network).not.toHaveBeenCalled();
  });
  it('retries a failed page without losing rows, handles no results and refreshes page one', async () => {
    const flow = useTrafficControl(); flow.keyword.value = '分页测试'; await finish(flow.query());
    const first = [...flow.items.value]; await finish(flow.loadMore());
    expect(flow.items.value).toEqual(first); expect(flow.error.value).toContain('下一页加载失败');
    await finish(flow.retry()); expect(flow.items.value).toHaveLength(40);
    await finish(flow.loadMore()); expect(flow.items.value).toHaveLength(41); expect(flow.hasMore.value).toBe(false);
    await finish(flow.refresh()); expect(flow.items.value).toHaveLength(20);
    flow.keyword.value = '不存在'; await finish(flow.query()); expect(flow.items.value).toEqual([]);
    flow.keyword.value = 'QUERY-FAIL'; await finish(flow.query()); expect(flow.notice.value?.message).toContain('交管区域查询失败');
  });
  it('confirms before writing, prevents double submissions, and displays server metadata', async () => {
    const flow = useTrafficControl(); await finish(flow.query()); const act = vi.spyOn(api, 'act');
    flow.open(flow.items.value[0]); flow.close(); expect(act).not.toHaveBeenCalled();
    flow.open(flow.items.value[0]); expect(flow.actionName.value).toBe('锁定');
    const pending = flow.confirm(); await flow.confirm(); flow.close(); expect(flow.selected.value).not.toBeNull();
    await finish(pending); expect(act).toHaveBeenCalledOnce();
    expect(act.mock.calls[0]).toEqual(['TC-01', 'lock', { requestId: expect.any(String), version: 1 }]);
    expect(flow.items.value[0]).toMatchObject({ status: 'OCCUPIED', version: 2, lastOperatorName: '系统管理员', lastOperationTime: new Date().toISOString() });
    expect(flow.items.value).toHaveLength(20); expect(flow.selected.value).toBeNull();
    expect(flow.notice.value).toEqual({ message: '锁定成功', error: false });
    flow.open(flow.items.value[0]); expect(flow.actionName.value).toBe('释放'); await finish(flow.confirm());
    expect(flow.items.value[0]).toMatchObject({ status: 'FREE', version: 3 });
  });
  it('restarts filtered pagination after a status change so remaining records are not skipped', async () => {
    const flow = useTrafficControl(); flow.status.value = 'FREE'; await finish(flow.query());
    flow.open(flow.items.value[0]); await finish(flow.confirm());
    expect(flow.items.value).toHaveLength(20); expect(flow.items.value.some((area) => area.areaCode === 'TC-01')).toBe(false);
    await finish(flow.loadMore()); const expected = await finish(api.query({ status: 'FREE' }, 2));
    expect(flow.items.value).toHaveLength(25); expect(flow.items.value.slice(20)).toEqual(expected.records);
    expect(new Set(flow.items.value.map((area) => area.areaCode)).size).toBe(25);
  });
  it('preserves failed operations and creates a fresh ID only when the user retries', async () => {
    for (const code of ['TC-LOCK-FAIL', 'TC-RELEASE-FAIL']) {
      const flow = useTrafficControl(); flow.keyword.value = code; await finish(flow.query());
      const original = { ...flow.items.value[0] }; flow.open(original); const act = vi.spyOn(api, 'act');
      await finish(flow.confirm()); expect(flow.items.value[0]).toEqual(original); expect(flow.selected.value).toEqual(original);
      expect(flow.notice.value?.message).toContain('设备暂不可用'); expect(act).toHaveBeenCalledOnce();
      await finish(flow.confirm()); expect(act.mock.calls[0][2].requestId).not.toBe(act.mock.calls[1][2].requestId);
      expect(flow.submitting.value).toBe(false); act.mockRestore();
    }
  });
  it('enforces current state/version and idempotency, and encodes special area codes', async () => {
    const input = { requestId: requestId(), version: 1 }; const transport = vi.spyOn(mock, 'resolveMockRequest');
    const locked = await finish(api.act('TC/特殊#01', 'lock', input));
    expect(transport.mock.lastCall?.[0].url).toContain('/traffic/areas/TC%2F%E7%89%B9%E6%AE%8A%2301/lock');
    expect(await finish(api.act('TC/特殊#01', 'lock', input))).toEqual(locked);
    await finish(expect(api.act('TC-01', 'lock', input)).rejects.toThrow('相同请求标识'));
    await finish(expect(api.act('TC/特殊#01', 'release', { requestId: requestId(), version: 1 })).rejects.toThrow('刷新后重试'));
    await finish(expect(api.act('TC/特殊#01', 'lock', { requestId: requestId(), version: 2 })).rejects.toThrow('当前状态不允许'));
    await finish(expect(api.act('UNKNOWN', 'lock', input)).rejects.toThrow('相同请求标识'));
    await finish(expect(api.act('UNKNOWN', 'lock', { requestId: requestId(), version: 1 })).rejects.toThrow('不存在'));
  });
  it('shows version conflict without changing cached state; refresh obtains the latest state', async () => {
    const flow = useTrafficControl(); await finish(flow.query()); const original = { ...flow.items.value[0] };
    await finish(api.act('TC-01', 'lock', { requestId: requestId(), version: 1 }));
    flow.open(original); await finish(flow.confirm());
    expect(flow.items.value[0]).toEqual(original); expect(flow.notice.value?.message).toContain('其他操作修改');
    flow.close(); await finish(flow.refresh()); expect(flow.items.value[0].status).toBe('OCCUPIED');
  });
  it('rejects malformed responses and ignores superseded queries and disposed writes', async () => {
    const flow = useTrafficControl(); const query = vi.spyOn(api, 'query');
    flow.keyword.value = 'x'.repeat(129); await flow.query(); expect(query).not.toHaveBeenCalled();
    flow.keyword.value = 'TC-01'; const old = flow.query(); flow.keyword.value = 'TC-02'; const newer = flow.query();
    await finish(Promise.all([old, newer])); expect(flow.items.value.map((area) => area.areaCode)).toEqual(['TC-02']);
    query.mockResolvedValueOnce({ records: [{ ...flow.items.value[0], status: 'INVALID' } as unknown as TrafficArea], current: 1, size: 20, total: 1, pages: 1 });
    await flow.refresh(); expect(flow.error.value).toContain('数据异常');
    flow.open(flow.items.value[0]); vi.spyOn(api, 'act').mockResolvedValueOnce({ ...flow.items.value[0], areaCode: 'WRONG' });
    await flow.confirm(); expect(flow.notice.value?.message).toContain('操作结果数据异常'); expect(flow.selected.value).not.toBeNull();
    const write = flow.confirm(); flow.dispose(); await finish(write);
    expect(flow.selected.value).toBeNull(); expect(flow.notice.value).toBeNull(); expect(flow.submitting.value).toBe(false);
  });
  it('renders fixed operation buttons beside two labeled metadata rows and a confirmation dialog', async () => {
    const wrapper = mount(TrafficPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' }, picker: { template: '<div><slot /></div>' } } } });
    hooks.show.forEach((callback) => callback()); await vi.advanceTimersByTimeAsync(500);
    const cards = wrapper.findAll('.area-card'); expect(cards).toHaveLength(20);
    expect(cards[0].find('.metadata').text()).toContain('最后操作人王工操作时间');
    expect(cards[0].find('.meta-actions button').text()).toBe('锁定'); expect(cards[1].find('.meta-actions button').text()).toBe('释放');
    await cards[0].find('button').trigger('tap'); expect(wrapper.find('[role="dialog"]').text()).toContain('确认锁定');
    await wrapper.findAll('.modal-actions button')[0].trigger('tap'); expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
