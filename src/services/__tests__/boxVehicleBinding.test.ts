import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useBoxVehicleBinding } from '../../composables/useBoxVehicleBinding';
import { boxVehicleBindingApi as api, type DirectVehicleBindings, type DirectBoxCandidate, type DirectBindingReceipt } from '../boxVehicleBinding';
import { ApiRequestError } from '../nariRequest';
import BindingPage from '../../pages/box-vehicle-binding/index.vue';
import HomePage from '../../pages/home/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import pages from '../../pages.json';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const cart = { vehicleCode: 'CAR-1', displayName: '周转料车', version: 1 };
function box(code: string) { return { boxCode: code, displayName: `料箱 ${code}`, version: 2 }; }
function vehicle(bound = false): DirectVehicleBindings {
  return { vehicle: { ...cart }, bindings: bound ? [{ bindingId: '9007199254741001', bindingVersion: 1, box: box('BOX-OLD') }] : [], bindingCount: bound ? 1 : 0 };
}
function candidate(code = 'BOX-NEW', rebind = false): DirectBoxCandidate {
  return { vehicle: { ...cart }, box: box(code), currentBinding: rebind ? { bindingId: '9007199254741002', bindingVersion: 3, vehicleCode: 'CAR-OTHER' } : null,
    currentVehicle: rebind ? { vehicleCode: 'CAR-OTHER', displayName: '其他料车', version: 4 } : null,
    requiresRebindConfirmation: rebind, eligibility: { allowed: true } };
}
function receipt(requestId: string, codes: string[] = ['BOX-NEW']): DirectBindingReceipt {
  return { requestId, vehicle: { ...cart, version: 2 }, bindingCount: codes.length,
    bindings: codes.map((code, index) => code === 'BOX-OLD' ? vehicle(true).bindings[0] :
      { bindingId: String(1000 + index), bindingVersion: 2, box: { ...box(code), version: 3 } }) };
}
async function ready(bound = false) {
  vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle(bound));
  const flow = useBoxVehicleBinding(); await flow.scan(' CAR-1 '); return flow;
}
beforeEach(() => {
  hooks.show.length = hooks.hide.length = 0;
  const storage = new Map<string, unknown>();
  vi.stubGlobal('uni', { navigateTo: vi.fn(), navigateBack: vi.fn(), getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('box vehicle direct binding', () => {
  it('shows existing boxes only after No and submits pending boxes only', async () => {
    const flow = await ready(true);
    expect(flow.vehicle.value).toBeNull(); expect(flow.review.value?.bindingCount).toBe(1);
    expect(flow.disabled.value).toBe(true); await flow.scan('BOX-NEW'); expect(flow.pending.value).toHaveLength(0);
    const unbind = vi.spyOn(api, 'unbindAll'); flow.keepBindings();
    expect(flow.vehicle.value?.bindings[0].box.boxCode).toBe('BOX-OLD'); expect(unbind).not.toHaveBeenCalled();
    expect(flow.canSubmit.value).toBe(false);
    vi.spyOn(api, 'getBox').mockResolvedValue(candidate()); await flow.scan(' BOX-NEW ');
    const bind = vi.spyOn(api, 'bind').mockImplementation(async (input) => receipt(input.requestId, ['BOX-OLD', 'BOX-NEW']));
    await flow.submit();
    expect(bind.mock.calls[0][0]).toMatchObject({ vehicleCode: 'CAR-1', vehicleVersion: 1,
      items: [{ boxCode: 'BOX-NEW', boxVersion: 2, expectedBinding: null, confirmRebind: false }] });
    expect(flow.vehicle.value).toBeNull(); expect(flow.pending.value).toHaveLength(0); expect(flow.notice.value?.text).toBe('料箱绑车成功');
  });
  it('unbinds all with the direct endpoint and keeps the returned cart version for new scans', async () => {
    const flow = await ready(true);
    vi.spyOn(api, 'unbindAll').mockImplementation(async (input) => receipt(input.requestId, []));
    await flow.unbindAll();
    expect(flow.review.value).toBeNull(); expect(flow.vehicle.value?.vehicle.version).toBe(2);
    const value = candidate(); value.vehicle.version = 2;
    vi.spyOn(api, 'getBox').mockResolvedValue(value); await flow.scan('BOX-NEW');
    const bind = vi.spyOn(api, 'bind').mockRejectedValue(new ApiRequestError('提交失败', 400));
    await flow.submit(); expect(bind.mock.calls[0][0].vehicleVersion).toBe(2);
  });
  it('retains the unbind dialog on rejection and generates a new ID after explicit failure', async () => {
    const flow = await ready(true);
    const unbind = vi.spyOn(api, 'unbindAll').mockRejectedValueOnce(new ApiRequestError('禁止解绑', 400))
      .mockImplementationOnce(async (input) => receipt(input.requestId, []));
    await flow.unbindAll(); expect(flow.review.value?.bindingCount).toBe(1); expect(flow.notice.value?.text).toBe('禁止解绑');
    await flow.unbindAll(); expect(flow.vehicle.value?.bindingCount).toBe(0);
    expect(unbind.mock.calls[1][0].requestId).not.toBe(unbind.mock.calls[0][0].requestId);
  });
  it('defers rebinding until submission, drops No, and sends the complete old relationship on Yes', async () => {
    const flow = await ready(); const value = candidate('BOX-OTHER', true);
    vi.spyOn(api, 'getBox').mockResolvedValue(value);
    const bind = vi.spyOn(api, 'bind').mockImplementation(async (input) => receipt(input.requestId, ['BOX-OTHER']));
    await flow.scan('BOX-OTHER'); expect(flow.rebind.value).toEqual(value); expect(flow.pending.value).toHaveLength(0);
    flow.chooseRebind(false); expect(flow.pending.value).toHaveLength(0); expect(bind).not.toHaveBeenCalled();
    await flow.scan('BOX-OTHER'); flow.chooseRebind(true); expect(flow.pending.value).toHaveLength(1); expect(bind).not.toHaveBeenCalled();
    await flow.submit(); expect(bind.mock.calls[0][0].items).toEqual([{ boxCode: 'BOX-OTHER', boxVersion: 2,
      expectedBinding: value.currentBinding, confirmRebind: true }]);
  });
  it('rejects already-bound, duplicate, or unavailable boxes without changing the pending list', async () => {
    const flow = await ready(true); flow.keepBindings();
    const query = vi.spyOn(api, 'getBox').mockResolvedValueOnce(candidate()).mockResolvedValueOnce({ ...candidate('BOX-BLOCKED'), eligibility: { allowed: false, reason: '已库位装载，不能直接绑车' } });
    await flow.scan('BOX-OLD'); expect(flow.notice.value?.text).toContain('已绑定当前料车'); expect(query).not.toHaveBeenCalled();
    await flow.scan('BOX-NEW'); await flow.scan('BOX-NEW'); expect(query).toHaveBeenCalledOnce();
    await flow.scan('BOX-BLOCKED'); expect(flow.pending.value).toHaveLength(1); expect(flow.notice.value?.text).toContain('已库位装载');
    flow.remove('BOX-NEW'); expect(flow.canSubmit.value).toBe(false);
  });
  it.each(['count', 'duplicate', 'version', 'code'])('rejects malformed vehicle %s data', async (kind) => {
    const value = vehicle(true);
    if (kind === 'count') value.bindingCount = 2;
    if (kind === 'duplicate') { value.bindings.push(value.bindings[0]); value.bindingCount = 2; }
    if (kind === 'version') value.vehicle.version = 0;
    if (kind === 'code') value.vehicle.vehicleCode = 'OTHER';
    vi.spyOn(api, 'getVehicle').mockResolvedValue(value); const flow = useBoxVehicleBinding(); await flow.scan('CAR-1');
    expect(flow.vehicle.value).toBeNull(); expect(flow.review.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it.each(['version', 'missing-null', 'wrong-owner', 'false-confirmation'])('rejects inconsistent candidate %s data', async (kind) => {
    const flow = await ready(); const value = candidate('BOX-NEW', kind === 'wrong-owner' || kind === 'false-confirmation');
    if (kind === 'version') value.vehicle.version = 2;
    if (kind === 'missing-null') value.currentBinding = undefined as unknown as null;
    if (kind === 'wrong-owner') value.currentVehicle!.vehicleCode = 'OTHER';
    if (kind === 'false-confirmation') value.requiresRebindConfirmation = false;
    vi.spyOn(api, 'getBox').mockResolvedValue(value); await flow.scan('BOX-NEW');
    expect(flow.pending.value).toHaveLength(0); expect(flow.rebind.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('keeps data on an explicit bind conflict and retries as a new business request', async () => {
    const flow = await ready(); vi.spyOn(api, 'getBox').mockResolvedValue(candidate()); await flow.scan('BOX-NEW');
    const bind = vi.spyOn(api, 'bind').mockRejectedValue(new ApiRequestError('关系已变化，请重新扫描', 409));
    await flow.submit(); await flow.submit(); expect(flow.vehicle.value?.vehicle.vehicleCode).toBe('CAR-1');
    expect(flow.pending.value).toHaveLength(1); expect(bind.mock.calls[0][0].requestId).not.toBe(bind.mock.calls[1][0].requestId);
    expect(flow.notice.value?.text).toContain('关系已变化');
  });
  it('reuses uncertain mutation IDs without automatic retry and rejects incomplete success receipts', async () => {
    const flow = await ready(); vi.spyOn(api, 'getBox').mockResolvedValue(candidate()); await flow.scan('BOX-NEW');
    const bind = vi.spyOn(api, 'bind').mockRejectedValueOnce(new Error('网络异常'))
      .mockImplementationOnce(async (input) => ({ ...receipt(input.requestId, []), vehicle: { ...cart, version: 2 } }))
      .mockImplementationOnce(async (input) => receipt(input.requestId));
    await flow.submit(); expect(bind).toHaveBeenCalledOnce(); expect(flow.pending.value).toHaveLength(1);
    await flow.submit(); expect(flow.notice.value?.text).toContain('回执缺少'); expect(flow.pending.value).toHaveLength(1);
    await flow.submit(); expect(bind.mock.calls[1][0]).toEqual(bind.mock.calls[0][0]); expect(bind.mock.calls[2][0]).toEqual(bind.mock.calls[0][0]);
    expect(flow.vehicle.value).toBeNull();
  });
  it('invalidates late queries and mutation replies after clearing or leaving', async () => {
    let resolve!: (value: DirectVehicleBindings) => void;
    vi.spyOn(api, 'getVehicle').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const flow = useBoxVehicleBinding(); const query = flow.scan('CAR-1'); flow.clear(); resolve(vehicle()); await query;
    expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value).toBeNull();
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle()); await flow.scan('CAR-1');
    vi.spyOn(api, 'getBox').mockResolvedValue(candidate()); await flow.scan('BOX-NEW');
    let finish!: (value: DirectBindingReceipt) => void;
    const bind = vi.spyOn(api, 'bind').mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const submit = flow.submit(); await flow.submit(); await flow.scan('BOX-OTHER'); expect(bind).toHaveBeenCalledOnce();
    flow.pause(); finish(receipt(bind.mock.calls[0][0].requestId)); await submit;
    expect(flow.vehicle.value).toBeNull(); expect(flow.notice.value).toBeNull(); flow.resume(); expect(flow.canSubmit.value).toBe(false);
  });
  it('enforces batch size without truncating existing bound rows', async () => {
    const flow = await ready(); const item = candidate();
    flow.pending.value = Array.from({ length: 1000 }, (_, index) => ({ ...item, box: box(`BOX-${index}`) }));
    const query = vi.spyOn(api, 'getBox'); await flow.scan('BOX-OVER'); expect(query).not.toHaveBeenCalled();
    expect(flow.notice.value?.text).toContain('1000'); flow.pending.value.push(candidate('BOX-OVER'));
    const bind = vi.spyOn(api, 'bind'); await flow.submit(); expect(bind).not.toHaveBeenCalled();
  });
  it('opens the new menu and renders locked dialogs, readonly rows, deletes and fixed footer', async () => {
    const home = mount(HomePage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    await home.findAll('.menu-entry').find((button) => button.text() === '料箱绑车')!.trigger('tap');
    expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/box-vehicle-binding/index' }); expect(home.findAll('.menu-entry')).toHaveLength(18);
    home.unmount(); hooks.show.length = 0;
    expect(pages.pages.find((page) => page.path === 'pages/box-vehicle-binding/index')?.style.disableScroll).toBe(true);
    vi.spyOn(api, 'getVehicle').mockResolvedValue(vehicle(true)); vi.spyOn(api, 'getBox').mockResolvedValue(candidate('BOX-OTHER', true));
    const bind = vi.spyOn(api, 'bind');
    const wrapper = mount(BindingPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach((show) => show());
      expect(wrapper.getComponent(ScanInput).props('placeholder')).toBe('扫描或输入料车编码');
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled();
      expect(wrapper.get('[role="dialog"]').text()).toContain('当前料车已绑定1个料箱');
      expect(wrapper.findAll('.box-row')).toHaveLength(0); expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true);
      await wrapper.get('.modal-actions button').trigger('tap');
      expect(wrapper.findAll('.box-row')).toHaveLength(1); expect(wrapper.findAll('.delete')).toHaveLength(0);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-OTHER'); await vi.dynamicImportSettled();
      expect(wrapper.get('[role="dialog"]').text()).toContain('CAR-OTHER'); await wrapper.findAll('.modal-actions button')[1].trigger('tap');
      expect(bind).not.toHaveBeenCalled(); expect(wrapper.findAll('.box-row')).toHaveLength(2);
      expect(wrapper.text()).not.toContain('待换绑'); expect(wrapper.text()).not.toContain('CAR-OTHER');
      expect(wrapper.get('.list-heading').text()).toContain('本次待绑定 1 箱');
      await wrapper.get('.delete').trigger('tap'); expect(wrapper.findAll('.box-row')).toHaveLength(1);
      expect(wrapper.findAll('.footer button')[1].attributes('disabled')).toBeDefined();
      await wrapper.findAll('.footer button')[0].trigger('tap'); expect(wrapper.find('.vehicle-card').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
