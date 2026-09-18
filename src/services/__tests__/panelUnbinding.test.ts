import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, isMockApi } from '../apiTransport';
import { resetMockData } from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { usePanelUnbinding } from '../../composables/usePanelUnbinding';

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



describe('panel unbinding Mock workflow', () => {
  beforeEach(async () => { seedTestSession(); });
  it('loads full bindings, matches codes locally, and never unchecks on repeated scan', async () => {
    const flow = usePanelUnbinding();
    const query = vi.spyOn(panelPackingApi, 'getBox');
    const panelQuery = vi.spyOn(panelPackingApi, 'getPanel');
    await finish(flow.scan(' BOX-NR-240818 '));
    expect(flow.box.value?.bindings).toHaveLength(3);
    await flow.scan('MU-240901-0034');
    const id = flow.selected.value[0];
    await flow.scan('MU-240901-0034');
    expect(flow.selected.value).toEqual([id]);
    expect(flow.notice.value?.text).toContain('已勾选');
    await flow.scan('UNKNOWN');
    expect(flow.notice.value?.text).toContain('未在当前箱');
    expect(query).toHaveBeenCalledTimes(1);
    expect(panelQuery).not.toHaveBeenCalled();
    flow.toggle(id);
    expect(flow.selected.value).toEqual([]);
    query.mockRestore();
    panelQuery.mockRestore();
  });
  it('requires confirmation, sends persisted IDs/versions and preserves unselected bindings', async () => {
    const flow = usePanelUnbinding();
    const submit = vi.spyOn(panelPackingApi, 'unbindSelected');
    await finish(flow.scan('BOX-NR-240818'));
    await flow.scan('MU-240901-0034');
    const item = flow.box.value!.bindings[0];
    flow.requestUnbind('selected');
    flow.cancel();
    await finish(flow.submit());
    expect(submit).not.toHaveBeenCalled();
    expect(flow.selected.value).toEqual([item.id]);
    flow.requestUnbind('selected');
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('BOX-NR-240818', 1, [{ id: item.id, version: item.version }]);
    expect(flow.box.value).toBeNull();
    expect(flow.selected.value).toEqual([]);
    expect(flow.notice.value?.text).toBe('解绑成功');
    const result = await finish(panelPackingApi.getBox('BOX-NR-240818'));
    expect(result.bindings).toHaveLength(2);
    expect(result.bindings.some((row) => row.id === item.id)).toBe(false);
    expect(network).not.toHaveBeenCalled();
    submit.mockRestore();
  });
  it('unbinds the entire box regardless of selection and handles empty boxes', async () => {
    const flow = usePanelUnbinding();
    await finish(flow.scan('BOX-NR-240818'));
    flow.requestUnbind('all');
    expect(flow.confirmCount.value).toBe(3);
    await finish(flow.submit());
    await finish(flow.scan('BOX-NR-240818'));
    expect(flow.box.value?.empty).toBe(true);
    flow.requestUnbind('all');
    expect(flow.confirmation.value).toBeNull();
  });
  it('handles BY_ORDER as a whole row without inventing a unique panel code', async () => {
    await finish(panelPackingApi.bindByOrder('BOX-1', 1, 'SO-20260901-018', 12));
    const flow = usePanelUnbinding();
    await finish(flow.scan('BOX-1'));
    await flow.scan('MU-240901-0034');
    expect(flow.selected.value).toEqual([]);
    flow.toggle(flow.box.value!.bindings[0].id);
    flow.requestUnbind('selected');
    expect(flow.confirmCount.value).toBe(1);
    await finish(flow.submit());
    expect((await finish(panelPackingApi.getBox('BOX-1'))).totalQuantity).toBe(0);
  });
  it('keeps failure state and rejects stale per-row versions atomically', async () => {
    const flow = usePanelUnbinding();
    await finish(flow.scan('BOX-NR-240818'));
    const rows = flow.box.value!.bindings;
    const error = panelPackingApi.unbindSelected('BOX-NR-240818', 1, [
      { id: rows[0].id, version: rows[0].version }, { id: rows[1].id, version: 99 }
    ]).catch((e: Error) => e.message);
    expect(await finish(error)).toContain('绑定记录已变化');
    expect((await finish(panelPackingApi.getBox('BOX-NR-240818'))).bindings).toHaveLength(3);
    await flow.scan('MU-240901-0034');
    await finish(panelPackingApi.unbindAll('BOX-NR-240818', 1));
    flow.requestUnbind('selected');
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('箱内绑定已变化');
    expect(flow.box.value).not.toBeNull();
    expect(flow.selected.value).toHaveLength(1);
    expect(flow.confirmation.value).toBe('selected');
  });
  it('ignores late query after clearing and resets failed queries safely', async () => {
    const flow = usePanelUnbinding();
    const loading = flow.scan('BOX-NR-240818');
    flow.clear();
    await finish(loading);
    expect(flow.box.value).toBeNull();
    await finish(flow.scan('BAD'));
    expect(flow.box.value).toBeNull();
    expect(flow.notice.value?.text).toBe('箱子编码不存在');
  });
});
