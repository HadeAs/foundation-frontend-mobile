import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { usePanelUnbinding } from '../../composables/usePanelUnbinding';
import UnbindingPage from '../../pages/panel-unbinding/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { panelPackingApi as api, type BoxBindings, type BoxReceipt } from '../panelPacking';
import { ApiRequestError } from '../nariRequest';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const pageStubs = {
  'scroll-view': { props: ['scrollY'], template: '<div><slot /></div>' },
  'checkbox-group': { template: '<div><slot /></div>' },
  checkbox: { props: ['value', 'checked', 'disabled'], template: '<input type="checkbox" :value="value" :checked="checked" :disabled="disabled" />' }
};
const box = (): BoxBindings => ({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 2 },
  contentState: 'LOADED', empty: false, runtimeUsage: 'MATERIAL', eligibility: { allowed: true }, totalQuantity: 4,
  bindings: [
    { id: '9007199254741001', version: 3, bindingMode: 'BY_CODE', panelCode: 'PANEL-1', materialCode: 'MAT-1', materialBatch: '000001', orderNo: 'ORDER-1', quantity: 1 },
    { id: '9007199254741002', version: 4, bindingMode: 'BY_ORDER', materialCode: 'MAT-2', materialBatch: '000002', orderNo: 'ORDER-2', quantity: 3 }
  ] });
