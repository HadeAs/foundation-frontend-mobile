import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { logisticsApi as api, type CreateLogisticsRequest, type ReturnLogisticsRequest, type LogisticsOptions, type TaskCreationResponse } from '../logistics';
import { ApiRequestError } from '../nariRequest';
import { useLogisticsCreation } from '../../composables/useLogisticsCreation';
import LogisticsPage from '../../pages/logistics-create/index.vue';
import ScanInput from '../../components/ScanInput.vue';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[], load: [] as ((query: Record<string, string>) => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn),
  onLoad: (fn: (query: Record<string, string>) => void) => hooks.load.push(fn) }));
const snapshot = (type: 'BOX' | 'VEHICLE' = 'VEHICLE'): LogisticsOptions => ({
  object: { containerType: type, containerCode: type === 'BOX' ? 'BOX-1' : 'CAR-1', version: 7 },
  origin: { locationCode: 'KW-1', locationName: '起始接驳位' }, vendor: type === 'BOX' ? 'HIKVISION' : 'STANDARD', taskType: 'GENERAL',
  destinations: [1, 2].map(index => ({ recommended: index === 1, location: { locationCode: 'DEST-' + index, locationName: '目标' + index,
    floorCode: 'F' + index, floorName: index === 1 ? '一层' : '二层', areaCode: 'AREA-1', areaName: '库房区' } })), eligibility: { allowed: true }
});
const receipt = (input: CreateLogisticsRequest | ReturnLogisticsRequest): TaskCreationResponse => ({ requestId: input.requestId,
  task: { taskId: '9007199254741001', taskNo: 'WL-1', version: 3, vendor: input.vendor, taskType: input.taskType,
    container: { ...input.object, version: input.version }, origin: { locationCode: input.originLocationCode, locationName: '起始接驳位' },
    destination: { locationCode: input.destinationLocationCode || 'RETURN-1', locationName: '目标位置' },
    status: 'QUEUED', statusName: '待派送', triggerMode: 'MANUAL', createdTime: '2026-10-12T01:00:00Z' } });
