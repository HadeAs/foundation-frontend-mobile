import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useBoxVehicleBinding } from '../../composables/useBoxVehicleBinding';
import { boxVehicleBindingApi as api, type DirectVehicleBindings, type DirectBoxCandidate, type DirectBindingReceipt } from '../boxVehicleBinding';
import { vehicleLoadingApi as loading } from '../vehicleLoading';
import { ApiRequestError } from '../nariRequest';
import BindingPage from '../../pages/box-vehicle-binding/index.vue';
import ScanInput from '../../components/ScanInput.vue';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));

const vehicle = (bound = true): DirectVehicleBindings => ({
  vehicle: { vehicleCode: 'CAR-1', displayName: '周转料车', version: 3 }, bindingCount: bound ? 1 : 0,
  bindings: bound ? [{ bindingId: 'direct-000001', bindingVersion: 2, box: { boxCode: 'BOX-OLD', displayName: '已绑定料箱', version: 4 } }] : []
});
const candidate = (code = 'BOX-NEW'): DirectBoxCandidate => ({
  vehicle: vehicle().vehicle, box: { boxCode: code, displayName: '本次料箱', version: 5 },
  currentBinding: null, currentVehicle: null, requiresRebindConfirmation: false, eligibility: { allowed: true }
});
const receipt = (requestId: string, bound = true): DirectBindingReceipt => ({ requestId,
  vehicle: { ...vehicle().vehicle, version: 4 }, bindingCount: bound ? 2 : 1,
  bindings: [...vehicle(bound).bindings, { bindingId: 'direct-000002', bindingVersion: 1, box: { ...candidate().box, version: 6 } }]
});
async function ready(bound = true) {
  vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle(bound)); vi.spyOn(api, 'getBox').mockResolvedValue(candidate());
  const flow = useBoxVehicleBinding(); await flow.scan('CAR-1'); if (bound) flow.keepBindings(); await flow.scan('BOX-NEW'); return flow;
}
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('box vehicle binding 2026-10-12.1', () => {
  it('does not accept a bind receipt that dropped an existing direct relationship', async () => {
    const flow = await ready();
    vi.spyOn(api, 'bind').mockImplementation(async input => receipt(input.requestId, false));
    await flow.submit();
    expect(flow.vehicle.value?.bindingCount).toBe(1); expect(flow.pending.value).toHaveLength(1); expect(flow.notice.value?.error).toBe(true);
  });
  it('does not accept an unrelated box in a completed bind receipt', async () => {
    const flow = await ready();
    vi.spyOn(api, 'bind').mockImplementation(async input => {
      const value = receipt(input.requestId); value.bindings.push({ bindingId: 'extra-relation', bindingVersion: 1,
        box: { boxCode: 'BOX-EXTRA', displayName: '其他料箱', version: 1 } }); value.bindingCount++; return value;
    });
    await flow.submit();
    expect(flow.vehicle.value?.bindingCount).toBe(1); expect(flow.pending.value).toHaveLength(1); expect(flow.notice.value?.error).toBe(true);
  });
  it('accepts complete append receipts without submitting existing boxes or using slot-loading APIs', async () => {
    const flow = await ready(); const loads = vi.spyOn(loading, 'getLoads'); const unload = vi.spyOn(loading, 'unloadAll');
    const bind = vi.spyOn(api, 'bind').mockImplementation(async input => receipt(input.requestId)); await flow.submit();
    expect(bind.mock.calls[0][0]).toEqual({ requestId: expect.any(String), vehicleCode: 'CAR-1', vehicleVersion: 3,
      items: [{ boxCode: 'BOX-NEW', boxVersion: 5, expectedBinding: null, confirmRebind: false }] });
    expect(flow.vehicle.value).toBeNull(); expect(flow.pending.value).toEqual([]); expect(flow.notice.value?.text).toBe('料箱绑车成功');
    expect(loads).not.toHaveBeenCalled(); expect(unload).not.toHaveBeenCalled();
  });
  const badQueries: [string, (value: DirectVehicleBindings) => void][] = [
    ['missing vehicle name', value => { Object.assign(value.vehicle, { displayName: undefined }); }],
    ['missing box name', value => { Object.assign(value.bindings[0].box, { displayName: undefined }); }],
    ['numeric relationship ID', value => { Object.assign(value.bindings[0], { bindingId: 123 }); }],
    ['oversized relationship ID', value => { value.bindings[0].bindingId = 'X'.repeat(129); }],
    ['invalid relation version', value => { value.bindings[0].bindingVersion = 2147483648; }],
    ['invalid box version', value => { value.bindings[0].box.version = 0; }],
    ['null list', value => { Object.assign(value, { bindings: null }); }]
  ];
  it.each(badQueries)('rejects incomplete direct summaries rather than inventing fields: %s', async (_label, change) => {
    const value = vehicle(); change(value); vi.spyOn(api, 'getVehicle').mockResolvedValue(value); const flow = useBoxVehicleBinding();
    await flow.scan('CAR-1'); expect(flow.review.value).toBeNull(); expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it.each([undefined, '', 123, 'X'.repeat(501)])('requires a valid backend reason when a box is ineligible: %s', async reason => {
    const flow = await ready(); const value = candidate('BOX-BLOCKED');
    Object.assign(value.eligibility, { allowed: false, reason }); vi.mocked(api.getBox).mockResolvedValue(value);
    await flow.scan('BOX-BLOCKED'); expect(flow.pending.value).toHaveLength(1); expect(flow.rebind.value).toBeNull();
    expect(flow.notice.value?.text).toContain('原因不完整');
  });
  it('keeps full backend ineligibility reasons and does not silently unload a slot-bound box', async () => {
    const flow = await ready(); const value = candidate('BOX-BLOCKED'); const reason = '该料箱已库位装载，不能直接绑车。'.repeat(20);
    value.eligibility = { allowed: false, reason }; vi.mocked(api.getBox).mockResolvedValue(value);
    const unload = vi.spyOn(loading, 'unloadSelected'); await flow.scan('BOX-BLOCKED');
    expect(flow.pending.value).toHaveLength(1); expect(flow.notice.value?.text).toBe(reason); expect(unload).not.toHaveBeenCalled();
  });
  it.each(['requestId', 'resultType', 'vehicleVersion', 'existingId', 'existingVersion', 'existingBoxVersion', 'newBoxVersion', 'missingPending'] as const)('keeps malformed completed receipts and manually retries identical input: %s', async kind => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bind').mockImplementationOnce(async input => {
      const value = receipt(input.requestId);
      if (kind === 'requestId') value.requestId = 'other';
      if (kind === 'resultType') Object.assign(value, { resultType: 'CONFIRMATION_REQUIRED' });
      if (kind === 'vehicleVersion') value.vehicle.version = input.vehicleVersion;
      if (kind === 'existingId') value.bindings[0].bindingId = 'replaced-existing';
      if (kind === 'existingVersion') value.bindings[0].bindingVersion++;
      if (kind === 'existingBoxVersion') value.bindings[0].box.version++;
      if (kind === 'newBoxVersion') value.bindings[1].box.version = 5;
      if (kind === 'missingPending') { value.bindings = value.bindings.slice(0, 1); value.bindingCount = 1; }
      return value;
    }).mockImplementationOnce(async input => receipt(input.requestId));
    await flow.submit(); expect(bind).toHaveBeenCalledOnce(); expect(flow.pending.value).toHaveLength(1); expect(flow.vehicle.value?.bindingCount).toBe(1);
    expect(flow.notice.value?.error).toBe(true); await flow.submit(); expect(bind.mock.calls[1][0]).toEqual(bind.mock.calls[0][0]); expect(flow.vehicle.value).toBeNull();
  });
  it('preserves textual old relationship credentials and only replaces them after an explicit Yes and final submit', async () => {
    const flow = await ready(false); flow.remove('BOX-NEW'); const value = candidate();
    value.currentBinding = { bindingId: 'direct-000009', bindingVersion: 8, vehicleCode: 'CAR-OTHER' };
    value.currentVehicle = { vehicleCode: 'CAR-OTHER', displayName: '其他料车', version: 11 }; value.requiresRebindConfirmation = true;
    vi.mocked(api.getBox).mockResolvedValue(value);
    const bind = vi.spyOn(api, 'bind').mockImplementation(async input => receipt(input.requestId, false));
    await flow.scan('BOX-NEW'); expect(flow.rebind.value).not.toBeNull(); flow.chooseRebind(false); expect(flow.pending.value).toEqual([]);
    await flow.scan('BOX-NEW'); flow.chooseRebind(true); expect(bind).not.toHaveBeenCalled(); await flow.submit();
    expect(bind.mock.calls[0][0].items).toEqual([{ boxCode: 'BOX-NEW', boxVersion: 5, expectedBinding: value.currentBinding, confirmRebind: true }]);
    expect(flow.vehicle.value).toBeNull();
  });
  it('rejects a reused old relationship ID/version on rebind and accepts a genuinely new relationship', async () => {
    const flow = await ready(false); flow.remove('BOX-NEW'); const value = candidate();
    value.currentBinding = { bindingId: 'direct-000002', bindingVersion: 8, vehicleCode: 'CAR-OTHER' };
    value.currentVehicle = { vehicleCode: 'CAR-OTHER', displayName: '其他料车', version: 11 }; value.requiresRebindConfirmation = true;
    vi.mocked(api.getBox).mockResolvedValue(value); await flow.scan('BOX-NEW'); flow.chooseRebind(true);
    const bind = vi.spyOn(api, 'bind').mockImplementationOnce(async input => receipt(input.requestId, false))
      .mockImplementationOnce(async input => { const value = receipt(input.requestId, false); value.bindings[0].bindingId = 'new-relation'; return value; });
    await flow.submit(); expect(flow.pending.value).toHaveLength(1); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(bind.mock.calls[1][0]).toEqual(bind.mock.calls[0][0]); expect(flow.vehicle.value).toBeNull();
  });
  it('replays unknown bind results and starts a fresh UUID after explicit rejection or an edited batch', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bind').mockRejectedValueOnce(new ApiRequestError('结果未知', 503)).mockRejectedValueOnce(new ApiRequestError('当前不允许绑定', 400))
      .mockRejectedValueOnce(new Error('连接中断')).mockImplementationOnce(async input => {
        const value = receipt(input.requestId); value.bindings[1].box.boxCode = 'BOX-OTHER'; return value;
      });
    await flow.submit(); await flow.submit(); expect(bind.mock.calls[1][0]).toEqual(bind.mock.calls[0][0]); await flow.submit();
    expect(bind.mock.calls[2][0].requestId).not.toBe(bind.mock.calls[1][0].requestId);
    flow.remove('BOX-NEW'); vi.mocked(api.getBox).mockResolvedValue(candidate('BOX-OTHER')); await flow.scan('BOX-OTHER'); await flow.submit();
    expect(bind.mock.calls[3][0].requestId).not.toBe(bind.mock.calls[2][0].requestId); expect(bind.mock.calls[3][0].items[0].boxCode).toBe('BOX-OTHER');
    expect(flow.vehicle.value).toBeNull();
  });
  it('keeps the review on uncertain all-unbind receipts and continues scanning with the returned vehicle version', async () => {
    vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle()); const flow = useBoxVehicleBinding(); await flow.scan('CAR-1');
    const unbind = vi.spyOn(api, 'unbindAll').mockRejectedValueOnce(new ApiRequestError('响应超时', 408))
      .mockImplementationOnce(async input => ({ ...vehicle(), requestId: input.requestId, vehicle: { ...vehicle().vehicle, version: 7 } }))
      .mockImplementationOnce(async input => ({ ...vehicle(false), requestId: input.requestId, vehicle: { ...vehicle().vehicle, version: 7 } }));
    await flow.unbindAll(); expect(flow.review.value?.bindingCount).toBe(1); expect(unbind).toHaveBeenCalledOnce();
    await flow.unbindAll(); expect(flow.review.value?.bindingCount).toBe(1); await flow.unbindAll();
    expect(unbind.mock.calls[1][0]).toEqual(unbind.mock.calls[0][0]); expect(unbind.mock.calls[2][0]).toEqual(unbind.mock.calls[0][0]);
    expect(unbind.mock.calls[0][0]).toEqual({ requestId: expect.any(String), vehicleCode: 'CAR-1', vehicleVersion: 3 });
    expect(flow.review.value).toBeNull(); expect(flow.vehicle.value?.vehicle.version).toBe(7);
    const value = candidate(); value.vehicle.version = 7; const query = vi.spyOn(api, 'getBox').mockResolvedValue(value); await flow.scan('BOX-NEW');
    expect(query).toHaveBeenCalledWith('CAR-1', 'BOX-NEW'); const bind = vi.spyOn(api, 'bind').mockImplementation(async input => ({ ...receipt(input.requestId, false), vehicle: { ...value.vehicle, version: 8 } }));
    await flow.submit(); expect(bind.mock.calls[0][0].vehicleVersion).toBe(7); expect(flow.vehicle.value).toBeNull();
  });
  it('loads complete existing lists and unbinds all without a 1000-box query cap', async () => {
    const value = vehicle(); const sample = value.bindings[0];
    value.bindings = Array.from({ length: 1001 }, (_, index) => ({ ...sample, bindingId: `direct-${index}`, box: { ...sample.box, boxCode: `BOX-${index}` } }));
    value.bindingCount = 1001; vi.spyOn(api, 'getVehicle').mockResolvedValue(value); const flow = useBoxVehicleBinding(); await flow.scan('CAR-1');
    expect(flow.review.value?.bindings).toHaveLength(1001); expect(flow.vehicle.value).toBeNull();
    const unbind = vi.spyOn(api, 'unbindAll').mockImplementation(async input => ({ ...vehicle(false), requestId: input.requestId, vehicle: { ...value.vehicle, version: 4 } }));
    await flow.unbindAll(); expect(unbind).toHaveBeenCalledOnce(); expect(unbind.mock.calls[0][0]).not.toHaveProperty('items'); expect(flow.vehicle.value?.bindingCount).toBe(0);
  });
  it('invalidates hidden scans including invalid input and ignores late candidate responses', async () => {
    const flow = await ready(false); flow.remove('BOX-NEW'); let resolve!: (value: DirectBoxCandidate) => void;
    vi.mocked(api.getBox).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const work = flow.scan('BOX-NEW'); flow.pause(); await flow.scan(''); await flow.scan('CAR-1'); flow.keepBindings(); flow.chooseRebind(true);
    expect(flow.notice.value).toBeNull(); expect(api.getVehicle).toHaveBeenCalledOnce(); flow.resume(); resolve(candidate()); await work;
    expect(flow.vehicle.value).toBeNull(); expect(flow.pending.value).toEqual([]); expect(flow.rebind.value).toBeNull();
  });
  it('ignores late one-click unbind success after hiding the page', async () => {
    vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle()); const flow = useBoxVehicleBinding(); await flow.scan('CAR-1');
    let resolve!: (value: DirectBindingReceipt) => void; const unbind = vi.spyOn(api, 'unbindAll').mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = flow.unbindAll(); await flow.unbindAll(); expect(unbind).toHaveBeenCalledOnce(); flow.pause();
    resolve({ ...vehicle(false), requestId: unbind.mock.calls[0][0].requestId, vehicle: { ...vehicle().vehicle, version: 4 } }); await work;
    expect(flow.vehicle.value).toBeNull(); expect(flow.review.value).toBeNull(); expect(flow.notice.value).toBeNull();
  });
  it('keeps readonly and pending row structure uniform, disables empty scrolling and resets on hide', async () => {
    vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle()); vi.spyOn(api, 'getBox').mockResolvedValue(candidate());
    const wrapper = mount(BindingPage, { global: { stubs: { 'scroll-view': { name: 'ScrollView', props: ['scrollY'], template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show()); const scroll = () => wrapper.getComponent({ name: 'ScrollView' });
      expect(scroll().props('scrollY')).toBe(false);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled(); expect(wrapper.findAll('.box-row')).toEqual([]);
      await wrapper.get('.modal-actions button').trigger('tap'); expect(wrapper.findAll('.box-row')).toHaveLength(1); expect(wrapper.findAll('.delete')).toEqual([]);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-NEW'); await vi.dynamicImportSettled();
      expect(wrapper.findAll('.box-row')).toHaveLength(2); expect(wrapper.findAll('.delete')).toHaveLength(1); expect(scroll().props('scrollY')).toBe(true);
      expect(wrapper.text()).not.toContain('待换绑'); expect(wrapper.text()).not.toContain('实际内容'); expect(wrapper.text()).not.toContain('批次');
      await wrapper.get('.delete').trigger('tap'); expect(wrapper.findAll('.box-row')).toHaveLength(1); expect(wrapper.get('.footer .primary').attributes('disabled')).toBeDefined();
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.findAll('.box-row')).toEqual([]); expect(scroll().props('scrollY')).toBe(false);
      vi.mocked(api.getVehicle).mockResolvedValue(vehicle(false)); hooks.show.forEach(show => show());
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled(); expect(scroll().props('scrollY')).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
