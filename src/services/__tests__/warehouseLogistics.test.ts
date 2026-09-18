import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WarehouseLogisticsPage from '../../pages/warehouse-logistics/index.vue';
import LocationCascade from '../../components/LocationCascade.vue';
import ScanInput from '../../components/ScanInput.vue';
import { useWarehouseLogistics } from '../../composables/useWarehouseLogistics';
import { warehouseLogisticsApi as api, type WarehouseLogisticsOptions } from '../warehouseLogistics';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { requestId } from '../nariRequest';
import { logisticsCancellationApi } from '../logisticsCancellation';
import { panelPackingApi } from '../panelPacking';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (callback: () => void) => hooks.show.push(callback), onHide: () => {} }));
const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock'); vi.useFakeTimers(); storage.clear(); network.mockClear(); resetMockData(); hooks.show.length = 0;
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('warehouse logistics initiation', () => {
  it('queries by scanCode only, selects the recommendation rather than the first candidate and sums quantities', async () => {
    const flow = useWarehouseLogistics(); const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.scan(' CAR-WH-NORMAL '));
    expect(transport.mock.lastCall?.[0].data).toEqual({ scanCode: 'CAR-WH-NORMAL' });
    expect(flow.scanType.value).toBe('VEHICLE'); expect(flow.options.value?.boxes).toHaveLength(3);
    expect(flow.options.value?.totalMaterialQuantity).toBe(7);
    expect(flow.destination.value?.locationCode).toBe('WH-DEST-002');
    expect(flow.destination.value).not.toEqual(flow.candidates.value[0]); expect(flow.canSubmit.value).toBe(true);
    await finish(flow.scan('KW-WH-SINGLE')); expect(flow.scanType.value).toBe('LOCATION');
    expect(flow.destination.value).toEqual(flow.candidates.value[0]); flow.openChoice(); expect(flow.choosing.value).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
  it('keeps full box/candidate arrays and queries box materials with WAREHOUSE_LOGISTICS context', async () => {
    const flow = useWarehouseLogistics(); await finish(flow.scan('CAR-WH-LONG'));
    expect(flow.candidates.value).toHaveLength(225); expect(flow.options.value?.boxes).toHaveLength(225);
    const original = flow.options.value; const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.openMaterials('BOX-WH-LONG-001'));
    expect(transport.mock.lastCall?.[0].data).toEqual({ boxCode: 'BOX-WH-LONG-001', context: 'WAREHOUSE_LOGISTICS' });
    expect(flow.detail.value?.materials).toHaveLength(30); expect(flow.canSubmit.value).toBe(false);
    await flow.scan('CAR-WH-NORMAL'); await flow.submit(); expect(transport).toHaveBeenCalledOnce();
    flow.closeMaterials(); expect(flow.options.value).toBe(original);
    await finish(flow.scan('CAR-WH-DETAIL-FAIL')); await finish(flow.openMaterials('BOX-WH-DETAIL-FAIL-001'));
    expect(flow.detail.value).toBeNull(); expect(flow.options.value).not.toBeNull(); expect(flow.notice.value?.text).toContain('物料查询失败');
  });
  it('switches within candidates, creates one task from a scanned location, clears and links cancellation', async () => {
    const flow = useWarehouseLogistics(); await finish(flow.scan('KW-WH-NORMAL'));
    flow.openChoice(); flow.choose(flow.candidates.value[0]); const create = vi.spyOn(api, 'create'); const transport = vi.spyOn(mock, 'resolveMockRequest');
    const pending = flow.submit(); await flow.submit(); await finish(pending);
    expect(create).toHaveBeenCalledOnce(); expect(create.mock.calls[0][0]).toEqual({ requestId: expect.any(String), scanType: 'LOCATION', scanCode: 'KW-WH-NORMAL',
      object: { containerType: 'VEHICLE', containerCode: 'CAR-WH-NORMAL' }, version: 1, destinationLocationCode: 'WH-DEST-001' });
    expect(flow.options.value).toBeNull(); expect(flow.destination.value).toBeNull(); expect(flow.notice.value?.text).toContain('WH-MOCK-');
    expect(transport).toHaveBeenCalledOnce(); expect(transport.mock.lastCall?.[0].url).toContain('/warehouse-logistics/tasks');
    const tasks = await finish(logisticsCancellationApi.query('CAR-WH-NORMAL', 1)); expect(tasks.records).toHaveLength(1);
    await finish(expect(api.getOptions('CAR-WH-NORMAL')).rejects.toThrow('未结束物流任务'));
    await finish(logisticsCancellationApi.cancel(tasks.records[0].taskId, { requestId: requestId(), version: tasks.records[0].version }));
    expect((await finish(api.getOptions('CAR-WH-NORMAL'))).totalMaterialQuantity).toBe(7);
  });
  it('replaces scan context directly and clears everything on scan failures', async () => {
    const flow = useWarehouseLogistics(); await finish(flow.scan('CAR-WH-NORMAL'));
    await finish(flow.scan('KW-WH-SINGLE')); expect(flow.options.value?.object.containerType).toBe('VEHICLE'); expect(flow.scanType.value).toBe('LOCATION');
    for (const [code, reason] of [['KW-WH-BOX', '绑定的是料箱'], ['CAR-WH-BLOCKED', '未满足'], ['CAR-WH-NO-END', '无可用'], ['KW-WH-EMPTY', '没有有效'], ['WH-AMBIGUOUS', '无法唯一'], ['BOX-WH-SINGLE', '不存在']]) {
      await finish(flow.scan(code)); expect(flow.options.value).toBeNull(); expect(flow.destination.value).toBeNull();
      expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.text).toContain(reason);
    }
  });
  it('rejects a box-bound location on both query and direct task creation without creating a task', async () => {
    await finish(expect(api.getOptions('KW-WH-BOX')).rejects.toThrow('当前位置绑定的是料箱，不允许缴库发起'));
    await finish(expect(api.create({ requestId: requestId(), scanType: 'LOCATION', scanCode: 'KW-WH-BOX',
      object: { containerType: 'BOX', containerCode: 'BOX-WH-SINGLE' }, version: 1, destinationLocationCode: 'WH-DEST-001' })).rejects.toThrow('不允许缴库发起'));
    expect((await finish(logisticsCancellationApi.query('BOX-WH-SINGLE', 1))).records).toEqual([]);
  });
  it('rejects a box returned by an older backend and clears the previous valid scan', async () => {
    const flow = useWarehouseLogistics(); await finish(flow.scan('CAR-WH-NORMAL'));
    const legacy: WarehouseLogisticsOptions = { ...flow.options.value!,
      origin: { locationCode: 'KW-WH-BOX', locationName: '料箱缴库位' },
      object: { containerType: 'BOX', containerCode: 'BOX-WH-SINGLE', version: 1 } };
    vi.spyOn(api, 'getOptions').mockResolvedValueOnce(legacy);
    const create = vi.spyOn(api, 'create'); await flow.scan('KW-WH-BOX'); await flow.submit();
    expect(flow.notice.value?.text).toBe('当前位置绑定的是料箱，不允许缴库发起');
    expect(flow.options.value).toBeNull(); expect(flow.destination.value).toBeNull(); expect(flow.detail.value).toBeNull();
    expect(flow.canSubmit.value).toBe(false); expect(create).not.toHaveBeenCalled();
    await finish(flow.scan('KW-WH-NORMAL')); expect(flow.canSubmit.value).toBe(true);
  });
  it('keeps submission failure data and sends fresh IDs only on manual retries', async () => {
    const flow = useWarehouseLogistics(); await finish(flow.scan('CAR-WH-FAIL')); const original = flow.options.value;
    const create = vi.spyOn(api, 'create'); await finish(flow.submit()); expect(create).toHaveBeenCalledOnce();
    expect(flow.options.value).toBe(original); expect(flow.notice.value?.text).toContain('目标地点暂不可用');
    await finish(flow.submit()); expect(create.mock.calls[0][0].requestId).not.toBe(create.mock.calls[1][0].requestId);
    expect(flow.canSubmit.value).toBe(true);
  });
  it('validates recommendation consistency, complete hierarchy, summary totals and exact scan identity', async () => {
    const valid = await finish(api.getOptions('CAR-WH-NORMAL'));
    for (const mutate of [
      (value: WarehouseLogisticsOptions) => { value.destinations = []; },
      (value: WarehouseLogisticsOptions) => { value.recommendedDestination = value.destinations[0].location; },
      (value: WarehouseLogisticsOptions) => { value.destinations[0].recommended = true; },
      (value: WarehouseLogisticsOptions) => { value.destinations[0].location.floorName = ''; },
      (value: WarehouseLogisticsOptions) => { value.destinations.push(value.destinations[0]); },
      (value: WarehouseLogisticsOptions) => { value.totalMaterialQuantity = 3; },
      (value: WarehouseLogisticsOptions) => { value.boxes.push(value.boxes[0]); },
      (value: WarehouseLogisticsOptions) => { value.object.containerCode = 'MISMATCH'; },
      (value: WarehouseLogisticsOptions) => { value.origin.locationCode = value.object.containerCode; }
    ]) {
      const result: WarehouseLogisticsOptions = JSON.parse(JSON.stringify(valid)); mutate(result);
      vi.spyOn(api, 'getOptions').mockResolvedValueOnce(result); const flow = useWarehouseLogistics(); await flow.scan('CAR-WH-NORMAL');
      expect(flow.options.value).toBeNull(); expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.error).toBe(true);
    }
  });
  it('rechecks aggregate version, target and scan relationship; repeated IDs do not create duplicate tasks', async () => {
    const flow = useWarehouseLogistics(); await finish(flow.scan('CAR-WH-NORMAL'));
    await finish(panelPackingApi.unbindAll('BOX-WH-NORMAL-001', 1)); await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('版本已变化'); expect(flow.options.value?.totalMaterialQuantity).toBe(7);
    const current = await finish(api.getOptions('CAR-WH-NORMAL'));
    const input = { requestId: requestId(), scanType: 'VEHICLE' as const, scanCode: 'CAR-WH-NORMAL', object: { containerType: 'VEHICLE' as const, containerCode: 'CAR-WH-NORMAL' },
      version: current.object.version, destinationLocationCode: current.recommendedDestination.locationCode };
    await finish(expect(api.create({ ...input, destinationLocationCode: 'NOT-ALLOWED' })).rejects.toThrow('不在当前允许'));
    await finish(expect(api.create({ ...input, scanType: 'LOCATION' })).rejects.toThrow('扫描对象'));
    const result = await finish(api.create(input)); expect(await finish(api.create(input))).toEqual(result);
    await finish(expect(api.create({ ...input, destinationLocationCode: 'WH-DEST-001' })).rejects.toThrow('相同请求标识'));
  });
  it('ignores late scan/detail/write responses after clear and validates input length', async () => {
    const flow = useWarehouseLogistics(); const get = vi.spyOn(api, 'getOptions');
    await flow.scan(' '); await flow.scan('X'.repeat(129)); expect(get).not.toHaveBeenCalled();
    const read = flow.scan('CAR-WH-NORMAL'); flow.clear(); await finish(read); expect(flow.options.value).toBeNull();
    await finish(flow.scan('CAR-WH-NORMAL')); const detail = flow.openMaterials('BOX-WH-NORMAL-001'); flow.clear(); await finish(detail); expect(flow.detail.value).toBeNull();
    await finish(flow.scan('CAR-WH-SINGLE')); const write = flow.submit(); flow.clear(); await finish(write); expect(flow.notice.value).toBeNull(); expect(flow.busy.value).toBe(false);
  });
  it('supports unfocused scanner events, read-only detail dialogs and dependent cascade resets', async () => {
    const wrapper = mount(WarehouseLogisticsPage, { global: { stubs: { picker: { name: 'TestPicker', props: ['value', 'disabled', 'range'], template: '<div><slot /></div>' }, 'scroll-view': { template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach((show) => show());
      window.dispatchEvent(new CustomEvent('pda-scan', { detail: { value: 'CAR-WH-NORMAL' } })); await vi.advanceTimersByTimeAsync(500);
      expect(wrapper.find('.choice').text()).toContain('一层 / 暂存库 / 2号入库接驳台');
      await wrapper.find('.box-row').trigger('tap'); await vi.advanceTimersByTimeAsync(500);
      expect(wrapper.find('[aria-label="箱内物料"]').exists()).toBe(true);
      expect(wrapper.findComponent(ScanInput).props('disabled')).toBe(true);
      await wrapper.find('.detail-footer button').trigger('tap');
      await wrapper.find('.choice').trigger('tap'); const modal = wrapper.findComponent(LocationCascade);
      const pickers = modal.findAllComponents({ name: 'TestPicker' });
      expect(pickers[0].props('value')).toBe(1); expect(pickers[1].props('value')).toBe(2);
      pickers[0].vm.$emit('change', { detail: { value: 2 } }); await wrapper.vm.$nextTick();
      expect(pickers[1].props('value')).toBe(0); expect(pickers[2].props('value')).toBe(0);
      expect(modal.find('button.primary').attributes('disabled')).toBeDefined();
      await modal.find('button').trigger('tap'); expect(wrapper.find('.choice').text()).toContain('2号入库接驳台');
      window.dispatchEvent(new CustomEvent('pda-scan', { detail: { value: 'CAR-WH-SINGLE' } })); await vi.advanceTimersByTimeAsync(500);
      expect(wrapper.find('.choice').exists()).toBe(false); expect(wrapper.find('.single-destination').text()).toContain('1号入库接驳台');
      await wrapper.find('.footer button').trigger('tap'); expect(wrapper.find('.empty').text()).toContain('请先扫描');
    } finally { wrapper.unmount(); }
  });
});
