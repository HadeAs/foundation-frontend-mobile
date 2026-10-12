import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { materialCallApi as api, type MaterialCallLocation, type MaterialCallBoxes, type MaterialCallRequest, type MaterialCallReceipt } from '../materialCall';
import { ApiRequestError } from '../nariRequest';
import { AUTH_SESSION_STORAGE_KEY } from '../auth';
import { useMaterialCall } from '../../composables/useMaterialCall';
import MaterialCallPage from '../../pages/material-call/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const storage = new Map<string, unknown>();
const location = (): MaterialCallLocation => ({ location: { locationCode: 'DEST', locationName: '叫料接收位' }, version: 2, occupied: false,
  eligibility: { allowed: true }, relatedTasks: [], unbindEligibility: { allowed: false, reason: '未绑定容器' } });
const candidates = (orderNo = 'MO-1'): MaterialCallBoxes => ({ orderNo, destination: { ...location().location,
  floorCode: 'F1', floorName: '一层', areaCode: 'R1', areaName: '装配区' }, destinationVersion: 7, eligibility: { allowed: true },
  boxes: [1, 2].map(index => ({ boxCode: 'BOX-' + index, version: 3, orderNo, origin: { locationCode: 'SOURCE-' + index, locationName: '料箱起点' },
    materialQuantity: index, eligibility: { allowed: true } })) });
const receipt = (input: MaterialCallRequest, state: MaterialCallReceipt['tasks'][number]['dispatchState'] = 'QUEUED'): MaterialCallReceipt => ({
  requestId: input.requestId, callNo: 'CALL-1', orderNo: input.orderNo, destination: location().location, createdTime: '2026-10-12T02:00:00Z',
  tasks: input.boxes.map((box, index) => ({ boxCode: box.boxCode, taskId: '900719925474100' + index, taskNo: 'TASK-' + index, dispatchState: state,
    ...(['FAILED', 'UNKNOWN'].includes(state) ? { reason: '后端派送原因' } : {}) })) });
