import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { emptyVehicleApi as api, type EmptyVehicleOptions, type CallEmptyVehicleRequest } from '../emptyVehicle';
import type { TaskCreationResponse } from '../logistics';
import { ApiRequestError } from '../nariRequest';
import { useEmptyVehicle } from '../../composables/useEmptyVehicle';
import EmptyVehiclePage from '../../pages/empty-vehicle/index.vue';
import ScanInput from '../../components/ScanInput.vue';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const snapshot = (target = 'DEST-1'): EmptyVehicleOptions => ({ destination: { locationCode: target, locationName: '目标接驳位' },
  origins: [1, 2].map(index => ({ origin: { locationCode: 'ORIGIN-' + index, locationName: '起始位' + index,
    floorCode: 'F' + index, floorName: index === 1 ? '一层' : '二层', areaCode: 'AREA-1', areaName: '缓存区' },
  vehicle: { containerType: 'VEHICLE', containerCode: 'CAR-' + index, version: index === 1 ? 7 : 11 } })) });
const receipt = (input: CallEmptyVehicleRequest): TaskCreationResponse => ({ requestId: input.requestId,
  task: { taskId: '9007199254741001', taskNo: 'CALL-1', version: 3, vendor: 'STANDARD', taskType: 'GENERAL',
    container: { containerType: 'VEHICLE', containerCode: input.vehicleCode, version: input.version },
    origin: { locationCode: input.originLocationCode, locationName: '起始位置' }, destination: { locationCode: input.destinationLocationCode, locationName: '目标位置' },
    status: 'QUEUED', statusName: '待派送', triggerMode: 'MANUAL', createdTime: '2026-10-12T01:00:00Z' } });
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('empty vehicle 2026-10-12.1', () => {
  it.each(['EMPTY', 'UNKNOWN', 'LOADED', undefined] as const)('preserves backend-qualified candidates without assuming actual empty content or current position: %s', async contentState => {
    const data = snapshot(); data.origins[0].vehicle.contentState = contentState;
    vi.spyOn(api, 'getOrigins').mockResolvedValue(data); const call = vi.spyOn(api, 'call'); const flow = useEmptyVehicle(); await flow.scan('DEST-1');
    expect(flow.origin.value).toBe(data.origins[0]); expect(flow.origin.value?.vehicle.location).toBeUndefined();
    expect(flow.origin.value?.vehicle.contentState).toBe(contentState); expect(flow.canSubmit.value).toBe(true); expect(call).not.toHaveBeenCalled();
  });
  it.each(['destination', 'type', 'version', 'name', 'content', 'usage', 'location', 'different location'])('rejects malformed candidate metadata as a whole: %s', async field => {
    const data = snapshot();
    if (field === 'destination') data.destination.locationType = '';
    if (field === 'type') Object.assign(data.origins[1].vehicle, { containerType: 'BOX' });
    if (field === 'version') data.origins[1].vehicle.version = 2147483648;
    if (field === 'name') data.origins[1].vehicle.containerName = ' ';
    if (field === 'content') Object.assign(data.origins[1].vehicle, { contentState: 'EMPTY_BY_COUNT' });
    if (field === 'usage') Object.assign(data.origins[1].vehicle, { runtimeUsage: 'OTHER' });
    if (field === 'location') data.origins[1].vehicle.location = { locationCode: 'ORIGIN-2', locationName: '' };
    if (field === 'different location') data.origins[1].vehicle.location = { locationCode: 'FOREIGN', locationName: '其他位置' };
    vi.spyOn(api, 'getOrigins').mockResolvedValue(data); const flow = useEmptyVehicle(); await flow.scan('DEST-1');
    expect(flow.options.value).toBeNull(); expect(flow.origin.value).toBeNull(); expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.error).toBe(true);
  });
  it.each([408, 503, undefined])('does not auto-retry an unknown outcome and manually preserves the complete original call after %s', async status => {
    vi.spyOn(api, 'getOrigins').mockResolvedValue(snapshot()); const call = vi.spyOn(api, 'call').mockRejectedValue(status ? new ApiRequestError('结果未确认', status) : new Error('网络异常'));
    const flow = useEmptyVehicle(); await flow.scan('DEST-1'); await flow.submit(); expect(call).toHaveBeenCalledOnce();
    flow.openChoice(); flow.closeChoice(); await flow.scan('DEST-2'); flow.cancelReplacement();
    await flow.submit(); expect(call.mock.calls[1]).toEqual(call.mock.calls[0]); expect(flow.origin.value?.vehicle.version).toBe(7);
  });
  it.each([400, 409])('starts a fresh manually submitted request only after explicit rejection %s', async status => {
    vi.spyOn(api, 'getOrigins').mockResolvedValue(snapshot()); const call = vi.spyOn(api, 'call').mockRejectedValue(new ApiRequestError('明确拒绝', status));
    const flow = useEmptyVehicle(); await flow.scan('DEST-1'); await flow.submit(); await flow.submit();
    expect(call.mock.calls[1][0].requestId).not.toBe(call.mock.calls[0][0].requestId); expect(flow.options.value).not.toBeNull();
  });
  it('changes the intent only when a different origin is confirmed, using its associated vehicle/version', async () => {
    vi.spyOn(api, 'getOrigins').mockResolvedValue(snapshot()); const call = vi.spyOn(api, 'call').mockRejectedValue(new Error('网络异常'));
    const flow = useEmptyVehicle(); await flow.scan('DEST-1'); await flow.submit();
    flow.openChoice(); flow.choose(flow.candidates.value[0]); await flow.submit(); expect(call.mock.calls[1]).toEqual(call.mock.calls[0]);
    flow.openChoice(); flow.choose(flow.candidates.value[1]); await flow.submit();
    expect(call.mock.calls[2][0]).toMatchObject({ originLocationCode: 'ORIGIN-2', vehicleCode: 'CAR-2', version: 11, destinationLocationCode: 'DEST-1' });
    expect(call.mock.calls[2][0].requestId).not.toBe(call.mock.calls[1][0].requestId);
  });
  it.each(['id', 'task id', 'number', 'task version', 'container version', 'stale container', 'object', 'origin', 'destination', 'type', 'brand', 'status', 'time', 'trigger', 'pending', 'primitive'])('does not clear or change UUID on an incomplete task-creation receipt: %s', async field => {
    vi.spyOn(api, 'getOrigins').mockResolvedValue(snapshot()); const call = vi.spyOn(api, 'call').mockImplementation(async input => {
      const data = receipt(input);
      if (field === 'id') data.requestId = 'wrong';
      if (field === 'task id') data.task.taskId = '1e19';
      if (field === 'number') data.task.taskNo = '';
      if (field === 'task version') data.task.version = 0;
      if (field === 'container version') data.task.container.version = 2147483648;
      if (field === 'stale container') data.task.container.version = input.version - 1;
      if (field === 'object') data.task.container.containerCode = 'OTHER';
      if (field === 'origin') data.task.origin.locationName = '';
      if (field === 'destination') data.task.destination.locationCode = 'OTHER';
      if (field === 'type') Object.assign(data.task, { taskType: 'PROCESS_ROUTE' });
      if (field === 'brand') Object.assign(data.task, { vendor: 'OTHER' });
      if (field === 'status') Object.assign(data.task, { status: 'CREATED' });
      if (field === 'time') data.task.createdTime = 'not a date';
      if (field === 'trigger') data.task.triggerMode = '';
      if (field === 'pending') Object.assign(data, { resultType: 'PENDING' });
      if (field === 'primitive') return 'invalid' as unknown as TaskCreationResponse;
      return data;
    });
    const flow = useEmptyVehicle(); await flow.scan('DEST-1'); await flow.submit(); expect(flow.options.value).not.toBeNull();
    expect(flow.notice.value?.error).toBe(true); expect(flow.notice.value?.text).toContain('呼叫结果'); await flow.submit(); expect(call.mock.calls[1]).toEqual(call.mock.calls[0]);
  });
  it.each(['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'] as const)('recognizes a complete persisted task in status %s without repeating creation or claiming arrival', async status => {
    vi.spyOn(api, 'getOrigins').mockResolvedValue(snapshot()); const call = vi.spyOn(api, 'call').mockImplementation(async input => ({ ...receipt(input), task: { ...receipt(input).task, status } }));
    const flow = useEmptyVehicle(); await flow.scan('DEST-1'); await flow.submit(); await flow.submit();
    expect(flow.notice.value).toEqual({ text: '呼叫成功', error: false }); expect(flow.options.value).toBeNull(); expect(call).toHaveBeenCalledOnce();
  });
  it('keeps replacement cancellation intact but uses a new request after confirmed replacement and clears old context on its query failure', async () => {
    const get = vi.spyOn(api, 'getOrigins').mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot('DEST-2')).mockRejectedValueOnce(new Error('目标已占用'));
    const call = vi.spyOn(api, 'call').mockRejectedValue(new Error('网络异常')); const flow = useEmptyVehicle(); await flow.scan('DEST-1'); await flow.submit();
    await flow.scan('DEST-2'); expect(get).toHaveBeenCalledOnce(); flow.cancelReplacement(); await flow.submit(); expect(call.mock.calls[1]).toEqual(call.mock.calls[0]);
    await flow.scan('DEST-2'); await flow.confirmReplacement(); await flow.submit();
    expect(call.mock.calls[2][0].requestId).not.toBe(call.mock.calls[1][0].requestId); expect(call.mock.calls[2][0].destinationLocationCode).toBe('DEST-2');
    await flow.scan('DEST-3'); await flow.confirmReplacement(); expect(flow.options.value).toBeNull(); expect(flow.notice.value?.text).toBe('目标已占用');
  });
  it('ignores hidden queries and late call results, restores an empty active page and never restores writes', async () => {
    let resolve!: (data: EmptyVehicleOptions) => void; const get = vi.spyOn(api, 'getOrigins').mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const flow = useEmptyVehicle(); const pending = flow.scan('DEST-1'); flow.pause(); resolve(snapshot()); await pending;
    expect(flow.options.value).toBeNull(); await flow.scan('DEST-1'); expect(get).toHaveBeenCalledOnce();
    flow.resume(); get.mockResolvedValue(snapshot()); await flow.scan('DEST-1'); let resolveTask!: (data: TaskCreationResponse) => void;
    const call = vi.spyOn(api, 'call').mockReturnValueOnce(new Promise(done => { resolveTask = done; })); const submit = flow.submit();
    flow.pause(); flow.resume(); resolveTask(receipt(call.mock.lastCall![0])); await submit;
    expect(flow.options.value).toBeNull(); expect(flow.notice.value).toBeNull(); await flow.submit(); expect(call).toHaveBeenCalledOnce();
  });
  it('renders candidate physical content separately from the path, blocks modal clear and drops hidden scan events', async () => {
    const get = vi.spyOn(api, 'getOrigins').mockResolvedValue(snapshot()); const wrapper = mount(EmptyVehiclePage, { global: { stubs: { picker: true } } });
    hooks.show.forEach(fn => fn()); wrapper.findComponent(ScanInput).vm.$emit('scan', 'DEST-1'); await flushPromises();
    expect(wrapper.get('.choice').text()).not.toContain('CAR-1'); expect(wrapper.text()).toContain('实际内容'); expect(wrapper.text()).toContain('未确认');
    await wrapper.get('.choice').trigger('tap'); await wrapper.get('.footer button').trigger('tap'); expect(wrapper.find('.cascade-modal').exists()).toBe(true);
    expect(wrapper.text()).toContain('CAR-1'); hooks.hide.forEach(fn => fn()); await flushPromises();
    wrapper.findComponent(ScanInput).vm.$emit('scan', 'DEST-2'); await flushPromises(); expect(get).toHaveBeenCalledOnce(); expect(wrapper.find('.choice').exists()).toBe(false);
    hooks.show.forEach(fn => fn()); wrapper.findComponent(ScanInput).vm.$emit('scan', 'DEST-2'); await flushPromises(); expect(get).toHaveBeenCalledTimes(2); wrapper.unmount();
  });
});
