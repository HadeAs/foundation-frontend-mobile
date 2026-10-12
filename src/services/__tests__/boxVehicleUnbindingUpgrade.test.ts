import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useBoxVehicleUnbinding } from '../../composables/useBoxVehicleUnbinding';
import { boxVehicleBindingApi as api, type DirectVehicleBindings, type DirectBindingReceipt } from '../boxVehicleBinding';
import { ApiRequestError } from '../nariRequest';
import UnbindingPage from '../../pages/box-vehicle-unbinding/index.vue';
import ScanInput from '../../components/ScanInput.vue';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));

const vehicle = (): DirectVehicleBindings => ({
  vehicle: { vehicleCode: 'CAR-1', displayName: '一号周转料车', version: 7 }, bindingCount: 3,
  bindings: Array.from({ length: 3 }, (_, index) => ({ bindingId: `direct-00000${index}`, bindingVersion: 2,
    box: { boxCode: `BOX-${index}`, displayName: `周转料箱 ${index}`, version: 3 } }))
});
const receipt = (requestId: string, remaining = [1, 2]): DirectBindingReceipt => ({ requestId,
  vehicle: { ...vehicle().vehicle, version: 8 }, bindingCount: remaining.length, bindings: remaining.map(index => vehicle().bindings[index])
});
async function ready() {
  vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle()); const flow = useBoxVehicleUnbinding();
  await flow.scan('CAR-1'); await flow.scan('BOX-0'); flow.requestUnbind('selected'); return flow;
}
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('box vehicle unbinding 2026-10-12.1', () => {
  it('keeps the page when an unselected box version changes in the completed receipt', async () => {
    const flow = await ready(); const unbind = vi.spyOn(api, 'unbindSelected').mockImplementationOnce(async input => {
      const value = receipt(input.requestId); value.bindings[0].box.version++; return value;
    }).mockImplementationOnce(async input => receipt(input.requestId));
    await flow.submit(); expect(flow.vehicle.value?.bindingCount).toBe(3); expect(flow.confirmation.value).toBe('selected');
    expect(flow.selected.value).toEqual(['direct-000000']); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(unbind.mock.calls[1][0]).toEqual(unbind.mock.calls[0][0]); expect(flow.vehicle.value).toBeNull();
  });
  it.each(['all', 'selected'] as const)('does not treat a pending-confirmation marker as a completed %s direct-unbind result', async mode => {
    const flow = await ready(); flow.cancel(); flow.requestUnbind(mode);
    const unbind = vi.spyOn(api, mode === 'all' ? 'unbindAll' : 'unbindSelected').mockImplementationOnce(async input =>
      Object.assign(receipt(input.requestId, mode === 'all' ? [] : [1, 2]), { resultType: 'CONFIRMATION_REQUIRED' }))
      .mockImplementationOnce(async input => receipt(input.requestId, mode === 'all' ? [] : [1, 2]));
    await flow.submit(); expect(flow.vehicle.value?.bindingCount).toBe(3); expect(flow.confirmation.value).toBe(mode);
    expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(unbind.mock.calls[1][0]).toEqual(unbind.mock.calls[0][0]); expect(flow.vehicle.value).toBeNull();
  });
  it.each(['all', 'selected'] as const)('uses textual direct credentials and completes a valid %s operation', async mode => {
    const flow = await ready(); flow.cancel(); flow.requestUnbind(mode);
    const unbind = vi.spyOn(api, mode === 'all' ? 'unbindAll' : 'unbindSelected').mockImplementation(async input =>
      receipt(input.requestId, mode === 'all' ? [] : [2, 1]));
    await flow.submit();
    expect(unbind.mock.calls[0][0]).toEqual({ requestId: expect.any(String), vehicleCode: 'CAR-1', vehicleVersion: 7,
      ...(mode === 'selected' ? { items: [{ bindingId: 'direct-000000', bindingVersion: 2, boxCode: 'BOX-0', boxVersion: 3 }] } : {}) });
    expect(flow.vehicle.value).toBeNull(); expect(flow.selected.value).toEqual([]); expect(flow.confirmation.value).toBeNull();
    expect(flow.notice.value?.text).toBe('料箱解绑成功');
  });
  it.each(['all', 'selected'] as const)('manually replays an uncertain %s result without background retries', async mode => {
    const flow = await ready(); flow.cancel(); flow.requestUnbind(mode);
    const unbind = vi.spyOn(api, mode === 'all' ? 'unbindAll' : 'unbindSelected').mockRejectedValueOnce(new ApiRequestError('处理结果未知', 503))
      .mockImplementationOnce(async input => receipt(input.requestId, mode === 'all' ? [] : [1, 2]));
    await flow.submit(); expect(unbind).toHaveBeenCalledOnce(); expect(flow.confirmation.value).toBe(mode);
    expect(flow.selected.value).toEqual(['direct-000000']); await flow.submit();
    expect(unbind.mock.calls[1][0]).toEqual(unbind.mock.calls[0][0]); expect(flow.vehicle.value).toBeNull();
  });
  it('creates a new intent only after the selected set is edited', async () => {
    const flow = await ready(); const unbind = vi.spyOn(api, 'unbindSelected').mockRejectedValueOnce(new Error('连接中断'))
      .mockImplementationOnce(async input => receipt(input.requestId, [0, 2]));
    await flow.submit(); flow.cancel(); flow.toggle('direct-000000'); await flow.scan('BOX-1'); flow.requestUnbind('selected'); await flow.submit();
    expect(unbind.mock.calls[1][0].requestId).not.toBe(unbind.mock.calls[0][0].requestId);
    expect(unbind.mock.calls[1][0].items).toEqual([{ bindingId: 'direct-000001', bindingVersion: 2, boxCode: 'BOX-1', boxVersion: 3 }]);
    expect(flow.vehicle.value).toBeNull();
  });
  it('requires server-provided nonempty names but accepts a server fallback to the box code', async () => {
    const value = vehicle(); value.bindings[0].box.displayName = value.bindings[0].box.boxCode;
    const query = vi.spyOn(api, 'getVehicle').mockResolvedValueOnce(value);
    const flow = useBoxVehicleUnbinding(); await flow.scan('CAR-1'); expect(flow.bindings.value[0].box.displayName).toBe('BOX-0');
    flow.clear(); const invalid = vehicle(); Object.assign(invalid.bindings[0].box, { displayName: undefined }); query.mockResolvedValueOnce(invalid);
    await flow.scan('CAR-1'); expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('ignores hidden invalid scans and stale queries after resuming', async () => {
    let resolve!: (value: DirectVehicleBindings) => void;
    const query = vi.spyOn(api, 'getVehicle').mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(vehicle());
    const flow = useBoxVehicleUnbinding(); const work = flow.scan('CAR-1'); flow.pause(); await flow.scan(''); await flow.scan('CAR-1');
    expect(query).toHaveBeenCalledOnce(); expect(flow.notice.value).toBeNull(); flow.resume(); await flow.scan('CAR-1');
    const late = vehicle(); late.vehicle.version = 99; resolve(late); await work; expect(flow.vehicle.value?.vehicle.version).toBe(7);
  });
  it.each(['all', 'selected'] as const)('ignores late %s failure after hiding and loading a new page context', async mode => {
    const flow = await ready(); flow.cancel(); flow.requestUnbind(mode); let reject!: (error: Error) => void;
    vi.spyOn(api, mode === 'all' ? 'unbindAll' : 'unbindSelected').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const work = flow.submit(); flow.pause(); flow.resume(); await flow.scan('CAR-1'); reject(new ApiRequestError('旧请求失败', 400)); await work;
    expect(flow.vehicle.value?.bindingCount).toBe(3); expect(flow.confirmation.value).toBeNull(); expect(flow.selected.value).toEqual([]); expect(flow.notice.value).toBeNull();
  });
  it('renders only direct box summaries, disables empty scrolling and preserves selected state when cancelling', async () => {
    vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle());
    const wrapper = mount(UnbindingPage, { global: { stubs: {
      'scroll-view': { name: 'ScrollView', props: ['scrollY'], template: '<div><slot /></div>' },
      checkbox: { template: '<span />' }, 'checkbox-group': { template: '<div class="checkbox-group"><slot /></div>' }
    } } });
    try {
      hooks.show.forEach(show => show()); const scroll = () => wrapper.getComponent({ name: 'ScrollView' });
      expect(scroll().props('scrollY')).toBe(false); wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled();
      expect(wrapper.findAll('.binding-row')).toHaveLength(3); expect(scroll().props('scrollY')).toBe(true);
      expect(wrapper.text()).not.toContain('实际内容'); expect(wrapper.text()).not.toContain('批次'); expect(wrapper.find('.delete').exists()).toBe(false);
      await wrapper.get('.checkbox-group').trigger('change'); await wrapper.get('.footer .primary').trigger('tap');
      expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true); await wrapper.get('.modal-actions button').trigger('tap');
      expect(wrapper.get('.list-heading').text()).toContain('已选 1 / 3');
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.findAll('.binding-row')).toEqual([]); expect(scroll().props('scrollY')).toBe(false);
      const empty = vehicle(); empty.bindings = []; empty.bindingCount = 0; vi.mocked(api.getVehicle).mockResolvedValue(empty); hooks.show.forEach(show => show());
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled();
      expect(scroll().props('scrollY')).toBe(false); expect(wrapper.get('.footer .danger').attributes('disabled')).toBeDefined(); expect(wrapper.get('.footer .primary').attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });
});