const key = () => [...storage.keys()].find(value => value.startsWith('foundation.material-calls.real.'))!;
async function ready() {
  vi.spyOn(api, 'getLocation').mockResolvedValue(location());
  vi.spyOn(api, 'getBoxes').mockImplementation(async (_code, orderNo) => candidates(orderNo));
  const flow = useMaterialCall(); await flow.scan(' DEST '); flow.order.value = ' MO-1 '; await flow.query(); flow.toggle('BOX-1'); return flow;
}
async function uncertain() { const flow = await ready(); vi.spyOn(api, 'submit').mockRejectedValue(new Error('网络连接中断')); await flow.submit(); return flow; }
beforeEach(() => {
  storage.clear(); hooks.show.length = hooks.hide.length = 0;
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.has(key) ? storage.get(key) : '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), navigateBack: vi.fn() }); seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('manual material call 2026-10-12.1', () => {
  it('keeps optional summary hierarchy absent, accepts future location types and uses the candidate runtime version', async () => {
    const flow = await ready(); const data = candidates(); data.destination.locationType = 'FUTURE_TYPE'; data.boxes[0].origin.locationType = 'FUTURE_TYPE';
    vi.mocked(api.getBoxes).mockResolvedValueOnce(data); await flow.query(); flow.toggle('BOX-1');
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => receipt(input)); await flow.submit();
    expect(submit.mock.lastCall?.[0]).toEqual({ requestId: expect.any(String), orderNo: 'MO-1', destinationLocationCode: 'DEST', destinationVersion: 7,
      boxes: [{ boxCode: 'BOX-1', version: 3 }] }); expect(flow.location.value).toBeNull();
  });
  it.each(['floor', 'area', 'type', 'version', 'eligibility', 'reason', 'null container'])('invalidates malformed scanned position without retaining old selections: %s', async field => {
    const flow = await ready(); const data = location();
    if (field === 'floor') data.location.floorCode = ' ';
    if (field === 'area') Object.assign(data.location, { areaName: null });
    if (field === 'type') data.location.locationType = 'x'.repeat(129);
    if (field === 'version') data.version = 2147483648;
    if (field === 'eligibility') Object.assign(data, { eligibility: {} });
    if (field === 'reason') Object.assign(data.eligibility, { reason: 123 });
    if (field === 'null container') Object.assign(data, { container: null });
    vi.mocked(api.getLocation).mockResolvedValueOnce(data); await flow.scan('DEST');
    expect(flow.location.value).toBeNull(); expect(flow.result.value).toBeNull(); expect(flow.selected.value).toEqual([]);
    expect(flow.canQuery.value).toBe(false); expect(flow.notice.value?.text).toContain('位置信息不完整');
  });
  it.each(['hierarchy', 'type', 'origin', 'origin type', 'reason', 'batch reason', 'quantity'])('preserves the last complete list when candidate metadata is invalid: %s', async field => {
    const flow = await ready(); const old = flow.result.value; const data = candidates();
    if (field === 'hierarchy') data.destination.areaName = '';
    if (field === 'type') Object.assign(data.destination, { locationType: null });
    if (field === 'origin') data.boxes[0].origin.floorName = ' ';
    if (field === 'origin type') Object.assign(data.boxes[0].origin, { locationType: 1 });
    if (field === 'reason') Object.assign(data.boxes[0].eligibility, { reason: 'x'.repeat(501) });
    if (field === 'batch reason') Object.assign(data.eligibility, { reason: false });
    if (field === 'quantity') data.boxes[0].materialQuantity = 2147483648;
    vi.mocked(api.getBoxes).mockResolvedValueOnce(data); await flow.query();
    expect(flow.result.value).toBe(old); expect(flow.selected.value).toEqual(['BOX-1']); expect(flow.notice.value?.error).toBe(true);
  });
  it('displays the backend empty-result reason without requiring a production-plan or order-master lookup', async () => {
    const flow = await ready(); vi.mocked(api.getBoxes).mockResolvedValueOnce({ ...candidates(), boxes: [], eligibility: { allowed: false, reason: '合法范围内没有该订单可用料箱' } });
    await flow.query(); expect(flow.boxes.value).toEqual([]); expect(flow.selected.value).toEqual([]);
    expect(flow.notice.value?.text).toBe('合法范围内没有该订单可用料箱'); expect(flow.canSubmit.value).toBe(false);
  });
  it.each(['QUEUED', 'DISPATCHED', 'COMPLETED', 'CANCELLED', 'FAILED', 'UNKNOWN'] as const)('finalizes a complete per-box receipt with dispatch state %s without recreating or polling', async state => {
    const flow = await ready(); flow.toggle('BOX-2'); const query = vi.mocked(api.getBoxes); query.mockClear();
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => receipt(input, state)); await flow.submit();
    expect(flow.attempt.value).toBeNull(); expect(flow.location.value).toBeNull(); expect(storage.get(key())).toBeNull();
    expect(flow.notice.value?.text).not.toContain('尚未确认');
    if (state === 'CANCELLED') expect(flow.notice.value?.text).toContain('已取消');
    if (state === 'COMPLETED') expect(flow.notice.value?.text).toContain('已完成');
    if (state === 'DISPATCHED') expect(flow.notice.value?.text).toContain('不代表到达');
    await flow.check(); await flow.resume(); await flow.submit(); expect(submit).toHaveBeenCalledOnce(); expect(query).not.toHaveBeenCalled();
  });
  it.each(['request', 'order', 'destination', 'destination metadata', 'time', 'date only', 'extra task', 'duplicate task', 'duplicate box', 'task id', 'state', 'reason', 'optional reason'])('retains the frozen original request for an invalid complete receipt: %s', async field => {
    const flow = await ready(); flow.toggle('BOX-2'); const submit = vi.spyOn(api, 'submit').mockImplementation(async input => {
      const data = receipt(input);
      if (field === 'request') data.requestId = 'other';
      if (field === 'order') data.orderNo = 'other';
      if (field === 'destination') data.destination.locationCode = 'other';
      if (field === 'destination metadata') data.destination.floorName = '';
      if (field === 'time') data.createdTime = 'invalid';
      if (field === 'date only') data.createdTime = '2026-10-12';
      if (field === 'extra task') data.tasks.push({ ...data.tasks[0], boxCode: 'OTHER', taskId: '1' });
      if (field === 'duplicate task') data.tasks[1].taskId = data.tasks[0].taskId;
      if (field === 'duplicate box') data.tasks[1].boxCode = data.tasks[0].boxCode;
      if (field === 'task id') Object.assign(data.tasks[0], { taskId: 9007199254741001 });
      if (field === 'state') Object.assign(data.tasks[0], { dispatchState: 'ACCEPTED' });
      if (field === 'reason') data.tasks[0].dispatchState = 'UNKNOWN';
      if (field === 'optional reason') Object.assign(data.tasks[0], { reason: 3 });
      return data;
    }); await flow.submit(); const input = submit.mock.lastCall![0];
    expect(flow.attempt.value?.input).toEqual(input); expect(flow.disabled.value).toBe(true); expect(flow.notice.value?.text).toContain('回执不完整');
    await flow.submit(); expect(submit).toHaveBeenCalledOnce();
    submit.mockImplementation(async original => receipt(original, 'CANCELLED')); await flow.check();
    expect(submit.mock.lastCall![0]).toEqual(input); expect(flow.attempt.value).toBeNull(); expect(flow.notice.value?.text).toContain('已取消');
  });
  it('refreshes only the applied order after an explicit rejection, resets selections and uses a new UUID on the next intent', async () => {
    const flow = await ready(); const oldLocation = flow.location.value; const data = candidates(); data.destinationVersion = 9; data.boxes[0].version = 5;
    const query = vi.mocked(api.getBoxes).mockResolvedValueOnce(data); query.mockClear();
    const submit = vi.spyOn(api, 'submit').mockRejectedValueOnce(new ApiRequestError('BOX-1 已被其他任务预占', 409))
      .mockImplementation(async input => receipt(input)); await flow.submit();
    const first = submit.mock.calls[0][0]; expect(flow.location.value).toBe(oldLocation); expect(flow.order.value.trim()).toBe('MO-1');
    expect(query).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledWith('DEST', 'MO-1'); expect(flow.selected.value).toEqual([]);
    flow.order.value = 'MO-2'; expect(flow.result.value).toEqual(data); expect(flow.canSubmit.value).toBe(false);
    flow.order.value = 'MO-1'; flow.toggle('BOX-1'); await flow.submit();
    expect(submit.mock.calls[1][0]).toMatchObject({ destinationVersion: 9, boxes: [{ boxCode: 'BOX-1', version: 5 }] });
    expect(submit.mock.calls[1][0].requestId).not.toBe(first.requestId);
  });
  it('preserves an existing real request with legacy minimal location context and never automatically resubmits on restoration', async () => {
    const flow = await uncertain(); const record = storage.get(key()) as { location: Partial<MaterialCallLocation> };
    delete record.location.relatedTasks; delete record.location.unbindEligibility;
    flow.pause(); const restored = useMaterialCall(); await restored.resume();
    expect(restored.attempt.value?.input).toEqual(flow.attempt.value?.input); expect(api.submit).toHaveBeenCalledOnce();
    expect(restored.order.value).toBe('MO-1'); expect(restored.location.value?.location.locationCode).toBe('DEST');
  });
  it.each(['location', 'reason', 'box', 'duplicate', 'record'])('preserves an invalid stored request and blocks new submissions rather than silently overwriting it: %s', async field => {
    await uncertain(); const storageKey = key(); const data = storage.get(storageKey) as { location: MaterialCallLocation; reason: string; input: MaterialCallRequest };
    if (field === 'location') data.location.location.locationName = '';
    if (field === 'reason') Object.assign(data, { reason: null });
    if (field === 'box') data.input.boxes[0].version = 0;
    if (field === 'duplicate') data.input.boxes.push(data.input.boxes[0]);
    if (field === 'record') storage.set(storageKey, 'broken record');
    const saved = JSON.stringify(storage.get(storageKey)); const flow = useMaterialCall();
    expect(flow.storageError.value).not.toBe(''); expect(flow.disabled.value).toBe(true);
    await flow.scan('DEST'); flow.order.value = 'MO-1'; await flow.query(); flow.toggle('BOX-1'); await flow.submit();
    expect(JSON.stringify(storage.get(storageKey))).toBe(saved); expect(api.submit).toHaveBeenCalledOnce();
  });
  it('keeps the page usable for read-only recovery when local storage cannot be read and re-reads without writing', async () => {
    const original = uni.getStorageSync;
    vi.spyOn(uni, 'getStorageSync').mockImplementation(key => { if (key.startsWith('foundation.material-calls.real.')) throw new Error('读取失败'); return original(key); });
    const flow = useMaterialCall(); const submit = vi.spyOn(api, 'submit');
    expect(flow.storageError.value).not.toBe(''); expect(flow.disabled.value).toBe(true);
    vi.mocked(uni.getStorageSync).mockImplementation(original); await flow.resume();
    expect(flow.storageError.value).toBe(''); expect(flow.disabled.value).toBe(false); expect(submit).not.toHaveBeenCalled();
  });
  it.each(['completed', 'rejected'])('retains the persisted original request if recording %s fails and does not allow a new intent', async outcome => {
    const flow = await ready(); const original = uni.setStorageSync;
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => {
      vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('磁盘不可写'); });
      if (outcome === 'rejected') throw new ApiRequestError('箱已被预占', 409);
      return receipt(input);
    }); await flow.submit(); const input = submit.mock.lastCall![0];
    expect(flow.attempt.value?.input).toEqual(input); expect(flow.storageError.value).not.toBe('');
    expect((storage.get(key()) as { input: MaterialCallRequest }).input).toEqual(input); expect(flow.disabled.value).toBe(true);
    await flow.submit(); await flow.check(); expect(submit).toHaveBeenCalledOnce();
    vi.mocked(uni.setStorageSync).mockImplementation(original); await flow.resume();
    submit.mockImplementation(async request => receipt(request)); await flow.check();
    expect(submit.mock.lastCall![0]).toEqual(input); expect(flow.attempt.value).toBeNull(); expect(storage.get(key())).toBeNull();
  });
  it('blocks hidden scans, queries, toggles and retries without restoring stale UI, and records a late complete result', async () => {
    const flow = await ready(); let resolve!: (value: MaterialCallReceipt) => void;
    const submit = vi.spyOn(api, 'submit').mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = flow.submit(); const input = submit.mock.lastCall![0]; flow.pause();
    const get = vi.mocked(api.getLocation); get.mockClear(); const query = vi.mocked(api.getBoxes); query.mockClear();
    await flow.scan('DEST'); await flow.query(); flow.toggle('BOX-1'); await flow.check(); flow.notify('隐藏提示', true);
    expect(get).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(submit).toHaveBeenCalledOnce();
    expect(flow.location.value).toBeNull(); expect(flow.notice.value).toBeNull(); expect(flow.canQuery.value).toBe(false);
    resolve(receipt(input)); await pending; expect(flow.attempt.value).toBeNull(); expect(storage.get(key())).toBeNull();
    expect(flow.location.value).toBeNull(); expect(flow.notice.value).toBeNull();
  });
  it('does not overlap a manual recovery with a still-running original request after returning to the page', async () => {
    const flow = await ready(); let resolve!: (value: MaterialCallReceipt) => void;
    const submit = vi.spyOn(api, 'submit').mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = flow.submit(); const input = submit.mock.lastCall![0]; flow.pause(); await flow.resume(); await flow.check();
    expect(submit).toHaveBeenCalledOnce(); expect(flow.busy.value).toBe(true);
    resolve(receipt(input)); await pending; expect(flow.busy.value).toBe(false); expect(flow.attempt.value).toBeNull(); expect(flow.location.value).toBeNull();
  });
  it.each(['account', 'environment'])('does not replay an original request in a changed %s scope and preserves its original record', async field => {
    const flow = await uncertain(); const storageKey = key(); const saved = JSON.stringify(storage.get(storageKey)); flow.pause();
    if (field === 'account') seedTestSession('other');
    else { const session = uni.getStorageSync(AUTH_SESSION_STORAGE_KEY); uni.setStorageSync(AUTH_SESSION_STORAGE_KEY, { ...session, baseUrl: 'https://other.example.test' }); }
    await flow.resume(); await flow.check(); await flow.scan('DEST'); await flow.query(); await flow.submit();
    expect(api.submit).toHaveBeenCalledOnce(); expect(flow.location.value).toBeNull(); expect(flow.disabled.value).toBe(true);
    expect(JSON.stringify(storage.get(storageKey))).toBe(saved); expect(flow.notice.value?.text).toContain('账号或环境已变化');
    seedTestSession(); const restored = useMaterialCall(); expect(restored.attempt.value?.input).toEqual(flow.attempt.value?.input);
  });
  it('records a late completion only in its original scope without unlocking the old page after an account switch', async () => {
    const flow = await ready(); let resolve!: (value: MaterialCallReceipt) => void;
    const submit = vi.spyOn(api, 'submit').mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = flow.submit(); const input = submit.mock.lastCall![0]; const storageKey = key(); flow.pause(); seedTestSession('other'); await flow.resume();
    resolve(receipt(input)); await pending;
    expect(storage.get(storageKey)).toBeNull(); expect(flow.location.value).toBeNull(); expect(flow.disabled.value).toBe(true);
    expect(flow.storageError.value).toContain('账号或环境已变化'); await flow.check(); await flow.scan('DEST'); expect(submit).toHaveBeenCalledOnce();
    expect([...storage.keys()].filter(value => value.startsWith('foundation.material-calls.real.'))).toEqual([storageKey]);
  });
  it('shows a read-only storage issue card, keeps native scanning unfocused and leaves the empty list non-scrollable', async () => {
    vi.useFakeTimers();
    const original = uni.getStorageSync;
    vi.spyOn(uni, 'getStorageSync').mockImplementation(key => key.startsWith('foundation.material-calls.real.') ? 'broken' : original(key));
    const submit = vi.spyOn(api, 'submit');
    const wrapper = mount(MaterialCallPage, { global: { stubs: { checkbox: true, 'checkbox-group': true,
      'scroll-view': { name: 'ScrollView', template: '<div><slot /></div>', props: ['scrollY', 'showScrollbar'] } } } });
    try {
      hooks.show.forEach(show => show()); await flushPromises(); expect(wrapper.get('.storage-card').text()).toContain('本地叫料记录');
      expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true); expect(wrapper.findAll('.footer button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
      vi.mocked(uni.getStorageSync).mockImplementation(original); await wrapper.get('.storage-retry').trigger('tap'); await flushPromises();
      expect(wrapper.find('.storage-card').exists()).toBe(false); expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(false);
      expect(wrapper.getComponent({ name: 'ScrollView' }).props('scrollY')).toBe(false);
      expect(submit).not.toHaveBeenCalled(); expect(wrapper.find('input[autofocus]').exists()).toBe(false);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
});
