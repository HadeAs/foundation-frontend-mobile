import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import CancellationPage from '../../pages/logistics-cancel/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { logisticsCancellationApi as api, type LogisticsTaskPage } from '../logisticsCancellation';
import { useLogisticsCancellation } from '../../composables/useLogisticsCancellation';
import { useLogisticsCreation } from '../../composables/useLogisticsCreation';
import { logisticsApi } from '../logistics';
import { requestId } from '../nariRequest';

const storage = new Map<string, unknown>();
const hooks = vi.hoisted(() => ({ show: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (callback: () => void) => hooks.show.push(callback), onHide: () => {} }));
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
const flows: ReturnType<typeof useLogisticsCancellation>[] = [];
function flow() { const item = useLogisticsCancellation(); flows.push(item); return item; }
// Complete immediate mock calls, without advancing the 3-second result poll.
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.advanceTimersByTimeAsync(800); return promise; }
async function scenario(code: string) {
  const state = flow(); state.keyword.value = code; await finish(state.query());
  state.open(state.items.value[0]); return state;
}
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock'); vi.useFakeTimers(); storage.clear(); network.mockClear(); resetMockData();
  hooks.show.length = 0;
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { flows.splice(0).forEach((state) => state.pause()); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('logistics cancellation', () => {
  it('drops stale mock requests only when the mock backend resets, allowing cancellation again', async () => {
    const state = await scenario('CANCEL-ACCEPTED');
    const cancel = vi.spyOn(api, 'cancel');
    await finish(state.confirm());
    const request = state.attempts.value[0]; state.pause();
    const sameSession = flow();
    expect(sameSession.attempts.value[0].requestId).toBe(request.requestId); sameSession.pause();
    resetMockData(); // Reload resets the in-memory server, but not uni storage.
    const restored = await scenario('CANCEL-ACCEPTED');
    expect(restored.attempts.value).toHaveLength(0);
    expect(restored.isPending(request.taskId)).toBe(false);
    await finish(restored.confirm());
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(restored.attempts.value[0].requestId).not.toBe(request.requestId);
    await vi.advanceTimersByTimeAsync(3500);
    expect(restored.notice.value?.message).toContain('取消成功');
    expect(restored.attempts.value).toHaveLength(0);
  });
  it('ignores legacy unscoped mock attempts but preserves real-mode recovery after backend mock resets', async () => {
    const state = await scenario('CANCEL-UNKNOWN');
    await finish(state.confirm()); state.pause();
    const mockKey = [...storage.keys()].find((key) => key.startsWith('foundation.cancellations.mock.'))!;
    storage.set(mockKey, JSON.parse(JSON.stringify(state.attempts.value)));
    expect(flow().attempts.value).toHaveLength(0);
    const task = state.items.value[0];
    vi.stubEnv('VITE_API_MODE', 'real');
    const real = flow();
    const cancel = vi.spyOn(api, 'cancel').mockImplementationOnce(async (taskId, input) => ({
      taskId, taskNo: task.taskNo, requestId: input.requestId, cancelStatus: 'UNKNOWN', reason: '结果未知', processedTime: new Date().toISOString()
    }));
    real.open(task); await real.confirm(); real.pause();
    const id = real.attempts.value[0].requestId;
    resetMockData();
    const recovered = flow();
    expect(recovered.attempts.value[0].requestId).toBe(id);
    expect(recovered.isPending(task.taskId)).toBe(true);
    recovered.open(task); await recovered.confirm(); expect(cancel).toHaveBeenCalledOnce();
    const result = vi.spyOn(api, 'result').mockResolvedValueOnce({
      taskId: task.taskId, taskNo: task.taskNo, requestId: id, cancelStatus: 'UNKNOWN', reason: '仍在核实', processedTime: new Date().toISOString()
    });
    await recovered.check(task.taskId);
    expect(result).toHaveBeenCalledWith(task.taskId, id);
    expect(recovered.attempts.value[0].status).toBe('UNKNOWN');
  });
  it('uses the shared scan input, queries on PDA/manual input and clear, and blocks background scans in the modal', async () => {
    const wrapper = mount(CancellationPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach((show) => show()); await vi.advanceTimersByTimeAsync(800);
      const scan = wrapper.findComponent(ScanInput);
      expect(scan.props('showScanButton')).toBe(true);
      scan.vm.$emit('scan', ' AGV-001 '); await vi.advanceTimersByTimeAsync(800);
      expect(wrapper.findAll('.task-card')).toHaveLength(1); expect(wrapper.text()).toContain('CANCEL-NORMAL');
      expect(wrapper.find('.status-actions .danger').exists()).toBe(true);
      await wrapper.find('.status-actions .danger').trigger('tap');
      window.dispatchEvent(new CustomEvent('pda-scan', { detail: { value: 'AGV-002' } }));
      await vi.advanceTimersByTimeAsync(800); expect(scan.props('modelValue')).toBe('AGV-001');
      await wrapper.find('.modal-actions button').trigger('tap');
      window.dispatchEvent(new CustomEvent('pda-scan', { detail: { value: 'AGV-002' } }));
      await vi.advanceTimersByTimeAsync(800); expect(wrapper.text()).toContain('CANCEL-ACCEPTED');
      scan.vm.$emit('clear'); await vi.advanceTimersByTimeAsync(800);
      expect(wrapper.findAll('.task-card')).toHaveLength(20); expect(scan.props('modelValue')).toBe('');
    } finally { wrapper.unmount(); }
  });
  it('queries only keyword/page/size, keeps string IDs and paginates without duplicates', async () => {
    const state = flow(); const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(state.query()); expect(transport.mock.lastCall?.[0].data).toEqual({ page: 1, size: 20 });
    expect(state.items.value[0].taskId).toBe('9007199254741001');
    await finish(state.loadMore()); await finish(state.loadMore());
    expect(state.items.value).toHaveLength(45); expect(new Set(state.items.value.map((item) => item.taskId)).size).toBe(45);
    expect(state.hasMore.value).toBe(false);
    state.keyword.value = '  agv-001  '; await finish(state.query());
    expect(state.items.value).toHaveLength(1); expect(transport.mock.lastCall?.[0].data).toEqual({ keyword: 'agv-001', page: 1, size: 20 });
    state.keyword.value = '不存在'; await finish(state.query()); expect(state.items.value).toHaveLength(0);
    expect(network).not.toHaveBeenCalled();
  });
  it('keeps loaded data and cursor when next page fails, then retries that page', async () => {
    const state = flow(); state.keyword.value = '分页测试车'; await finish(state.query());
    await finish(state.loadMore()); expect(state.items.value).toHaveLength(20); expect(state.page.value).toBe(1);
    await finish(state.retry()); expect(state.items.value).toHaveLength(38); expect(state.page.value).toBe(2);
    state.keyword.value = 'QUERY-FAIL'; await finish(state.query()); expect(state.error.value).toContain('查询失败');
  });
  it('does not cancel before confirmation, submits once, and removes only confirmed cancelled tasks', async () => {
    const state = await scenario('CANCEL-NORMAL'); const cancel = vi.spyOn(api, 'cancel');
    state.close(); await state.confirm(); expect(cancel).not.toHaveBeenCalled();
    state.open(state.items.value[0]); const submitting = state.confirm(); await state.confirm(); await finish(submitting);
    expect(cancel).toHaveBeenCalledOnce(); expect(cancel.mock.calls[0][1]).toMatchObject({ version: 1 });
    expect(state.items.value).toHaveLength(0); expect(state.attempts.value).toHaveLength(0);
    expect(state.notice.value).toMatchObject({ error: false });
    expect(await finish(api.cancel(cancel.mock.calls[0][0], cancel.mock.calls[0][1]))).toMatchObject({ cancelStatus: 'CANCELLED' });
  });
  it('treats ACCEPTED as pending, queries every three seconds and pauses offscreen', async () => {
    const state = await scenario('CANCEL-ACCEPTED'); const result = vi.spyOn(api, 'result');
    await finish(state.confirm()); expect(state.attempts.value[0].status).toBe('ACCEPTED');
    expect(state.items.value).toHaveLength(1); expect(state.notice.value?.message || '').not.toContain('取消成功');
    state.pause(); await vi.advanceTimersByTimeAsync(10000); expect(result).not.toHaveBeenCalled();
    await finish(state.resume()); await vi.advanceTimersByTimeAsync(3500);
    expect(result).toHaveBeenCalledOnce(); expect(state.attempts.value).toHaveLength(0); expect(state.items.value).toHaveLength(0);
    expect(state.notice.value?.message).toContain('取消成功');
  });
  it('retains failed task and backend reason; explicit retry generates a new request ID', async () => {
    const state = await scenario('CANCEL-FAILED'); const cancel = vi.spyOn(api, 'cancel');
    await finish(state.confirm()); await vi.advanceTimersByTimeAsync(3500);
    expect(state.notice.value?.message).toContain('设备拒绝取消'); expect(state.items.value).toHaveLength(1);
    expect(state.attempts.value).toHaveLength(0);
    state.open(state.items.value[0]); await finish(state.confirm());
    expect(cancel.mock.calls[0][1].requestId).not.toBe(cancel.mock.calls[1][1].requestId);
  });
  it('retains UNKNOWN correlation across page recreation and never automatically reissues writes', async () => {
    const state = await scenario('CANCEL-UNKNOWN'); const cancel = vi.spyOn(api, 'cancel');
    await finish(state.confirm()); await vi.advanceTimersByTimeAsync(3500);
    const id = state.attempts.value[0].requestId;
    expect(state.attempts.value[0].status).toBe('UNKNOWN'); state.pause();
    const restored = flow(); await finish(restored.resume());
    expect(restored.attempts.value[0].requestId).toBe(id);
    const result = vi.spyOn(api, 'result'); await vi.advanceTimersByTimeAsync(15000); expect(result).not.toHaveBeenCalled();
    const task = restored.items.value.find((item) => item.container.containerCode === 'CANCEL-UNKNOWN')!;
    restored.open(task); await restored.confirm(); expect(cancel).toHaveBeenCalledOnce();
    await finish(restored.check(task.taskId)); expect(result).toHaveBeenCalledWith(task.taskId, id);
    expect(restored.notice.value?.error).toBe(true);
  });
  it('stops polling after query failure and offers manual result refresh', async () => {
    const state = await scenario('CANCEL-RESULT-FAIL'); const result = vi.spyOn(api, 'result');
    await finish(state.confirm()); await vi.advanceTimersByTimeAsync(3500);
    expect(state.attempts.value[0].status).toBe('UNKNOWN'); expect(result).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15000); expect(result).toHaveBeenCalledOnce();
    await finish(state.check(state.attempts.value[0].taskId)); expect(result).toHaveBeenCalledTimes(2);
  });
  it('handles uncertain network writes by querying the same ID, even if the task disappears from the list', async () => {
    const state = await scenario('CANCEL-NORMAL'); const realCancel = api.cancel;
    const cancel = vi.spyOn(api, 'cancel').mockImplementationOnce(async (...args) => { await realCancel(...args); throw new Error('网络超时'); });
    await finish(state.confirm()); expect(state.attempts.value[0].status).toBe('UNKNOWN');
    await finish(state.refresh()); expect(state.items.value).toHaveLength(0); expect(state.attempts.value).toHaveLength(1);
    expect(state.notice.value?.message).not.toContain('取消成功');
    await finish(state.check(state.attempts.value[0].taskId)); expect(state.notice.value?.message).toContain('取消成功');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('keeps modal/task on explicit rejection and revalidates task versions', async () => {
    const state = await scenario('CANCEL-REJECTED'); await finish(state.confirm());
    expect(state.selected.value).not.toBeNull(); expect(state.attempts.value).toHaveLength(0);
    expect(state.notice.value?.message).toContain('设备正在执行交接');
    const task = state.items.value[0];
    const bad = expect(api.cancel(task.taskId, { version: 99, requestId: requestId() })).rejects.toThrow('版本已变化'); await finish(bad);
  });
  it('ignores stale filter responses and hidden-page list responses', async () => {
    const state = flow(); let resolve!: (value: LogisticsTaskPage) => void;
    vi.spyOn(api, 'query').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = state.query(); state.keyword.value = 'AGV-002'; await finish(state.query());
    resolve({ records: [], total: 0, current: 1, size: 20, pages: 0 }); await first;
    expect(state.items.value[0].agvCode).toBe('AGV-002');
    const next = state.refresh(); state.pause(); await finish(next); expect(state.items.value[0].agvCode).toBe('AGV-002');
  });
  it('links creation to cancellation and allows creation again only after final cancellation', async () => {
    const create = useLogisticsCreation(); await finish(create.scan('CAR-LOG-NORMAL')); await finish(create.submit());
    expect((await finish(logisticsApi.getOptions('CAR-LOG-NORMAL'))).eligibility.allowed).toBe(false);
    const state = await scenario('CAR-LOG-NORMAL'); await finish(state.confirm());
    expect((await finish(logisticsApi.getOptions('CAR-LOG-NORMAL'))).eligibility.allowed).toBe(true);
  });
  it('does not infer success from a mismatched receipt or an unknown correlation ID', async () => {
    const state = await scenario('CANCEL-NORMAL');
    vi.spyOn(api, 'cancel').mockImplementationOnce(async (taskId, input) => ({ taskId, requestId: input.requestId,
      taskNo: 'WRONG-TASK', cancelStatus: 'CANCELLED', processedTime: new Date().toISOString() }));
    await finish(state.confirm()); expect(state.attempts.value[0].status).toBe('UNKNOWN');
    await finish(state.check(state.attempts.value[0].taskId));
    expect(state.notice.value?.message).toContain('未找到该取消请求'); expect(state.attempts.value).toHaveLength(1);
    expect(state.items.value).toHaveLength(1);
  });
  it('isolates unresolved requests by account and refuses a write when correlation cannot be saved', async () => {
    const state = await scenario('CANCEL-UNKNOWN'); await finish(state.confirm()); state.pause();
    seedTestSession('another-user'); const other = flow(); expect(other.attempts.value).toHaveLength(0);
    other.keyword.value = 'CANCEL-NORMAL'; await finish(other.query()); other.open(other.items.value[0]);
    const cancel = vi.spyOn(api, 'cancel'); vi.spyOn(uni, 'setStorageSync').mockImplementationOnce(() => { throw new Error('storage full'); });
    await other.confirm(); expect(cancel).not.toHaveBeenCalled(); expect(other.attempts.value).toHaveLength(0);
    expect(other.notice.value?.message).toContain('未提交取消');
  });
});
