import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import EmptyVehiclePage from '../../pages/empty-vehicle/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import LocationCascade from '../../components/LocationCascade.vue';
import { emptyVehicleApi as api, type EmptyVehicleOptions } from '../emptyVehicle';
import { useEmptyVehicle } from '../../composables/useEmptyVehicle';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { requestId } from '../nariRequest';
import { logisticsCancellationApi } from '../logisticsCancellation';
import { locationBindingApi } from '../locationBinding';

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

describe('empty vehicle calling', () => {
  it('queries by destination only, selects the first backend item without writing, and keeps all candidates', async () => {
    const flow = useEmptyVehicle(); const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.scan(' KW-05-01 ')); expect(transport.mock.lastCall?.[0].data).toEqual({ destinationLocationCode: 'KW-05-01' });
    expect(flow.origin.value).toBe(flow.options.value?.origins[0]); expect(flow.canSubmit.value).toBe(true);
    expect(transport).toHaveBeenCalledOnce(); expect(flow.candidates.value).toHaveLength(3);
    flow.clear(); await finish(flow.scan('KW-CALL-LONG')); expect(flow.candidates.value).toHaveLength(225);
    const first = flow.options.value!.origins[0]; flow.openChoice(); flow.closeChoice(); expect(flow.origin.value).toBe(first);
    expect(network).not.toHaveBeenCalled();
  });
  it('switches location and associated vehicle/version together, submits once, and clears on success', async () => {
    const flow = useEmptyVehicle(); await finish(flow.scan('KW-05-01'));
    const chosen = flow.options.value!.origins[1]; expect(chosen.vehicle.version).not.toBe(flow.origin.value!.vehicle.version);
    flow.openChoice(); flow.choose(chosen.origin); const call = vi.spyOn(api, 'call');
    const operation = flow.submit(); await flow.submit(); await finish(operation);
    expect(call).toHaveBeenCalledOnce(); expect(call.mock.calls[0][0]).toEqual({ requestId: expect.any(String), originLocationCode: chosen.origin.locationCode,
      destinationLocationCode: 'KW-05-01', vehicleCode: chosen.vehicle.containerCode, version: chosen.vehicle.version });
    expect(flow.options.value).toBeNull(); expect(flow.origin.value).toBeNull(); expect(flow.notice.value).toEqual({ text: '呼叫成功', error: false });
    const tasks = await finish(logisticsCancellationApi.query(chosen.vehicle.containerCode, 1));
    expect(tasks.records).toHaveLength(1); expect(tasks.records[0].destination.locationCode).toBe('KW-05-01');
    const conflict = expect(api.getOrigins('KW-05-01')).rejects.toThrow('未结束物流任务'); await finish(conflict);
    await finish(logisticsCancellationApi.cancel(tasks.records[0].taskId, { requestId: requestId(), version: tasks.records[0].version }));
    expect((await finish(api.getOrigins('KW-05-01'))).origins).toHaveLength(3);
  });
  it('confirms target replacement, preserves on cancel, and drops old selection for no-candidate/error cases', async () => {
    const flow = useEmptyVehicle(); await finish(flow.scan('KW-05-01')); const original = flow.origin.value;
    await flow.scan('KW-CALL-NONE'); expect(flow.replacement.value).toBe('KW-CALL-NONE'); expect(flow.origin.value).toBe(original);
    flow.cancelReplacement(); expect(flow.origin.value).toBe(original);
    await flow.scan('KW-CALL-NONE'); await finish(flow.confirmReplacement());
    expect(flow.options.value?.destination.locationCode).toBe('KW-CALL-NONE'); expect(flow.origin.value).toBeNull(); expect(flow.canSubmit.value).toBe(false);
    await flow.scan('KW-CALL-OCCUPIED'); await finish(flow.confirmReplacement());
    expect(flow.options.value).toBeNull(); expect(flow.notice.value?.text).toContain('已有容器');
    await finish(flow.scan('KW-CALL-BLOCKED')); expect(flow.notice.value?.text).toContain('已停用');
  });
  it('keeps failed call context and sends a fresh request only on user retry', async () => {
    const flow = useEmptyVehicle(); await finish(flow.scan('KW-CALL-FAIL')); const original = flow.origin.value;
    const call = vi.spyOn(api, 'call'); await finish(flow.submit());
    expect(flow.notice.value?.text).toContain('设备暂不可用'); expect(flow.origin.value).toBe(original);
    expect(call).toHaveBeenCalledOnce(); await finish(flow.submit());
    expect(call.mock.calls[0][0].requestId).not.toBe(call.mock.calls[1][0].requestId);
    expect(flow.canSubmit.value).toBe(true);
  });
  it('rejects malformed full candidate arrays without accepting a partial list', async () => {
    const valid = await finish(api.getOrigins('KW-05-01'));
    for (const mutate of [
      (value: EmptyVehicleOptions) => { value.origins[1].origin.floorName = ''; },
      (value: EmptyVehicleOptions) => { value.origins[1].origin.locationCode = value.origins[0].origin.locationCode; },
      (value: EmptyVehicleOptions) => { value.origins[1].vehicle.containerCode = value.origins[0].vehicle.containerCode; },
      (value: EmptyVehicleOptions) => { value.origins[1].vehicle.version = 0; },
      (value: EmptyVehicleOptions) => { value.origins[1].origin.floorName = '矛盾楼层名称'; }
    ]) {
      const data: EmptyVehicleOptions = JSON.parse(JSON.stringify(valid)); mutate(data);
      vi.spyOn(api, 'getOrigins').mockResolvedValueOnce(data);
      const flow = useEmptyVehicle(); await flow.scan('KW-05-01');
      expect(flow.options.value).toBeNull(); expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.error).toBe(true);
    }
  });
  it('validates inputs and discards late responses after reset', async () => {
    const flow = useEmptyVehicle(); const query = vi.spyOn(api, 'getOrigins');
    await flow.scan(' '.repeat(5)); await flow.scan('X'.repeat(129)); expect(query).not.toHaveBeenCalled();
    const pending = flow.scan('KW-05-01'); flow.clear(); await finish(pending);
    expect(flow.options.value).toBeNull(); expect(flow.origin.value).toBeNull(); expect(flow.busy.value).toBe(false);
    await finish(flow.scan('KW-CALL-SINGLE')); expect(flow.canSubmit.value).toBe(true);
    const submit = flow.submit(); flow.clear(); await finish(submit); expect(flow.notice.value).toBeNull();
  });
  it('checks idempotency, current version and current origin relation at submission', async () => {
    const options = await finish(api.getOrigins('KW-05-01')); const first = options.origins[0];
    const input = { requestId: requestId(), originLocationCode: first.origin.locationCode, destinationLocationCode: 'KW-05-01', vehicleCode: first.vehicle.containerCode, version: first.vehicle.version };
    await finish(expect(api.call({ ...input, version: 99 })).rejects.toThrow('版本已变化'));
    const result = await finish(api.call(input)); expect(await finish(api.call(input))).toEqual(result);
    await finish(expect(api.call({ ...input, destinationLocationCode: 'KW-CALL-SINGLE' })).rejects.toThrow('相同请求标识'));
    const second = options.origins[1]; const location = await finish(locationBindingApi.getLocation(second.origin.locationCode));
    await finish(locationBindingApi.unbind({ locationCode: second.origin.locationCode, version: location.version,
      container: { containerType: 'VEHICLE', containerCode: second.vehicle.containerCode }, containerVersion: second.vehicle.version }));
    await finish(expect(api.call({ ...input, requestId: requestId(), destinationLocationCode: 'KW-CALL-LONG', originLocationCode: second.origin.locationCode,
      vehicleCode: second.vehicle.containerCode, version: second.vehicle.version })).rejects.toThrow('已不可用'));
  });
  it('renders carrier outside the choice and preserves cascades and scanner guards', async () => {
    const wrapper = mount(EmptyVehiclePage, { global: { stubs: { picker: { name: 'TestPicker', props: ['range', 'value', 'disabled'], template: '<div><slot /></div>' } } } });
    try {
      hooks.show.forEach((show) => show());
      window.dispatchEvent(new CustomEvent('pda-scan', { detail: { value: 'KW-05-01' } })); await vi.advanceTimersByTimeAsync(500);
      expect(wrapper.find('.choice').text()).not.toContain('CAR-'); expect(wrapper.text()).toContain('CAR-CALL-001');
      await wrapper.find('.choice').trigger('tap'); const modal = wrapper.findComponent(LocationCascade);
      expect(modal.props('title')).toBe('选择起始位置'); expect(wrapper.findComponent(ScanInput).props('disabled')).toBe(true);
      const pickers = modal.findAllComponents({ name: 'TestPicker' });
      pickers[0].vm.$emit('change', { detail: { value: 0 } }); await wrapper.vm.$nextTick();
      expect(pickers[1].props('value')).toBe(0); expect(pickers[2].props('value')).toBe(0);
      expect(modal.find('button.primary').attributes('disabled')).toBeDefined();
      await modal.find('button').trigger('tap'); expect(wrapper.text()).toContain('CAR-CALL-001');
      window.dispatchEvent(new CustomEvent('pda-scan', { detail: { value: 'KW-CALL-NONE' } })); await wrapper.vm.$nextTick();
      expect(wrapper.find('[aria-label="替换目标位置"]').exists()).toBe(true);
      expect(wrapper.findComponent(ScanInput).props('disabled')).toBe(true);
    } finally { wrapper.unmount(); }
  });
});
