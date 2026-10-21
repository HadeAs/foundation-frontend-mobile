import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useOrderPacking } from '../../composables/useOrderPacking';
import PackingPage from '../../pages/order-packing/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { panelPackingApi as api, type BoxBindings, type BoxBindingConfirmation, type BoxReceipt, type BoxBindingResult } from '../panelPacking';
import { ApiRequestError } from '../nariRequest';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const panelCode = '123456789ABC000001ABCDEFG00001234';
const box = (): BoxBindings => ({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 2 },
  empty: true, contentState: 'EMPTY', runtimeUsage: 'MATERIAL', bindings: [], totalQuantity: 0, eligibility: { allowed: true } });
const panel = (code = panelCode) => ({ panelCode: code, orderNo: 'ORDER-1', materialCode: 'MAT-1', materialBatch: '000001', eligibility: { allowed: true } });
const boundBox = (mode: 'BY_CODE' | 'BY_ORDER' = 'BY_ORDER'): BoxBindings => ({ ...box(), empty: false, contentState: 'LOADED', totalQuantity: 3,
  bindings: [{ id: '9007199254741001', version: 1, bindingMode: mode, ...(mode === 'BY_CODE' ? { panelCode } : {}),
    materialCode: 'MAT-1', materialBatch: '000002', orderNo: 'ORDER-OLD', quantity: mode === 'BY_CODE' ? 1 : 3 }] });
