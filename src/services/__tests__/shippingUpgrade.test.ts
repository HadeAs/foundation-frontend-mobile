import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { shippingApi as api, type ShippingObject, type ShippingReceipt, type ShippingRequest } from '../shipping';
import { ApiRequestError } from '../nariRequest';
import { useShipping } from '../../composables/useShipping';
import ShippingPage from '../../pages/shipping/index.vue';
import ScanInput from '../../components/ScanInput.vue';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));

const snapshot = (type: 'BOX' | 'VEHICLE' = 'BOX', location = false): ShippingObject => ({ scanType: location ? 'LOCATION' : type,
  scanCode: location ? 'KW-1' : type === 'BOX' ? 'BOX-1' : 'CAR-1', object: { containerType: type, containerCode: type === 'BOX' ? 'BOX-1' : 'CAR-1', version: 7 },
  boxes: Array.from({ length: type === 'BOX' ? 1 : 3 }, (_, index) => ({ boxCode: 'BOX-' + (index + 1), version: 7, materialQuantity: 1,
    materials: [{ lineType: 'PANEL', panelCode: 'PANEL-' + index, orderNo: 'SO-1', materialCode: 'MAT-1', materialBatch: '000031', quantity: 1 }] })),
  totalMaterialQuantity: type === 'BOX' ? 1 : 3, eligibility: { allowed: true } });
