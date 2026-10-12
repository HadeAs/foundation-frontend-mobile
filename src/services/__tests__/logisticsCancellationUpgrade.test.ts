import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { logisticsCancellationApi as api, type CancellationResult, type LogisticsTaskPage } from '../logisticsCancellation';
import type { LogisticsTask } from '../logistics';
import { ApiRequestError } from '../nariRequest';
import { useLogisticsCancellation } from '../../composables/useLogisticsCancellation';
import CancellationPage from '../../pages/logistics-cancel/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const storage = new Map<string, unknown>();
const flows: ReturnType<typeof useLogisticsCancellation>[] = [];
const task = (index = 1): LogisticsTask => ({ taskId: '900719925474100' + index, taskNo: 'WL-' + index, version: 7,
  vendor: 'STANDARD', taskType: 'GENERAL', container: { containerType: 'VEHICLE', containerCode: 'CAR-' + index, version: 2 },
  origin: { locationCode: 'ORIGIN-' + index, locationName: '起始位置' }, destination: { locationCode: 'DEST-' + index, locationName: '目标位置' },
  status: 'UNKNOWN', statusName: '外部结果未知', triggerMode: 'MANUAL', createdTime: '2026-10-12T01:00:00Z' });
const page = (records = [task()], current = 1, total = records.length): LogisticsTaskPage => ({ records, current, total, size: 20, pages: Math.ceil(total / 20) });
const receipt = (taskId: string, requestId: string, cancelStatus: CancellationResult['cancelStatus'] = 'ACCEPTED'): CancellationResult => ({
  taskId, taskNo: task().taskNo, requestId, cancelStatus, processedTime: '2026-10-12T02:00:00Z',
  ...(['FAILED', 'UNKNOWN'].includes(cancelStatus) ? { reason: '后端返回的核查原因' } : {}) });
