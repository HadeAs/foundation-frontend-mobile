import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { warehouseApplicationApi as api, type ApplicationObject, type ApplicationReceipt } from '../warehouseApplication';
import { useWarehouseApplication } from '../../composables/useWarehouseApplication';
import { ApiRequestError } from '../nariRequest';
import ApplicationPage from '../../pages/warehouse-application/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import type { BoxMaterials } from '../warehouseApplication';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));

const object = (type: 'BOX' | 'VEHICLE' = 'BOX'): ApplicationObject => ({
  scanType: type, scanCode: type === 'BOX' ? 'BOX-1' : 'CAR-1', object: { containerType: type, containerCode: type === 'BOX' ? 'BOX-1' : 'CAR-1', version: 7,
    contentState: 'LOADED' },
  boxes: [{ boxCode: 'BOX-1', version: type === 'BOX' ? 7 : 3, materialQuantity: 1,
    materials: [{ lineType: 'PANEL', panelCode: 'PANEL-1', materialCode: 'MAT-1', materialBatch: '000001', orderNo: 'SO-1', quantity: 1 }] }],
  totalMaterialQuantity: 1, eligibility: { allowed: true }
});
const receipt = (requestId: string): ApplicationReceipt => ({ requestId, applicationNo: 'APPLY-1', sapDocumentNos: ['SAP-1'],
  wmsPendingCreated: true, processedTime: '2026-10-12T01:00:00Z' });
