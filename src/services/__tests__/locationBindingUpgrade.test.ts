import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { useLocationBinding } from '../../composables/useLocationBinding';
import { locationBindingApi as api, type LocationContainers, type RelatedTransportTask } from '../locationBinding';
import { logisticsCancellationApi as cancellationApi, type CancellationResult } from '../logisticsCancellation';
import { ApiRequestError } from '../nariRequest';
import { AUTH_SESSION_STORAGE_KEY } from '../auth';
import { DEFAULT_API_BASE_URL } from '../environment';
import BindingPage from '../../pages/location-binding/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const snapshot = (overrides: Partial<LocationContainers> = {}): LocationContainers => ({ location: { locationCode: 'LOC-1', locationName: '接驳位' }, version: 2,
  occupied: true, container: { containerType: 'VEHICLE', containerCode: 'CAR-1', version: 3 },
  eligibility: { allowed: true }, relatedTasks: [], unbindEligibility: { allowed: true }, ...overrides
});
const task = (index = 1): RelatedTransportTask => ({ taskId: `900719925474100${index}`, taskNo: `WL-${index}`, version: 9,
  status: 'RUNNING', settled: false, cancellationEligibility: { allowed: true } });
const blocked = (tasks = [task()]): LocationContainers => snapshot({ relatedTasks: tasks, unbindEligibility: { allowed: false, reason: '运输及实物尚未结算' } });
const cancellation = (id: string, status: CancellationResult['cancelStatus'] = 'ACCEPTED', index = 1): CancellationResult => ({
  requestId: id, taskId: task(index).taskId, taskNo: task(index).taskNo, cancelStatus: status, processedTime: '2026-10-12T01:00:00Z',
  ...(['FAILED', 'UNKNOWN'].includes(status) ? { reason: '后端返回的取消原因' } : {})
});
const receipt = (id: string) => ({ requestId: id, affectedCount: 1, processedTime: '2026-10-12T01:00:00Z' });
const context = { locationCode: 'LOC-1', version: 2, container: { containerType: 'VEHICLE' as const, containerCode: 'CAR-1' }, containerVersion: 3 };
const storage = new Map<string, unknown>();
const storageKey = 'foundation.location-cancellations.real.' + DEFAULT_API_BASE_URL + '.admin';
async function ready(value = blocked()) {
  vi.spyOn(api, 'getLocation').mockResolvedValue(value); const flow = useLocationBinding(); await flow.scan('LOC-1'); return flow;
}
async function bindingReady() {
  const flow = await ready(snapshot({ occupied: false, container: undefined, unbindEligibility: { allowed: false, reason: '未绑定容器' } }));
  vi.spyOn(api, 'getContainer').mockResolvedValue({ container: snapshot().container!, eligibility: { allowed: true } });
  await flow.scan('alias'); return flow;
}
beforeEach(() => {
  hooks.show.length = hooks.hide.length = 0;
  storage.clear(); vi.stubGlobal('uni', { navigateBack: vi.fn(), getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
  vi.spyOn(api, 'bind').mockImplementation(async (_data, id) => receipt(id!));
  vi.spyOn(api, 'unbind').mockImplementation(async (_data, id) => receipt(id!));
  vi.spyOn(cancellationApi, 'cancel').mockImplementation(async (taskId, input) => cancellation(input.requestId, 'ACCEPTED', Number(taskId.slice(-1))));
  vi.spyOn(cancellationApi, 'result').mockImplementation(async (taskId, id) => cancellation(id, 'CANCELLED', Number(taskId.slice(-1))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('location binding 2026-10-12.1', () => {
  it('uses independent unbind eligibility instead of the binding qualification', async () => {
    const value = snapshot(); value.eligibility = { allowed: false, reason: '已占用，不能绑定' };
    vi.spyOn(api, 'getLocation').mockResolvedValue(value); const flow = useLocationBinding(); await flow.scan('LOC-1');
    expect(flow.canUnbind.value).toBe(true);
  });
  it('does not allow direct unbinding when physical verification is still blocked', async () => {
    const value = Object.assign(snapshot(), { unbindEligibility: { allowed: false, reason: '传感器未确认实物状态' } });
    vi.spyOn(api, 'getLocation').mockResolvedValue(value); const flow = useLocationBinding(); await flow.scan('LOC-1');
    expect(flow.canUnbind.value).toBe(false);
  });
  it('unbinds without cancellation only when the backend returns no blockers and allows physical unbinding', async () => {
    const flow = await ready(snapshot({ eligibility: { allowed: false, reason: '已占用，不能绑定' } }));
    flow.requestUnbind(); expect(flow.confirmingTasks.value).toBe(false); await flow.submit();
    expect(api.unbind).toHaveBeenCalledWith(context, expect.any(String)); expect(cancellationApi.cancel).not.toHaveBeenCalled();
    expect(flow.location.value).toBeNull(); expect(flow.notice.value?.text).toBe('解绑成功');
  });
  it('does not infer permission from an empty blocker list or from a task terminal status', async () => {
    const flow = await ready(snapshot({ unbindEligibility: { allowed: false, reason: '实物核验未通过' } }));
    flow.requestUnbind(); await flow.submit(); expect(flow.confirmation.value).toBe(false); expect(api.unbind).not.toHaveBeenCalled();
    expect(cancellationApi.cancel).not.toHaveBeenCalled(); expect(flow.notice.value?.text).toBe('实物核验未通过');
    flow.clear(); vi.mocked(api.getLocation).mockResolvedValue(blocked([{ ...task(), status: 'CANCELLED', cancellationEligibility: { allowed: false, reason: '已取消，实物未结算' } }]));
    await flow.scan('LOC-1'); expect(flow.canRequestUnbind.value).toBe(false); expect(flow.canUnbind.value).toBe(false);
  });
  it('cancels only eligible blockers with task version and exact automatic unbind context', async () => {
    const noPermission = { ...task(2), cancellationEligibility: { allowed: false, reason: '当前不可取消' } };
    const flow = await ready(blocked([task(), noPermission])); flow.requestUnbind(); await flow.submit();
    expect(cancellationApi.cancel).toHaveBeenCalledOnce(); expect(cancellationApi.cancel).toHaveBeenCalledWith(task().taskId,
      { requestId: expect.any(String), version: 9, unbindContext: context });
    expect(flow.cancellationRecords.value[0].status).toBe('ACCEPTED'); expect(api.unbind).not.toHaveBeenCalled();
    expect(flow.confirmation.value).toBe(false); expect(flow.canRequestUnbind.value).toBe(false);
  });
  it('never directly unbinds when blockers are present even if unbind eligibility is true', async () => {
    const flow = await ready(blocked()); flow.location.value!.unbindEligibility = { allowed: true };
    expect(flow.canUnbind.value).toBe(false); flow.requestUnbind(); expect(flow.confirmingTasks.value).toBe(true);
    await flow.submit(); expect(api.unbind).not.toHaveBeenCalled();
  });
  it('verifies ACCEPTED using the original UUID and requires a new confirmation with refreshed versions', async () => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit();
    const input = vi.mocked(cancellationApi.cancel).mock.calls[0][1];
    expect(flow.notice.value?.text).toContain('处理中'); expect(cancellationApi.result).not.toHaveBeenCalled();
    const fresh = snapshot({ version: 4, container: { ...snapshot().container!, version: 6 } });
    vi.mocked(api.getLocation).mockResolvedValue(fresh); await flow.verifyAndRefresh();
    expect(cancellationApi.result).toHaveBeenCalledWith(task().taskId, input.requestId);
    expect(flow.canUnbind.value).toBe(true); expect(api.unbind).not.toHaveBeenCalled(); expect(flow.confirmation.value).toBe(false);
    flow.requestUnbind(); await flow.submit();
    expect(api.unbind).toHaveBeenCalledWith({ ...context, version: 4, containerVersion: 6 }, expect.any(String));
    expect(vi.mocked(api.unbind).mock.calls[0][1]).not.toBe(input.requestId); expect(flow.location.value).toBeNull();
    expect(storage.get(storageKey)).toEqual([]);
  });
  it('refreshes after immediate final cancellation but still refuses CANCELLED without physical settlement', async () => {
    const flow = await ready(); vi.mocked(cancellationApi.cancel).mockImplementation(async (_taskId, input) => cancellation(input.requestId, 'CANCELLED'));
    const fresh = blocked([{ ...task(), status: 'CANCELLED', version: 10, cancellationEligibility: { allowed: false, reason: '取消成功，实物待结算' } }]);
    fresh.version = 4; vi.mocked(api.getLocation).mockResolvedValue(fresh); flow.requestUnbind(); await flow.submit();
    expect(api.getLocation).toHaveBeenCalledTimes(2); expect(flow.location.value?.version).toBe(4);
    expect(flow.canRequestUnbind.value).toBe(false); expect(flow.notice.value?.error).toBe(true); expect(api.unbind).not.toHaveBeenCalled();
    await flow.verifyAndRefresh(); expect(cancellationApi.cancel).toHaveBeenCalledOnce(); expect(cancellationApi.result).not.toHaveBeenCalled();
  });
  it('does not treat disappearance of tasks as success while a cancellation result remains UNKNOWN', async () => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit();
    vi.mocked(cancellationApi.result).mockImplementation(async (_taskId, id) => cancellation(id, 'UNKNOWN'));
    vi.mocked(api.getLocation).mockResolvedValue(snapshot()); await flow.verifyAndRefresh();
    expect(flow.relatedTasks.value).toEqual([]); expect(flow.canUnbind.value).toBe(false); expect(flow.cancellationRecords.value[0].status).toBe('UNKNOWN');
    expect(flow.notice.value?.text).toContain('仍未确认'); expect(api.unbind).not.toHaveBeenCalled();
    vi.mocked(cancellationApi.result).mockImplementation(async (_taskId, id) => cancellation(id, 'CANCELLED')); await flow.verifyAndRefresh();
    expect(flow.canUnbind.value).toBe(true); expect(cancellationApi.cancel).toHaveBeenCalledOnce();
  });
  it.each([new Error('网络中断'), new ApiRequestError('服务器未确认', 503), new ApiRequestError('响应超时', 408), new ApiRequestError('记录不可见', 404)])(
    'never re-posts an uncertain cancellation after clearing, hiding and reopening (%s)', async error => {
      const flow = await ready(); vi.mocked(cancellationApi.cancel).mockRejectedValueOnce(error);
      flow.requestUnbind(); await flow.submit(); const input = vi.mocked(cancellationApi.cancel).mock.calls[0][1];
      expect(flow.cancellationRecords.value[0].status).toBe('UNKNOWN'); expect(flow.confirmation.value).toBe(true);
      flow.cancel(); flow.clear(); flow.pause(); flow.resume(); await flow.scan('LOC-1');
      flow.requestUnbind(); await flow.submit(); expect(cancellationApi.cancel).toHaveBeenCalledOnce();
      const reopened = useLocationBinding(); await reopened.scan('LOC-1'); await reopened.verifyAndRefresh();
      expect(cancellationApi.result).toHaveBeenCalledWith(task().taskId, input.requestId); expect(cancellationApi.cancel).toHaveBeenCalledOnce();
      expect(api.unbind).not.toHaveBeenCalled();
    }
  );
  it.each([403, 409])('preserves an explicit cancellation failure until manually refreshed and uses a new task version (%s)', async statusCode => {
    const flow = await ready(); vi.mocked(cancellationApi.cancel).mockRejectedValueOnce(new ApiRequestError('后端拒绝取消', statusCode));
    flow.requestUnbind(); await flow.submit(); expect(flow.notice.value?.text).toBe('后端拒绝取消');
    expect(flow.cancellationRecords.value[0].status).toBe('FAILED'); expect(api.unbind).not.toHaveBeenCalled();
    const previous = vi.mocked(cancellationApi.cancel).mock.calls[0][1]; flow.cancel();
    vi.mocked(api.getLocation).mockResolvedValue(blocked([{ ...task(), version: 11 }])); await flow.verifyAndRefresh();
    flow.requestUnbind(); await flow.submit(); const next = vi.mocked(cancellationApi.cancel).mock.calls[1][1];
    expect(next.version).toBe(11); expect(next.requestId).not.toBe(previous.requestId); expect(cancellationApi.result).not.toHaveBeenCalled();
  });
  it('shows the backend final failure without unbinding or automatically issuing another cancellation', async () => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit();
    vi.mocked(cancellationApi.result).mockImplementation(async (_taskId, id) => cancellation(id, 'FAILED'));
    await flow.verifyAndRefresh(); expect(api.unbind).not.toHaveBeenCalled(); expect(cancellationApi.cancel).toHaveBeenCalledOnce();
    expect(flow.canUnbind.value).toBe(false); expect(flow.notice.value).toEqual({ text: '后端返回的取消原因', error: true });
  });
  it.each(['requestId', 'taskId', 'taskNo', 'processedTime', 'cancelStatus'] as const)('does not trust an uncorrelated or malformed cancellation %s', async field => {
    const flow = await ready(); vi.mocked(cancellationApi.cancel).mockImplementation(async (_taskId, input) =>
      Object.assign(cancellation(input.requestId), { [field]: field === 'cancelStatus' ? 'FAILED' : 'invalid' }));
    flow.requestUnbind(); await flow.submit(); expect(flow.cancellationRecords.value[0].status).toBe('UNKNOWN');
    expect(flow.notice.value?.text).toContain('取消回执异常'); expect(api.unbind).not.toHaveBeenCalled();
    flow.cancel(); await flow.verifyAndRefresh(); expect(cancellationApi.cancel).toHaveBeenCalledOnce();
  });
  it.each(['FAILED', 'UNKNOWN'] as const)('requires a nonempty backend reason for queried %s results', async status => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit();
    vi.mocked(cancellationApi.result).mockImplementation(async (_taskId, id) => ({ ...cancellation(id, status), reason: '' }));
    await flow.verifyAndRefresh(); expect(flow.cancellationRecords.value[0].status).toBe('UNKNOWN');
    expect(flow.canUnbind.value).toBe(false); expect(flow.notice.value?.text).toContain('回执异常');
  });
  it('keeps original result credentials after a query network failure and manually verifies them again', async () => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit(); const input = vi.mocked(cancellationApi.cancel).mock.calls[0][1];
    vi.mocked(cancellationApi.result).mockRejectedValueOnce(new Error('结果查询网络失败')); await flow.verifyAndRefresh();
    expect(flow.notice.value?.text).toBe('结果查询网络失败'); expect(flow.cancellationRecords.value[0].status).toBe('UNKNOWN');
    expect(api.getLocation).toHaveBeenCalledOnce(); await flow.verifyAndRefresh();
    expect(vi.mocked(cancellationApi.result).mock.calls).toEqual([[task().taskId, input.requestId], [task().taskId, input.requestId]]);
    expect(cancellationApi.cancel).toHaveBeenCalledOnce();
  });
  it('keeps the original cancellation after FLOW 503 and result 404 without unlocking location unbinding', async () => {
    const flow = await ready(); vi.mocked(cancellationApi.cancel).mockRejectedValueOnce(new ApiRequestError('FLOW 未发送', 503));
    flow.requestUnbind(); await flow.submit(); const input = vi.mocked(cancellationApi.cancel).mock.calls[0][1]; flow.cancel();
    vi.mocked(cancellationApi.result).mockRejectedValue(new ApiRequestError('取消记录不存在', 404));
    vi.mocked(api.getLocation).mockResolvedValue(snapshot()); await flow.verifyAndRefresh();
    expect(flow.cancellationRecords.value[0]).toMatchObject({ input, status: 'UNKNOWN' });
    expect(flow.notice.value?.text).toContain('不代表未发送或已过期'); expect(flow.canUnbind.value).toBe(false);
    flow.requestUnbind(); await flow.submit(); expect(cancellationApi.cancel).toHaveBeenCalledOnce(); expect(api.unbind).not.toHaveBeenCalled();
  });
  it('normalizes legacy ACCEPTED descriptions while retaining the saved request and unbind context', async () => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit();
    const saved = flow.cancellationRecords.value[0]; storage.set(storageKey, [{ ...saved, reason: '取消已受理' }]);
    const reopened = useLocationBinding(); await reopened.scan('LOC-1');
    expect(reopened.cancellationRecords.value[0]).toMatchObject({ input: saved.input, status: 'ACCEPTED' });
    expect(reopened.cancellationRecords.value[0].reason).toContain('不代表调度已受理');
    expect(cancellationApi.cancel).toHaveBeenCalledOnce(); expect(reopened.canUnbind.value).toBe(false);
  });
  it('preserves successfully submitted tasks when a later task cancellation fails and stops remaining writes', async () => {
    const flow = await ready(blocked([task(), task(2), task(3)]));
    vi.mocked(cancellationApi.cancel).mockImplementationOnce(async (_taskId, input) => {
      const saved = storage.get(storageKey) as { input: { requestId: string } }[];
      expect(saved[0].input.requestId).toBe(input.requestId); return cancellation(input.requestId, 'CANCELLED');
    }).mockRejectedValueOnce(new Error('第二项结果未知'));
    flow.requestUnbind(); await flow.submit(); expect(cancellationApi.cancel).toHaveBeenCalledTimes(2);
    expect(flow.cancellationRecords.value.map(record => record.status)).toEqual(['CANCELLED', 'UNKNOWN']);
    expect(vi.mocked(cancellationApi.cancel).mock.calls[0][1].requestId).not.toBe(vi.mocked(cancellationApi.cancel).mock.calls[1][1].requestId);
    expect(flow.confirmation.value).toBe(true); expect(api.unbind).not.toHaveBeenCalled();
  });
  it('does not send cancellation if persisting the original request fails', async () => {
    const flow = await ready(); vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('存储不可用'); });
    flow.requestUnbind(); await flow.submit(); expect(cancellationApi.cancel).not.toHaveBeenCalled();
    expect(flow.notice.value?.text).toContain('无法保存'); expect(flow.canRequestUnbind.value).toBe(false);
  });
  it('isolates pending cancellation records by account and environment and fails closed on corrupted records', async () => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit(); seedTestSession('other');
    const other = useLocationBinding(); await other.scan('LOC-1'); expect(other.cancellationRecords.value).toEqual([]);
    seedTestSession(); const session = storage.get(AUTH_SESSION_STORAGE_KEY) as { baseUrl: string }; session.baseUrl = 'https://production.example';
    const production = useLocationBinding(); await production.scan('LOC-1'); expect(production.cancellationRecords.value).toEqual([]);
    seedTestSession(); storage.set(storageKey, [{ taskId: task().taskId, input: { requestId: 'broken' } }]);
    vi.mocked(api.getLocation).mockResolvedValue(snapshot());
    const corrupted = useLocationBinding(); await corrupted.scan('LOC-1'); expect(corrupted.canRequestUnbind.value).toBe(false);
    expect(corrupted.notice.value?.text).toContain('本地取消记录不可用'); expect(corrupted.notice.value?.error).toBe(true);
    expect(cancellationApi.cancel).toHaveBeenCalledOnce();
  });
  it.each(['container', 'type', 'occupied'] as const)('requires a new scan when refreshed occupancy %s changes', async change => {
    const flow = await ready(); flow.requestUnbind(); await flow.submit();
    const changed = snapshot();
    if (change === 'container') changed.container!.containerCode = 'CAR-OTHER';
    if (change === 'type') changed.container!.containerType = 'BOX';
    if (change === 'occupied') { changed.occupied = false; changed.container = undefined; }
    vi.mocked(api.getLocation).mockResolvedValue(changed); await flow.verifyAndRefresh();
    expect(flow.location.value?.container?.containerCode).toBe('CAR-1'); expect(flow.canRequestUnbind.value).toBe(false);
    expect(flow.notice.value?.text).toContain('绑定关系已变化'); expect(api.unbind).not.toHaveBeenCalled();
    flow.clear(); await flow.scan('LOC-1'); expect(flow.location.value).toEqual(changed);
  });
  it('does not repopulate the page from late cancellation results after hiding and preserves the original pending request', async () => {
    const flow = await ready(); let resolve!: (value: CancellationResult) => void;
    vi.mocked(cancellationApi.cancel).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    flow.requestUnbind(); const work = flow.submit(); const input = vi.mocked(cancellationApi.cancel).mock.calls[0][1];
    flow.pause(); await flow.scan(''); flow.resume(); await flow.scan('LOC-1'); resolve(cancellation(input.requestId, 'CANCELLED')); await work;
    expect(flow.location.value?.version).toBe(2); expect(flow.cancellationRecords.value[0].status).toBe('UNKNOWN');
    expect(flow.confirmation.value).toBe(false); expect(api.unbind).not.toHaveBeenCalled();
    await flow.verifyAndRefresh(); expect(cancellationApi.result).toHaveBeenCalledWith(task().taskId, input.requestId);
  });
  it('drops late refresh responses and prevents concurrent scan, cancellation and verification writes', async () => {
    const flow = await ready(snapshot()); let resolve!: (value: LocationContainers) => void;
    vi.mocked(api.getLocation).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const work = flow.verifyAndRefresh(); flow.requestUnbind(); await flow.submit(); await flow.scan('LOC-2'); await flow.verifyAndRefresh();
    expect(api.getLocation).toHaveBeenCalledTimes(2); expect(api.unbind).not.toHaveBeenCalled();
    flow.pause(); flow.resume(); await flow.scan('LOC-1'); resolve(snapshot({ version: 99 })); await work;
    expect(flow.location.value?.version).toBe(2); expect(flow.notice.value).toBeNull();
  });
  const invalidLocations: [string, (value: LocationContainers) => void][] = [
    ['missing tasks', value => Object.assign(value, { relatedTasks: undefined })],
    ['missing qualification', value => Object.assign(value, { unbindEligibility: undefined })],
    ['missing denial reason', value => { value.unbindEligibility = { allowed: false }; }],
    ['null free container', value => Object.assign(value, { occupied: false, container: null })],
    ['duplicate task', value => { value.relatedTasks.push({ ...value.relatedTasks[0] }); }],
    ['numeric task ID', value => Object.assign(value.relatedTasks[0], { taskId: 9007199254741001 })],
    ['invalid task ID', value => { value.relatedTasks[0].taskId = '0'; }],
    ['invalid task version', value => { value.relatedTasks[0].version = 0; }],
    ['missing settlement', value => Object.assign(value.relatedTasks[0], { settled: undefined })],
    ['unknown task state', value => Object.assign(value.relatedTasks[0], { status: 'DONE' })],
    ['missing cancellation reason', value => { value.relatedTasks[0].cancellationEligibility = { allowed: false }; }],
    ['invalid content state', value => Object.assign(value.container!, { contentState: 'EMPTY_ASSUMED' })]
  ];
  it.each(invalidLocations)('rejects incomplete current location data (%s) without admitting a scan', async (_name, change) => {
    const value = blocked(); change(value); const flow = await ready(value);
    expect(flow.location.value).toBeNull(); expect(flow.canRequestUnbind.value).toBe(false); expect(flow.notice.value?.text).toContain('不完整');
  });
  it.each(['bind', 'unbind'] as const)('replays an uncertain %s using the same UUID and accepts a complete receipt without operationNo', async mode => {
    const flow = mode === 'bind' ? await bindingReady() : await ready(snapshot());
    if (mode === 'unbind') flow.requestUnbind();
    const mutation = vi.mocked(api[mode]); mutation.mockRejectedValueOnce(new ApiRequestError('外部处理结果未知', 503));
    await flow.submit(); const first = mutation.mock.calls[0]; expect(flow.location.value).not.toBeNull();
    await flow.submit(); expect(mutation.mock.calls[1]).toEqual(first); expect(flow.location.value).toBeNull();
    expect(cancellationApi.cancel).not.toHaveBeenCalled();
  });
  it.each(['requestId', 'missingCount', 'affectedCount', 'processedTime', 'resultType'] as const)('rejects an incomplete or inconsistent location receipt %s', async field => {
    const flow = await bindingReady(); vi.mocked(api.bind).mockImplementationOnce(async (_data, id) =>
      Object.assign(receipt(id!), field === 'missingCount' ? { affectedCount: undefined } :
        { [field]: field === 'affectedCount' ? 0 : field === 'resultType' ? 'CONFIRMATION_REQUIRED' : '' }));
    await flow.submit(); expect(flow.pending.value?.containerCode).toBe('CAR-1'); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(vi.mocked(api.bind).mock.calls[1]).toEqual(vi.mocked(api.bind).mock.calls[0]); expect(flow.location.value).toBeNull();
  });
  it.each(['bind', 'unbind'] as const)('uses a new request UUID after an explicit %s rejection, not after an uncertain response', async mode => {
    const flow = mode === 'bind' ? await bindingReady() : await ready(snapshot()); if (mode === 'unbind') flow.requestUnbind();
    const mutation = vi.mocked(api[mode]); mutation.mockRejectedValueOnce(new ApiRequestError('版本冲突', 409)); await flow.submit(); await flow.submit();
    expect(mutation.mock.calls[1][1]).not.toBe(mutation.mock.calls[0][1]); expect(mutation.mock.calls[1][0]).toEqual(mutation.mock.calls[0][0]);
  });
  it('renders separate cancellation and unbind confirmations, fixed refresh controls, and no unapproved transport popup', async () => {
    vi.spyOn(api, 'getLocation').mockResolvedValue(blocked());
    const wrapper = mount(BindingPage, { global: { stubs: {
      'scroll-view': { name: 'ScrollView', props: ['scrollY'], template: '<div><slot /></div>' }
    } } });
    try {
      hooks.show.forEach(show => show()); expect(wrapper.getComponent({ name: 'ScrollView' }).props('scrollY')).toBe(false);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'LOC-1'); await flushPromises();
      expect(wrapper.text()).toContain('实物未结算'); expect(wrapper.get('.refresh').text()).toBe('核实并刷新');
      await wrapper.get('.footer .danger').trigger('tap'); expect(wrapper.get('.modal').attributes('aria-label')).toBe('确认取消阻塞任务');
      expect(wrapper.find('.notice').exists()).toBe(false);
      expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true); expect(wrapper.get('.refresh').attributes('disabled')).toBeDefined();
      await wrapper.get('.modal-actions .danger').trigger('tap'); await flushPromises();
      expect(wrapper.find('.modal').exists()).toBe(false); expect(wrapper.text()).toContain('取消处理中'); expect(api.unbind).not.toHaveBeenCalled();
      vi.mocked(api.getLocation).mockResolvedValue(snapshot({ version: 4, container: { ...snapshot().container!, version: 6 } }));
      await wrapper.get('.refresh').trigger('tap'); await flushPromises(); await wrapper.get('.footer .danger').trigger('tap');
      expect(wrapper.get('.modal').attributes('aria-label')).toBe('确认解绑容器');
      await wrapper.get('.modal-actions .danger').trigger('tap'); await flushPromises();
      expect(wrapper.find('.modal').exists()).toBe(false); expect(wrapper.text()).not.toContain('是否创建物流任务');
      expect(wrapper.getComponent({ name: 'ScrollView' }).props('scrollY')).toBe(false);
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.text()).toContain('请先扫描库位');
    } finally { wrapper.unmount(); }
  });
});
