import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, isMockApi } from '../apiTransport';
import { resetMockData } from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { useOrderPacking } from '../../composables/useOrderPacking';

const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
beforeEach(() => {
  vi.stubEnv('VITE_API_MODE', 'mock');
  vi.useFakeTimers();
  storage.clear();
  network.mockClear();
  resetMockData();
  vi.stubGlobal('uni', {
    request: network,
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key)
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }


describe('order packing Mock workflow', () => {
  beforeEach(async () => { seedTestSession(); });
  it('rejects a nonempty box when declined and keeps the updated box after unbinding', async () => {
    const flow = useOrderPacking();
    await finish(flow.scan('BOX-NR-240818'));
    expect(flow.box.value).toBeNull();
    expect(flow.review.value?.totalQuantity).toBe(3);
    flow.clear();
    expect(flow.review.value).toBeNull();
    expect((await finish(panelPackingApi.getBox('BOX-NR-240818'))).totalQuantity).toBe(3);
    await finish(flow.scan('BOX-NR-240818'));
    await finish(flow.unbindAll());
    expect(flow.box.value?.box.version).toBe(2);
    expect(flow.review.value).toBeNull();
  });
  it('looks up an already bound panel order and submits only order quantity, then resets', async () => {
    const flow = useOrderPacking();
    await finish(flow.scan(' BOX-1 '));
    await finish(flow.scan('MU-240901-0034'));
    expect(flow.order.value).toBe('SO-20260901-018');
    flow.quantity.value = '12';
    await finish(flow.submit());
    expect(flow.box.value).toBeNull();
    expect(flow.order.value).toBe('');
    expect(flow.quantity.value).toBe('');
    expect(flow.notice.value?.text).toBe('装箱成功');
    const result = await finish(panelPackingApi.getBox('BOX-1'));
    expect(result.totalQuantity).toBe(12);
    expect(result.bindings[0].bindingMode).toBe('BY_ORDER');
    expect(result.bindings[0].panelCode).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });
  it('validates quantities, preserves failed input, and accepts a corrected manual order', async () => {
    const flow = useOrderPacking();
    await finish(flow.scan('BOX-1'));
    flow.order.value = 'UNKNOWN';
    for (const value of ['', '0', '-1', '1.5', '1e2', '2147483648']) {
      flow.quantity.value = value;
      expect(flow.canSubmit.value).toBe(false);
    }
    flow.quantity.value = '2147483647';
    expect(flow.canSubmit.value).toBe(true);
    flow.quantity.value = '2';
    await finish(flow.submit());
    expect(flow.notice.value?.text).toBe('订单不存在或无法唯一解析物料');
    expect(flow.order.value).toBe('UNKNOWN');
    expect(flow.box.value).not.toBeNull();
    flow.order.value = ' SO-20260901-019 ';
    await finish(flow.submit());
    expect(flow.box.value).toBeNull();
  });
  it('ignores late responses after reset and prevents duplicate submissions', async () => {
    const flow = useOrderPacking();
    const scanning = flow.scan('BOX-1');
    flow.clear();
    await finish(scanning);
    expect(flow.box.value).toBeNull();
    await finish(flow.scan('BOX-1'));
    flow.order.value = 'SO-20260901-018';
    flow.quantity.value = '2';
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect((await finish(panelPackingApi.getBox('BOX-1'))).totalQuantity).toBe(2);
  });
  it('preserves box and order on unknown scan or version conflict', async () => {
    const flow = useOrderPacking();
    await finish(flow.scan('BOX-1'));
    flow.order.value = 'SO-20260901-018';
    await finish(flow.scan('BAD'));
    expect(flow.order.value).toBe('SO-20260901-018');
    await finish(panelPackingApi.bindByOrder('BOX-1', 1, 'SO-20260901-018', 1));
    flow.quantity.value = '2';
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('绑定已变化');
    expect(flow.box.value?.box.version).toBe(1);
    expect(flow.quantity.value).toBe('2');
  });
});
