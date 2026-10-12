import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { warehouseLogisticsApi as api, type WarehouseLogisticsOptions, type WarehouseLogisticsRequest } from '../warehouseLogistics';
import type { BoxMaterials } from '../warehouseApplication';
import type { TaskCreationResponse } from '../logistics';
import { ApiRequestError } from '../nariRequest';
import { useWarehouseLogistics } from '../../composables/useWarehouseLogistics';
import WarehousePage from '../../pages/warehouse-logistics/index.vue';
import ScanInput from '../../components/ScanInput.vue';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const snapshot = (): WarehouseLogisticsOptions => {
  const destinations = [1, 2].map(index => ({ location: { locationCode: 'DEST-' + index, locationName: '库房接驳位' + index,
    floorCode: 'F1', floorName: '一层', areaCode: 'AREA-' + index, areaName: '库房区' + index }, recommended: index === 2 }));
  return { object: { containerType: 'VEHICLE', containerCode: 'CAR-1', version: 7 }, origin: { locationCode: 'SOURCE-1', locationName: '来源位置' },
    vendor: 'STANDARD', taskType: 'GENERAL', destinations, recommendedDestination: destinations[1].location, eligibility: { allowed: true },
    boxes: [{ boxCode: 'BOX-1', version: 7, materialQuantity: 1, materials: [{ lineType: 'PANEL', panelCode: 'MU-1', orderNo: 'SO-1', materialCode: 'MAT-1', quantity: 1 }] },
      { boxCode: 'BOX-2', version: 8, materialQuantity: 3, materials: [{ lineType: 'QUANTITY', orderNo: 'SO-2', materialCode: 'MAT-2', quantity: 3, materialBatch: '000019' }] }], totalMaterialQuantity: 4 };
};
const materials = (): BoxMaterials => ({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 31, contentState: 'UNKNOWN' }, sourceSystem: 'LES',
  materials: [{ lineType: 'PANEL', panelCode: 'MU-DETAIL', orderNo: 'SO-1', materialCode: 'MAT-1', quantity: 1, materialBatch: '000019' }], totalQuantity: 1 });
