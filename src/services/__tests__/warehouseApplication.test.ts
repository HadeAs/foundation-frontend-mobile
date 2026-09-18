import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { warehouseApplicationApi as api, type ApplicationObject, type ApplicationReceipt } from '../warehouseApplication';
import { useWarehouseApplication } from '../../composables/useWarehouseApplication';

const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock');
  vi.useFakeTimers();
  storage.clear(); network.mockClear(); resetMockData();
  vi.stubGlobal('uni', { request: network,
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('warehouse application', () => {
  it('queries without scanType; submits the entire object and version once; clears only on full success', async () => {
    const flow = useWarehouseApplication();
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.scan(' CAR-APPLY '));
    expect(transport.mock.lastCall?.[0].data).toEqual({ scanCode: 'CAR-APPLY' });
    expect(flow.object.value?.object.containerType).toBe('VEHICLE');
    expect(flow.object.value?.boxes).toHaveLength(4);
    expect(flow.object.value?.totalMaterialQuantity).toBe(8);
    expect(flow.materials.value).toEqual([]);
    expect(flow.canSubmit.value).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    transport.mockClear();
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.lastCall?.[0].data).toEqual({ requestId: expect.any(String), object: { containerType: 'VEHICLE', containerCode: 'CAR-APPLY' }, version: 1 });
    expect(flow.object.value).toBeNull();
    expect(flow.notice.value?.text).toContain('缴库申请成功，缴库单号：SAP-MOCK-');
    expect((await finish(api.getObject('CAR-APPLY'))).totalMaterialQuantity).toBe(8);
    expect(network).not.toHaveBeenCalled();
  });
  it('replaces scans directly and rejects the removed demo code without retaining old data', async () => {
    const flow = useWarehouseApplication();
    await finish(flow.scan('CAR-APPLY'));
    await finish(flow.scan('BOX-NR-240818'));
    expect(flow.materials.value).toHaveLength(3);
    await finish(flow.scan('BOX-APPLY-QUANTITY'));
    expect(flow.object.value).toBeNull();
    expect(flow.notice.value?.text).toBe('载具或箱子编码不存在');
    await finish(flow.scan('UNKNOWN'));
    expect(flow.object.value).toBeNull();
    expect(flow.canSubmit.value).toBe(false);
    expect(flow.notice.value?.text).toBe('载具或箱子编码不存在');
    await finish(flow.scan('CONTAINER-AMBIGUOUS'));
    expect(flow.notice.value?.text).toContain('无法唯一识别');
    await finish(flow.scan('BOX-NR-240818'));
    expect(flow.materials.value).toHaveLength(3);
    const get = vi.spyOn(api, 'getObject');
    await flow.scan('X'.repeat(129));
    await flow.scan('   ');
    expect(get).not.toHaveBeenCalled();
    expect(flow.object.value).toBeNull();
  });
  it('disables empty and ineligible objects and preserves complete long lists', async () => {
    const flow = useWarehouseApplication();
    const submit = vi.spyOn(api, 'submit');
    for (const code of ['BOX-1', 'CAR-EMPTY', 'BOX-APPLY-BLOCKED']) {
      await finish(flow.scan(code));
      expect(flow.object.value).not.toBeNull();
      expect(flow.canSubmit.value).toBe(false);
      await flow.submit();
    }
    expect(submit).not.toHaveBeenCalled();
    await finish(flow.scan('CAR-APPLY-LONG'));
    expect(flow.object.value?.boxes).toHaveLength(30);
    expect(flow.object.value?.totalMaterialQuantity).toBe(30);
    await finish(flow.scan('BOX-LONG'));
    expect(flow.materials.value).toHaveLength(30);
  });
  it('loads read-only box detail with context, locks background actions, and keeps the submission snapshot', async () => {
    const flow = useWarehouseApplication();
    await finish(flow.scan('CAR-APPLY'));
    const selected = flow.object.value;
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.openMaterials('BOX-APPLY-01'));
    expect(transport.mock.lastCall?.[0].data).toEqual({ boxCode: 'BOX-APPLY-01', context: 'WAREHOUSE_APPLICATION' });
    expect(flow.detail.value?.materials).toHaveLength(1);
    expect(flow.canSubmit.value).toBe(false);
    await flow.scan('BOX-1'); await flow.submit();
    expect(flow.object.value).toBe(selected);
    expect(transport).toHaveBeenCalledOnce();
    flow.closeMaterials();
    expect(flow.detail.value).toBeNull();
    await flow.openMaterials('FOREIGN');
    expect(transport).toHaveBeenCalledOnce();
    await finish(flow.openMaterials('BOX-APPLY-DETAIL-FAIL'));
    expect(flow.detail.value).toBeNull();
    expect(flow.notice.value?.text).toBe('箱内物料查询失败，请重试');
    expect(flow.object.value).toBe(selected);
    expect(flow.canSubmit.value).toBe(true);
  });
  it.each(['MES', 'SAP', 'WMS'])('retains state on %s failure with no automatic retries; manual retry sends a new UUID', async (stage) => {
    const flow = useWarehouseApplication();
    await finish(flow.scan(`BOX-APPLY-${stage}-FAIL`));
    const selected = flow.object.value;
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain(stage);
    expect(flow.notice.value?.error).toBe(true);
    expect(flow.object.value).toBe(selected);
    expect(transport).toHaveBeenCalledOnce();
    const first = (transport.mock.lastCall?.[0].data as { requestId: string }).requestId;
    await finish(flow.submit());
    expect((transport.mock.lastCall?.[0].data as { requestId: string }).requestId).not.toBe(first);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('detects latest container versions before submission without changing material bindings', async () => {
    const flow = useWarehouseApplication();
    await finish(flow.scan('BOX-NR-240818'));
    await finish(panelPackingApi.unbindAll('BOX-NR-240818', 1));
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('对象信息已变化');
    expect(flow.object.value?.totalMaterialQuantity).toBe(3);
    expect((await finish(panelPackingApi.getBox('BOX-NR-240818'))).totalQuantity).toBe(0);
  });
  it('rejects incomplete/mismatched objects and partial success receipts, preserving state', async () => {
    const flow = useWarehouseApplication();
    const valid = await finish(api.getObject('BOX-NR-240818'));
    const get = vi.spyOn(api, 'getObject');
    for (const invalid of [{ ...valid, totalMaterialQuantity: 2 }, { ...valid, scanType: 'LOCATION' },
      { ...valid, boxes: [...valid.boxes, ...valid.boxes] }, { ...valid, boxes: [{ ...valid.boxes[0], version: 0 }] }]) {
      get.mockResolvedValueOnce(invalid as ApplicationObject);
      await flow.scan('BOX-NR-240818');
      expect(flow.object.value).toBeNull();
      expect(flow.notice.value?.error).toBe(true);
    }
    get.mockRestore();
    await finish(flow.scan('BOX-NR-240818'));
    const receipt: ApplicationReceipt = { requestId: 'id', applicationNo: 'JK-1', sapDocumentNos: ['SAP-1', 'SAP-2'], wmsPendingCreated: true, processedTime: '2026-09-17T00:00:00Z' };
    const submit = vi.spyOn(api, 'submit');
    for (const invalid of [{ ...receipt, wmsPendingCreated: false }, { ...receipt, sapDocumentNos: [] }]) {
      submit.mockResolvedValueOnce(invalid);
      await flow.submit();
      expect(flow.object.value).not.toBeNull();
      expect(flow.notice.value?.text).toContain('未能确认全部处理成功');
    }
    submit.mockResolvedValueOnce(receipt);
    await flow.submit();
    expect(flow.object.value).toBeNull();
    expect(flow.notice.value?.text).toContain('SAP-1、SAP-2');
  });
  it('drops late scan/detail/submit results after clearing and blocks concurrent operations', async () => {
    const flow = useWarehouseApplication();
    const query = flow.scan('CAR-APPLY');
    await flow.scan('BOX-1');
    flow.clear(); await finish(query);
    expect(flow.object.value).toBeNull();
    await finish(flow.scan('CAR-APPLY'));
    const detail = flow.openMaterials('BOX-APPLY-01');
    flow.clear(); await finish(detail);
    expect(flow.detail.value).toBeNull();
    await finish(flow.scan('BOX-NR-240818'));
    const submit = flow.submit();
    expect(flow.disabled.value).toBe(true);
    flow.clear(); await finish(submit);
    expect(flow.notice.value).toBeNull();
    expect(flow.object.value).toBeNull();
  });
});
