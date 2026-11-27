import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReceivingVehicleRelease } from '../../composables/useReceivingVehicleRelease';
import { receivingApi } from '../receiving';
import { ApiRequestError } from '../nariRequest';
import { seedTestSession } from './helpers/authSession';

const receivingRequestId = '3aa004c0-55e0-4704-84dd-f34bd0403081';
const notify = vi.fn();
beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('uni', { getStorageSync: (k: string) => storage.get(k), setStorageSync: (k: string, v: unknown) => storage.set(k, v) });
  seedTestSession(); notify.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('接收成功后的车位解绑', () => {
  it.each(['receiving', 'inbound'] as const)('can decline after reopening %s without a write', flowName => {
    const post = vi.spyOn(receivingApi, 'releaseVehicles');
    const flow = useReceivingVehicleRelease(flowName, notify); flow.offer(receivingRequestId);
    const restored = useReceivingVehicleRelease(flowName, notify);
    expect(restored.asking.value).toBe(true); restored.close();
    expect(restored.visible.value).toBe(false); expect(post).not.toHaveBeenCalled();
  });
  it('preserves both IDs after a conflict and a mismatched reply and presents mixed or waiting vehicles individually', async () => {
    const post = vi.spyOn(receivingApi, 'releaseVehicles').mockRejectedValueOnce(new ApiRequestError('需核实原接收', 409))
      .mockImplementationOnce(async input => ({ ...input, receivingRequestId: 'another', vehicles: [] }))
      .mockImplementationOnce(async input => ({ ...input, vehicles: [
        { vehicleCode: 'V1', locationCode: 'L1', status: 'RELEASED' },
        { vehicleCode: 'V2', locationCode: 'L2', status: 'WAITING_BOXES' },
        { vehicleCode: 'V3', locationCode: 'L3', status: 'RETAINED' }
      ] }));
    const flow = useReceivingVehicleRelease('receiving', notify); flow.offer(receivingRequestId);
    await Promise.all([flow.confirm(), flow.confirm()]); flow.close();
    expect(flow.pending.value?.reason).toContain('需核实');
    const reopened = useReceivingVehicleRelease('receiving', notify);
    expect(useReceivingVehicleRelease('inbound', notify).visible.value).toBe(false);
    await reopened.confirm(); expect(reopened.asking.value).toBe(false); expect(reopened.pending.value).toBeTruthy();
    await reopened.confirm();
    expect(post.mock.calls).toEqual(Array(3).fill(post.mock.calls[0]));
    expect(post.mock.calls[0][0]).toEqual({ receivingRequestId, requestId: expect.any(String) });
    expect(post.mock.calls[0][0].requestId).not.toBe(receivingRequestId);
    expect(reopened.vehicles.value.map(v => v.status)).toEqual(['RELEASED', 'WAITING_BOXES', 'RETAINED']);
    expect(reopened.pending.value).toBeNull(); reopened.close(); expect(reopened.visible.value).toBe(false);
  });
  it.each([true, false])('closes and notifies when the server returns all released or no candidates (%s)', async empty => {
    vi.spyOn(receivingApi, 'releaseVehicles').mockImplementation(async input => ({ ...input, vehicles: empty ? [] :
      [{ vehicleCode: 'V', locationCode: 'L', status: 'RELEASED' }] }));
    const flow = useReceivingVehicleRelease('inbound', notify);
    flow.offer(receivingRequestId); await flow.confirm();
    expect(flow.visible.value).toBe(false); expect(notify).toHaveBeenCalledWith(empty ? '本次无车位关系需要解绑' : '车与位置关系已解绑');
  });
});
