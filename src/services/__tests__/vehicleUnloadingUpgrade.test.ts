import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useVehicleUnloading } from '../../composables/useVehicleUnloading';
import UnloadingPage from '../../pages/vehicle-unloading/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { vehicleLoadingApi as api, type VehicleLoads } from '../vehicleLoading';
import { boxVehicleBindingApi as direct } from '../boxVehicleBinding';
import { ApiRequestError } from '../nariRequest';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));

const snapshot = (): VehicleLoads => ({
  vehicle: { containerType: 'VEHICLE', containerCode: 'CAR-1', version: 3 },
  loadedBoxCount: 2,
  totalMaterialQuantity: 5,
  loads: [
    { slotCode: 'SLOT-1', slotVersion: 4, id: '9007199254741001', version: 6,
      box: { containerType: 'BOX', containerCode: 'BOX-1', version: 5, contentState: 'UNKNOWN' },
      materials: [
        { lineType: 'PANEL', panelCode: 'PANEL-1', materialCode: 'MAT-1', orderNo: 'SO-1', quantity: 1, materialBatch: '000007' },
        { lineType: 'QUANTITY', materialCode: 'MAT-2', orderNo: 'SO-2', quantity: 4 }
      ] },
    { slotCode: 'SLOT-2', slotVersion: 7, id: '9007199254741002', version: 8,
      box: { containerType: 'BOX', containerCode: 'BOX-2', version: 9, contentState: 'LOADED', runtimeUsage: 'FIXTURE' }, materials: [] },
    { slotCode: 'SLOT-EMPTY', slotVersion: 10, materials: [] }
  ]
});
type Receipt = Awaited<ReturnType<typeof api.unloadAll>>;
const receipt = (requestId: string, affectedCount = 1): Receipt => ({ requestId, affectedCount, processedTime: '2026-10-12T07:00:00Z' });
async function ready() {
  vi.spyOn(api, 'getLoads').mockResolvedValue(snapshot());
  const flow = useVehicleUnloading(); await flow.scan('CAR-1'); return flow;
}
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('vehicle unloading 2026-10-12.1', () => {
  it('accepts optional display fields, preserves text batches and does not infer empty fixture contents', async () => {
    const flow = await ready();
    expect(flow.loaded.value).toHaveLength(2);
    expect(flow.loaded.value[0].materials[0].materialBatch).toBe('000007');
    expect(flow.loaded.value[0].materials[1]).not.toHaveProperty('panelCode');
    expect(flow.loaded.value[1].box.contentState).toBe('LOADED');
    expect(flow.loaded.value[1].materials).toEqual([]);
    expect(flow.notice.value).toBeNull();
  });
  it('keeps the snapshot and confirmation on an incomplete completed receipt', async () => {
    const value = snapshot();
    for (const row of value.loads) for (const material of row.materials) Object.assign(material, { materialName: '板件', unit: '件' });
    vi.spyOn(api, 'getLoads').mockResolvedValue(value);
    const flow = useVehicleUnloading(); await flow.scan('CAR-1'); await flow.scan('BOX-1'); flow.requestUnload('selected');
    vi.spyOn(api, 'unloadSelected').mockResolvedValue(receipt('not-the-original-request', 0));
    await flow.submit();
    expect(flow.vehicle.value).not.toBeNull();
    expect(flow.confirmation.value).toBe('selected');
    expect(flow.selected.value).toEqual(['9007199254741001']);
    expect(flow.notice.value?.error).toBe(true);
  });
  it.each(['EMPTY', 'UNKNOWN', 'LOADED', undefined] as const)('preserves actual contents independent of missing panel records: %s', async contentState => {
    const value = snapshot(); value.loads[1].box!.contentState = contentState;
    vi.spyOn(api, 'getLoads').mockResolvedValue(value); const flow = useVehicleUnloading(); await flow.scan('CAR-1');
    expect(flow.loaded.value[1].box.contentState).toBe(contentState); expect(flow.loaded.value[1].materials).toEqual([]);
    expect(flow.canUnloadAll.value).toBe(true);
  });
  it('matches only loaded boxes locally, keeps repeated scans selected and never calls direct relationship APIs', async () => {
    const getDirect = vi.spyOn(direct, 'getVehicle'); const getBox = vi.spyOn(api, 'getBox'); const flow = await ready();
    await flow.scan('BOX-2'); const selected = [...flow.selected.value]; await flow.scan('BOX-2');
    expect(flow.selected.value).toEqual(selected); expect(flow.notice.value?.text).toContain('已勾选');
    await flow.scan('SLOT-EMPTY'); await flow.scan('NOT-LOADED'); flow.toggle('SLOT-1');
    expect(flow.selected.value).toEqual(selected); expect(flow.notice.value?.text).toContain('未在当前载具');
    expect(api.getLoads).toHaveBeenCalledOnce(); expect(getDirect).not.toHaveBeenCalled(); expect(getBox).not.toHaveBeenCalled();
  });
  const badSnapshots: [string, (value: VehicleLoads) => void][] = [
    ['vehicle identity', value => { value.vehicle.containerCode = 'OTHER'; }],
    ['vehicle type', value => { Object.assign(value.vehicle, { containerType: 'BOX' }); }],
    ['vehicle version', value => { value.vehicle.version = 0; }],
    ['missing slots', value => { Object.assign(value, { loads: null }); }],
    ['slot code', value => { Object.assign(value.loads[0], { slotCode: 123 }); }],
    ['slot version', value => { value.loads[0].slotVersion = 2147483648; }],
    ['numeric relationship ID', value => { Object.assign(value.loads[0], { id: 9007199254741001 }); }],
    ['non-ID relationship', value => { value.loads[0].id = 'BOX-1'; }],
    ['relationship version', value => { value.loads[0].version = 0; }],
    ['null box', value => { Object.assign(value.loads[0], { box: null }); }],
    ['box version', value => { value.loads[0].box!.version = 0; }],
    ['invalid content state', value => { Object.assign(value.loads[0].box!, { contentState: 'FULL' }); }],
    ['invalid usage', value => { Object.assign(value.loads[1].box!, { runtimeUsage: 'UNKNOWN' }); }],
    ['confirmed empty with materials', value => { value.loads[0].box!.contentState = 'EMPTY'; }],
    ['incomplete materials', value => { Object.assign(value.loads[0], { materials: null }); }],
    ['missing material', value => { value.loads[0].materials[0].materialCode = ''; }],
    ['non-text batch', value => { Object.assign(value.loads[0].materials[0], { materialBatch: 7 }); }],
    ['null name', value => { Object.assign(value.loads[0].materials[0], { materialName: null }); }],
    ['missing panel', value => { delete value.loads[0].materials[0].panelCode; }],
    ['panel quantity', value => { value.loads[0].materials[0].quantity = 2; value.totalMaterialQuantity = 6; }],
    ['invented quantity panel', value => { value.loads[0].materials[1].panelCode = 'FAKE'; }],
    ['fractional quantity', value => { value.loads[0].materials[1].quantity = 1.5; }],
    ['empty slot with relation', value => { value.loads[2].id = '12'; }],
    ['empty slot with materials', value => { value.loads[2].materials = value.loads[0].materials; }],
    ['duplicate slots', value => { value.loads[1].slotCode = value.loads[0].slotCode; }],
    ['duplicate relations', value => { value.loads[1].id = value.loads[0].id; }],
    ['duplicate boxes', value => { value.loads[1].box!.containerCode = value.loads[0].box!.containerCode; }],
    ['incorrect box total', value => { value.loadedBoxCount = 3; }],
    ['incorrect material total', value => { value.totalMaterialQuantity = 4; }]
  ];
  it.each(badSnapshots)('rejects an incomplete or inconsistent full snapshot: %s', async (_label, change) => {
    const value = snapshot(); change(value); vi.spyOn(api, 'getLoads').mockResolvedValue(value);
    const flow = useVehicleUnloading(); await flow.scan('CAR-1');
    expect(flow.vehicle.value).toBeNull(); expect(flow.loaded.value).toEqual([]); expect(flow.notice.value?.error).toBe(true);
  });
  it.each(['all', 'selected'] as const)('uses exact carrier/relationship versions and accepts a complete %s receipt without operationNo', async mode => {
    const flow = await ready(); await flow.scan('BOX-1'); flow.requestUnload(mode);
    const all = vi.spyOn(api, 'unloadAll').mockImplementation(async (_code, _version, id) => receipt(id!, 2));
    const part = vi.spyOn(api, 'unloadSelected').mockImplementation(async (_code, _version, _items, id) => receipt(id!));
    await flow.submit();
    if (mode === 'all') { expect(all).toHaveBeenCalledWith('CAR-1', 3, expect.any(String)); expect(part).not.toHaveBeenCalled(); }
    else { expect(part).toHaveBeenCalledWith('CAR-1', 3, [{ id: '9007199254741001', version: 6 }], expect.any(String)); expect(all).not.toHaveBeenCalled(); }
    expect(flow.vehicle.value).toBeNull(); expect(flow.selected.value).toEqual([]); expect(flow.confirmation.value).toBeNull();
    expect(flow.notice.value?.text).toBe('卸载成功');
  });
  it.each(['requestId', 'missingCount', 'time', 'partial', 'materialsCount', 'resultType', 'null'] as const)('does not clear on a malformed receipt and replays the original request manually: %s', async kind => {
    const flow = await ready(); await flow.scan('BOX-1'); flow.requestUnload('selected');
    const unload = vi.spyOn(api, 'unloadSelected').mockImplementationOnce(async (_code, _version, _items, id) => {
      const value = receipt(id!);
      if (kind === 'requestId') value.requestId = 'other';
      if (kind === 'missingCount') Object.assign(value, { affectedCount: undefined });
      if (kind === 'time') value.processedTime = 'not-a-date';
      if (kind === 'partial') value.affectedCount = 0;
      if (kind === 'materialsCount') value.affectedCount = 5;
      if (kind === 'resultType') Object.assign(value, { resultType: 'CONFIRMATION_REQUIRED' });
      return kind === 'null' ? null as unknown as Receipt : value;
    }).mockImplementationOnce(async (_code, _version, _items, id) => receipt(id!));
    await flow.submit(); expect(flow.vehicle.value).not.toBeNull(); expect(flow.confirmation.value).toBe('selected');
    expect(flow.selected.value).toEqual(['9007199254741001']); expect(flow.notice.value?.error).toBe(true); expect(unload).toHaveBeenCalledOnce();
    await flow.submit(); expect(unload.mock.calls[1]).toEqual(unload.mock.calls[0]); expect(flow.vehicle.value).toBeNull();
  });
  it.each([new Error('网络异常'), new ApiRequestError('响应未知', 503), new ApiRequestError('响应超时', 408)])('manually replays an uncertain selected result without automatic requests: %s', async error => {
    const flow = await ready(); await flow.scan('BOX-1'); flow.requestUnload('selected');
    const unload = vi.spyOn(api, 'unloadSelected').mockRejectedValueOnce(error).mockImplementationOnce(async (_code, _version, _items, id) => receipt(id!));
    await flow.submit(); expect(unload).toHaveBeenCalledOnce(); expect(flow.confirmation.value).toBe('selected');
    await flow.submit(); expect(unload.mock.calls[1]).toEqual(unload.mock.calls[0]); expect(flow.vehicle.value).toBeNull();
  });
  it('keeps an uncertain all-unload ID but starts a fresh request after an explicit rejection', async () => {
    const flow = await ready(); flow.requestUnload('all');
    const unload = vi.spyOn(api, 'unloadAll').mockRejectedValueOnce(new ApiRequestError('响应未知', 503))
      .mockRejectedValueOnce(new ApiRequestError('载具版本变化，请重新扫描', 409)).mockImplementationOnce(async (_code, _version, id) => receipt(id!, 2));
    await flow.submit(); await flow.submit(); expect(unload.mock.calls[1]).toEqual(unload.mock.calls[0]);
    expect(flow.confirmation.value).toBe('all'); expect(flow.loaded.value).toHaveLength(2);
    await flow.submit(); expect(unload.mock.calls[2][2]).not.toBe(unload.mock.calls[1][2]); expect(flow.vehicle.value).toBeNull();
  });
  it('starts a fresh intent after changing an uncertain selection and submits no material or slot credentials', async () => {
    const flow = await ready(); await flow.scan('BOX-1'); flow.requestUnload('selected');
    const unload = vi.spyOn(api, 'unloadSelected').mockRejectedValueOnce(new Error('网络异常'))
      .mockImplementationOnce(async (_code, _version, _items, id) => receipt(id!));
    await flow.submit(); flow.cancel(); flow.toggle('9007199254741001'); await flow.scan('BOX-2'); flow.requestUnload('selected'); await flow.submit();
    expect(unload.mock.calls[1][3]).not.toBe(unload.mock.calls[0][3]);
    expect(unload.mock.calls[1][2]).toEqual([{ id: '9007199254741002', version: 8 }]);
  });
  it('caps only selected operations at 1000 without truncating the complete query or all-unload', async () => {
    const value = snapshot(); const sample = value.loads[1];
    value.loads = Array.from({ length: 1001 }, (_, index) => ({ ...sample, id: String(10001 + index), slotCode: `S-${index}`, box: { ...sample.box!, containerCode: `B-${index}` } }));
    value.loadedBoxCount = 1001; value.totalMaterialQuantity = 0; vi.spyOn(api, 'getLoads').mockResolvedValue(value);
    const flow = useVehicleUnloading(); await flow.scan('CAR-1'); expect(flow.loaded.value).toHaveLength(1001);
    for (const row of flow.loaded.value.slice(0, 1000)) flow.toggle(row.id);
    await flow.scan('B-1000'); expect(flow.selected.value).toHaveLength(1000); expect(flow.notice.value?.text).toContain('1000');
    flow.toggle(flow.loaded.value[999].id); await flow.scan('B-1000'); expect(flow.selected.value).toContain('11001');
    flow.requestUnload('selected'); expect(flow.confirmCount.value).toBe(1000); flow.cancel();
    flow.requestUnload('all'); expect(flow.confirmCount.value).toBe(1001);
    const all = vi.spyOn(api, 'unloadAll').mockImplementation(async (_code, _version, id) => receipt(id!, 1001));
    await flow.submit(); expect(all).toHaveBeenCalledOnce(); expect(flow.vehicle.value).toBeNull();
  });
  it('blocks background edits and duplicate requests during confirmations and submission', async () => {
    const flow = await ready(); await flow.scan('BOX-1'); flow.requestUnload('selected');
    await flow.scan('BOX-2'); flow.toggle('9007199254741002'); expect(flow.selected.value).toEqual(['9007199254741001']);
    let resolve!: (value: Receipt) => void; const unload = vi.spyOn(api, 'unloadSelected').mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = flow.submit(); flow.cancel(); await flow.submit();
    expect(flow.confirmation.value).toBe('selected'); expect(unload).toHaveBeenCalledOnce();
    resolve(receipt(unload.mock.calls[0][3]!)); await work; expect(flow.vehicle.value).toBeNull();
  });
  it('clears hidden contexts, blocks hidden scans and ignores late queries after resuming', async () => {
    let resolve!: (value: VehicleLoads) => void;
    const query = vi.spyOn(api, 'getLoads').mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(snapshot());
    const flow = useVehicleUnloading(); const work = flow.scan('CAR-1'); flow.pause(); await flow.scan('CAR-1'); expect(query).toHaveBeenCalledOnce();
    flow.resume(); await flow.scan('CAR-1'); const late = snapshot(); late.vehicle.version = 99; resolve(late); await work;
    expect(flow.vehicle.value).toEqual(snapshot()); expect(flow.notice.value).toBeNull();
    flow.pause(); expect(flow.vehicle.value).toBeNull(); expect(flow.selected.value).toEqual([]);
  });
  it('ignores late unload success after the page is hidden', async () => {
    const flow = await ready(); flow.requestUnload('all'); let resolve!: (value: Receipt) => void;
    const all = vi.spyOn(api, 'unloadAll').mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = flow.submit(); flow.pause(); resolve(receipt(all.mock.calls[0][2]!, 2)); await work;
    expect(flow.vehicle.value).toBeNull(); expect(flow.confirmation.value).toBeNull(); expect(flow.notice.value).toBeNull();
  });
  it('renders actual state without inventing content, scrolls only loaded lists and resets on hide', async () => {
    vi.spyOn(api, 'getLoads').mockResolvedValue(snapshot());
    const wrapper = mount(UnloadingPage, { global: { stubs: {
      'scroll-view': { name: 'ScrollView', props: ['scrollY'], template: '<div><slot /></div>' },
      checkbox: { template: '<input type="checkbox" />' }, 'checkbox-group': { template: '<div><slot /></div>' }
    } } });
    try {
      hooks.show.forEach(show => show()); const scroll = () => wrapper.getComponent({ name: 'ScrollView' });
      expect(scroll().props('scrollY')).toBe(false);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled();
      expect(wrapper.findAll('.binding-row')).toHaveLength(2); expect(wrapper.text()).toContain('实际内容 未确认');
      expect(wrapper.text()).toContain('实际内容 已确认非空'); expect(scroll().props('scrollY')).toBe(true);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'BOX-2'); await vi.dynamicImportSettled();
      expect(wrapper.get('.list-heading').text()).toContain('已选 1 / 2');
      hooks.hide.forEach(hide => hide()); await wrapper.vm.$nextTick();
      expect(wrapper.findAll('.binding-row')).toEqual([]); expect(scroll().props('scrollY')).toBe(false);
      const value = snapshot(); value.loads = [value.loads[2]]; value.loadedBoxCount = value.totalMaterialQuantity = 0;
      vi.mocked(api.getLoads).mockResolvedValue(value); hooks.show.forEach(show => show());
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'CAR-1'); await vi.dynamicImportSettled();
      expect(wrapper.text()).toContain('暂无已装载箱子'); expect(scroll().props('scrollY')).toBe(false);
      expect(wrapper.get('.footer .danger').attributes('disabled')).toBeDefined(); expect(wrapper.get('.footer .primary').attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });
});