function receipt(id: string, remaining = 3, count = 1): BoxReceipt {
  return { requestId: id, operationNo: 'OP-1', affectedCount: count, processedTime: '2026-10-12T06:00:00Z',
    box: { boxCode: 'BOX-1', version: 3, materialQuantity: remaining } };
}
async function ready(value = box()) {
  vi.spyOn(api, 'getBox').mockResolvedValue(value);
  const flow = usePanelUnbinding(); await flow.scan('BOX-1'); return flow;
}
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('panel unbinding 2026-10-12.1', () => {
  it.each(['UNKNOWN', 'LOADED'] as const)('accepts %s with no panel relations without interpreting it as physical emptiness', async contentState => {
    const flow = await ready({ ...box(), bindings: [], totalQuantity: 0, contentState, runtimeUsage: 'FIXTURE' });
    expect(flow.box.value?.contentState).toBe(contentState); expect(flow.box.value?.empty).toBe(false);
    expect(flow.notice.value).toBeNull(); expect(flow.canUnbindAll.value).toBe(false);
    flow.requestUnbind('all'); expect(flow.confirmation.value).toBeNull();
  });
  it.each(['batch', 'empty', 'quantity', 'identity', 'duplicate', 'codeQuantity', 'orderCode', 'eligibility'])('rejects an inconsistent full snapshot: %s', async kind => {
    const value = box();
    if (kind === 'batch') delete (value.bindings[0] as { materialBatch?: string }).materialBatch;
    if (kind === 'empty') value.empty = true;
    if (kind === 'quantity') value.totalQuantity = 3;
    if (kind === 'identity') Object.assign(value.bindings[0], { id: 9007199254741001 });
    if (kind === 'duplicate') value.bindings[1].id = value.bindings[0].id;
    if (kind === 'codeQuantity') { value.bindings[0].quantity = 2; value.totalQuantity = 5; }
    if (kind === 'orderCode') value.bindings[1].panelCode = 'fabricated';
    if (kind === 'eligibility') value.eligibility = { allowed: false };
    const flow = await ready(value); expect(flow.box.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('keeps a disallowed box visible but disables scanning selection and both unbind actions', async () => {
    const flow = await ready({ ...box(), eligibility: { allowed: false, reason: '当前箱有任务预占' } });
    expect(flow.box.value?.bindings).toHaveLength(2); expect(flow.notice.value?.text).toBe('当前箱有任务预占');
    expect(flow.canUnbindAll.value).toBe(false); flow.toggle('9007199254741001'); await flow.scan('PANEL-1');
    flow.requestUnbind('all'); flow.requestUnbind('selected'); expect(flow.selected.value).toEqual([]); expect(flow.confirmation.value).toBeNull();
  });
  it('matches only true panel codes locally and sends string relationship IDs/versions for whole quantity rows', async () => {
    const flow = await ready(); const panels = vi.spyOn(api, 'getPanel');
    await flow.scan(' PANEL-1 '); await flow.scan('PANEL-1'); expect(flow.selected.value).toEqual(['9007199254741001']);
    await flow.scan('MAT-2'); expect(flow.selected.value).toEqual(['9007199254741001']); expect(panels).not.toHaveBeenCalled();
    flow.toggle('9007199254741002'); flow.requestUnbind('selected'); expect(flow.confirmCount.value).toBe(2);
    const submit = vi.spyOn(api, 'unbindSelected').mockImplementation(async (_code, _version, _items, id) => receipt(id!, 0, 2));
    await flow.submit(); expect(submit).toHaveBeenCalledWith('BOX-1', 2, [
      { id: '9007199254741001', version: 3 }, { id: '9007199254741002', version: 4 }
    ], expect.any(String));
    expect(flow.box.value).toBeNull(); expect(flow.selected.value).toEqual([]); expect(flow.notice.value?.text).toBe('解绑成功');
  });
  it('does not cap or truncate full queries and all-unbind, but stops selected batches above 1000', async () => {
    const value = box(); value.bindings = Array.from({ length: 1001 }, (_, index) => ({ ...value.bindings[0], id: String(index + 1), panelCode: `P-${index}` }));
    value.totalQuantity = 1001; const flow = await ready(value); expect(flow.box.value?.bindings).toHaveLength(1001);
    value.bindings.forEach(item => flow.toggle(item.id)); expect(flow.selected.value).toHaveLength(1000);
    expect(flow.canUnbindSelected.value).toBe(true); expect(flow.notice.value?.text).toContain('1000');
    flow.requestUnbind('all'); expect(flow.confirmCount.value).toBe(1001);
    const submit = vi.spyOn(api, 'unbindAll').mockImplementation(async (_code, _version, id) => receipt(id!, 0, 1001));
    await flow.submit(); expect(submit).toHaveBeenCalledWith('BOX-1', 2, expect.any(String)); expect(flow.box.value).toBeNull();
  });
  it('cancels without losing selection and blocks background edits during confirmation', async () => {
    const flow = await ready(); await flow.scan('PANEL-1'); flow.requestUnbind('selected');
    flow.toggle('9007199254741002'); await flow.scan('PANEL-1'); expect(flow.selected.value).toEqual(['9007199254741001']);
    expect(flow.canUnbindAll.value).toBe(false); flow.cancel(); expect(flow.selected.value).toEqual(['9007199254741001']);
    const submit = vi.spyOn(api, 'unbindSelected'); await flow.submit(); expect(submit).not.toHaveBeenCalled(); expect(flow.canUnbindSelected.value).toBe(true);
  });
  it('manually retries uncertain results with the exact original ID and changes ID after an explicit rejection', async () => {
    const flow = await ready(); await flow.scan('PANEL-1'); flow.requestUnbind('selected');
    const submit = vi.spyOn(api, 'unbindSelected').mockRejectedValueOnce(new ApiRequestError('请求超时', 408))
      .mockRejectedValueOnce(new ApiRequestError('业务拒绝', 400))
      .mockImplementationOnce(async (_code, _version, _items, id) => receipt(id!));
    await flow.submit(); expect(submit).toHaveBeenCalledOnce(); expect(flow.confirmation.value).toBe('selected');
    await flow.submit(); expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]); expect(flow.selected.value).toHaveLength(1);
    await flow.submit(); expect(submit.mock.calls[2][3]).not.toBe(submit.mock.calls[1][3]); expect(flow.box.value).toBeNull();
  });
  it('replays an uncertain entire-box request without adding selected items', async () => {
    const flow = await ready(); flow.requestUnbind('all');
    const submit = vi.spyOn(api, 'unbindAll').mockRejectedValueOnce(new ApiRequestError('响应未知', 503))
      .mockImplementationOnce(async (_code, _version, id) => receipt(id!, 0, 2));
    await flow.submit(); expect(submit).toHaveBeenCalledOnce(); await flow.submit();
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]); expect(submit.mock.calls[0]).toHaveLength(3); expect(flow.box.value).toBeNull();
  });
  it.each(['requestId', 'boxCode', 'version', 'remaining', 'count', 'time', 'resultType'])('retains data on a malformed completed receipt: %s', async kind => {
    const flow = await ready(); await flow.scan('PANEL-1'); flow.requestUnbind('selected');
    const submit = vi.spyOn(api, 'unbindSelected').mockImplementationOnce(async (_code, _version, _items, id) => {
      const value = receipt(id!);
      if (kind === 'requestId') value.requestId = 'other';
      if (kind === 'boxCode') value.box.boxCode = 'OTHER-BOX';
      if (kind === 'version') value.box.version = 2;
      if (kind === 'remaining') value.box.materialQuantity = 0;
      if (kind === 'count') value.affectedCount = 4;
      if (kind === 'time') value.processedTime = 'not-a-date';
      if (kind === 'resultType') Object.assign(value, { resultType: 'CONFIRMATION_REQUIRED' });
      return value;
    }).mockImplementationOnce(async (_code, _version, _items, id) => receipt(id!));
    await flow.submit(); expect(flow.box.value?.box.version).toBe(2); expect(flow.selected.value).toHaveLength(1);
    expect(flow.confirmation.value).toBe('selected'); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]); expect(flow.box.value).toBeNull();
  });
  it('rejects an entire-box receipt that did not remove all relationships', async () => {
    const flow = await ready(); flow.requestUnbind('all');
    vi.spyOn(api, 'unbindAll').mockImplementation(async (_code, _version, id) => receipt(id!, 1, 2));
    await flow.submit(); expect(flow.box.value).not.toBeNull(); expect(flow.confirmation.value).toBe('all'); expect(flow.notice.value?.error).toBe(true);
  });
  it('ignores a late query when hidden and resumes with a clean page', async () => {
    let resolve!: (value: BoxBindings) => void; const get = vi.spyOn(api, 'getBox').mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(box());
    const flow = usePanelUnbinding(); const work = flow.scan('BOX-1'); flow.pause(); resolve(box()); await work;
    expect(flow.box.value).toBeNull(); expect(flow.notice.value).toBeNull(); await flow.scan('BOX-1'); expect(get).toHaveBeenCalledOnce();
    flow.resume(); await flow.scan('BOX-1'); expect(flow.box.value).not.toBeNull();
  });
  it('prevents duplicate writes and ignores a late completed receipt after hiding', async () => {
    const flow = await ready(); await flow.scan('PANEL-1'); flow.requestUnbind('selected');
    let resolve!: (value: BoxReceipt) => void; const submit = vi.spyOn(api, 'unbindSelected').mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = flow.submit(); await flow.submit(); expect(submit).toHaveBeenCalledOnce(); flow.pause();
    resolve(receipt(submit.mock.calls[0][3]!)); await work;
    expect(flow.box.value).toBeNull(); expect(flow.selected.value).toEqual([]); expect(flow.confirmation.value).toBeNull(); expect(flow.notice.value).toBeNull();
  });
  it('renders per-line batches and optional text, keeps modal context, then resets on hide', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValue(box());
    const wrapper = mount(UnbindingPage, { global: { stubs: pageStubs } });
    try {
      hooks.show.forEach(show => show()); wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await vi.dynamicImportSettled();
      expect(wrapper.text()).toContain('已确认非空'); expect(wrapper.text()).toContain('批次 000001'); expect(wrapper.text()).toContain('批次 000002');
      expect(wrapper.text()).not.toContain('MAT-1 ·'); expect(wrapper.text()).not.toContain('undefined'); expect(wrapper.findAll('.binding-row')).toHaveLength(2);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'PANEL-1'); await wrapper.vm.$nextTick();
      await wrapper.findAll('.footer button')[2].trigger('tap'); expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('确认解绑');
      expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true); expect(wrapper.findAll('.binding-row input[type="checkbox"]')[0].attributes('disabled')).toBeDefined();
      await wrapper.findAll('.modal-actions button')[0].trigger('tap'); expect(wrapper.text()).toContain('已选 1 / 2');
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.find('.box-card').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it('disables footer and checkboxes for a visible ineligible box', async () => {
    vi.spyOn(api, 'getBox').mockResolvedValue({ ...box(), eligibility: { allowed: false, reason: '暂不允许解绑' } });
    const wrapper = mount(UnbindingPage, { global: { stubs: pageStubs } });
    try {
      hooks.show.forEach(show => show()); wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await vi.dynamicImportSettled();
      expect(wrapper.find('.box-card').exists()).toBe(true); expect(wrapper.findAll('.footer button')[1].attributes('disabled')).toBeDefined();
      expect(wrapper.findAll('.footer button')[2].attributes('disabled')).toBeDefined(); expect(wrapper.findAll('.binding-row input[type="checkbox"]')[0].attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });
});
