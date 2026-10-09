import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testRequest } from './helpers/testRequest';
import { resetMockData } from './fixtures/nariBackend';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { usePanelPacking } from '../../composables/usePanelPacking';

const storage = new Map<string, unknown>();
const network = vi.fn(testRequest);
beforeEach(() => {
  vi.useFakeTimers(); storage.clear(); network.mockClear(); resetMockData();
  vi.stubGlobal('uni', { request: network,
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }

describe('panel packing integration with a test backend', () => {
  it('supports nonempty box confirmation, unbind, joint candidates, bind and re-query', async () => {
    seedTestSession();
    const flow = usePanelPacking();
    await finish(flow.scan('BOX-NR-240818'));
    expect(flow.review.value?.totalQuantity).toBe(3);
    await finish(flow.unbindAll());
    expect(flow.box.value?.box.version).toBe(2);
    await finish(flow.scan('MU-240901-0034'));
    await finish(flow.getJoint());
    expect(flow.pending.value).toHaveLength(4);
    await finish(flow.submit());
    expect(flow.box.value).toBeNull();
    const box = await finish(panelPackingApi.getBox('BOX-NR-240818'));
    expect(box.totalQuantity).toBe(4);
    expect(box.box.version).toBe(3);
    expect(network).toHaveBeenCalled();
  });
  it('keeps unknown-code failures local and does not partially bind an invalid batch', async () => {
    seedTestSession();
    const flow = usePanelPacking();
    await finish(flow.scan('BAD'));
    expect(flow.notice.value?.text).toBe('箱子编码不存在');
    const result = panelPackingApi.bind('BOX-1', 1, ['MU-240901-0037', 'BAD']).catch((error: Error) => error.message);
    expect(await finish(result)).toBe('物料唯一码不存在');
    expect((await finish(panelPackingApi.getBox('BOX-1'))).totalQuantity).toBe(0);
    expect(network).toHaveBeenCalled();
  });
  it('queries complete seed-specific joint groups without box data and returns no candidates for empty inputs', async () => {
    seedTestSession();
    expect(await finish(panelPackingApi.getJoint([]))).toEqual({ candidates: [] });
    const first = await finish(panelPackingApi.getJoint(['MU-240901-0038']));
    expect(Object.keys(first)).toEqual(['candidates']);
    expect(first.candidates.map((p) => p.panelCode)).toEqual(['MU-240901-0039', 'MU-240901-0040', 'MU-240901-0041']);
    const both = await finish(panelPackingApi.getJoint(['MU-240901-0042', 'MU-240901-0038', 'MU-240901-0039']));
    expect(both.candidates.map((p) => p.panelCode)).toEqual(['MU-240901-0040', 'MU-240901-0041', 'MU-240901-0043', 'MU-240901-0044', 'MU-240901-0045']);
    await finish(panelPackingApi.bind('BOX-1', 1, ['MU-240901-0040']));
    expect((await finish(panelPackingApi.getJoint(['MU-240901-0038']))).candidates.map((p) => p.panelCode)).toEqual(['MU-240901-0039', 'MU-240901-0041']);
    expect(await finish(panelPackingApi.getJoint(['MU-UNLOAD-0001']))).toEqual({ candidates: [] });
    const failure = panelPackingApi.getJoint(['UNKNOWN']).catch((error: Error) => error.message);
    expect(await finish(failure)).toBe('物料唯一码不存在');
    expect(network).toHaveBeenCalled();
  });
});
