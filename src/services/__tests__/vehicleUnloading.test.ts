import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockData } from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { useVehicleUnloading } from '../../composables/useVehicleUnloading';
import { vehicleLoadingApi as api, type VehicleLoads } from '../vehicleLoading';
import * as mock from '../mockApi';

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
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }


describe('vehicle unloading Mock workflow', () => {
  beforeEach(async () => { seedTestSession(); });
  it('loads all slots but selects only loaded boxes, matches locally and keeps repeated scans checked', async () => {
    const flow = useVehicleUnloading();
    const query = vi.spyOn(api, 'getLoads');
    await finish(flow.scan(' CAR-NR-0098 '));
    expect(flow.vehicle.value!.loads.length).toBeGreaterThan(flow.loaded.value.length);
    expect(flow.loaded.value).toHaveLength(1);
    await flow.scan('BOX-LOADED');
    const id = flow.selected.value[0];
    await flow.scan('BOX-LOADED');
    expect(flow.selected.value).toEqual([id]);
    expect(flow.notice.value?.text).toContain('已勾选');
    await flow.scan('SLOT-OCCUPIED');
    expect(flow.notice.value?.text).toContain('未在当前载具');
    flow.toggle('SLOT-01');
    expect(flow.selected.value).toEqual([id]);
    expect(query).toHaveBeenCalledOnce();
    flow.toggle(id);
    expect(flow.selected.value).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });
  it('confirms selected IDs/versions, clears on success and preserves materials and other boxes', async () => {
    const flow = useVehicleUnloading();
    await finish(flow.scan('CAR-UNLOAD'));
    await flow.scan('BOX-UNLOAD-01');
    const selected = flow.loaded.value[0];
    const materials = (await finish(panelPackingApi.getBox('BOX-UNLOAD-01'))).bindings;
    const unload = vi.spyOn(api, 'unloadSelected');
    flow.requestUnload('selected');
    flow.cancel();
    await flow.submit();
    expect(unload).not.toHaveBeenCalled();
    expect(flow.selected.value).toEqual([selected.id]);
    flow.requestUnload('selected');
    expect(flow.confirmCount.value).toBe(1);
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(unload).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledWith('CAR-UNLOAD', 1, [{ id: selected.id, version: selected.version }]);
    expect(flow.vehicle.value).toBeNull();
    expect(flow.selected.value).toEqual([]);
    expect(flow.confirmation.value).toBeNull();
    expect(flow.notice.value?.text).toBe('卸载成功');
    const result = await finish(api.getLoads('CAR-UNLOAD'));
    expect(result.loadedBoxCount).toBe(2);
    expect(result.vehicle.version).toBe(2);
    expect(result.loads[0]).toMatchObject({ slotVersion: 2, materials: [] });
    expect(result.loads[0].id).toBeUndefined();
    const box = await finish(panelPackingApi.getBox('BOX-UNLOAD-01'));
    expect(box.bindings).toEqual(materials);
    expect(box.box.version).toBe(2);
    expect((await finish(api.getBox('BOX-UNLOAD-01'))).loadedSlotCode).toBeUndefined();
  });
  it('unloads all independently of selection, supports empty vehicles and load/unload/reload', async () => {
    const flow = useVehicleUnloading();
    await finish(flow.scan('CAR-UNLOAD'));
    await flow.scan('BOX-UNLOAD-02');
    flow.requestUnload('all');
    expect(flow.confirmCount.value).toBe(3);
    await finish(flow.submit());
    await finish(flow.scan('CAR-UNLOAD'));
    expect(flow.loaded.value).toHaveLength(0);
    flow.requestUnload('all');
    expect(flow.confirmation.value).toBeNull();
    await finish(api.load([{ slotCode: 'SLOT-UNLOAD-01', slotVersion: 2, boxCode: 'BOX-UNLOAD-01', boxVersion: 2 }]));
    flow.clear();
    await finish(flow.scan('CAR-UNLOAD'));
    expect(flow.loaded.value).toHaveLength(1);
    expect(flow.loaded.value[0].id).toBeTruthy();
    flow.requestUnload('all');
    await finish(flow.submit());
    expect((await finish(api.getSlot('SLOT-UNLOAD-01'))).eligibility.allowed).toBe(true);
    for (const code of ['CAR-EMPTY', 'CAR-NR-0099']) {
      flow.clear();
      await finish(flow.scan(code));
      expect(flow.vehicle.value).not.toBeNull();
      expect(flow.loaded.value).toEqual([]);
      flow.requestUnload('selected');
      flow.requestUnload('all');
      expect(flow.confirmation.value).toBeNull();
    }
  });
  it('rejects stale relationship versions atomically and foreign/duplicate IDs', async () => {
    const result = await finish(api.getLoads('CAR-UNLOAD'));
    const row = result.loads[0];
    const other = (await finish(api.getLoads('CAR-NR-0098'))).loads.find((x) => x.box)!;
    for (const items of [
      [{ id: row.id!, version: row.version! }, { id: result.loads[1].id!, version: 99 }],
      [{ id: other.id!, version: other.version! }],
      [{ id: row.id!, version: row.version! }, { id: row.id!, version: row.version! }]
    ]) {
      const failure = api.unloadSelected('CAR-UNLOAD', 1, items).catch((e: Error) => e.message);
      expect(await finish(failure)).toBeTypeOf('string');
      expect((await finish(api.getLoads('CAR-UNLOAD'))).loadedBoxCount).toBe(3);
    }
    expect((await finish(api.getSlot('SLOT-UNLOAD-01'))).version).toBe(1);
  });
  it('keeps selections/dialog on backend failure and retries with a new request ID', async () => {
    const flow = useVehicleUnloading();
    const requests = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.scan('CAR-UNLOAD-FAIL'));
    await flow.scan('BOX-UNLOAD-FAIL-01');
    flow.requestUnload('selected');
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('暂不允许卸载');
    expect(flow.confirmation.value).toBe('selected');
    expect(flow.selected.value).toHaveLength(1);
    await finish(flow.submit());
    const calls = requests.mock.calls.filter(([options]) => options.url.endsWith('/unload-selected'));
    expect(calls).toHaveLength(2);
    const ids = calls.map(([options]) => (options.data as { requestId: string }).requestId);
    expect(ids[0]).not.toBe(ids[1]);
    expect((await finish(api.getLoads('CAR-UNLOAD-FAIL'))).loadedBoxCount).toBe(2);
  });
  it('invalidates vehicle snapshots when box contents change', async () => {
    const flow = useVehicleUnloading();
    await finish(flow.scan('CAR-UNLOAD'));
    await finish(panelPackingApi.unbindAll('BOX-UNLOAD-01', 1));
    flow.requestUnload('all');
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('载具装载信息已变化');
    expect(flow.vehicle.value).not.toBeNull();
    expect((await finish(api.getLoads('CAR-UNLOAD'))).loadedBoxCount).toBe(3);
  });
  it('ignores late responses, blocks modal/busy edits and caps only selected batches', async () => {
    const flow = useVehicleUnloading();
    const pending = flow.scan('CAR-UNLOAD');
    await flow.scan('CAR-LONG');
    flow.clear();
    await finish(pending);
    expect(flow.vehicle.value).toBeNull();
    await finish(flow.scan('UNKNOWN'));
    expect(flow.notice.value?.text).toBe('载具编码不存在');
    await finish(flow.scan('CAR-LONG'));
    expect(flow.loaded.value).toHaveLength(30);
    flow.requestUnload('all');
    await flow.scan('BOX-LONG-01');
    flow.toggle(flow.loaded.value[0].id);
    expect(flow.selected.value).toEqual([]);
    const submitting = flow.submit();
    flow.cancel();
    expect(flow.confirmation.value).toBe('all');
    flow.clear();
    await finish(submitting);
    expect(flow.vehicle.value).toBeNull();
    expect(flow.notice.value).toBeNull();
    await finish(flow.scan('CAR-UNLOAD'));
    const sample = flow.loaded.value[0];
    flow.vehicle.value = { ...flow.vehicle.value!, loadedBoxCount: 1001, loads: Array.from({ length: 1001 }, (_, i) => ({
      ...sample, id: String(10000 + i), slotCode: 'SLOT-' + i, box: { ...sample.box, containerCode: 'BOX-' + i }
    })) };
    flow.selected.value = flow.loaded.value.map((row) => row.id);
    flow.requestUnload('selected');
    expect(flow.notice.value?.text).toContain('1000');
    expect(flow.confirmation.value).toBeNull();
    flow.requestUnload('all');
    expect(flow.confirmCount.value).toBe(1001);
  });
  it('rejects inconsistent or incomplete snapshots before local scan matching', async () => {
    const result = await finish(api.getLoads('CAR-UNLOAD'));
    const invalid: VehicleLoads[] = [
      { ...result, loadedBoxCount: 2 },
      { ...result, totalMaterialQuantity: 99 },
      { ...result, loads: [result.loads[0], result.loads[0]] },
      { ...result, loads: [{ ...result.loads[0], id: undefined }] },
      { ...result, loads: [{ ...result.loads[0], box: undefined }] },
      { ...result, vehicle: { ...result.vehicle, containerCode: 'OTHER' } }
    ];
    const query = vi.spyOn(api, 'getLoads');
    for (const data of invalid) {
      const flow = useVehicleUnloading();
      query.mockResolvedValueOnce(data);
      await flow.scan('CAR-UNLOAD');
      expect(flow.vehicle.value).toBeNull();
      expect(flow.notice.value?.error).toBe(true);
    }
  });
});
