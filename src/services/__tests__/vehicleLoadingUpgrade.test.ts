import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useVehicleLoading } from '../../composables/useVehicleLoading';
import LoadingPage from '../../pages/vehicle-loading/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { vehicleLoadingApi as api, type VehicleSlot, type LoadingBox } from '../vehicleLoading';
import { ApiRequestError } from '../nariRequest';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const slot = (code = 'SLOT-1', vehicleCode = 'CAR-1'): VehicleSlot => ({ slotCode: code, version: 2,
  vehicle: { containerType: 'VEHICLE', containerCode: vehicleCode, version: 3 }, eligibility: { allowed: true } });
const box = (code = 'BOX-1'): LoadingBox => ({ box: { containerType: 'BOX', containerCode: code, version: 4, contentState: 'LOADED', runtimeUsage: 'FIXTURE' }, eligibility: { allowed: true } });
type Receipt = Awaited<ReturnType<typeof api.load>>;
const receipt = (requestId: string, affectedCount = 1): Receipt => ({ requestId, affectedCount, processedTime: '2026-10-12T07:00:00Z' });
async function ready() {
  vi.spyOn(api, 'getSlot').mockImplementation(async code => slot(code, code === 'SLOT-2' ? 'CAR-2' : 'CAR-1'));
  vi.spyOn(api, 'getBox').mockImplementation(async code => box(code));
  const flow = useVehicleLoading(); await flow.scan('SLOT-1'); await flow.scan('BOX-1'); return flow;
}
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('vehicle loading 2026-10-12.1', () => {
  it('keeps all pairs on an incomplete or partial completed receipt instead of reporting success', async () => {
    const flow = await ready();
    const load = vi.spyOn(api, 'load').mockImplementationOnce(async (_items, id) => receipt(id!, 0))
      .mockImplementationOnce(async (_items, id) => receipt(id!));
    await flow.submit(); expect(flow.pairs.value).toHaveLength(1); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(load.mock.calls[1]).toEqual(load.mock.calls[0]); expect(flow.pairs.value).toEqual([]);
  });
  it.each(['EMPTY', 'UNKNOWN', 'LOADED', undefined] as const)('does not invent empty status or block backend-eligible contents: %s', async contentState => {
    const flow = await ready(); flow.clear(); await flow.scan('SLOT-1');
    const value = box(); value.box.contentState = contentState; vi.mocked(api.getBox).mockResolvedValue(value); await flow.scan('BOX-1');
    expect(flow.pairs.value[0].box?.box.contentState).toBe(contentState); expect(flow.canSubmit.value).toBe(true); expect(flow.notice.value).toBeNull();
  });
  it('honors direct-binding ineligibility without implicitly unbinding or changing scan phase', async () => {
    const flow = await ready(); flow.clear(); await flow.scan('SLOT-1');
    vi.mocked(api.getBox).mockResolvedValue({ ...box(), eligibility: { allowed: false, reason: '料箱已直接绑定料车 CAR-DIRECT，不能库位装载' } });
    const load = vi.spyOn(api, 'load'); await flow.scan('BOX-1');
    expect(flow.pending.value?.slot.slotCode).toBe('SLOT-1'); expect(flow.pending.value?.box).toBeNull(); expect(flow.canSubmit.value).toBe(false);
    expect(flow.notice.value?.text).toContain('已直接绑定'); await flow.submit(); expect(load).not.toHaveBeenCalled();
    vi.mocked(api.getBox).mockResolvedValue(box()); await flow.scan('BOX-1'); expect(flow.completeCount.value).toBe(1);
  });
  it.each(['vehicleCode', 'slotVersion', 'boxNull', 'allowed', 'reason'])('rejects incomplete slot data without staging a pair: %s', async kind => {
    const value = slot();
    if (kind === 'vehicleCode') Object.assign(value.vehicle, { containerCode: 123 });
    if (kind === 'slotVersion') value.version = 2147483648;
    if (kind === 'boxNull') Object.assign(value, { box: null });
    if (kind === 'allowed') Object.assign(value.eligibility, { allowed: 'true' });
    if (kind === 'reason') value.eligibility = { allowed: false };
    vi.spyOn(api, 'getSlot').mockResolvedValue(value); const flow = useVehicleLoading(); await flow.scan('SLOT-1');
    expect(flow.pairs.value).toEqual([]); expect(flow.notice.value?.error).toBe(true);
  });
  it.each(['contentState', 'runtimeUsage', 'loadedNull', 'boxVersion', 'reason'])('retains the waiting slot after malformed box data: %s', async kind => {
    const flow = await ready(); flow.clear(); await flow.scan('SLOT-1'); const value = box();
    if (kind === 'contentState') Object.assign(value.box, { contentState: 'FULL' });
    if (kind === 'runtimeUsage') Object.assign(value.box, { runtimeUsage: 'OTHER' });
    if (kind === 'loadedNull') Object.assign(value, { loadedVehicleCode: null });
    if (kind === 'boxVersion') value.box.version = 0;
    if (kind === 'reason') value.eligibility = { allowed: false };
    vi.mocked(api.getBox).mockResolvedValue(value); await flow.scan('BOX-1');
    expect(flow.pending.value?.slot.slotCode).toBe('SLOT-1'); expect(flow.completeCount.value).toBe(0); expect(flow.notice.value?.error).toBe(true);
  });
  it('blocks occupied slots and already loaded boxes even when a contradictory allowed flag is returned', async () => {
    const flow = await ready(); flow.clear();
    vi.mocked(api.getSlot).mockResolvedValueOnce({ ...slot(), box: box().box }); await flow.scan('SLOT-1'); expect(flow.pairs.value).toEqual([]);
    await flow.scan('SLOT-1'); vi.mocked(api.getBox).mockResolvedValueOnce({ ...box(), loadedSlotCode: 'SLOT-OTHER' });
    await flow.scan('BOX-1'); expect(flow.pending.value?.box).toBeNull(); expect(flow.notice.value?.text).toContain('已装车');
  });
  it('submits only slot/box versions from both carriers and accepts the receipt without operationNo', async () => {
    const flow = await ready(); await flow.scan('SLOT-2'); await flow.scan('BOX-2');
    const load = vi.spyOn(api, 'load').mockImplementation(async (_items, id) => receipt(id!, 2)); await flow.submit();
    expect(load).toHaveBeenCalledWith([
      { slotCode: 'SLOT-1', slotVersion: 2, boxCode: 'BOX-1', boxVersion: 4 },
      { slotCode: 'SLOT-2', slotVersion: 2, boxCode: 'BOX-2', boxVersion: 4 }
    ], expect.any(String)); expect(flow.pairs.value).toEqual([]); expect(flow.notice.value?.text).toBe('装载成功');
  });
  it('manually reuses an uncertain ID and uses a fresh ID after an explicit business refusal', async () => {
    const flow = await ready();
    const load = vi.spyOn(api, 'load').mockRejectedValueOnce(new ApiRequestError('响应未知', 503))
      .mockRejectedValueOnce(new ApiRequestError('业务拒绝', 400)).mockImplementationOnce(async (_items, id) => receipt(id!));
    await flow.submit(); expect(load).toHaveBeenCalledOnce(); expect(flow.canSubmit.value).toBe(true);
    await flow.submit(); expect(load.mock.calls[1]).toEqual(load.mock.calls[0]); await flow.submit();
    expect(load.mock.calls[2][1]).not.toBe(load.mock.calls[1][1]); expect(flow.pairs.value).toEqual([]);
  });
  it('starts a different request when the user edits an uncertain batch, without silently resending the old items', async () => {
    const flow = await ready(); const load = vi.spyOn(api, 'load').mockRejectedValueOnce(new Error('网络异常'))
      .mockImplementationOnce(async (_items, id) => receipt(id!));
    await flow.submit(); flow.remove('SLOT-1'); await flow.scan('SLOT-2'); await flow.scan('BOX-2'); await flow.submit();
    expect(load.mock.calls[1][1]).not.toBe(load.mock.calls[0][1]);
    expect(load.mock.calls[1][0]).toEqual([{ slotCode: 'SLOT-2', slotVersion: 2, boxCode: 'BOX-2', boxVersion: 4 }]);
  });
  it.each(['requestId', 'missingCount', 'time', 'resultType'])('does not clear on a malformed load receipt: %s', async kind => {
    const flow = await ready(); const load = vi.spyOn(api, 'load').mockImplementationOnce(async (_items, id) => {
      const value = receipt(id!);
      if (kind === 'requestId') value.requestId = 'other';
      if (kind === 'missingCount') Object.assign(value, { affectedCount: undefined });
      if (kind === 'time') value.processedTime = 'not-a-date';
      if (kind === 'resultType') Object.assign(value, { resultType: 'CONFIRMATION_REQUIRED' });
      return value;
    }).mockImplementationOnce(async (_items, id) => receipt(id!));
    await flow.submit(); expect(flow.pairs.value).toHaveLength(1); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(load.mock.calls[1]).toEqual(load.mock.calls[0]); expect(flow.pairs.value).toEqual([]);
  });
  it('caps both staged and submitted pairs at 1000 and never splits the batch', async () => {
    const flow = await ready(); const sample = flow.pairs.value[0];
    flow.pairs.value = Array.from({ length: 1000 }, (_, index) => ({ slot: { ...sample.slot, slotCode: `S-${index}` }, box: box(`B-${index}`) }));
    await flow.scan('SLOT-2'); expect(flow.pairs.value).toHaveLength(1000); expect(flow.notice.value?.text).toContain('1000');
    const load = vi.spyOn(api, 'load').mockImplementation(async (_items, id) => receipt(id!, 1000)); await flow.submit();
    expect(load).toHaveBeenCalledOnce(); expect(load.mock.calls[0][0]).toHaveLength(1000);
    flow.pairs.value = Array.from({ length: 1001 }, (_, index) => ({ slot: { ...sample.slot, slotCode: `S-${index}` }, box: box(`B-${index}`) }));
    expect(flow.canSubmit.value).toBe(false); await flow.submit(); expect(load).toHaveBeenCalledOnce();
  });
  it('ignores late slot/box queries on hide and resumes at the initial scan stage', async () => {
    let resolveSlot!: (value: VehicleSlot) => void;
    const getSlot = vi.spyOn(api, 'getSlot').mockImplementationOnce(() => new Promise(done => { resolveSlot = done; })).mockResolvedValue(slot());
    const flow = useVehicleLoading(); const work = flow.scan('SLOT-1'); flow.pause(); resolveSlot(slot()); await work;
    expect(flow.pairs.value).toEqual([]); await flow.scan('SLOT-1'); expect(getSlot).toHaveBeenCalledOnce(); flow.resume(); await flow.scan('SLOT-1');
    let resolveBox!: (value: LoadingBox) => void; vi.spyOn(api, 'getBox').mockImplementation(() => new Promise(done => { resolveBox = done; }));
    const scanning = flow.scan('BOX-1'); flow.pause(); resolveBox(box()); await scanning;
    expect(flow.pairs.value).toEqual([]); expect(flow.notice.value).toBeNull();
  });
  it('prevents duplicate loads/edits and ignores late success after hiding', async () => {
    const flow = await ready(); let resolve!: (value: Receipt) => void;
    const load = vi.spyOn(api, 'load').mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = flow.submit(); await flow.submit(); flow.remove('SLOT-1'); await flow.scan('SLOT-2');
    expect(load).toHaveBeenCalledOnce(); expect(flow.pairs.value).toHaveLength(1); flow.pause();
    resolve(receipt(load.mock.calls[0][1]!)); await work; expect(flow.pairs.value).toEqual([]); expect(flow.notice.value).toBeNull();
  });
  it('renders a uniform pending/complete card with actual state, handles deletion, and clears on hide', async () => {
    vi.spyOn(api, 'getSlot').mockResolvedValue(slot()); vi.spyOn(api, 'getBox').mockResolvedValue(box());
    const wrapper = mount(LoadingPage, { global: { stubs: { 'scroll-view': { props: ['scrollY'], template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach(show => show()); wrapper.getComponent(ScanInput).vm.$emit('scan', 'SLOT-1'); await vi.dynamicImportSettled();
      expect(wrapper.findAll('.pair-list .info')).toHaveLength(4); expect(wrapper.text()).toContain('待扫描箱子');
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-1'); await vi.dynamicImportSettled();
      expect(wrapper.findAll('.pair-list .info')).toHaveLength(4); expect(wrapper.text()).toContain('已确认非空'); expect(wrapper.text()).toContain('已完成 1 对');
      await wrapper.get('.delete').trigger('tap'); expect(wrapper.find('.pair-list').exists()).toBe(false);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'SLOT-1'); await vi.dynamicImportSettled();
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick(); expect(wrapper.find('.pair-list').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
