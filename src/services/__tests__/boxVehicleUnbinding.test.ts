import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useBoxVehicleUnbinding } from '../../composables/useBoxVehicleUnbinding';
import { boxVehicleBindingApi as api, type DirectVehicleBindings, type DirectBindingReceipt } from '../boxVehicleBinding';
import { vehicleLoadingApi } from '../vehicleLoading';
import { ApiRequestError } from '../nariRequest';
import UnbindingPage from '../../pages/box-vehicle-unbinding/index.vue';
import HomePage from '../../pages/home/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import pages from '../../pages.json';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
function vehicle(count = 3): DirectVehicleBindings {
  return { vehicle: { vehicleCode: 'CAR-1', displayName: '周转料车', version: 7 }, bindingCount: count,
    bindings: Array.from({ length: count }, (_, i) => ({ bindingId: `${9007199254741001n + BigInt(i)}`, bindingVersion: 2,
      box: { boxCode: `BOX-${i}`, displayName: `周转料箱 ${i}`, version: 3 } })) };
}
function receipt(requestId: string, remaining: number[] = []): DirectBindingReceipt {
  const value = vehicle();
  return { requestId, vehicle: { ...value.vehicle, version: 8 }, bindings: remaining.map((i) => value.bindings[i]), bindingCount: remaining.length };
}
async function ready(count = 3) {
  vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle(count));
  const flow = useBoxVehicleUnbinding(); await flow.scan(' CAR-1 '); return flow;
}
beforeEach(() => {
  hooks.show.length = hooks.hide.length = 0;
  const storage = new Map<string, unknown>();
  vi.stubGlobal('uni', { navigateTo: vi.fn(), navigateBack: vi.fn(), getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('box vehicle direct unbinding', () => {
  it('loads only direct relations once and matches scanned boxes locally without toggling repeated scans', async () => {
    const loads = vi.spyOn(vehicleLoadingApi, 'getLoads'); const candidates = vi.spyOn(api, 'getBox');
    const flow = await ready();
    expect(api.getVehicle).toHaveBeenCalledWith('CAR-1'); expect(flow.selected.value).toEqual([]);
    await flow.scan(' BOX-1 '); expect(flow.selected.value).toEqual([vehicle().bindings[1].bindingId]);
    await flow.scan('BOX-1'); expect(flow.selected.value).toHaveLength(1); expect(flow.notice.value?.text).toContain('已勾选');
    await flow.scan('BOX-FOREIGN'); expect(flow.notice.value?.text).toContain('未在当前料车'); expect(flow.selected.value).toHaveLength(1);
    flow.toggle('unknown'); expect(flow.selected.value).toHaveLength(1);
    flow.toggle(flow.selected.value[0]); expect(flow.selected.value).toEqual([]);
    expect(api.getVehicle).toHaveBeenCalledOnce(); expect(loads).not.toHaveBeenCalled(); expect(candidates).not.toHaveBeenCalled();
  });
  it('requires confirmation and submits selected relationship/box snapshots as strings, then clears on success', async () => {
    const flow = await ready(); await flow.scan('BOX-1');
    const unbind = vi.spyOn(api, 'unbindSelected').mockImplementation(async (input) => receipt(input.requestId, [0, 2]));
    await flow.submit(); expect(unbind).not.toHaveBeenCalled();
    flow.requestUnbind('selected'); expect(flow.confirmCount.value).toBe(1); expect(flow.disabled.value).toBe(true);
    flow.toggle(vehicle().bindings[0].bindingId); await flow.scan('BOX-2'); expect(flow.selected.value).toHaveLength(1);
    flow.cancel(); expect(flow.selected.value).toHaveLength(1); await flow.submit(); expect(unbind).not.toHaveBeenCalled();
    flow.requestUnbind('selected'); await flow.submit();
    expect(unbind.mock.calls[0][0]).toMatchObject({ vehicleCode: 'CAR-1', vehicleVersion: 7, items: [
      { bindingId: '9007199254741002', bindingVersion: 2, boxCode: 'BOX-1', boxVersion: 3 }
    ] });
    expect(flow.vehicle.value).toBeNull(); expect(flow.selected.value).toEqual([]); expect(flow.confirmation.value).toBeNull();
    expect(flow.notice.value?.text).toBe('料箱解绑成功'); expect(flow.canUnbindAll.value).toBe(false);
  });
  it('unbinds the entire cart independently of selections and sends no selected items', async () => {
    const flow = await ready(); await flow.scan('BOX-0');
    const unbind = vi.spyOn(api, 'unbindAll').mockImplementation(async (input) => receipt(input.requestId));
    const partial = vi.spyOn(api, 'unbindSelected');
    flow.requestUnbind('all'); expect(flow.confirmCount.value).toBe(3); await flow.submit();
    expect(unbind.mock.calls[0][0]).toEqual({ requestId: expect.any(String), vehicleCode: 'CAR-1', vehicleVersion: 7 });
    expect(partial).not.toHaveBeenCalled(); expect(flow.vehicle.value).toBeNull();
  });
  it('handles empty carts and invalid input without allowing an unbind or guessing container types', async () => {
    const flow = useBoxVehicleUnbinding(); const query = vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle(0));
    await flow.scan('   '); await flow.scan('X'.repeat(129)); expect(query).not.toHaveBeenCalled();
    await flow.scan('CAR-1'); expect(flow.vehicle.value?.bindingCount).toBe(0); expect(flow.bindings.value).toEqual([]);
    flow.requestUnbind('all'); flow.requestUnbind('selected'); expect(flow.confirmation.value).toBeNull();
    expect(flow.canUnbindAll.value).toBe(false); expect(flow.canUnbindSelected.value).toBe(false);
    flow.clear(); query.mockRejectedValueOnce(new ApiRequestError('扫描对象必须是料车', 400)); await flow.scan('BOX-0');
    expect(query).toHaveBeenLastCalledWith('BOX-0'); expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value?.text).toBe('扫描对象必须是料车');
  });
  it.each(['count', 'binding-id', 'box-code', 'version', 'box-version', 'binding-version', 'name', 'wrong-cart'])('rejects malformed query %s snapshots', async (kind) => {
    const value = vehicle();
    if (kind === 'count') value.bindingCount = 4;
    if (kind === 'binding-id') value.bindings[1].bindingId = value.bindings[0].bindingId;
    if (kind === 'box-code') value.bindings[1].box.boxCode = value.bindings[0].box.boxCode;
    if (kind === 'version') value.vehicle.version = 0;
    if (kind === 'box-version') value.bindings[0].box.version = 2147483648;
    if (kind === 'binding-version') value.bindings[0].bindingVersion = 1.5;
    if (kind === 'name') value.vehicle.displayName = '';
    if (kind === 'wrong-cart') value.vehicle.vehicleCode = 'CAR-OTHER';
    vi.spyOn(api, 'getVehicle').mockResolvedValue(value); const flow = useBoxVehicleUnbinding(); await flow.scan('CAR-1');
    expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it.each(['all', 'selected'] as const)('keeps %s failures and confirmation intact, new ID on explicitly rejected retry', async (mode) => {
    const flow = await ready(); await flow.scan('BOX-0'); flow.requestUnbind(mode);
    const unbind = vi.spyOn(api, mode === 'all' ? 'unbindAll' : 'unbindSelected').mockRejectedValue(new ApiRequestError('关系已变化，请重新扫描', 409));
    await flow.submit(); await flow.submit();
    expect(flow.vehicle.value?.bindingCount).toBe(3); expect(flow.selected.value).toHaveLength(1); expect(flow.confirmation.value).toBe(mode);
    expect(flow.notice.value?.text).toContain('关系已变化'); expect(unbind).toHaveBeenCalledTimes(2);
    expect(unbind.mock.calls[1][0].requestId).not.toBe(unbind.mock.calls[0][0].requestId);
  });
  it.each([new Error('连接中断'), new ApiRequestError('超时', 408), new ApiRequestError('服务异常', 500)])('manually retries an uncertain result with identical ID and content: %s', async (failure) => {
    const flow = await ready(); await flow.scan('BOX-0'); flow.requestUnbind('selected');
    const unbind = vi.spyOn(api, 'unbindSelected').mockRejectedValueOnce(failure)
      .mockImplementationOnce(async (input) => receipt(input.requestId, [1, 2]));
    await flow.submit(); expect(unbind).toHaveBeenCalledOnce(); expect(flow.confirmation.value).toBe('selected');
    await flow.submit(); expect(unbind.mock.calls[1][0]).toEqual(unbind.mock.calls[0][0]); expect(flow.vehicle.value).toBeNull();
  });
  it.each(['request-id', 'cart', 'version', 'count', 'selected-still-bound', 'other-removed', 'changed-relation'])('retains malformed %s success receipts for verification', async (kind) => {
    const flow = await ready(); await flow.scan('BOX-0'); flow.requestUnbind('selected');
    const unbind = vi.spyOn(api, 'unbindSelected').mockImplementation(async (input) => {
      const value = receipt(input.requestId, [1, 2]);
      if (kind === 'request-id') value.requestId = 'other';
      if (kind === 'cart') value.vehicle.vehicleCode = 'CAR-OTHER';
      if (kind === 'version') value.vehicle.version = 7;
      if (kind === 'count') value.bindingCount = 3;
      if (kind === 'selected-still-bound') value.bindings[0] = vehicle().bindings[0];
      if (kind === 'other-removed') { value.bindings = []; value.bindingCount = 0; }
      if (kind === 'changed-relation') value.bindings[0].bindingVersion++;
      return value;
    });
    await flow.submit(); await flow.submit();
    expect(flow.vehicle.value?.bindingCount).toBe(3); expect(flow.confirmation.value).toBe('selected');
    expect(flow.notice.value?.error).toBe(true); expect(unbind.mock.calls[1][0]).toEqual(unbind.mock.calls[0][0]);
  });
  it('requires an empty list on all-unbind receipt', async () => {
    const flow = await ready(); flow.requestUnbind('all');
    vi.spyOn(api, 'unbindAll').mockImplementation(async (input) => receipt(input.requestId, [1]));
    await flow.submit(); expect(flow.vehicle.value?.bindingCount).toBe(3); expect(flow.confirmation.value).toBe('all'); expect(flow.notice.value?.error).toBe(true);
  });
  it('caps selected operations at 1000 without truncating the full cart or limiting all-unbind', async () => {
    const flow = await ready(1001);
    for (let i = 0; i < 1000; i++) flow.toggle(flow.bindings.value[i].bindingId);
    await flow.scan('BOX-1000'); expect(flow.selected.value).toHaveLength(1000); expect(flow.notice.value?.text).toContain('1000');
    expect(flow.bindings.value).toHaveLength(1001); flow.toggle(flow.selected.value[0]); await flow.scan('BOX-1000');
    expect(flow.selected.value).toHaveLength(1000); flow.requestUnbind('all'); expect(flow.confirmCount.value).toBe(1001);
    const unbind = vi.spyOn(api, 'unbindAll').mockImplementation(async (input) => receipt(input.requestId));
    await flow.submit(); expect(unbind.mock.calls[0][0]).not.toHaveProperty('items'); expect(flow.vehicle.value).toBeNull();
  });
  it('locks duplicate requests and invalidates late query/mutation replies on reset or hide', async () => {
    let resolve!: (value: DirectVehicleBindings) => void;
    const query = vi.spyOn(api, 'getVehicle').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const flow = useBoxVehicleUnbinding(); const work = flow.scan('CAR-1'); await flow.scan('CAR-1'); expect(query).toHaveBeenCalledOnce();
    flow.clear(); resolve(vehicle()); await work; expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value).toBeNull();
    query.mockResolvedValue(vehicle()); await flow.scan('CAR-1'); await flow.scan('BOX-0'); flow.requestUnbind('selected');
    let finish!: (value: DirectBindingReceipt) => void;
    const unbind = vi.spyOn(api, 'unbindSelected').mockImplementation(() => new Promise((done) => { finish = done; }));
    const submit = flow.submit(); await flow.submit(); flow.cancel(); expect(flow.confirmation.value).toBe('selected'); expect(unbind).toHaveBeenCalledOnce();
    flow.pause(); finish(receipt(unbind.mock.calls[0][0].requestId, [1, 2])); await submit;
    expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value).toBeNull(); await flow.scan('CAR-1'); expect(query).toHaveBeenCalledTimes(2);
    flow.resume(); await flow.scan('CAR-1'); expect(flow.selected.value).toEqual([]);
  });
  it('opens the menu and renders checkboxes, count, confirmation, disabled state and clear without extra controls', async () => {
    const stubs = { 'scroll-view': { template: '<div><slot /></div>' }, checkbox: { template: '<span class="checkbox-stub" />' },
      'checkbox-group': { template: '<div class="checkbox-group-stub"><slot /></div>' } };
    const home = mount(HomePage, { global: { stubs } });
    await home.findAll('.menu-entry').find((button) => button.text() === '料箱解绑')!.trigger('tap');
    expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/box-vehicle-unbinding/index' }); expect(home.findAll('.menu-entry')).toHaveLength(18);
    home.unmount(); hooks.show.length = 0;
    expect(pages.pages.find((page) => page.path === 'pages/box-vehicle-unbinding/index')?.style.disableScroll).toBe(true);
    vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle());
    const unbind = vi.spyOn(api, 'unbindSelected').mockImplementation(async (input) => receipt(input.requestId, [1, 2]));
    const wrapper = mount(UnbindingPage, { global: { stubs } });
    try {
      hooks.show.forEach((show) => show());
      expect(wrapper.getComponent(ScanInput).props('placeholder')).toBe('扫描或输入料车编码');
      expect(wrapper.findAll('.footer button')[1].attributes('disabled')).toBeDefined();
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled();
      expect(wrapper.findAll('.checkbox-stub')).toHaveLength(3); expect(wrapper.get('.list-heading').text()).toContain('已选 0 / 3');
      expect(wrapper.text()).not.toContain('全选'); expect(wrapper.find('.delete').exists()).toBe(false);
      expect(wrapper.getComponent(ScanInput).props('placeholder')).toBe('扫描料箱编码勾选');
      await wrapper.findAll('.checkbox-group-stub')[0].trigger('change'); expect(wrapper.get('.list-heading').text()).toContain('已选 1 / 3');
      await wrapper.findAll('.footer button')[2].trigger('tap'); expect(wrapper.get('[role="dialog"]').text()).toContain('已选 1 个料箱');
      expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true); expect(unbind).not.toHaveBeenCalled();
      await wrapper.findAll('.modal-actions button')[0].trigger('tap'); expect(wrapper.get('.list-heading').text()).toContain('已选 1 / 3');
      await wrapper.findAll('.footer button')[2].trigger('tap'); await wrapper.findAll('.modal-actions button')[1].trigger('tap'); await vi.dynamicImportSettled();
      expect(wrapper.find('.vehicle-card').exists()).toBe(false); expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled();
      await wrapper.findAll('.footer button')[0].trigger('tap'); expect(wrapper.findAll('.checkbox-stub')).toHaveLength(0);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled(); hooks.hide.forEach((hide) => hide()); await wrapper.vm.$nextTick();
      expect(wrapper.find('.vehicle-card').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
