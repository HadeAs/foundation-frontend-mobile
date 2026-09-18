import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import LocationCascade from '../../components/LocationCascade.vue';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { logisticsApi as api, type LogisticsOptions } from '../logistics';
import { useLogisticsCreation } from '../../composables/useLogisticsCreation';
import { shippingApi, shippingRequest } from '../shipping';
import { locationBindingApi } from '../locationBinding';

const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock'); vi.useFakeTimers(); storage.clear(); network.mockClear(); resetMockData();
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('logistics creation', () => {
  it('preserves eligibility reasons up to 500 characters without relaxing code limits', async () => {
    const valid = await finish(api.getOptions('CAR-LOG-NORMAL'));
    const get = vi.spyOn(api, 'getOptions');
    const flow = useLogisticsCreation();
    for (const length of [1, 128, 129, 200, 500]) {
      const reason = '错'.repeat(length);
      get.mockResolvedValueOnce({ ...valid, eligibility: { allowed: false, reason } });
      await flow.scan('CAR-LOG-NORMAL');
      expect(flow.notice.value).toEqual({ text: reason, error: true });
      expect(flow.options.value).not.toBeNull();
      expect(flow.canSubmit.value).toBe(false);
    }
    for (const reason of ['', '   ', '错'.repeat(501), undefined]) {
      get.mockResolvedValueOnce({ ...valid, eligibility: { allowed: false, reason } });
      await flow.scan('CAR-LOG-NORMAL');
      expect(flow.notice.value?.text).toContain('物流任务信息不完整');
      expect(flow.options.value).toBeNull();
    }
    get.mockClear(); await flow.scan('X'.repeat(129)); expect(get).not.toHaveBeenCalled();
  });
  it('selects the unique recommendation without submitting and retains all 225 options', async () => {
    const flow = useLogisticsCreation();
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.scan(' CAR-LOG-SINGLE '));
    expect(transport.mock.lastCall?.[0].data).toEqual({ scanCode: 'CAR-LOG-SINGLE' });
    expect(flow.candidates.value).toHaveLength(1);
    expect(flow.destination.value).toEqual(flow.candidates.value[0]);
    expect(flow.canSubmit.value).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    flow.openChoice(); flow.choose(flow.candidates.value[0]);
    expect(flow.canSubmit.value).toBe(true);
    await finish(flow.scan('KW-LOG-LONG'));
    expect(flow.options.value?.object.containerCode).toBe('CAR-LOG-LONG');
    expect(flow.candidates.value).toHaveLength(225);
    expect(flow.destination.value?.locationCode).toBe('DEST-001');
    expect(network).not.toHaveBeenCalled();
  });
  it('replays backend vendor/type and version, submits once and clears after success', async () => {
    for (const [code, vendor, taskType] of [['CAR-LOG-HIK', 'HIKVISION', 'GENERAL'], ['CAR-LOG-PROCESS', 'STANDARD', 'PROCESS_ROUTE']]) {
      const flow = useLogisticsCreation();
      await finish(flow.scan(code));
      flow.openChoice(); flow.choose(flow.candidates.value[0]);
      const create = vi.spyOn(api, 'create');
      await finish(Promise.all([flow.submit(), flow.submit()]));
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0][0]).toEqual({ requestId: expect.any(String), object: { containerType: 'VEHICLE', containerCode: code }, version: 1,
        vendor, taskType, originLocationCode: code.replace('CAR-', 'KW-'), destinationLocationCode: 'DEST-001' });
      expect(flow.notice.value?.text).toContain('物流任务创建成功');
      expect(flow.options.value).toBeNull();
      expect(flow.destination.value).toBeNull();
      create.mockRestore();
      await finish(flow.scan(code));
      expect(flow.canSubmit.value).toBe(false);
      expect(flow.notice.value?.text).toContain('未结束物流任务');
    }
  });
  it('does not guess with zero or multiple recommendations, and resets previous selections on rescan', async () => {
    const flow = useLogisticsCreation();
    const valid = await finish(api.getOptions('CAR-LOG-NORMAL'));
    const get = vi.spyOn(api, 'getOptions');
    get.mockResolvedValueOnce({ ...valid, destinations: valid.destinations.map((item, index) => ({ ...item, recommended: index === 3 })) });
    await flow.scan('CAR-LOG-NORMAL');
    expect(flow.destination.value).toEqual(valid.destinations[3].location);
    flow.openChoice(); flow.choose(flow.candidates.value[1]);
    expect(flow.destination.value).toEqual(valid.destinations[1].location);
    for (const destinations of [
      [{ ...valid.destinations[0], recommended: false }],
      valid.destinations.map((item) => ({ ...item, recommended: true })),
      []
    ]) {
      get.mockResolvedValueOnce({ ...valid, destinations });
      await flow.scan('CAR-LOG-NORMAL');
      expect(flow.destination.value).toBeNull();
      expect(flow.canSubmit.value).toBe(false);
    }
    get.mockResolvedValueOnce({ ...valid, eligibility: { allowed: false, reason: '不可创建' } });
    await flow.scan('CAR-LOG-NORMAL');
    expect(flow.destination.value).toBeNull();
    expect(flow.canSubmit.value).toBe(false);
    flow.clear(); expect(flow.destination.value).toBeNull();
  });
  it('retains failures and uses a new UUID on each manual retry', async () => {
    const flow = useLogisticsCreation();
    await finish(flow.scan('CAR-LOG-FAIL')); flow.openChoice(); flow.choose(flow.candidates.value[0]);
    const create = vi.spyOn(api, 'create');
    const selected = flow.destination.value;
    await finish(flow.submit()); await finish(flow.submit());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].requestId).not.toBe(create.mock.calls[1][0].requestId);
    expect(flow.destination.value).toBe(selected);
    expect(flow.notice.value?.text).toBe('物流任务创建失败：目标位置暂不可用');
  });
  it('disables ineligible/empty results, rejects bad scans or incomplete hierarchy, and ignores late responses', async () => {
    const flow = useLogisticsCreation();
    for (const code of ['CAR-LOG-NO-END', 'CAR-LOG-BLOCKED']) {
      await finish(flow.scan(code)); flow.openChoice();
      expect(flow.choosing.value).toBe(false); expect(flow.canSubmit.value).toBe(false);
    }
    for (const code of ['UNKNOWN', 'CONTAINER-AMBIGUOUS', 'KW-SHIP-EMPTY', 'CAR-EMPTY', 'KW-BOUND-CAR']) {
      await finish(flow.scan(code)); expect(flow.options.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
    }
    const valid = await finish(api.getOptions('CAR-LOG-NORMAL'));
    vi.spyOn(api, 'getOptions').mockResolvedValueOnce({ ...valid, destinations: [{ ...valid.destinations[0], location: { ...valid.destinations[0].location, areaName: '' } }] });
    await flow.scan('CAR-LOG-NORMAL'); expect(flow.options.value).toBeNull();
    let resolve!: (value: LogisticsOptions) => void;
    vi.spyOn(api, 'getOptions').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const stale = flow.scan('CAR-LOG-NORMAL'); flow.clear(); resolve(valid); await stale;
    expect(flow.options.value).toBeNull();
    const get = vi.spyOn(api, 'getOptions'); get.mockClear();
    await flow.scan(' '); await flow.scan('X'.repeat(129)); expect(get).not.toHaveBeenCalled();
  });
  it('carries shippingNo only for the handed-off vehicle; logistics failure/cancel never rolls shipping back', async () => {
    const shipped = await finish(shippingApi.submit(shippingRequest(await finish(shippingApi.getObject('CAR-SHIP')))));
    const flow = useLogisticsCreation();
    await finish(flow.scan(shipped.object.containerCode, shipped.shippingNo));
    expect(flow.options.value?.object.version).toBe(shipped.object.version);
    const recommended = flow.destination.value;
    flow.openChoice(); flow.closeChoice(); expect(flow.destination.value).toBe(recommended);
    flow.openChoice(); flow.choose(flow.candidates.value[0]);
    const create = vi.spyOn(api, 'create').mockRejectedValueOnce(new Error('创建失败'));
    await flow.submit(); expect(flow.options.value).not.toBeNull();
    expect((await finish(shippingApi.getObject('CAR-SHIP'))).totalMaterialQuantity).toBe(0);
    await finish(flow.submit()); expect(create.mock.lastCall?.[0].shippingNo).toBe(shipped.shippingNo);
    await finish(flow.scan('CAR-LOG-NORMAL')); flow.openChoice(); flow.choose(flow.candidates.value[0]);
    await finish(flow.submit()); expect(create.mock.lastCall?.[0].shippingNo).toBeUndefined();
  });
  it('revalidates source and candidates server-side and protects idempotent submissions', async () => {
    const flow = useLogisticsCreation(); await finish(flow.scan('CAR-LOG-NORMAL')); flow.openChoice(); flow.choose(flow.candidates.value[0]);
    const create = vi.spyOn(api, 'create'); await finish(flow.submit());
    const input = create.mock.calls[0][0]; const first = await create.mock.results[0].value;
    expect(await finish(api.create(input))).toEqual(first);
    const bad = expect(api.create({ ...input, destinationLocationCode: 'WRONG' })).rejects.toThrow('相同请求标识'); await finish(bad);
    await finish(flow.scan('CAR-LOG-SINGLE')); flow.openChoice(); flow.choose(flow.candidates.value[0]);
    const location = await finish(locationBindingApi.getLocation('KW-LOG-SINGLE'));
    await finish(locationBindingApi.unbind({ locationCode: 'KW-LOG-SINGLE', version: location.version, container: { containerType: 'VEHICLE', containerCode: 'CAR-LOG-SINGLE' }, containerVersion: location.container!.version }));
    await finish(flow.submit()); expect(flow.notice.value?.error).toBe(true); expect(flow.options.value).not.toBeNull();
  });
  it('cascades by codes, clears descendants, cancels without committing, and confirms only complete paths', async () => {
    const options = await finish(api.getOptions('CAR-LOG-NORMAL'));
    const wrapper = mount(LocationCascade, { props: { locations: options.destinations.map((item) => item.location) }, global: { stubs: {
      picker: { name: 'TestPicker', props: ['range', 'value', 'disabled'], template: '<div><slot /></div>' }
    } } });
    const pickers = wrapper.findAllComponents({ name: 'TestPicker' });
    const change = async (i: number, value: number) => { pickers[i].vm.$emit('change', { detail: { value } }); await wrapper.vm.$nextTick(); };
    expect(pickers.map((picker) => picker.props('value'))).toEqual([0, 0, 0]);
    expect(pickers[1].props('disabled')).toBe(true);
    await change(0, 1); await change(1, 1); await change(2, 1);
    expect(wrapper.find('button.primary').attributes('disabled')).toBeUndefined();
    await change(1, 2); expect(pickers[2].props('value')).toBe(0);
    await change(2, 1); await change(0, 2);
    expect(pickers.map((picker) => picker.props('value'))).toEqual([2, 0, 0]);
    expect(wrapper.find('button.primary').attributes('disabled')).toBeDefined();
    await wrapper.find('button').trigger('tap'); expect(wrapper.emitted('cancel')).toHaveLength(1); expect(wrapper.emitted('confirm')).toBeUndefined();
    await change(1, 1); await change(2, 1); await wrapper.find('button.primary').trigger('tap');
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toMatchObject({ floorCode: 'F2', areaCode: 'A1', locationCode: 'DEST-005' });
    wrapper.unmount();
  });
});