const makeFlow = () => { const flow = useLogisticsCancellation(); flows.push(flow); return flow; };
async function ready() { vi.spyOn(api, 'query').mockResolvedValue(page()); const flow = makeFlow(); await flow.query(); flow.open(flow.items.value[0]); return flow; }
beforeEach(() => {
  vi.useFakeTimers(); storage.clear(); hooks.show.length = hooks.hide.length = 0;
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.has(key) ? storage.get(key) : '', setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key), navigateBack: vi.fn() }); seedTestSession();
});
afterEach(() => { flows.splice(0).forEach(flow => flow.pause()); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('logistics cancellation 2026-10-12.1', () => {
  it.each(['number', 'version', 'container', 'content', 'origin', 'destination', 'vendor', 'type', 'status', 'status name', 'trigger', 'time', 'AGV'])('rejects incomplete task models on refresh without replacing the valid list: %s', async field => {
    const flow = await ready(); flow.close(); const value = task();
    if (field === 'number') value.taskNo = '';
    if (field === 'version') value.version = 2147483648;
    if (field === 'container') value.container.version = 0;
    if (field === 'content') Object.assign(value.container, { contentState: 'EMPTY_BY_COUNT' });
    if (field === 'origin') value.origin.locationName = '';
    if (field === 'destination') value.destination.locationCode = '';
    if (field === 'vendor') Object.assign(value, { vendor: 'OTHER' });
    if (field === 'type') Object.assign(value, { taskType: 'PROCESS_ROUTE' });
    if (field === 'status') Object.assign(value, { status: 'CREATED' });
    if (field === 'status name') value.statusName = '';
    if (field === 'trigger') value.triggerMode = '';
    if (field === 'time') value.createdTime = 'not a date';
    if (field === 'AGV') value.agvName = ' ';
    vi.mocked(api.query).mockResolvedValueOnce(page([value])); await flow.refresh();
    expect(flow.items.value).toEqual([task()]); expect(flow.error.value).not.toBe(''); expect(flow.page.value).toBe(1);
  });
  it.each(['pages', 'oversize', 'duplicate', 'overflow', 'past last'])('rejects inconsistent pagination atomically and allows retry of the failed page: %s', async field => {
    const flow = await ready(); flow.close(); const data = page([task(2)], 2, 21);
    if (field === 'pages') data.pages = 1;
    if (field === 'oversize') data.records = Array.from({ length: 21 }, (_, index) => task(index + 2));
    if (field === 'duplicate') data.records = [task(2), task(2)];
    if (field === 'overflow') data.pages = 2147483648;
    if (field === 'past last') { data.total = 1; data.pages = 1; }
    vi.mocked(api.query).mockResolvedValueOnce(page([task()], 1, 21)); await flow.refresh();
    vi.mocked(api.query).mockResolvedValueOnce(data); await flow.loadMore();
    expect(flow.items.value).toEqual([task()]); expect(flow.page.value).toBe(1); expect(flow.error.value).not.toBe('');
    vi.mocked(api.query).mockResolvedValueOnce(page([task(2)], 2, 21)); await flow.retry(); expect(flow.items.value.map(item => item.taskId)).toEqual([task().taskId, task(2).taskId]);
  });
  it('keeps optional current position/content/AGV absent and sends the task version, not the container version or unbind context', async () => {
    const flow = await ready(); const cancel = vi.spyOn(api, 'cancel').mockImplementation(async (id, input) => receipt(id, input.requestId, 'CANCELLED'));
    await flow.confirm(); expect(cancel.mock.lastCall?.[1]).toEqual({ requestId: expect.any(String), version: 7 });
    expect(flow.notice.value).toMatchObject({ error: false }); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'] as const)('does not locally remove a backend-listed task or hide its action based on status %s', async status => {
    const data = task(); data.status = status; vi.spyOn(api, 'query').mockResolvedValue(page([data])); const flow = makeFlow(); await flow.query();
    expect(flow.items.value).toHaveLength(1); flow.open(flow.items.value[0]); expect(flow.selected.value?.status).toBe(status);
  });
  it.each(['time', 'id', 'task', 'number', 'FAILED', 'UNKNOWN'])('does not finalize an invalid immediate cancellation receipt: %s', async field => {
    const flow = await ready(); const cancel = vi.spyOn(api, 'cancel').mockImplementation(async (id, input) => {
      const data = receipt(id, input.requestId, 'CANCELLED');
      if (field === 'time') data.processedTime = 'not a date';
      if (field === 'id') data.requestId = 'wrong';
      if (field === 'task') data.taskId = '1';
      if (field === 'number') data.taskNo = 'wrong';
      if (field === 'FAILED' || field === 'UNKNOWN') Object.assign(data, { cancelStatus: field, reason: '未经即时回执契约确认的结果' });
      return data;
    });
    await flow.confirm(); expect(flow.attempts.value).toHaveLength(1); expect(flow.attempts.value[0].status).toBe('UNKNOWN');
    expect(flow.notice.value?.error).toBe(true); expect(flow.items.value).toHaveLength(1);
    const id = flow.attempts.value[0].requestId; flow.open(flow.items.value[0]); await flow.confirm(); expect(cancel).toHaveBeenCalledOnce();
    const result = vi.spyOn(api, 'result').mockImplementation(async taskId => receipt(taskId, id, 'CANCELLED'));
    await flow.check(task().taskId); expect(result).toHaveBeenCalledWith(task().taskId, id); expect(flow.attempts.value).toHaveLength(0);
  });
  it.each(['time', 'reason', 'id'])('preserves correlation on an invalid result-query reply and stops automatic polling: %s', async field => {
    const flow = await ready(); const cancel = vi.spyOn(api, 'cancel').mockImplementation(async (id, input) => receipt(id, input.requestId)); await flow.confirm();
    const input = cancel.mock.lastCall![1]; const data = receipt(task().taskId, input.requestId, 'FAILED');
    if (field === 'time') data.processedTime = '';
    if (field === 'reason') data.reason = ' ';
    if (field === 'id') data.requestId = 'wrong';
    const result = vi.spyOn(api, 'result').mockResolvedValue(data); await flow.check(task().taskId); await vi.advanceTimersByTimeAsync(10000);
    expect(flow.attempts.value[0].status).toBe('UNKNOWN'); expect(result).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
  });
  it('displays an unbounded backend result reason without applying code-length limits, and retries explicit failures with a new UUID', async () => {
    const flow = await ready(); const cancel = vi.spyOn(api, 'cancel').mockImplementation(async (id, input) => receipt(id, input.requestId)); await flow.confirm();
    const id = cancel.mock.lastCall![1].requestId; vi.spyOn(api, 'result').mockResolvedValue({ ...receipt(task().taskId, id, 'FAILED'), reason: '原'.repeat(600) });
    await flow.check(task().taskId); expect(flow.notice.value?.message).toHaveLength(600); expect(flow.attempts.value).toHaveLength(0);
    flow.open(flow.items.value[0]); await flow.confirm(); expect(cancel.mock.calls[1][1].requestId).not.toBe(id);
  });
  it.each([408, 503, undefined])('persists the request before sending and never repeats an uncertain write after %s', async status => {
    const flow = await ready(); const cancel = vi.spyOn(api, 'cancel').mockImplementation(async (_id, input) => {
      const stored = [...storage.entries()].find(([key]) => key.startsWith('foundation.cancellations.real.'))![1] as { requestId: string }[];
      expect(stored[0].requestId).toBe(input.requestId); throw status ? new ApiRequestError('结果未知', status) : new Error('网络异常');
    });
    await flow.confirm(); const id = flow.attempts.value[0].requestId; await vi.advanceTimersByTimeAsync(10000); flow.pause();
    vi.mocked(api.query).mockResolvedValue(page([])); await flow.resume(); expect(flow.attempts.value[0].requestId).toBe(id);
    expect(cancel).toHaveBeenCalledOnce(); expect(flow.notice.value?.message || '').not.toContain('取消成功');
  });
  it('blocks hidden reads/writes and modal background events while preserving pending polling on close', async () => {
    const flow = await ready(); const query = vi.mocked(api.query); query.mockClear();
    await flow.query(); await flow.refresh(); await flow.loadMore(); await flow.retry(); expect(query).not.toHaveBeenCalled();
    flow.close(); flow.pause(); await flow.query(); await flow.refresh(); await flow.loadMore(); await flow.retry();
    flow.open(task()); const cancel = vi.spyOn(api, 'cancel'); await flow.confirm(); expect(query).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    await flow.resume(); flow.open(flow.items.value[0]); cancel.mockImplementation(async (id, input) => receipt(id, input.requestId)); await flow.confirm();
    flow.open(task(2)); const result = vi.spyOn(api, 'result').mockImplementation(async (id, requestId) => receipt(id, requestId, 'CANCELLED'));
    await vi.advanceTimersByTimeAsync(10000); expect(result).not.toHaveBeenCalled(); flow.close(); await vi.advanceTimersByTimeAsync(3000);
    expect(result).toHaveBeenCalledOnce();
  });
  it('does not let a late accepted/cancelled response refresh or notify a new visible page after hiding', async () => {
    const flow = await ready(); let resolve!: (data: CancellationResult) => void;
    const cancel = vi.spyOn(api, 'cancel').mockReturnValueOnce(new Promise(done => { resolve = done; })); const pending = flow.confirm();
    flow.pause(); await flow.resume(); const reads = vi.mocked(api.query).mock.calls.length;
    resolve(receipt(task().taskId, cancel.mock.lastCall![1].requestId, 'CANCELLED')); await pending;
    expect(vi.mocked(api.query)).toHaveBeenCalledTimes(reads); expect(flow.notice.value).toBeNull(); expect(flow.selected.value).toBeNull();
    expect(flow.attempts.value).toHaveLength(0); expect(flow.items.value).toHaveLength(0);
  });
  it('does not overwrite a newly opened confirmation with a late result query after pause/resume', async () => {
    const flow = await ready(); vi.spyOn(api, 'cancel').mockImplementation(async (id, input) => receipt(id, input.requestId)); await flow.confirm();
    let resolve!: (data: CancellationResult) => void; const result = vi.spyOn(api, 'result').mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = flow.check(task().taskId); flow.pause(); await flow.resume();
    const before = vi.mocked(api.query).mock.calls.length; resolve(receipt(task().taskId, flow.attempts.value[0].requestId, 'CANCELLED')); await pending;
    expect(vi.mocked(api.query)).toHaveBeenCalledTimes(before); expect(flow.notice.value).toBeNull(); expect(result).toHaveBeenCalledOnce();
  });
  it('does not silently discard or overwrite malformed persisted real correlations and blocks new cancellation', async () => {
    const key = 'foundation.cancellations.real.http://192.168.0.171:18080.admin';
    const stored = [{ taskId: task().taskId, taskNo: task().taskNo, requestId: 'not-a-uuid', status: 'UNKNOWN', reason: '旧记录需核实' }]; storage.set(key, stored);
    vi.spyOn(api, 'query').mockResolvedValue(page()); const flow = makeFlow(); await flow.query(); flow.open(task());
    const cancel = vi.spyOn(api, 'cancel'); await flow.confirm(); expect(cancel).not.toHaveBeenCalled(); expect(storage.get(key)).toBe(stored);
    expect(flow.notice.value?.message).toContain('记录');
  });
  it('keeps a saved pending request when saving a terminal result fails, and does not unlock repeat cancellation', async () => {
    const flow = await ready(); vi.spyOn(api, 'cancel').mockImplementation(async (id, input) => receipt(id, input.requestId)); await flow.confirm();
    const key = [...storage.keys()].find(key => key.startsWith('foundation.cancellations.real.'))!; const original = storage.get(key);
    vi.spyOn(api, 'result').mockImplementation(async (id, input) => receipt(id, input, 'CANCELLED'));
    vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('storage full'); });
    await expect(flow.check(task().taskId)).resolves.toBeUndefined(); expect(storage.get(key)).toBe(original);
    expect(flow.isPending(task().taskId)).toBe(true); flow.open(task()); await flow.confirm(); expect(api.cancel).toHaveBeenCalledOnce();
  });
  it.each([null, 'corrupted'])('does not treat a malformed non-array real record as empty: %s', async stored => {
    const key = 'foundation.cancellations.real.http://192.168.0.171:18080.admin'; storage.set(key, stored);
    const flow = await ready(); const cancel = vi.spyOn(api, 'cancel'); await flow.confirm();
    expect(flow.storageError.value).toBe(true); expect(cancel).not.toHaveBeenCalled(); expect(storage.get(key)).toBe(stored);
  });
  it('handles a local correlation read failure without crashing or attempting a cancellation', async () => {
    const read = uni.getStorageSync;
    vi.spyOn(uni, 'getStorageSync').mockImplementation(key => { if (key.startsWith('foundation.cancellations.real.')) throw new Error('取消记录读取失败'); return read(key); });
    const flow = await ready(); const cancel = vi.spyOn(api, 'cancel'); await flow.confirm();
    expect(flow.storageError.value).toBe(true); expect(cancel).not.toHaveBeenCalled(); expect(flow.notice.value?.message).toContain('记录');
  });
  it('prevents requests for an old account after the signed-in account changes', async () => {
    const flow = await ready(); const query = vi.mocked(api.query); query.mockClear(); const cancel = vi.spyOn(api, 'cancel');
    seedTestSession('other-account'); await flow.confirm(); await flow.refresh(); expect(cancel).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
  it('renders unassigned AGV, keeps action buttons visible, and clears confirmation/scan events when hidden', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValue(page()); const wrapper = mount(CancellationPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    hooks.show.forEach(fn => fn()); await flushPromises(); expect(wrapper.get('.agv').text()).toBe('—'); expect(wrapper.get('.status-actions .danger').text()).toBe('取消任务');
    await wrapper.get('.status-actions .danger').trigger('tap'); expect(wrapper.find('.modal-mask').exists()).toBe(true);
    wrapper.findComponent(ScanInput).vm.$emit('scan', 'OTHER'); await flushPromises(); expect(query).toHaveBeenCalledOnce();
    hooks.hide.forEach(fn => fn()); await flushPromises(); wrapper.findComponent(ScanInput).vm.$emit('scan', 'OTHER'); await flushPromises(); expect(query).toHaveBeenCalledOnce();
    expect(wrapper.find('.modal-mask').exists()).toBe(false); wrapper.unmount();
  });
});
