import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { usePanelPacking } from '../../composables/usePanelPacking';
import PackingPage from '../../pages/panel-packing/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { panelPackingApi as api, type BoxBindings, type BoxBindingConfirmation, type BoxReceipt, type BoxBindingResult } from '../panelPacking';
import { ApiRequestError } from '../nariRequest';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const box = (): BoxBindings => ({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 2 },
  empty: true, contentState: 'EMPTY', runtimeUsage: 'MATERIAL', bindings: [], totalQuantity: 0, eligibility: { allowed: true } });
const panel = (code = 'P1') => ({ panelCode: code, orderNo: 'ORDER-1', materialCode: 'MAT-1', materialBatch: '000001', eligibility: { allowed: true } });
const boundBox = (): BoxBindings => ({ ...box(), empty: false, contentState: 'LOADED', totalQuantity: 1,
  bindings: [{ id: '9007199254741001', version: 1, bindingMode: 'BY_CODE', panelCode: 'BOUND', materialCode: 'MAT-1', materialBatch: '000002', orderNo: 'ORDER-OLD', quantity: 1 }] });
function confirmation(id: string): BoxBindingConfirmation {
  return { resultType: 'CONFIRMATION_REQUIRED', requestId: id, confirmationType: 'MIXED_CONTENT',
    box: box().box, confirmationToken: 'server-token-not-client-generated', message: '本次存在混料，混装仅用于缴库，不参与生产配送，是否继续？' };
}
function receipt(id: string, version = 3): BoxReceipt {
  return { requestId: id, affectedCount: 1, processedTime: '2026-10-12T02:00:00Z', box: { boxCode: 'BOX-1', version, materialQuantity: 1 } };
}
async function ready() {
  vi.spyOn(api, 'getBox').mockResolvedValue(box()); vi.spyOn(api, 'getPanel').mockImplementation(async code => panel(code));
  const flow = usePanelPacking(); await flow.scan('BOX-1'); await flow.scan('P1'); return flow;
}
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('panel packing 2026-10-12.1', () => {
  it('does not treat a 200 confirmation as binding, locks background edits and keeps data when cancelled', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bind').mockImplementation(async (_box, _version, _codes, options) => confirmation(options!.requestId!));
    await flow.submit(); expect(flow.notice.value).toBeNull(); expect(flow.box.value?.box.version).toBe(2);
    expect(flow.mixed.value?.confirmation.message).toContain('仅用于缴库'); expect(flow.pending.value).toHaveLength(1);
    flow.remove('P1'); await flow.scan('P2'); await flow.getJoint(); await flow.submit();
    expect(flow.pending.value).toHaveLength(1); expect(bind).toHaveBeenCalledOnce(); expect(flow.canJoint.value).toBe(false);
    flow.cancelMixed(); expect(flow.mixed.value).toBeNull(); expect(flow.pending.value).toHaveLength(1); expect(flow.canSubmit.value).toBe(true);
  });
  it('continues with a fresh ID, server token and the exact panel set, accepting a final receipt without operationNo', async () => {
    const flow = await ready(); await flow.scan('P2');
    const bind = vi.spyOn(api, 'bind').mockImplementationOnce(async (_box, _version, _codes, options) => confirmation(options!.requestId!))
      .mockImplementationOnce(async (_box, _version, _codes, options) => receipt(options!.requestId!));
    await flow.submit(); await flow.continueMixed();
    const initial = bind.mock.calls[0]; const continued = bind.mock.calls[1];
    expect(continued.slice(0, 3)).toEqual(initial.slice(0, 3));
    expect(continued[3]).toEqual({ requestId: expect.any(String), confirmMixed: true, confirmationToken: 'server-token-not-client-generated' });
    expect(continued[3]!.requestId).not.toBe(initial[3]!.requestId);
    expect(flow.mixed.value).toBeNull(); expect(flow.box.value).toBeNull(); expect(flow.pending.value).toEqual([]); expect(flow.notice.value?.text).toBe('装箱成功');
  });
  it('does not automatically resend and reuses the confirmed ID/content after a timeout', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bind').mockImplementationOnce(async (_box, _version, _codes, options) => confirmation(options!.requestId!))
      .mockRejectedValueOnce(new ApiRequestError('请求超时', 408))
      .mockImplementationOnce(async (_box, _version, _codes, options) => receipt(options!.requestId!));
    await flow.submit(); await flow.continueMixed(); expect(bind).toHaveBeenCalledTimes(2);
    expect(flow.mixed.value).not.toBeNull(); expect(flow.pending.value).toHaveLength(1);
    await flow.continueMixed(); expect(bind.mock.calls[2]).toEqual(bind.mock.calls[1]); expect(flow.box.value).toBeNull();
  });
  it('drops expired confirmation on conflict, retains the page and requires a new confirmation flow', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bind').mockImplementationOnce(async (_box, _version, _codes, options) => confirmation(options!.requestId!))
      .mockRejectedValueOnce(new ApiRequestError('确认凭据已失效', 409))
      .mockImplementationOnce(async (_box, _version, _codes, options) => confirmation(options!.requestId!));
    await flow.submit(); await flow.continueMixed();
    expect(flow.pending.value).toHaveLength(1); expect(flow.mixed.value).toBeNull(); expect(flow.notice.value?.text).toContain('重新扫描');
    await flow.continueMixed(); expect(bind).toHaveBeenCalledTimes(2);
    await flow.submit(); expect(bind.mock.calls[2][3]).not.toHaveProperty('confirmationToken');
    expect(bind.mock.calls[2][3]!.requestId).not.toBe(bind.mock.calls[1][3]!.requestId);
  });
  it.each(['token', 'requestId', 'version', 'kind', 'operationNo'])('rejects malformed confirmation %s without reporting success', async kind => {
    const flow = await ready();
    vi.spyOn(api, 'bind').mockImplementation(async (_box, _version, _codes, options) => {
      const value = confirmation(options!.requestId!);
      if (kind === 'token') value.confirmationToken = '';
      if (kind === 'requestId') value.requestId = 'other';
      if (kind === 'version') value.box.version = 3;
      if (kind === 'kind') value.confirmationType = 'UNKNOWN' as 'MIXED_CONTENT';
      if (kind === 'operationNo') Object.assign(value, { operationNo: 'invalid-success' });
      return value;
    });
    await flow.submit(); expect(flow.mixed.value).toBeNull(); expect(flow.pending.value).toHaveLength(1); expect(flow.notice.value?.error).toBe(true);
  });
  it('keeps a malformed final receipt unresolved and manually retries its original ID', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bind').mockImplementationOnce(async (_box, _version, _codes, options) => ({ ...receipt(options!.requestId!), requestId: 'other' }))
      .mockImplementationOnce(async (_box, _version, _codes, options) => receipt(options!.requestId!));
    await flow.submit(); expect(flow.pending.value).toHaveLength(1); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(bind.mock.calls[1]).toEqual(bind.mock.calls[0]); expect(flow.box.value).toBeNull();
  });
  it.each(['UNKNOWN', 'LOADED'] as const)('does not interpret %s with no panel rows as EMPTY', async contentState => {
    vi.spyOn(api, 'getBox').mockResolvedValue({ ...box(), empty: false, contentState, runtimeUsage: 'FIXTURE' });
    const flow = usePanelPacking(); await flow.scan('BOX-1');
    expect(flow.box.value?.contentState).toBe(contentState); expect(flow.box.value?.empty).toBe(false); expect(flow.review.value).toBeNull();
    flow.clear(); vi.mocked(api.getBox).mockResolvedValue({ ...box(), contentState }); await flow.scan('BOX-1');
    expect(flow.box.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('requires batches on bound lines, permits missing names/units, and permits absent candidate batches', async () => {
    const value = boundBox(); vi.spyOn(api, 'getBox').mockResolvedValue(value);
    const flow = usePanelPacking(); await flow.scan('BOX-1'); flow.keepBindings();
    const candidate = panel(); delete (candidate as { materialBatch?: string }).materialBatch;
    vi.spyOn(api, 'getPanel').mockResolvedValue(candidate); await flow.scan('P1'); expect(flow.pending.value).toHaveLength(1);
    flow.clear(); const invalid = boundBox(); delete (invalid.bindings[0] as { materialBatch?: string }).materialBatch;
    vi.mocked(api.getBox).mockResolvedValue(invalid); await flow.scan('BOX-1'); expect(flow.review.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('does not mix binding modes in the same cycle after keeping quantity bindings', async () => {
    const value = boundBox(); value.bindings[0].bindingMode = 'BY_ORDER'; delete value.bindings[0].panelCode;
    vi.spyOn(api, 'getBox').mockResolvedValue(value); const flow = usePanelPacking(); await flow.scan('BOX-1'); flow.keepBindings();
    const query = vi.spyOn(api, 'getPanel'); await flow.scan('P1'); expect(query).not.toHaveBeenCalled(); expect(flow.canStage.value).toBe(false);
    expect(flow.notice.value?.text).toContain('数量绑箱');
  });
  it('refreshes physical state after all-unbind and retains returned versions without assuming fixture emptiness', async () => {
    const get = vi.spyOn(api, 'getBox').mockResolvedValueOnce(boundBox()).mockResolvedValueOnce({ ...box(), box: { ...box().box, version: 3 },
      empty: false, contentState: 'LOADED', runtimeUsage: 'FIXTURE', eligibility: { allowed: false, reason: '该治具箱仍非空' } });
    const flow = usePanelPacking(); await flow.scan('BOX-1');
    vi.spyOn(api, 'unbindAll').mockResolvedValue({ ...receipt('unused'), box: { boxCode: 'BOX-1', version: 3, materialQuantity: 0 } });
    await flow.unbindAll(); expect(get).toHaveBeenCalledTimes(2); expect(flow.box.value?.box.version).toBe(3);
    expect(flow.box.value?.contentState).toBe('LOADED'); expect(flow.box.value?.empty).toBe(false); expect(flow.canStage.value).toBe(false);
    expect(flow.notice.value?.text).toBe('该治具箱仍非空');
  });
  it('keeps an unknown locked snapshot if unbind succeeded but refreshing the box fails', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValueOnce(boundBox()).mockRejectedValueOnce(new Error('连接失败'));
    const flow = usePanelPacking(); await flow.scan('BOX-1');
    vi.spyOn(api, 'unbindAll').mockResolvedValue({ ...receipt('unused'), box: { boxCode: 'BOX-1', version: 3, materialQuantity: 0 } });
    await flow.unbindAll(); expect(flow.box.value?.empty).toBe(false); expect(flow.box.value?.contentState).toBe('UNKNOWN');
    expect(flow.box.value?.box.version).toBe(3); expect(flow.notice.value?.text).toContain('一键解绑已完成'); expect(flow.canStage.value).toBe(false);
  });
  it('drops late confirmation replies after hide/reset and starts clean when shown again', async () => {
    const flow = await ready(); let resolve!: (result: BoxBindingResult) => void;
    const bind = vi.spyOn(api, 'bind').mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = flow.submit(); await flow.submit(); expect(bind).toHaveBeenCalledOnce(); flow.pause();
    resolve(confirmation(bind.mock.calls[0][3]!.requestId!)); await work;
    expect(flow.mixed.value).toBeNull(); expect(flow.pending.value).toEqual([]); expect(flow.notice.value).toBeNull();
    await flow.scan('BOX-1'); expect(api.getBox).toHaveBeenCalledOnce(); flow.resume(); await flow.scan('BOX-1'); expect(flow.box.value).not.toBeNull();
  });
  it('renders batch text, omits missing names, confirms without clearing, and resets on hide', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValue(boundBox()); vi.spyOn(api, 'getPanel').mockResolvedValue(panel());
    vi.spyOn(api, 'bind').mockImplementation(async (_box, _version, _codes, options) => confirmation(options!.requestId!));
    const wrapper = mount(PackingPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show()); wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await vi.dynamicImportSettled();
      await wrapper.findAll('.modal-actions button')[0].trigger('tap');
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'P1'); await vi.dynamicImportSettled();
      expect(wrapper.text()).toContain('批次 000002'); expect(wrapper.text()).toContain('批次 000001'); expect(wrapper.text()).not.toContain('MAT-1 ·');
      await wrapper.findAll('.footer button')[2].trigger('tap'); await vi.dynamicImportSettled();
      expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('混料确认'); expect(wrapper.findAll('.material-card')).toHaveLength(2);
      expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true); expect(wrapper.findAll('.footer button')[0].attributes('disabled')).toBeDefined();
      await wrapper.findAll('.modal-actions button')[0].trigger('tap'); expect(wrapper.findAll('.material-card')).toHaveLength(2);
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.find('.box-card').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