async function ready(value = object()) {
  vi.spyOn(api, 'getObject').mockResolvedValue(value); const flow = useWarehouseApplication(); await flow.scan(value.scanCode); return flow;
}
beforeEach(() => {
  const storage = new Map<string, unknown>();
  hooks.show.length = hooks.hide.length = 0;
  vi.stubGlobal('uni', { navigateBack: vi.fn(), getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('warehouse application 2026-10-12.1', () => {
  it('accepts absent optional names and units while preserving batch text', async () => {
    const flow = await ready();
    const row = flow.orders.value[0].boxes[0].materials[0];
    expect(flow.canSubmit.value).toBe(true);
    expect(row.materialBatch).toBe('000001');
    expect(row.materialName).toBeUndefined(); expect(row.unit).toBeUndefined();
  });
  it('requires exactly one unit per actual panel code', async () => {
    const value = object(); value.boxes[0].materials[0].materialName = '板件'; value.boxes[0].materials[0].unit = '件';
    value.boxes[0].materials[0].quantity = 2; value.boxes[0].materialQuantity = value.totalMaterialQuantity = 2;
    vi.spyOn(api, 'getObject').mockResolvedValue(value); const flow = useWarehouseApplication(); await flow.scan('BOX-1');
    expect(flow.object.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('does not clear on a success-shaped receipt for another request', async () => {
    const flow = await ready(); vi.spyOn(api, 'submit').mockResolvedValue(receipt('47ab7945-b324-4ed4-a10a-af734b83de07'));
    await flow.submit(); expect(flow.object.value).not.toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it.each([false, true])('completes an application when the receipt reports wmsPendingCreated=%s', async wmsPendingCreated => {
    const flow = await ready();
    const submit = vi.spyOn(api, 'submit').mockImplementation(async (_target, _version, id) => ({ ...receipt(id!), wmsPendingCreated }));
    await flow.submit();
    expect(flow.pending.value).toBeNull();
    expect(flow.object.value).toBeNull();
    expect(flow.notice.value).toEqual({ text: '缴库申请成功，缴库单号：SAP-1', error: false });
    expect(submit).toHaveBeenCalledOnce();
  });
  it('preserves the original request and input for manual replay after an uncertain application response', async () => {
    const value = object(); value.boxes[0].materials[0].materialName = '板件'; value.boxes[0].materials[0].unit = '件';
    vi.spyOn(api, 'getObject').mockResolvedValue(value); const flow = useWarehouseApplication(); await flow.scan('BOX-1');
    const submit = vi.spyOn(api, 'submit').mockRejectedValue(new ApiRequestError('申请结果未知', 503));
    await flow.submit(); await flow.submit(); expect(submit.mock.calls[0][2]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  });
  it('accepts quantity summaries and optional batch without inventing an actual panel code', async () => {
    const value = object(); value.boxes[0].materials = [{ lineType: 'QUANTITY', materialCode: 'MAT-2', orderNo: 'SO-2', quantity: 5 }];
    value.boxes[0].materialQuantity = value.totalMaterialQuantity = 5;
    const flow = await ready(value); expect(flow.canSubmit.value).toBe(true);
    const row = flow.orders.value[0].boxes[0].materials[0];
    expect(row.panelCode).toBeUndefined(); expect(row.materialBatch).toBeUndefined();
  });
  it('does not equate zero material bindings or fixture usage with confirmed physical emptiness', async () => {
    const value = object(); value.object.contentState = 'UNKNOWN'; value.object.runtimeUsage = 'FIXTURE';
    value.boxes[0].materials = []; value.boxes[0].materialQuantity = value.totalMaterialQuantity = 0;
    const flow = await ready(value); expect(flow.object.value?.object.contentState).toBe('UNKNOWN');
    expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.text).toBe('当前对象无可处理物料');
  });
  it('rejects duplicate actual panel codes across different boxes in a whole vehicle snapshot', async () => {
    const value = object('VEHICLE'); value.boxes.push({ ...value.boxes[0], boxCode: 'BOX-2' }); value.totalMaterialQuantity = 2;
    const flow = await ready(value); expect(flow.object.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it.each([
    ['invalid optional batch', (value: ApplicationObject) => Object.assign(value.boxes[0].materials[0], { materialBatch: 1 })],
    ['invalid quantity identity', (value: ApplicationObject) => Object.assign(value.boxes[0].materials[0], { lineType: 'QUANTITY' })],
    ['invalid current location', (value: ApplicationObject) => Object.assign(value.object, { location: { locationCode: 'LOC-1' } })],
    ['invalid physical state', (value: ApplicationObject) => Object.assign(value.object, { contentState: 'AVAILABLE' })]
  ] as const)('rejects inconsistent object data (%s) instead of submitting a partial snapshot', async (_name, change) => {
    const value = object(); change(value); const flow = await ready(value); expect(flow.object.value).toBeNull(); expect(flow.canSubmit.value).toBe(false);
  });
  it('uses complete read-only detail from either source and keeps the original application object version', async () => {
    const flow = await ready(object('VEHICLE')); const selected = flow.object.value;
    const query = vi.spyOn(api, 'getMaterials'); const detail: BoxMaterials = { box: { containerType: 'BOX', containerCode: 'BOX-1', version: 99 },
      sourceSystem: 'WMS', materials: object().boxes[0].materials, totalQuantity: 1 };
    for (const sourceSystem of ['LES', 'WMS'] as const) {
      query.mockResolvedValueOnce({ ...detail, sourceSystem }); await flow.openMaterials('BOX-1');
      expect(flow.detail.value?.sourceSystem).toBe(sourceSystem); expect(flow.canSubmit.value).toBe(false);
      const calls = query.mock.calls.length; await flow.openMaterials('BOX-1'); await flow.scan('BOX-1'); await flow.submit(); expect(query).toHaveBeenCalledTimes(calls);
      flow.closeMaterials(); expect(flow.object.value).toBe(selected);
    }
    const submit = vi.spyOn(api, 'submit').mockImplementation(async (_target, _version, id) => receipt(id!)); await flow.submit();
    expect(submit).toHaveBeenCalledWith({ containerType: 'VEHICLE', containerCode: 'CAR-1' }, 7, expect.any(String)); expect(flow.object.value).toBeNull();
  });
  it.each([new Error('网络异常'), new ApiRequestError('结果未知', 503), new ApiRequestError('请求超时', 408)])(
    'replays only the unchanged request manually after %s', async error => {
      const flow = await ready(); const submit = vi.spyOn(api, 'submit').mockRejectedValueOnce(error)
        .mockImplementationOnce(async (_target, _version, id) => receipt(id!));
      await flow.submit(); expect(submit).toHaveBeenCalledOnce(); expect(flow.object.value?.object.version).toBe(7);
      await flow.submit(); expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]); expect(flow.object.value).toBeNull();
    }
  );
  it('submits a new complete request after an explicit refusal without resuming backend stages', async () => {
    const flow = await ready(); const submit = vi.spyOn(api, 'submit').mockRejectedValueOnce(new ApiRequestError('MES 校验失败', 400))
      .mockImplementationOnce(async (_target, _version, id) => receipt(id!));
    await flow.submit(); expect(flow.notice.value?.text).toBe('MES 校验失败'); await flow.submit();
    expect(submit.mock.calls[1][2]).not.toBe(submit.mock.calls[0][2]); expect(submit.mock.calls[1].slice(0, 2)).toEqual(submit.mock.calls[0].slice(0, 2));
  });
  it.each([
    ['BOX', { wmsPendingCreated: false, sapDocumentNos: ['SAP-1', 'SAP-2'] }, '缴库申请成功，缴库单号：SAP-1、SAP-2'],
    ['VEHICLE', { wmsPendingCreated: false, sapDocumentNos: [] }, '缴库申请成功'],
    ['BOX', null, '缴库申请成功'],
    ['VEHICLE', undefined, '缴库申请成功']
  ] as const)('clears pending on the backend success envelope for %s (%j)', async (type, data, message) => {
    const flow = await ready(object(type));
    const requests: unknown[] = [];
    vi.stubGlobal('uni', { ...uni, request(options: UniNamespace.RequestOptions) {
      requests.push(options.data);
      options.success?.({ statusCode: requests.length === 1 ? 503 : 200, header: {}, cookies: [],
        data: requests.length === 1 ? { code: 500, message: '结果待核实' } : { code: 0, message: 'ok', data } });
    } });
    await flow.submit();
    expect(flow.pending.value).not.toBeNull();
    const reopened = useWarehouseApplication();
    await reopened.submit();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(reopened.notice.value).toEqual({ text: message, error: false });
    expect(reopened.pending.value).toBeNull();
    expect(useWarehouseApplication().pending.value).toBeNull();
    expect(reopened.canSubmit.value).toBe(false);
  });
  it('shows processing without a pending warning until the result is unknown', async () => {
    vi.spyOn(api, 'getObject').mockResolvedValue(object());
    let finish!: (result: ApplicationReceipt) => void;
    const post = vi.spyOn(api, 'submit').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = mount(ApplicationPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show());
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1');
      await flushPromises();
      await wrapper.get('.footer .primary').trigger('tap');
      expect(wrapper.text()).toContain('提交中');
      expect(wrapper.find('.pending-submission').exists()).toBe(false);
      finish({ ...receipt(post.mock.calls[0][2]!), wmsPendingCreated: false });
      await flushPromises();
      expect(wrapper.text()).toContain('缴库申请成功');
      expect(wrapper.find('.pending-submission').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it('ignores hidden scans and late detail results after loading a new object', async () => {
    const flow = await ready(object('VEHICLE')); let resolve!: (value: BoxMaterials) => void;
    vi.spyOn(api, 'getMaterials').mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const work = flow.openMaterials('BOX-1'); flow.pause(); await flow.scan(''); expect(flow.notice.value).toBeNull();
    flow.resume(); vi.mocked(api.getObject).mockResolvedValue(object()); await flow.scan('BOX-1');
    resolve({ box: object().object, sourceSystem: 'LES', totalQuantity: 1, materials: object().boxes[0].materials }); await work;
    expect(flow.object.value?.scanType).toBe('BOX'); expect(flow.detail.value).toBeNull(); expect(flow.busy.value).toBe(false);
  });
  it('keeps the original request pending across hide/show without starting an overlapping submission', async () => {
    const flow = await ready(); let reject!: (error: Error) => void;
    const submit = vi.spyOn(api, 'submit').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockRejectedValue(new ApiRequestError('新申请结果未知', 503));
    const old = flow.submit(); const input = submit.mock.calls[0]; flow.pause(); flow.resume(); await flow.scan('BOX-1'); await flow.submit();
    expect(submit).toHaveBeenCalledOnce();
    reject(new ApiRequestError('旧申请被拒绝', 400)); await old; await flow.submit();
    expect(submit).toHaveBeenCalledOnce(); expect(flow.object.value).toBeNull(); expect(flow.notice.value).toBeNull();
    expect(flow.pending.value).toBeNull(); expect(input[2]).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it('shows optional batch and physical state without changing the fixed page workflow, and clears on hiding', async () => {
    vi.spyOn(api, 'getObject').mockResolvedValue(object());
    const wrapper = mount(ApplicationPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show()); expect(wrapper.find('.list-scroll').exists()).toBe(false);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await flushPromises();
      expect(wrapper.text()).toContain('已确认非空'); expect(wrapper.text()).toContain('批次 000001');
      expect(wrapper.get('.material-quantity').text()).toBe('1'); expect(wrapper.text()).not.toContain('undefined');
      expect(wrapper.get('.footer .primary').attributes('disabled')).toBeUndefined();
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.find('.object-card').exists()).toBe(false);
      expect(wrapper.find('.list-scroll').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it('groups a vehicle by order and shows the original boxes, panels, batch and quantities', async () => {
    const value = object('VEHICLE');
    const first = value.boxes[0];
    const panel = first.materials[0];
    first.materials.push({ ...panel, panelCode: 'PANEL-2', orderNo: 'SO-2', materialBatch: '000002' });
    first.materialQuantity = 2;
    value.boxes.push({ ...first, boxCode: 'BOX-2', materialQuantity: 1, materials: [{ ...panel, panelCode: 'PANEL-3' }] });
    value.totalMaterialQuantity = 3;
    vi.spyOn(api, 'getObject').mockResolvedValue(value);
    const wrapper = mount(ApplicationPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show());
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1');
      await flushPromises();
      const [firstOrder, secondOrder] = wrapper.findAll('.order-group');
      expect(firstOrder.get('.order-heading').text()).toMatch(/订单 SO-1\s*2 件/);
      expect(firstOrder.findAll('.box-body').map(box => box.text())).toEqual(['BOX-1', 'BOX-2']);
      expect(firstOrder.findAll('.material-code').map(row => row.text())).toEqual(['PANEL-1', 'PANEL-3']);
      expect(secondOrder.get('.order-heading').text()).toMatch(/订单 SO-2\s*1 件/);
      expect(secondOrder.text()).toContain('PANEL-2');
      expect(secondOrder.text()).toContain('批次 000002');
      expect(value.boxes[0].materials).toHaveLength(2);
    } finally { wrapper.unmount(); }
  });
});