beforeEach(() => { hooks.show.length = hooks.hide.length = hooks.load.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('logistics creation 2026-10-12.1', () => {
  it('keeps the backend-resolved box and brand when scanning a location, without guessing the moving object', async () => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot('BOX')); const create = vi.spyOn(api, 'create').mockImplementation(async input => receipt(input));
    const flow = useLogisticsCreation(); await flow.scan(' KW-1 '); await flow.submit();
    expect(create.mock.lastCall?.[0]).toMatchObject({ object: { containerType: 'BOX', containerCode: 'BOX-1' }, version: 7,
      vendor: 'HIKVISION', taskType: 'GENERAL', originLocationCode: 'KW-1', destinationLocationCode: 'DEST-1' });
    expect(flow.options.value).toBeNull(); expect(flow.notice.value?.text).toContain('待派送'); expect(create).toHaveBeenCalledOnce();
  });
  it.each(['PROCESS_ROUTE', undefined])('rejects a removed or missing task type instead of filling a default: %s', async taskType => {
    const data = snapshot(); Object.assign(data, { taskType }); vi.spyOn(api, 'getOptions').mockResolvedValue(data);
    const create = vi.spyOn(api, 'create'); const flow = useLogisticsCreation(); await flow.scan('CAR-1'); await flow.submit();
    expect(flow.options.value).toBeNull(); expect(flow.notice.value?.error).toBe(true); expect(create).not.toHaveBeenCalled();
  });
  it.each(['version', 'content', 'usage', 'location', 'reason', 'recommendation'])('rejects invalid query metadata without retaining partial candidates: %s', async field => {
    const data = snapshot();
    if (field === 'version') data.object.version = 2147483648;
    if (field === 'content') Object.assign(data.object, { contentState: 'EMPTY_BY_COUNT' });
    if (field === 'usage') Object.assign(data.object, { runtimeUsage: 'OTHER' });
    if (field === 'location') data.object.location = { locationCode: 'KW-1', locationName: '' };
    if (field === 'reason') data.eligibility.reason = '错'.repeat(501);
    if (field === 'recommendation') data.recommendedDestination = { ...data.destinations[0].location, locationCode: 'FOREIGN' };
    vi.spyOn(api, 'getOptions').mockResolvedValue(data); const flow = useLogisticsCreation(); await flow.scan('CAR-1');
    expect(flow.options.value).toBeNull(); expect(flow.candidates.value).toHaveLength(0); expect(flow.notice.value?.error).toBe(true);
  });
  it.each(['UNKNOWN', 'EMPTY', 'LOADED', undefined] as const)('does not gate transport/return or fabricate a current location from actual content %s', async contentState => {
    const data = snapshot(); data.object.contentState = contentState; data.object.runtimeUsage = 'FIXTURE';
    vi.spyOn(api, 'getOptions').mockResolvedValue(data); const flow = useLogisticsCreation(); await flow.scan('CAR-1');
    expect(flow.canSubmit.value).toBe(true); expect(flow.canReturn.value).toBe(true); expect(flow.options.value?.object.location).toBeUndefined();
  });
  it.each(['create', 'returnToWarehouse'] as const)('manually retries the unchanged %s request with its original UUID after an unknown result', async action => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, action).mockRejectedValue(new ApiRequestError('结果未知', 503));
    const flow = useLogisticsCreation(); await flow.scan('CAR-1'); await (action === 'create' ? flow.submit() : flow.returnToWarehouse());
    expect(create).toHaveBeenCalledOnce(); expect(flow.canSubmit.value).toBe(true);
    await (action === 'create' ? flow.submit() : flow.returnToWarehouse());
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]); expect(flow.options.value).not.toBeNull();
    expect(flow.destination.value?.locationCode).toBe('DEST-1');
  });
  it.each([408, undefined])('reuses an unchanged manually retried request for timeout/network failure %s without auto-retrying', async status => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockRejectedValue(status ? new ApiRequestError('超时', status) : new Error('网络异常'));
    const flow = useLogisticsCreation(); await flow.scan('CAR-1'); await flow.submit(); expect(create).toHaveBeenCalledOnce();
    await flow.submit(); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
  it.each([400, 409])('starts a new UUID only after explicit rejection %s', async status => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockRejectedValue(new ApiRequestError('明确拒绝', status));
    const flow = useLogisticsCreation(); await flow.scan('CAR-1'); await flow.submit(); await flow.submit();
    expect(create.mock.calls[1][0].requestId).not.toBe(create.mock.calls[0][0].requestId); expect(flow.options.value).not.toBeNull();
  });
  it('keeps a retry intent when cancelling or confirming the unchanged target, but changes it for another target/operation', async () => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockRejectedValue(new Error('网络异常'));
    const returning = vi.spyOn(api, 'returnToWarehouse').mockRejectedValue(new Error('网络异常'));
    const flow = useLogisticsCreation(); await flow.scan('CAR-1'); await flow.submit();
    flow.openChoice(); flow.closeChoice(); flow.openChoice(); flow.choose(flow.candidates.value[0]); await flow.submit();
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    flow.openChoice(); flow.choose(flow.candidates.value[1]); await flow.submit();
    expect(create.mock.calls[2][0].requestId).not.toBe(create.mock.calls[1][0].requestId);
    await flow.returnToWarehouse(); expect(returning.mock.calls[0][0].requestId).not.toBe(create.mock.calls[2][0].requestId);
    expect(returning.mock.calls[0][0]).not.toHaveProperty('destinationLocationCode');
  });
  it.each(['id', 'task id', 'task version', 'container version', 'stale container', 'brand', 'type', 'origin', 'destination', 'status', 'time', 'trigger', 'pending'])('retains the page and original UUID on an invalid creation receipt: %s', async field => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockImplementation(async input => {
      const data = receipt(input);
      if (field === 'id') data.requestId = 'wrong';
      if (field === 'task id') data.task.taskId = '1e19';
      if (field === 'task version') data.task.version = 2147483648;
      if (field === 'container version') data.task.container.version = 0;
      if (field === 'stale container') data.task.container.version = input.version - 1;
      if (field === 'brand') data.task.vendor = 'HIKVISION';
      if (field === 'type') Object.assign(data.task, { taskType: 'PROCESS_ROUTE' });
      if (field === 'origin') data.task.origin.locationName = '';
      if (field === 'destination') data.task.destination.locationCode = 'FOREIGN';
      if (field === 'status') Object.assign(data.task, { status: 'CREATED' });
      if (field === 'time') data.task.createdTime = 'not a date';
      if (field === 'trigger') data.task.triggerMode = '';
      if (field === 'pending') Object.assign(data, { resultType: 'PENDING' });
      return data;
    });
    const flow = useLogisticsCreation(); await flow.scan('CAR-1'); await flow.submit();
    expect(flow.options.value).not.toBeNull(); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
  it.each(['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'] as const)('acknowledges a complete persisted task with status %s without equating dispatch with arrival', async status => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockImplementation(async input => ({ ...receipt(input),
      task: { ...receipt(input).task, status, statusName: status === 'UNKNOWN' ? '外部结果未知' : status } }));
    const flow = useLogisticsCreation(); await flow.scan('CAR-1'); await flow.submit();
    expect(flow.options.value).toBeNull(); expect(flow.notice.value?.error).toBe(false); expect(flow.notice.value?.text).not.toContain('运输完成');
    expect(create).toHaveBeenCalledOnce();
  });
  it('checks allocated return receipts with the same identity/version/status rules as specified tasks', async () => {
    const data = snapshot(); data.destinations = []; data.eligibility = { allowed: false, reason: '无手选目标' };
    vi.spyOn(api, 'getOptions').mockResolvedValue(data); const create = vi.spyOn(api, 'returnToWarehouse').mockImplementation(async input => ({ ...receipt(input), task: { ...receipt(input).task, version: 0 } }));
    const flow = useLogisticsCreation(); await flow.scan('CAR-1'); expect(flow.canReturn.value).toBe(true); await flow.returnToWarehouse();
    expect(flow.options.value).not.toBeNull(); await flow.returnToWarehouse(); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    create.mockImplementation(async input => receipt(input)); await flow.returnToWarehouse(); expect(flow.options.value).toBeNull();
    expect(create.mock.calls[2]).toEqual(create.mock.calls[0]);
  });
  it('refreshes the shipped vehicle version and carries shippingNo only on specified tasks for this scan', async () => {
    vi.spyOn(api, 'getOptions').mockResolvedValue({ ...snapshot(), object: { ...snapshot().object, version: 12 } });
    const create = vi.spyOn(api, 'create').mockRejectedValue(new Error('网络异常')); const returning = vi.spyOn(api, 'returnToWarehouse').mockRejectedValue(new Error('网络异常'));
    const flow = useLogisticsCreation(); await flow.scan('CAR-1', 'SHIP-1'); await flow.submit();
    expect(create.mock.lastCall?.[0]).toMatchObject({ shippingNo: 'SHIP-1', version: 12 });
    await flow.returnToWarehouse(); expect(returning.mock.lastCall?.[0]).not.toHaveProperty('shippingNo');
    await flow.scan('KW-1'); await flow.submit(); expect(create.mock.lastCall?.[0]).not.toHaveProperty('shippingNo');
  });
  it('drops hidden query/creation responses and does not issue writes until shown and manually submitted again', async () => {
    let resolve!: (value: LogisticsOptions) => void; const get = vi.spyOn(api, 'getOptions').mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const flow = useLogisticsCreation(); const pending = flow.scan('CAR-1'); flow.pause(); resolve(snapshot()); await pending;
    expect(flow.options.value).toBeNull(); await flow.scan('CAR-1'); expect(get).toHaveBeenCalledOnce();
    flow.resume(); get.mockResolvedValue(snapshot()); await flow.scan('CAR-1'); let resolveTask!: (value: TaskCreationResponse) => void;
    const create = vi.spyOn(api, 'create').mockReturnValueOnce(new Promise(done => { resolveTask = done; }));
    const submit = flow.submit(); flow.pause(); resolveTask(receipt(create.mock.lastCall![0])); await submit;
    expect(flow.options.value).toBeNull(); expect(flow.notice.value).toBeNull(); await flow.submit(); expect(create).toHaveBeenCalledOnce();
    flow.resume(); expect(create).toHaveBeenCalledOnce(); expect(flow.options.value).toBeNull();
  });
  it('renders actual content without a fabricated current location, blocks hidden input and modal background actions', async () => {
    const data = snapshot(); data.object.contentState = 'UNKNOWN'; const get = vi.spyOn(api, 'getOptions').mockResolvedValue(data);
    const wrapper = mount(LogisticsPage, { global: { stubs: { picker: true } } }); hooks.show.forEach(fn => fn());
    wrapper.findComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await flushPromises();
    expect(wrapper.text()).toContain('实际内容'); expect(wrapper.text()).toContain('未确认'); expect(wrapper.text()).not.toContain('当前位置');
    await wrapper.get('.choice').trigger('tap'); await wrapper.get('.footer button').trigger('tap');
    expect(wrapper.find('.cascade-modal').exists()).toBe(true); expect(wrapper.text()).toContain('CAR-1');
    hooks.hide.forEach(fn => fn()); await flushPromises(); expect(wrapper.find('.choice').exists()).toBe(false);
    wrapper.findComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await flushPromises(); expect(get).toHaveBeenCalledOnce();
    hooks.show.forEach(fn => fn()); wrapper.findComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await flushPromises(); expect(get).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('queries a handed-off vehicle once on load without creating a task and does not restore it after hiding', async () => {
    const get = vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create');
    const wrapper = mount(LogisticsPage, { global: { stubs: { picker: true } } });
    hooks.load.forEach(fn => fn({ scanCode: 'CAR-1', shippingNo: 'SHIP-1' })); hooks.show.forEach(fn => fn()); await flushPromises();
    expect(get).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('CAR-1');
    hooks.hide.forEach(fn => fn()); hooks.show.forEach(fn => fn()); await flushPromises();
    expect(get).toHaveBeenCalledOnce(); expect(wrapper.find('.choice').exists()).toBe(false); wrapper.unmount();
  });
});