const receipt = (input: WarehouseLogisticsRequest): TaskCreationResponse => ({ requestId: input.requestId, task: {
  taskId: '9007199254741001', taskNo: 'WH-1', version: 3, vendor: 'STANDARD', taskType: 'GENERAL',
  container: { ...input.object, version: input.version }, origin: { locationCode: 'SOURCE-1', locationName: '实际起始位' },
  destination: { locationCode: input.destinationLocationCode, locationName: '实际目标位' }, status: 'QUEUED', statusName: '待派送', triggerMode: 'MANUAL', createdTime: '2026-10-12T01:00:00Z'
} });
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('warehouse logistics 2026-10-12.1', () => {
  it('accepts optional display fields, preserves textual batches and defaults only to the unique backend recommendation', async () => {
    const data = snapshot(); vi.spyOn(api, 'getOptions').mockResolvedValue(data); const flow = useWarehouseLogistics(); await flow.scan(' CAR-1 ');
    expect(flow.options.value).toBe(data); expect(flow.destination.value?.locationCode).toBe('DEST-2'); expect(flow.options.value?.boxes[1].materials[0].materialBatch).toBe('000019');
    expect(flow.options.value?.object.location).toBeUndefined(); expect(flow.canSubmit.value).toBe(true); await flow.scan('SOURCE-1'); expect(flow.scanType.value).toBe('LOCATION');
  });
  it.each(['EMPTY', 'LOADED', 'UNKNOWN', undefined] as const)('does not infer physical content or eligibility from zero material rows: %s', async contentState => {
    const data = snapshot(); data.object.contentState = contentState; data.object.runtimeUsage = 'FIXTURE'; data.boxes = []; data.totalMaterialQuantity = 0;
    vi.spyOn(api, 'getOptions').mockResolvedValue(data); const flow = useWarehouseLogistics(); await flow.scan('CAR-1'); expect(flow.canSubmit.value).toBe(true);
    expect(flow.options.value?.object.contentState).toBe(contentState); expect(flow.options.value?.object.location).toBeUndefined();
  });
  it.each(['type', 'version', 'content', 'usage', 'object name', 'object location', 'origin', 'line name', 'unit', 'batch', 'panel quantity', 'duplicate panel', 'line type', 'candidate type', 'recommended metadata', 'reason'])('rejects malformed full scan data rather than displaying a partial snapshot: %s', async field => {
    const data = snapshot();
    if (field === 'type') Object.assign(data, { taskType: 'PROCESS_ROUTE' });
    if (field === 'version') data.object.version = 2147483648;
    if (field === 'content') Object.assign(data.object, { contentState: 'EMPTY_BY_COUNT' });
    if (field === 'usage') Object.assign(data.object, { runtimeUsage: 'OTHER' });
    if (field === 'object name') data.object.containerName = '';
    if (field === 'object location') data.object.location = { locationCode: 'SOURCE-1', locationName: '' };
    if (field === 'origin') data.origin.locationType = '';
    if (field === 'line name') data.boxes[0].materials[0].materialName = '';
    if (field === 'unit') data.boxes[0].materials[0].unit = '';
    if (field === 'batch') Object.assign(data.boxes[0].materials[0], { materialBatch: 19 });
    if (field === 'panel quantity') { data.boxes[0].materials[0].quantity = data.boxes[0].materialQuantity = 2; data.totalMaterialQuantity = 5; }
    if (field === 'duplicate panel') { data.boxes[1].materials = [{ ...data.boxes[0].materials[0] }]; data.boxes[1].materialQuantity = 1; data.totalMaterialQuantity = 2; }
    if (field === 'line type') data.boxes[1].materials[0].panelCode = 'FAKE';
    if (field === 'candidate type') data.destinations[0].location.locationType = '';
    if (field === 'recommended metadata') data.recommendedDestination = { ...data.recommendedDestination, locationType: '' };
    if (field === 'reason') data.eligibility.reason = '坏'.repeat(501);
    vi.spyOn(api, 'getOptions').mockResolvedValue(data); const flow = useWarehouseLogistics(); await flow.scan('CAR-1');
    expect(flow.options.value).toBeNull(); expect(flow.destination.value).toBeNull(); expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.error).toBe(true);
  });
  it('treats a box-bound location and denied scan as failure, keeping no stale object or target', async () => {
    const data = snapshot(); const get = vi.spyOn(api, 'getOptions').mockResolvedValueOnce(data).mockResolvedValueOnce({ ...data, object: { containerType: 'BOX', containerCode: 'BOX-1', version: 7 } })
      .mockResolvedValueOnce({ ...data, eligibility: { allowed: false, reason: '后端不允许原因'.repeat(70) } });
    const create = vi.spyOn(api, 'create'); const flow = useWarehouseLogistics(); await flow.scan('CAR-1'); await flow.scan('SOURCE-1'); await flow.submit();
    expect(flow.notice.value?.text).toContain('料箱，不允许缴库'); expect(flow.options.value).toBeNull(); expect(create).not.toHaveBeenCalled();
    await flow.scan('CAR-1'); expect(flow.notice.value?.text).toBe('后端不允许原因'.repeat(70)); expect(flow.options.value).toBeNull(); expect(get).toHaveBeenCalledTimes(3);
  });
  it('keeps readonly details and their new box version out of the original submission snapshot', async () => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const get = vi.spyOn(api, 'getMaterials').mockResolvedValue(materials());
    const create = vi.spyOn(api, 'create').mockImplementation(async input => receipt(input)); const flow = useWarehouseLogistics(); await flow.scan('SOURCE-1');
    const source = flow.options.value; await flow.openMaterials('BOX-1'); expect(get).toHaveBeenCalledWith('BOX-1'); expect(flow.detail.value?.box.version).toBe(31);
    await flow.submit(); expect(create).not.toHaveBeenCalled(); flow.closeMaterials(); expect(flow.options.value).toBe(source); await flow.submit();
    expect(create.mock.lastCall?.[0]).toEqual({ requestId: expect.any(String), scanType: 'LOCATION', scanCode: 'SOURCE-1', object: { containerType: 'VEHICLE', containerCode: 'CAR-1' }, version: 7, destinationLocationCode: 'DEST-2' });
  });
  it.each(['identity', 'source', 'quantity', 'batch'])('keeps scan context when a readonly detail is invalid: %s', async field => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const data = materials();
    if (field === 'identity') data.box.containerCode = 'OTHER';
    if (field === 'source') Object.assign(data, { sourceSystem: 'OTHER' });
    if (field === 'quantity') data.materials[0].quantity = data.totalQuantity = 2;
    if (field === 'batch') data.materials[0].materialBatch = '';
    vi.spyOn(api, 'getMaterials').mockResolvedValue(data); const flow = useWarehouseLogistics(); await flow.scan('CAR-1'); const before = flow.options.value;
    await flow.openMaterials('BOX-1'); expect(flow.options.value).toBe(before); expect(flow.detail.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it.each([408, 503, undefined])('manually reuses the full request after an unknown %s result, preserving it through canceled or unchanged selection', async status => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockRejectedValue(status ? new ApiRequestError('结果未确认', status) : new Error('网络异常'));
    vi.spyOn(api, 'getMaterials').mockResolvedValue(materials()); const flow = useWarehouseLogistics(); await flow.scan('SOURCE-1'); await flow.submit();
    expect(create).toHaveBeenCalledOnce(); flow.openChoice(); flow.closeChoice(); await flow.openMaterials('BOX-1'); flow.closeMaterials();
    flow.openChoice(); flow.choose(flow.destination.value!); await flow.submit(); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
  it.each([400, 409])('uses a new UUID only after explicit rejection %s', async status => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockRejectedValue(new ApiRequestError('明确拒绝', status));
    const flow = useWarehouseLogistics(); await flow.scan('CAR-1'); await flow.submit(); await flow.submit();
    expect(create.mock.calls[1][0].requestId).not.toBe(create.mock.calls[0][0].requestId); expect(flow.options.value).not.toBeNull();
  });
  it('starts a new intent for a different confirmed target or scan, without inventing extra task fields', async () => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockRejectedValue(new Error('网络异常')); const flow = useWarehouseLogistics();
    await flow.scan('CAR-1'); await flow.submit(); flow.openChoice(); flow.choose(flow.candidates.value[0]); await flow.submit();
    expect(create.mock.calls[1][0].requestId).not.toBe(create.mock.calls[0][0].requestId); expect(create.mock.calls[1][0].destinationLocationCode).toBe('DEST-1');
    await flow.scan('SOURCE-1'); await flow.submit(); expect(create.mock.calls[2][0].requestId).not.toBe(create.mock.calls[1][0].requestId);
    expect(create.mock.calls[2][0].scanType).toBe('LOCATION'); expect(Object.keys(create.mock.calls[2][0]).sort()).toEqual(['destinationLocationCode', 'object', 'requestId', 'scanCode', 'scanType', 'version']);
  });
  it.each(['id', 'task identity', 'task version', 'container version', 'container identity', 'origin', 'target', 'vendor', 'type', 'status', 'time', 'trigger', 'pending'])('does not clear or rotate the UUID on an incomplete creation receipt: %s', async field => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockImplementation(async input => {
      const data = receipt(input);
      if (field === 'id') data.requestId = 'wrong';
      if (field === 'task identity') data.task.taskId = '1e19';
      if (field === 'task version') data.task.version = 0;
      if (field === 'container version') data.task.container.version = input.version - 1;
      if (field === 'container identity') data.task.container.containerCode = 'OTHER';
      if (field === 'origin') data.task.origin.locationName = '';
      if (field === 'target') data.task.destination.locationCode = 'OTHER';
      if (field === 'vendor') data.task.vendor = 'HIKVISION';
      if (field === 'type') Object.assign(data.task, { taskType: 'PROCESS_ROUTE' });
      if (field === 'status') Object.assign(data.task, { status: 'CREATED' });
      if (field === 'time') data.task.createdTime = '2026-10-12';
      if (field === 'trigger') data.task.triggerMode = '';
      if (field === 'pending') Object.assign(data, { resultType: 'PENDING' });
      return data;
    });
    const flow = useWarehouseLogistics(); await flow.scan('CAR-1'); await flow.submit(); expect(flow.options.value).not.toBeNull(); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
  it.each(['QUEUED', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'] as const)('recognizes an already-created task in %s without implying physical arrival or repeating creation', async status => {
    vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); const create = vi.spyOn(api, 'create').mockImplementation(async input => ({ ...receipt(input), task: { ...receipt(input).task, status } }));
    const flow = useWarehouseLogistics(); await flow.scan('CAR-1'); await flow.submit(); await flow.submit(); expect(create).toHaveBeenCalledOnce();
    expect(flow.options.value).toBeNull(); expect(flow.notice.value?.text).toContain('创建成功，任务编号：WH-1');
  });
  it('discards hidden scan/detail/create responses and never restores or sends a hidden write', async () => {
    let resolve!: (data: WarehouseLogisticsOptions) => void; const get = vi.spyOn(api, 'getOptions').mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const flow = useWarehouseLogistics(); const scan = flow.scan('CAR-1'); flow.pause(); resolve(snapshot()); await scan; await flow.scan('CAR-1'); expect(get).toHaveBeenCalledOnce();
    flow.resume(); get.mockResolvedValue(snapshot()); await flow.scan('CAR-1'); let resolveDetail!: (data: BoxMaterials) => void;
    vi.spyOn(api, 'getMaterials').mockReturnValueOnce(new Promise(done => { resolveDetail = done; })); const detail = flow.openMaterials('BOX-1');
    flow.pause(); flow.resume(); resolveDetail(materials()); await detail; expect(flow.detail.value).toBeNull();
    await flow.scan('CAR-1'); let resolveTask!: (data: TaskCreationResponse) => void; const create = vi.spyOn(api, 'create').mockReturnValueOnce(new Promise(done => { resolveTask = done; }));
    const submit = flow.submit(); flow.pause(); flow.resume(); resolveTask(receipt(create.mock.lastCall![0])); await submit;
    expect(flow.notice.value).toBeNull(); expect(flow.options.value).toBeNull(); await flow.submit(); expect(create).toHaveBeenCalledOnce();
  });
  it('renders content and optional batches, blocks modal background clear and hidden scanner events', async () => {
    const get = vi.spyOn(api, 'getOptions').mockResolvedValue(snapshot()); vi.spyOn(api, 'getMaterials').mockResolvedValue(materials());
    const wrapper = mount(WarehousePage, { global: { stubs: { picker: true, 'scroll-view': { template: '<div><slot /></div>' } } } });
    hooks.show.forEach(fn => fn()); wrapper.findComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await flushPromises(); expect(wrapper.text()).toContain('实际内容未确认');
    await wrapper.get('.box-row').trigger('tap'); await flushPromises(); expect(wrapper.get('.detail-modal').text()).toContain('批次 000019');
    await wrapper.get('.footer button').trigger('tap'); expect(wrapper.find('.detail-modal').exists()).toBe(true); await wrapper.get('.detail-footer button').trigger('tap');
    await wrapper.get('.choice').trigger('tap'); await wrapper.get('.footer button').trigger('tap'); expect(wrapper.find('.cascade-modal').exists()).toBe(true);
    hooks.hide.forEach(fn => fn()); await flushPromises(); wrapper.findComponent(ScanInput).vm.$emit('scan', 'SOURCE-1'); await flushPromises(); expect(get).toHaveBeenCalledOnce();
    expect(wrapper.find('.choice').exists()).toBe(false); hooks.show.forEach(fn => fn()); wrapper.findComponent(ScanInput).vm.$emit('scan', 'SOURCE-1'); await flushPromises();
    expect(get).toHaveBeenCalledTimes(2); wrapper.unmount();
  });
});