function byCodeBox() { const value = boundBox('BY_CODE'); value.totalQuantity = 1; return value; }
function confirmation(id: string): BoxBindingConfirmation {
  return { resultType: 'CONFIRMATION_REQUIRED', requestId: id, confirmationType: 'MIXED_CONTENT',
    box: box().box, confirmationToken: 'server-token-not-client-generated', message: '本次存在混料，混装仅用于缴库，不参与生产配送，是否继续？' };
}
function receipt(id: string, quantity = 2): BoxReceipt {
  return { requestId: id, affectedCount: 1, processedTime: '2026-10-12T02:00:00Z',
    box: { boxCode: 'BOX-1', version: 3, materialQuantity: quantity } };
}
async function ready(value = box()) {
  vi.spyOn(api, 'getBox').mockResolvedValue(value); vi.spyOn(api, 'getPanel').mockImplementation(async code => panel(code));
  const flow = useOrderPacking(); await flow.scan('BOX-1'); await flow.scan(panelCode); flow.quantity.value = '2'; return flow;
}
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('order packing 2026-10-12.1', () => {
  it('appends to quantity bindings without an all-unbind or per-piece identity and accepts a receipt without operationNo', async () => {
    const flow = await ready(boundBox());
    expect(flow.review.value).toBeNull(); expect(flow.box.value?.totalQuantity).toBe(3); expect(flow.canSubmit.value).toBe(true);
    const bind = vi.spyOn(api, 'bindByOrder').mockImplementation(async (_box, _version, _order, _qty, _panel, options) => receipt(options!.requestId!, 5));
    const unbind = vi.spyOn(api, 'unbindAll');
    await flow.submit(); expect(unbind).not.toHaveBeenCalled();
    expect(bind.mock.calls[0].slice(0, 5)).toEqual(['BOX-1', 2, 'ORDER-1', 2, panelCode]);
    expect(flow.box.value).toBeNull(); expect(flow.representative.value).toBeNull(); expect(flow.quantity.value).toBe('');
  });
  it('requires full-unbind to switch from code bindings and refreshes the actual box without rescanning', async () => {
    const get = vi.spyOn(api, 'getBox').mockResolvedValueOnce(byCodeBox()).mockResolvedValueOnce({ ...box(), box: { ...box().box, version: 4 } });
    const flow = useOrderPacking(); await flow.scan('BOX-1');
    expect(flow.review.value?.totalQuantity).toBe(1); expect(flow.box.value).toBeNull();
    const query = vi.spyOn(api, 'getPanel'); await flow.scan(panelCode); expect(query).not.toHaveBeenCalled();
    vi.spyOn(api, 'unbindAll').mockResolvedValue(receipt('unbind', 0));
    await flow.unbindAll(); expect(get.mock.calls).toEqual([['BOX-1'], ['BOX-1']]);
    expect(flow.review.value).toBeNull(); expect(flow.box.value?.box.version).toBe(4); expect(flow.box.value?.contentState).toBe('EMPTY');
    vi.mocked(api.getPanel).mockResolvedValue(panel()); await flow.scan(panelCode); flow.quantity.value = '1'; expect(flow.canSubmit.value).toBe(true);
  });
  it('retains an unknown locked snapshot if all-unbind completed but refresh failed', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValueOnce(byCodeBox()).mockRejectedValueOnce(new Error('连接失败'));
    vi.spyOn(api, 'unbindAll').mockResolvedValue(receipt('unbind', 0));
    const flow = useOrderPacking(); await flow.scan('BOX-1'); await flow.unbindAll();
    expect(flow.box.value?.box.version).toBe(3); expect(flow.box.value?.empty).toBe(false); expect(flow.box.value?.contentState).toBe('UNKNOWN');
    expect(flow.review.value).toBeNull(); expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.text).toContain('一键解绑已完成');
  });
  it('does not mistake a fixture with no panel bindings for an empty box after all-unbind', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValueOnce(byCodeBox()).mockResolvedValueOnce({ ...box(), box: { ...box().box, version: 3 },
      empty: false, contentState: 'LOADED', runtimeUsage: 'FIXTURE', eligibility: { allowed: false, reason: '该治具箱仍非空' } });
    vi.spyOn(api, 'unbindAll').mockResolvedValue(receipt('unbind', 0));
    const flow = useOrderPacking(); await flow.scan('BOX-1'); await flow.unbindAll();
    expect(flow.box.value?.contentState).toBe('LOADED'); expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.text).toBe('该治具箱仍非空');
  });
  it.each(['UNKNOWN', 'LOADED'] as const)('uses actual %s content even when there are no binding rows', async contentState => {
    vi.spyOn(api, 'getBox').mockResolvedValue({ ...box(), empty: false, contentState, runtimeUsage: 'FIXTURE' });
    const flow = useOrderPacking(); await flow.scan('BOX-1');
    expect(flow.box.value?.contentState).toBe(contentState); expect(flow.box.value?.empty).toBe(false); expect(flow.review.value).toBeNull();
  });
  it('requires a batch on binding lines and rejects inconsistent empty or quantity data', async () => {
    const get = vi.spyOn(api, 'getBox'); const flow = useOrderPacking();
    const noBatch = boundBox(); delete (noBatch.bindings[0] as { materialBatch?: string }).materialBatch;
    for (const value of [noBatch, { ...boundBox(), empty: true }, { ...boundBox(), totalQuantity: 4 }]) {
      get.mockResolvedValue(value); flow.clear(); await flow.scan('BOX-1');
      expect(flow.box.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
    }
  });
  it('uses the actual representative code without parsing it locally and retains metadata after invalid scans', async () => {
    const flow = await ready(); const get = vi.mocked(api.getPanel);
    const value = { ...panel('X'.repeat(128)), orderNo: 'OTHER-ORDER', currentBoxCode: 'OTHER-BOX', eligibility: { allowed: false } };
    delete (value as { materialBatch?: string }).materialBatch;
    get.mockResolvedValue(value); await flow.scan(` ${value.panelCode} `);
    expect(flow.order.value).toBe('OTHER-ORDER'); expect(flow.representative.value?.panelCode).toBe(value.panelCode);
    expect(flow.representative.value?.materialBatch).toBeUndefined(); expect(flow.canSubmit.value).toBe(true);
    const calls = get.mock.calls.length;
    await flow.scan('SHORT'); await flow.scan('X'.repeat(129)); expect(get.mock.calls).toHaveLength(calls);
    expect(flow.order.value).toBe('OTHER-ORDER');
    get.mockResolvedValue({ ...panel(), panelCode: 'other' }); await flow.scan(panelCode); expect(flow.order.value).toBe('OTHER-ORDER');
    get.mockResolvedValue({ ...panel(), orderNo: '' }); await flow.scan(panelCode); expect(flow.order.value).toBe('OTHER-ORDER');
  });
  it('treats a 200 mixed confirmation as non-mutating, blocks scans/submits and cancels without clearing', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bindByOrder').mockImplementation(async (_box, _version, _order, _qty, _panel, options) => confirmation(options!.requestId!));
    await flow.submit(); expect(flow.box.value?.box.version).toBe(2); expect(flow.notice.value).toBeNull(); expect(flow.mixed.value).not.toBeNull();
    expect(flow.canSubmit.value).toBe(false); await flow.scan('X'.repeat(33)); await flow.submit(); expect(bind).toHaveBeenCalledOnce();
    expect(api.getPanel).toHaveBeenCalledOnce(); flow.cancelMixed(); expect(flow.mixed.value).toBeNull();
    expect(flow.order.value).toBe('ORDER-1'); expect(flow.quantity.value).toBe('2'); expect(flow.canSubmit.value).toBe(true);
  });
  it('continues with a new request ID, server token and frozen representative/order/quantity', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bindByOrder').mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => confirmation(options!.requestId!))
      .mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => receipt(options!.requestId!));
    await flow.submit(); flow.quantity.value = '99'; await flow.continueMixed();
    expect(bind.mock.calls[1].slice(0, 5)).toEqual(bind.mock.calls[0].slice(0, 5));
    expect(bind.mock.calls[1][5]).toEqual({ requestId: expect.any(String), confirmMixed: true, confirmationToken: 'server-token-not-client-generated' });
    expect(bind.mock.calls[1][5]!.requestId).not.toBe(bind.mock.calls[0][5]!.requestId);
    expect(flow.box.value).toBeNull(); expect(flow.notice.value?.text).toBe('装箱成功');
  });
  it('does not auto-retry an uncertain confirmed submission and manually reuses its ID and inputs', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bindByOrder').mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => confirmation(options!.requestId!))
      .mockRejectedValueOnce(new ApiRequestError('请求超时', 408))
      .mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => receipt(options!.requestId!));
    await flow.submit(); await flow.continueMixed(); expect(bind).toHaveBeenCalledTimes(2); expect(flow.mixed.value).not.toBeNull();
    await flow.continueMixed(); expect(bind.mock.calls[2]).toEqual(bind.mock.calls[1]); expect(flow.box.value).toBeNull();
  });
  it('retries an unchanged uncertain initial submission with its original ID but gives an explicit refusal a new ID', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bindByOrder').mockRejectedValueOnce(new ApiRequestError('服务器异常', 503))
      .mockRejectedValueOnce(new ApiRequestError('业务拒绝', 400))
      .mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => receipt(options!.requestId!));
    await flow.submit(); expect(bind).toHaveBeenCalledOnce(); await flow.submit();
    expect(bind.mock.calls[1]).toEqual(bind.mock.calls[0]); expect(flow.quantity.value).toBe('2'); await flow.submit();
    expect(bind.mock.calls[2][5]!.requestId).not.toBe(bind.mock.calls[1][5]!.requestId); expect(flow.box.value).toBeNull();
  });
  it('discards expired mixed tokens and requires box requery after a version conflict', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bindByOrder').mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => confirmation(options!.requestId!))
      .mockRejectedValueOnce(new ApiRequestError('确认凭据已失效', 409));
    await flow.submit(); await flow.continueMixed();
    expect(flow.mixed.value).toBeNull(); expect(flow.canSubmit.value).toBe(false); expect(flow.order.value).toBe('ORDER-1');
    await flow.continueMixed(); await flow.submit(); expect(bind).toHaveBeenCalledTimes(2);
    flow.clear(); await flow.scan('BOX-1'); await flow.scan(panelCode); flow.quantity.value = '2';
    bind.mockImplementation(async (_box, _version, _order, _qty, _panel, options) => receipt(options!.requestId!)); await flow.submit();
    expect(bind.mock.calls[2][5]).not.toHaveProperty('confirmationToken'); expect(flow.box.value).toBeNull();
  });
  it.each(['token', 'requestId', 'version', 'kind', 'operationNo'])('rejects malformed mixed confirmation %s without clearing', async kind => {
    const flow = await ready();
    vi.spyOn(api, 'bindByOrder').mockImplementation(async (_box, _version, _order, _qty, _panel, options) => {
      const value = confirmation(options!.requestId!);
      if (kind === 'token') value.confirmationToken = '';
      if (kind === 'requestId') value.requestId = 'other';
      if (kind === 'version') value.box.version = 3;
      if (kind === 'kind') value.confirmationType = 'UNKNOWN' as 'MIXED_CONTENT';
      if (kind === 'operationNo') Object.assign(value, { operationNo: 'invalid-success' });
      return value;
    });
    await flow.submit(); expect(flow.mixed.value).toBeNull(); expect(flow.representative.value).not.toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('keeps an invalid success receipt unresolved and permits original-ID manual retry', async () => {
    const flow = await ready();
    const bind = vi.spyOn(api, 'bindByOrder').mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => ({ ...receipt(options!.requestId!), requestId: 'other' }))
      .mockImplementationOnce(async (_box, _version, _order, _qty, _panel, options) => receipt(options!.requestId!));
    await flow.submit(); expect(flow.box.value).not.toBeNull(); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(bind.mock.calls[1]).toEqual(bind.mock.calls[0]); expect(flow.box.value).toBeNull();
  });
  it('prevents duplicates and ignores a late confirmation after hide/reset', async () => {
    const flow = await ready(); let resolve!: (result: BoxBindingResult) => void;
    const bind = vi.spyOn(api, 'bindByOrder').mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = flow.submit(); await flow.submit(); expect(bind).toHaveBeenCalledOnce(); flow.pause();
    resolve(confirmation(bind.mock.calls[0][5]!.requestId!)); await work;
    expect(flow.box.value).toBeNull(); expect(flow.mixed.value).toBeNull(); expect(flow.representative.value).toBeNull(); expect(flow.notice.value).toBeNull();
    await flow.scan('BOX-1'); expect(api.getBox).toHaveBeenCalledOnce(); flow.resume(); await flow.scan('BOX-1'); expect(flow.box.value).not.toBeNull();
  });
  it('renders actual content/counts, a read-only order and optional batch with no missing-name separator', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValue(boundBox()); vi.spyOn(api, 'getPanel').mockResolvedValue(panel());
    vi.spyOn(api, 'bindByOrder').mockImplementation(async (_box, _version, _order, _qty, _panel, options) => confirmation(options!.requestId!));
    const wrapper = mount(PackingPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show()); wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await vi.dynamicImportSettled();
      expect(wrapper.text()).toContain('已确认非空'); expect(wrapper.text()).toContain('3 件'); expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      wrapper.getComponent(ScanInput).vm.$emit('scan', panelCode); await vi.dynamicImportSettled();
      const orderInput = wrapper.get('[aria-label="订单号"]'); expect(orderInput.attributes('disabled')).toBeDefined(); expect(orderInput.attributes('aria-readonly')).toBe('true');
      expect((orderInput.element as HTMLInputElement).value).toBe('ORDER-1'); expect(wrapper.text()).toContain('批次 000001'); expect(wrapper.text()).not.toContain('MAT-1 ·');
      await wrapper.get('[aria-label="数量"]').setValue('2'); await wrapper.findAll('.footer button')[1].trigger('tap'); await vi.dynamicImportSettled();
      expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('混料确认'); expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true);
      expect(wrapper.get('[aria-label="数量"]').attributes('disabled')).toBeDefined(); expect(wrapper.findAll('.footer button')[0].attributes('disabled')).toBeDefined();
      await wrapper.findAll('.modal-actions button')[0].trigger('tap'); expect(wrapper.text()).toContain(panelCode);
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.find('.box-card').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it('declines a binding-mode switch by invalidating only the scan, without sending unbind', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValue(byCodeBox()); const unbind = vi.spyOn(api, 'unbindAll');
    const wrapper = mount(PackingPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show()); wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await vi.dynamicImportSettled();
      expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('一键解绑确认');
      await wrapper.findAll('.modal-actions button')[0].trigger('tap'); expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.find('.box-card').exists()).toBe(false); expect(unbind).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
});
