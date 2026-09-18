import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockData } from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { useVehicleLoading } from '../../composables/useVehicleLoading';

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


import { vehicleLoadingApi as api } from '../vehicleLoading';

describe('vehicle loading Mock workflow', () => {
  beforeEach(async () => { seedTestSession(); });
  it('scans slot then box, supports different vehicles, submits versions and clears on success', async () => {
    const flow = useVehicleLoading();
    await finish(flow.scan(' SLOT-01 '));
    expect(flow.pairs.value[0].slot.vehicle.containerCode).toBe('CAR-NR-0098');
    expect(flow.pending.value?.box).toBeNull();
    expect(flow.canSubmit.value).toBe(false);
    await finish(flow.scan('BOX-1'));
    await finish(flow.scan('SLOT-07'));
    await finish(flow.scan('BOX-NR-240819'));
    expect(flow.completeCount.value).toBe(2);
    expect((await finish(api.getSlot('SLOT-01'))).box).toBeUndefined();
    const load = vi.spyOn(api, 'load');
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith([
      { slotCode: 'SLOT-01', slotVersion: 1, boxCode: 'BOX-1', boxVersion: 1 },
      { slotCode: 'SLOT-07', slotVersion: 1, boxCode: 'BOX-NR-240819', boxVersion: 1 }
    ]);
    expect(flow.pairs.value).toEqual([]);
    expect(flow.notice.value?.text).toBe('装载成功');
    const slot = await finish(api.getSlot('SLOT-01'));
    expect(slot.box?.containerCode).toBe('BOX-1');
    expect(slot.version).toBe(2);
    expect(slot.vehicle.version).toBe(2);
    expect((await finish(api.getBox('BOX-1'))).loadedSlotCode).toBe('SLOT-01');
    expect((await finish(panelPackingApi.getBox('BOX-1'))).box.version).toBe(2);
    expect(network).not.toHaveBeenCalled();
    load.mockRestore();
  });
  it('preserves scan phase on nonexistent, occupied or ineligible results', async () => {
    const flow = useVehicleLoading();
    for (const code of ['UNKNOWN', 'SLOT-OCCUPIED', 'SLOT-BLOCKED']) {
      await finish(flow.scan(code));
      expect(flow.pairs.value).toHaveLength(0);
      expect(flow.notice.value?.error).toBe(true);
    }
    await finish(flow.scan('SLOT-01'));
    for (const code of ['SLOT-02', 'BOX-LOADED', 'BOX-LOAD-BLOCKED']) {
      await finish(flow.scan(code));
      expect(flow.pending.value?.slot.slotCode).toBe('SLOT-01');
      expect(flow.completeCount.value).toBe(0);
      expect(flow.notice.value?.error).toBe(true);
    }
    await finish(flow.scan('BOX-1'));
    expect(flow.completeCount.value).toBe(1);
  });
  it('rejects duplicates and resumes the right phase when a pair is removed', async () => {
    const flow = useVehicleLoading();
    await finish(flow.scan('SLOT-01'));
    await finish(flow.scan('BOX-1'));
    await finish(flow.scan('SLOT-01'));
    expect(flow.pairs.value).toHaveLength(1);
    expect(flow.notice.value?.text).toContain('重复');
    await finish(flow.scan('SLOT-02'));
    await finish(flow.scan('BOX-1'));
    expect(flow.pending.value?.slot.slotCode).toBe('SLOT-02');
    flow.remove('SLOT-01');
    expect(flow.completeCount.value).toBe(0);
    expect(flow.pending.value?.slot.slotCode).toBe('SLOT-02');
    flow.remove('SLOT-02');
    expect(flow.pending.value).toBeUndefined();
    expect(flow.pairs.value).toEqual([]);
    await finish(flow.scan('SLOT-01'));
    await finish(flow.submit());
    expect(flow.canSubmit.value).toBe(false);
    expect((await finish(api.getSlot('SLOT-01'))).box).toBeUndefined();
  });
  it('keeps all pending data on submit failure, writes nothing, and allows a corrected retry', async () => {
    const flow = useVehicleLoading();
    await finish(flow.scan('SLOT-01'));
    await finish(flow.scan('BOX-1'));
    await finish(flow.scan('SLOT-SUBMIT-FAIL'));
    await finish(flow.scan('BOX-NR-240819'));
    await finish(flow.submit());
    expect(flow.pairs.value).toHaveLength(2);
    expect(flow.notice.value?.text).toBe('提交时载具状态已变化，当前不允许装载');
    expect((await finish(api.getSlot('SLOT-01'))).box).toBeUndefined();
    expect((await finish(api.getBox('BOX-1'))).box.version).toBe(1);
    await finish(flow.submit());
    expect(flow.pairs.value).toHaveLength(2);
    flow.remove('SLOT-SUBMIT-FAIL');
    await finish(flow.submit());
    expect(flow.pairs.value).toEqual([]);
  });
  it('rechecks box versions and rejects an entire stale batch', async () => {
    const flow = useVehicleLoading();
    await finish(flow.scan('SLOT-01'));
    await finish(flow.scan('BOX-1'));
    await finish(flow.scan('SLOT-02'));
    await finish(flow.scan('BOX-NR-240819'));
    await finish(panelPackingApi.bindByOrder('BOX-NR-240819', 1, 'SO-20260901-018', 2));
    await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('信息已变化');
    expect((await finish(api.getSlot('SLOT-01'))).version).toBe(1);
    expect((await finish(api.getBox('BOX-1'))).loadedSlotCode).toBeUndefined();
  });
  it('ignores late responses after reset and blocks delete/scans while busy', async () => {
    const flow = useVehicleLoading();
    const loading = flow.scan('SLOT-01');
    await flow.scan('SLOT-02');
    flow.clear();
    await finish(loading);
    expect(flow.pairs.value).toEqual([]);
    await finish(flow.scan('SLOT-01'));
    const boxLoading = flow.scan('BOX-1');
    flow.remove('SLOT-01');
    expect(flow.pairs.value).toHaveLength(1);
    flow.clear();
    await finish(boxLoading);
    expect(flow.pairs.value).toEqual([]);
  });
  it('rejects malformed identities and caps the batch without splitting it', async () => {
    const flow = useVehicleLoading();
    const wrong = vi.spyOn(api, 'getSlot').mockResolvedValueOnce({ slotCode: 'WRONG', version: 1, vehicle: { containerType: 'VEHICLE', containerCode: 'CAR', version: 1 }, eligibility: { allowed: true } });
    await flow.scan('SLOT-01');
    expect(flow.pairs.value).toEqual([]);
    expect(flow.notice.value?.text).toContain('不一致');
    wrong.mockRestore();
    await finish(flow.scan('SLOT-01'));
    await finish(flow.scan('BOX-1'));
    const sample = flow.pairs.value[0];
    flow.pairs.value = Array.from({ length: 1000 }, (_, i) => ({ ...sample, slot: { ...sample.slot, slotCode: 'SLOT-TEST-' + i } }));
    await finish(flow.scan('SLOT-02'));
    expect(flow.pairs.value).toHaveLength(1000);
    expect(flow.notice.value?.text).toContain('1000');
  });
});
