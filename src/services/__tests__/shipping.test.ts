import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { locationBindingApi } from '../locationBinding';
import { vehicleLoadingApi } from '../vehicleLoading';
import { shippingApi as api, shippingRequest, type ShippingObject } from '../shipping';
import { useShipping } from '../../composables/useShipping';

const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock'); vi.useFakeTimers();
  storage.clear(); network.mockClear(); resetMockData();
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('shipping', () => {
  it('identifies three scan types without guessing; replaces scans and rejects unknown/ambiguous/empty locations', async () => {
    const flow = useShipping();
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    for (const [code, scanType, type] of [['CAR-SHIP', 'VEHICLE', 'VEHICLE'], ['BOX-SHIP-SINGLE', 'BOX', 'BOX'], ['KW-SHIP-CAR', 'LOCATION', 'VEHICLE'], ['KW-SHIP-BOX', 'LOCATION', 'BOX']]) {
      await finish(flow.scan(` ${code} `));
      expect(transport.mock.lastCall?.[0].data).toEqual({ scanCode: code });
      expect(flow.object.value?.scanType).toBe(scanType);
      expect(flow.object.value?.object.containerType).toBe(type);
      expect(flow.canSubmit.value).toBe(true);
    }
    for (const code of ['UNKNOWN', 'CONTAINER-AMBIGUOUS', 'KW-SHIP-EMPTY']) {
      await finish(flow.scan(code));
      expect(flow.object.value).toBeNull();
      expect(flow.notice.value?.error).toBe(true);
    }
    const get = vi.spyOn(api, 'getObject');
    await flow.scan(' '); await flow.scan('X'.repeat(129));
    expect(get).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
  it('keeps full lists, disables empty/blocked objects and requests box details with SHIPPING context', async () => {
    const flow = useShipping();
    for (const code of ['BOX-SHIP-EMPTY', 'BOX-SHIP-BLOCKED', 'CAR-EMPTY']) {
      await finish(flow.scan(code));
      expect(flow.canSubmit.value).toBe(false);
      expect(flow.notice.value?.error).toBe(true);
    }
    await finish(flow.scan('BOX-SHIP-LONG'));
    expect(flow.materials.value).toHaveLength(30);
    await finish(flow.scan('CAR-SHIP-LONG'));
    expect(flow.object.value?.boxes).toHaveLength(30);
    await finish(flow.scan('CAR-SHIP'));
    const object = flow.object.value;
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.openMaterials('BOX-SHIP-01'));
    expect(transport.mock.lastCall?.[0].data).toEqual({ boxCode: 'BOX-SHIP-01', context: 'SHIPPING' });
    expect(flow.detail.value?.sourceSystem).toBe('WMS');
    expect(flow.detail.value?.materials).toHaveLength(1);
    expect(flow.disabled.value).toBe(true);
    await flow.scan('BOX-SHIP-SINGLE'); await flow.submit();
    expect(flow.object.value).toBe(object);
    flow.closeMaterials();
    await flow.openMaterials('FOREIGN');
    expect(transport).toHaveBeenCalledOnce();
    await finish(flow.openMaterials('BOX-SHIP-DETAIL-FAIL'));
    expect(flow.detail.value).toBeNull();
    expect(flow.notice.value?.text).toBe('箱内物料查询失败，请重试');
    expect(flow.object.value).toBe(object);
  });
  it('submits the original location and resolved container; clears success and respects the follow-up flag', async () => {
    const flow = useShipping();
    await finish(flow.scan('KW-SHIP-CAR'));
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.lastCall?.[0].data).toEqual({ requestId: expect.any(String), scanType: 'LOCATION', scanCode: 'KW-SHIP-CAR',
      object: { containerType: 'VEHICLE', containerCode: 'CAR-SHIP' }, version: 1 });
    expect(flow.object.value).toBeNull();
    expect(flow.shipped.value?.object.containerCode).toBe('CAR-SHIP');
    expect(flow.disabled.value).toBe(true);
    await flow.scan('BOX-SHIP-SINGLE');
    expect(flow.object.value).toBeNull();
    flow.dismissLogistics();
    expect(flow.disabled.value).toBe(false);
    for (const code of ['KW-SHIP-BOX', 'CAR-SHIP-NO-TASK']) {
      await finish(flow.scan(code)); await finish(flow.submit());
      expect(flow.object.value).toBeNull();
      expect(flow.shipped.value).toBeNull();
      expect(flow.notice.value?.text).toContain('成品发货成功');
    }
  });
  it('replaces only scoped LES material relations, clears WMS and retains load/location relations and other boxes', async () => {
    const old = await finish(panelPackingApi.getBox('BOX-SHIP-SINGLE'));
    const other = await finish(panelPackingApi.getBox('BOX-NR-240818'));
    const object = await finish(api.getObject('BOX-SHIP-SINGLE'));
    const input = shippingRequest(object);
    const receipt = await finish(api.submit(input));
    const les = await finish(panelPackingApi.getBox('BOX-SHIP-SINGLE'));
    expect(les.bindings).toHaveLength(3);
    expect(les.bindings.map((row) => row.panelCode)).toEqual(object.boxes[0].materials.map((row) => row.panelCode));
    expect(les.box.version).toBe(old.box.version + 1);
    expect((await finish(api.getMaterials('BOX-SHIP-SINGLE'))).materials).toEqual([]);
    expect((await finish(api.getObject('BOX-SHIP-SINGLE'))).totalMaterialQuantity).toBe(0);
    expect(await finish(panelPackingApi.getBox('BOX-NR-240818'))).toEqual(other);
    expect((await finish(locationBindingApi.getLocation('KW-SHIP-BOX'))).container?.containerCode).toBe('BOX-SHIP-SINGLE');
    // Same logical request returns its original receipt, not a second mutation.
    expect(await finish(api.submit(input))).toEqual(receipt);
    expect((await finish(panelPackingApi.getBox('BOX-SHIP-SINGLE'))).box.version).toBe(les.box.version);
    const bad = api.submit({ ...input, version: input.version + 1 });
    const check = expect(bad).rejects.toThrow('相同请求标识'); await finish(check);
    const before = await finish(vehicleLoadingApi.getLoads('CAR-SHIP'));
    await finish(api.submit(shippingRequest(await finish(api.getObject('CAR-SHIP')))));
    const after = await finish(vehicleLoadingApi.getLoads('CAR-SHIP'));
    expect(after.loads.map((row) => [row.id, row.slotCode, row.box?.containerCode])).toEqual(before.loads.map((row) => [row.id, row.slotCode, row.box?.containerCode]));
    expect(after.vehicle.version).toBe(before.vehicle.version + 1);
  });
  it('preserves failed submissions for manual retry with a fresh request id, no automatic retry', async () => {
    const flow = useShipping();
    await finish(flow.scan('BOX-SHIP-FAIL'));
    const object = flow.object.value;
    const submit = vi.spyOn(api, 'submit');
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('WMS 数据校验未通过');
    expect(flow.object.value).toBe(object);
    expect(flow.canSubmit.value).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    await finish(flow.submit());
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0].requestId).not.toBe(submit.mock.calls[1][0].requestId);
    expect((await finish(api.getObject('BOX-SHIP-FAIL'))).totalMaterialQuantity).toBe(3);
  });
  it('rechecks location relationships and aggregate versions at submit', async () => {
    const flow = useShipping();
    await finish(flow.scan('KW-SHIP-BOX'));
    const location = await finish(locationBindingApi.getLocation('KW-SHIP-BOX'));
    await finish(locationBindingApi.unbind({ locationCode: 'KW-SHIP-BOX', version: location.version, container: { containerType: 'BOX', containerCode: 'BOX-SHIP-SINGLE' }, containerVersion: location.container!.version }));
    await finish(flow.submit());
    expect(flow.notice.value?.error).toBe(true);
    expect(flow.object.value).not.toBeNull();
    await finish(flow.scan('BOX-SHIP-SINGLE'));
    await finish(panelPackingApi.unbindAll('BOX-SHIP-SINGLE', flow.object.value!.object.version));
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('对象信息已变化');
  });
  it('ignores late responses after clear and rejects incomplete object or receipt data', async () => {
    const flow = useShipping();
    const pending = flow.scan('CAR-SHIP'); flow.clear(); await finish(pending);
    expect(flow.object.value).toBeNull();
    const valid = await finish(api.getObject('CAR-SHIP'));
    vi.spyOn(api, 'getObject').mockResolvedValueOnce({ ...valid, totalMaterialQuantity: 999 });
    await flow.scan('CAR-SHIP');
    expect(flow.object.value).toBeNull();
    expect(flow.notice.value?.text).toContain('信息不完整');
    await finish(flow.scan('CAR-SHIP'));
    vi.spyOn(api, 'submit').mockResolvedValueOnce({ requestId: 'wrong-id', shippingNo: 'SHIP-1', object: valid.object, canCreateLogisticsTask: true, processedTime: new Date().toISOString() });
    await flow.submit();
    expect(flow.object.value).not.toBeNull();
    expect(flow.shipped.value).toBeNull();
    expect(flow.notice.value?.text).toContain('发货结果不完整');
    let resolve!: (value: ShippingObject) => void;
    vi.spyOn(api, 'getObject').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const old = flow.scan('CAR-SHIP'); flow.clear(); resolve(valid); await old;
    expect(flow.object.value).toBeNull();
  });
});