const receipt = (input: ShippingRequest): ShippingReceipt => ({ requestId: input.requestId, shippingNo: 'SHIP-1', object: { ...input.object, version: 8 },
  canCreateLogisticsTask: input.object.containerType === 'VEHICLE', processedTime: '2026-10-12T01:00:00Z' });
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn(), navigateTo: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shipping 2026-10-12.1', () => {
  it('accepts optional material display fields without rejecting complete WMS content', async () => {
    vi.spyOn(api, 'getObject').mockResolvedValue(snapshot()); const flow = useShipping(); await flow.scan('BOX-1');
    expect(flow.canSubmit.value).toBe(true); expect(flow.materials.value[0].materialBatch).toBe('000031');
  });
  it('does not use old LES box details for SHIPPING or replace the submission snapshot', async () => {
    const value = snapshot('VEHICLE'); value.boxes.forEach(box => box.materials.forEach(row => Object.assign(row, { materialName: '板件', unit: '件' })));
    vi.spyOn(api, 'getObject').mockResolvedValue(value); vi.spyOn(api, 'getMaterials').mockResolvedValue({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 99 },
      sourceSystem: 'LES', materials: value.boxes[0].materials, totalQuantity: 1 });
    const flow = useShipping(); await flow.scan('CAR-1'); await flow.openMaterials('BOX-1');
    expect(flow.detail.value).toBeNull(); expect(flow.object.value?.object.version).toBe(7); expect(flow.notice.value?.error).toBe(true);
  });
  it('manually reuses the same complete shipping request after an unknown external result', async () => {
    const value = snapshot(); value.boxes[0].materials[0].materialName = '板件'; value.boxes[0].materials[0].unit = '件';
    vi.spyOn(api, 'getObject').mockResolvedValue(value); const submit = vi.spyOn(api, 'submit').mockRejectedValue(new ApiRequestError('WMS 清理结果未知', 503));
    const flow = useShipping(); await flow.scan('BOX-1'); await flow.submit(); await flow.submit();
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]); expect(flow.object.value).not.toBeNull();
  });
  it('preserves LOCATION scan credentials and submits only the resolved whole container and its original version', async () => {
    const value = snapshot('VEHICLE', true); vi.spyOn(api, 'getObject').mockResolvedValue(value);
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => receipt(input));
    const flow = useShipping(); await flow.scan(' KW-1 '); await flow.submit();
    expect(submit.mock.lastCall?.[0]).toEqual({ requestId: expect.any(String), scanType: 'LOCATION', scanCode: 'KW-1',
      object: { containerType: 'VEHICLE', containerCode: 'CAR-1' }, version: 7 });
    expect(flow.object.value).toBeNull(); expect(flow.shipped.value?.object.version).toBe(8); expect(flow.disabled.value).toBe(true);
    flow.dismissLogistics(); expect(flow.disabled.value).toBe(false); expect(submit).toHaveBeenCalledOnce();
  });
  it.each([408, 500, undefined])('never auto-retries an uncertain shipping result, and manually keeps the original body after %s', async status => {
    vi.spyOn(api, 'getObject').mockResolvedValue(snapshot());
    const submit = vi.spyOn(api, 'submit').mockRejectedValue(status ? new ApiRequestError('结果未确认', status) : new Error('网络异常'));
    const flow = useShipping(); await flow.scan('BOX-1'); await flow.submit(); expect(submit).toHaveBeenCalledOnce();
    expect(flow.canSubmit.value).toBe(true); await flow.submit(); expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(flow.shipped.value).toBeNull();
  });
  it.each([400, 409])('starts a fresh manually submitted intent after explicit rejection %s', async status => {
    vi.spyOn(api, 'getObject').mockResolvedValue(snapshot()); const submit = vi.spyOn(api, 'submit').mockRejectedValue(new ApiRequestError('明确拒绝', status));
    const flow = useShipping(); await flow.scan('BOX-1'); await flow.submit(); await flow.submit();
    expect(submit.mock.calls[1][0].requestId).not.toBe(submit.mock.calls[0][0].requestId); expect(flow.object.value).not.toBeNull();
  });
  it.each(['id', 'object', 'version', 'number', 'time', 'pending'])('does not clear or offer logistics on an invalid final receipt: %s', async field => {
    vi.spyOn(api, 'getObject').mockResolvedValue(snapshot('VEHICLE'));
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => {
      const data = receipt(input);
      if (field === 'id') data.requestId = 'wrong';
      if (field === 'object') data.object.containerCode = 'OTHER';
      if (field === 'version') data.object.version = input.version;
      if (field === 'number') data.shippingNo = '';
      if (field === 'time') data.processedTime = 'not a date';
      if (field === 'pending') Object.assign(data, { resultType: 'PENDING' });
      return data;
    });
    const flow = useShipping(); await flow.scan('CAR-1'); await flow.submit();
    expect(flow.object.value).not.toBeNull(); expect(flow.shipped.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  });
  it.each(['panel quantity', 'duplicate panels', 'totals', 'batch', 'location', 'eligibility'])('rejects inconsistent complete WMS query data: %s', async field => {
    const data = snapshot('VEHICLE');
    if (field === 'panel quantity') { data.boxes[0].materials[0].quantity = 2; data.boxes[0].materialQuantity = 2; data.totalMaterialQuantity = 4; }
    if (field === 'duplicate panels') data.boxes[1].materials[0].panelCode = data.boxes[0].materials[0].panelCode;
    if (field === 'totals') data.totalMaterialQuantity = 2;
    if (field === 'batch') Object.assign(data.boxes[0].materials[0], { materialBatch: 123 });
    if (field === 'location') data.object.location = { locationCode: 'KW-1', locationName: '' };
    if (field === 'eligibility') data.eligibility = { allowed: false };
    vi.spyOn(api, 'getObject').mockResolvedValue(data); const submit = vi.spyOn(api, 'submit');
    const flow = useShipping(); await flow.scan('CAR-1'); await flow.submit(); expect(flow.object.value).toBeNull(); expect(submit).not.toHaveBeenCalled();
  });
  it('keeps unknown physical content separate from zero WMS material quantity and accepts optional quantity summaries', async () => {
    const empty = snapshot(); empty.boxes[0].materials = []; empty.boxes[0].materialQuantity = 0; empty.totalMaterialQuantity = 0;
    empty.object.contentState = 'UNKNOWN'; empty.object.runtimeUsage = 'FIXTURE';
    const quantity = snapshot(); quantity.boxes[0].materials = [{ lineType: 'QUANTITY', materialCode: 'MAT-1', orderNo: 'SO-1', quantity: 5 }];
    quantity.boxes[0].materialQuantity = 5; quantity.totalMaterialQuantity = 5;
    vi.spyOn(api, 'getObject').mockResolvedValueOnce(empty).mockResolvedValueOnce(quantity);
    const flow = useShipping(); await flow.scan('BOX-1'); expect(flow.canSubmit.value).toBe(false); expect(flow.object.value?.object.contentState).toBe('UNKNOWN');
    await flow.scan('BOX-1'); expect(flow.canSubmit.value).toBe(true); expect(flow.materials.value[0].panelCode).toBeUndefined();
  });
  it('displays a full backend rejection reason and permits no submission without changing the WMS view', async () => {
    const data = snapshot(); data.eligibility = { allowed: false, reason: '原'.repeat(500) };
    vi.spyOn(api, 'getObject').mockResolvedValue(data); const submit = vi.spyOn(api, 'submit');
    const flow = useShipping(); await flow.scan('BOX-1'); expect(flow.notice.value?.text).toHaveLength(500); await flow.submit();
    expect(flow.object.value).not.toBeNull(); expect(submit).not.toHaveBeenCalled();
  });
  it('keeps WMS detail versions read-only and submits the original whole-object snapshot after closing', async () => {
    const data = snapshot('VEHICLE'); vi.spyOn(api, 'getObject').mockResolvedValue(data);
    vi.spyOn(api, 'getMaterials').mockResolvedValue({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 99 }, sourceSystem: 'WMS',
      materials: data.boxes[0].materials, totalQuantity: 1 });
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => receipt(input)); const flow = useShipping();
    await flow.scan('CAR-1'); await flow.openMaterials('BOX-1'); await flow.submit(); expect(submit).not.toHaveBeenCalled();
    expect(flow.detail.value?.box.version).toBe(99); flow.closeMaterials(); await flow.submit(); expect(submit.mock.lastCall?.[0].version).toBe(7);
  });
  it('does not offer a logistics task when the shipping receipt disallows it', async () => {
    vi.spyOn(api, 'getObject').mockResolvedValue(snapshot('VEHICLE'));
    vi.spyOn(api, 'submit').mockImplementation(async input => ({ ...receipt(input), canCreateLogisticsTask: false }));
    const flow = useShipping(); await flow.scan('CAR-1'); await flow.submit(); expect(flow.shipped.value).toBeNull(); expect(flow.object.value).toBeNull();
  });
  it('drops late detail and receipt responses when hidden and restores an empty active view', async () => {
    const data = snapshot('VEHICLE'); const get = vi.spyOn(api, 'getObject').mockResolvedValue(data);
    let resolveDetail!: (value: Awaited<ReturnType<typeof api.getMaterials>>) => void;
    vi.spyOn(api, 'getMaterials').mockReturnValue(new Promise(done => { resolveDetail = done; }));
    const flow = useShipping(); await flow.scan('CAR-1'); const detail = flow.openMaterials('BOX-1'); flow.pause();
    resolveDetail({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 7 }, sourceSystem: 'WMS', materials: data.boxes[0].materials, totalQuantity: 1 });
    await detail; expect(flow.detail.value).toBeNull(); await flow.scan('CAR-1'); expect(get).toHaveBeenCalledOnce();
    flow.resume(); await flow.scan('CAR-1'); let resolveReceipt!: (value: ShippingReceipt) => void;
    const submit = vi.spyOn(api, 'submit').mockReturnValue(new Promise(done => { resolveReceipt = done; }));
    const pending = flow.submit(); flow.pause(); resolveReceipt(receipt(submit.mock.lastCall![0])); await pending;
    expect(flow.shipped.value).toBeNull(); expect(flow.object.value).toBeNull(); expect(flow.notice.value).toBeNull();
  });
  it('renders optional batch and physical content, clears hidden fields, and uses a fresh query after showing again', async () => {
    const data = snapshot(); data.object.contentState = 'UNKNOWN'; const get = vi.spyOn(api, 'getObject').mockResolvedValue(data);
    const wrapper = mount(ShippingPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } }); hooks.show.forEach(fn => fn()); await flushPromises();
    wrapper.findComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await flushPromises();
    expect(wrapper.text()).toContain('实际内容'); expect(wrapper.text()).toContain('未确认'); expect(wrapper.text()).toContain('批次 000031');
    expect(wrapper.get('.material-sub').text()).toBe('MAT-1'); expect(wrapper.get('.material-quantity').text()).toBe('1');
    hooks.hide.forEach(fn => fn()); await flushPromises(); expect(wrapper.find('.object-card').exists()).toBe(false);
    hooks.show.forEach(fn => fn()); wrapper.findComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await flushPromises(); expect(get).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('retains the completed shipping question on navigation failure without resubmitting and protects late callbacks after hide', async () => {
    vi.spyOn(api, 'getObject').mockResolvedValue(snapshot('VEHICLE', true)); const submit = vi.spyOn(api, 'submit').mockImplementation(async input => receipt(input));
    const navigate = vi.fn(); vi.stubGlobal('uni', { navigateBack: vi.fn(), navigateTo: navigate });
    const wrapper = mount(ShippingPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } }); hooks.show.forEach(fn => fn());
    wrapper.findComponent(ScanInput).vm.$emit('scan', 'KW-1'); await flushPromises(); await wrapper.get('.footer .primary').trigger('tap'); await flushPromises();
    expect(wrapper.find('.object-card').exists()).toBe(false); await wrapper.get('.modal-actions .primary').trigger('tap');
    const first = navigate.mock.lastCall![0] as { url: string; fail: () => void; complete: () => void };
    expect(first.url).toContain('scanCode=CAR-1&shippingNo=SHIP-1'); first.fail(); first.complete(); await flushPromises();
    expect(wrapper.find('[aria-label="是否创建物流任务"]').exists()).toBe(true); expect(wrapper.text()).toContain('成品发货已完成');
    await wrapper.get('.modal-actions .primary').trigger('tap'); expect(navigate).toHaveBeenCalledTimes(2); expect(submit).toHaveBeenCalledOnce();
    const late = navigate.mock.lastCall![0] as { fail: () => void; complete: () => void }; hooks.hide.forEach(fn => fn()); hooks.show.forEach(fn => fn());
    late.fail(); late.complete(); await flushPromises(); expect(wrapper.find('[aria-label="是否创建物流任务"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('无法打开物流任务页面'); wrapper.unmount();
  });
  it('URI-encodes the handoff and releases navigation state on success without creating a task itself', async () => {
    const data = snapshot('VEHICLE', true); data.object.containerCode = 'CAR / 中文?';
    vi.spyOn(api, 'getObject').mockResolvedValue(data);
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => ({ ...receipt(input), shippingNo: 'SHIP / 编号?' }));
    const navigate = vi.fn(); vi.stubGlobal('uni', { navigateBack: vi.fn(), navigateTo: navigate });
    const wrapper = mount(ShippingPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } }); hooks.show.forEach(fn => fn());
    wrapper.findComponent(ScanInput).vm.$emit('scan', 'KW-1'); await flushPromises(); await wrapper.get('.footer .primary').trigger('tap'); await flushPromises();
    await wrapper.get('.modal-actions .primary').trigger('tap');
    const target = navigate.mock.lastCall![0] as { url: string; success: () => void; complete: () => void };
    expect(target.url).toBe('/pages/logistics-create/index?scanCode=CAR%20%2F%20%E4%B8%AD%E6%96%87%3F&shippingNo=SHIP%20%2F%20%E7%BC%96%E5%8F%B7%3F');
    target.success(); target.complete(); await flushPromises(); expect(wrapper.find('.modal-mask').exists()).toBe(false);
    expect(wrapper.get('.footer button').attributes('disabled')).toBeUndefined(); expect(submit).toHaveBeenCalledOnce(); wrapper.unmount();
  });
});
