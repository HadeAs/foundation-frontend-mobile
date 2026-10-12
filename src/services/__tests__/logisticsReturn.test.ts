import { testRequest } from './helpers/testRequest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import LogisticsPage from '../../pages/logistics-create/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { useLogisticsCreation } from '../../composables/useLogisticsCreation';
import { logisticsApi as api, type TaskCreationResponse } from '../logistics';
import { logisticsCancellationApi } from '../logisticsCancellation';
import { locationBindingApi } from '../locationBinding';
import { requestId } from '../nariRequest';
import { resetMockData } from './fixtures/nariBackend';
import * as mock from './fixtures/nariBackend';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (callback: () => void) => hooks.show.push(callback), onHide: () => {}, onLoad: () => {} }));
const storage = new Map<string, unknown>();
const network = vi.fn(testRequest);
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(() => {
  vi.useFakeTimers(); storage.clear(); network.mockClear(); hooks.show.length = 0; resetMockData();
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('logistics return contract', () => {
  it.each(['CAR-LOG-NORMAL', 'KW-LOG-NORMAL'])('creates from %s without sending the user-selected destination and clears the page', async (code) => {
    const flow = useLogisticsCreation();
    await finish(flow.scan(` ${code} `));
    flow.openChoice(); flow.choose(flow.candidates.value[1]);
    const chosen = flow.destination.value!.locationCode;
    const create = vi.spyOn(api, 'returnToWarehouse');
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(Promise.all([flow.returnToWarehouse(), flow.returnToWarehouse(), flow.submit()]));
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toEqual({ requestId: expect.any(String),
      object: { containerType: 'VEHICLE', containerCode: 'CAR-LOG-NORMAL' }, version: 1, originLocationCode: 'KW-LOG-NORMAL',
      vendor: 'STANDARD', taskType: 'GENERAL', destinationMode: 'RETURN_LINE_SIDE' });
    expect(transport.mock.lastCall?.[0]).toMatchObject({ url: expect.stringContaining('/logistics/tasks'), method: 'POST' });
    expect(flow.options.value).toBeNull(); expect(flow.destination.value).toBeNull(); expect(flow.canReturn.value).toBe(false);
    expect(flow.notice.value?.text).toContain('回库任务创建成功');
    const receipt = await create.mock.results[0].value;
    expect(receipt.task.destination.locationCode).toBe('KW-RETURN-STANDARD');
    expect(receipt.task.destination.locationCode).not.toBe(chosen);
    const page = await finish(logisticsCancellationApi.query('CAR-LOG-NORMAL', 1));
    expect(page.records).toHaveLength(1); expect(page.records[0].taskId).toBe(receipt.task.taskId);
    const blocked = await finish(api.getOptions(code)); expect(blocked.eligibility.allowed).toBe(false);
    const cancel = await finish(logisticsCancellationApi.cancel(receipt.task.taskId, { requestId: requestId(), version: receipt.task.version }));
    expect(cancel.cancelStatus).toBe('CANCELLED');
    expect((await finish(api.getOptions(code))).eligibility.allowed).toBe(true);
    expect(network).toHaveBeenCalled();
  });
  it('allows return without any manual destinations and preserves failure data for a new-request retry', async () => {
    const flow = useLogisticsCreation();
    await finish(flow.scan('CAR-LOG-NO-END'));
    expect(flow.destination.value).toBeNull(); expect(flow.canSubmit.value).toBe(false); expect(flow.canReturn.value).toBe(true);
    await finish(flow.returnToWarehouse()); expect(flow.notice.value?.error).toBe(false);
    await finish(flow.scan('CAR-LOG-RETURN-FAIL'));
    const source = flow.options.value; const selected = flow.destination.value;
    const create = vi.spyOn(api, 'returnToWarehouse');
    await finish(flow.returnToWarehouse()); await finish(flow.returnToWarehouse());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].requestId).not.toBe(create.mock.calls[1][0].requestId);
    expect(flow.options.value).toBe(source); expect(flow.destination.value).toBe(selected);
    expect(flow.notice.value).toEqual({ text: '回库失败：回库位置暂不可用', error: true });
    expect((await finish(logisticsCancellationApi.query('CAR-LOG-RETURN-FAIL', 1))).records).toHaveLength(0);
  });
  it('keeps the footer return button disabled until a vehicle is identified and blocks it while choosing', async () => {
    const wrapper = mount(LogisticsPage, { global: { stubs: { picker: true } } });
    try {
      hooks.show.forEach((show) => show());
      const scan = wrapper.getComponent(ScanInput);
      const button = () => wrapper.findAll('.footer button')[1];
      expect(button().text()).toBe('回库'); expect(button().attributes('disabled')).toBeDefined();
      scan.vm.$emit('scan', 'KW-LOG-NORMAL'); await vi.advanceTimersByTimeAsync(200);
      expect(button().attributes('disabled')).toBeUndefined();
      await wrapper.get('.choice').trigger('tap'); expect(button().attributes('disabled')).toBeDefined();
      await wrapper.get('.cascade-modal .actions button').trigger('tap');
      expect(button().attributes('disabled')).toBeUndefined();
      await button().trigger('tap'); await vi.advanceTimersByTimeAsync(200);
      expect(wrapper.find('.choice').exists()).toBe(false);
      expect(wrapper.text()).toContain('回库任务创建成功');
      expect(button().attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
    const flow = useLogisticsCreation(); const create = vi.spyOn(api, 'returnToWarehouse');
    await flow.returnToWarehouse(); await finish(flow.scan('UNKNOWN')); await flow.returnToWarehouse();
    await finish(flow.scan('BOX-SHIP-SINGLE')); await flow.returnToWarehouse();
    expect(flow.canReturn.value).toBe(false); expect(create).not.toHaveBeenCalled();
  });
  it('revalidates version, origin and pending tasks; replays only identical requests', async () => {
    const flow = useLogisticsCreation(); await finish(flow.scan('CAR-LOG-HIK'));
    const create = vi.spyOn(api, 'returnToWarehouse'); await finish(flow.returnToWarehouse());
    const input = create.mock.calls[0][0]; const receipt = await create.mock.results[0].value;
    expect(receipt.task.destination.locationCode).toBe('KW-RETURN-HIK');
    expect(await finish(api.returnToWarehouse(input))).toEqual(receipt);
    await finish(expect(api.returnToWarehouse({ ...input, originLocationCode: 'OTHER' })).rejects.toThrow('相同请求标识'));
    await finish(expect(api.returnToWarehouse({ ...input, requestId: requestId() })).rejects.toThrow('未结束物流任务'));
    await finish(expect(api.create({ ...input, destinationMode: 'SPECIFIED', destinationLocationCode: 'DEST-001' })).rejects.toThrow('相同请求标识'));
    await finish(flow.scan('CAR-LOG-SINGLE'));
    const state = flow.options.value!;
    const stale = { requestId: requestId(), object: { containerType: state.object.containerType, containerCode: state.object.containerCode },
      version: state.object.version, vendor: state.vendor, taskType: state.taskType,
      originLocationCode: state.origin.locationCode, destinationMode: 'RETURN_LINE_SIDE' as const };
    await finish(expect(api.returnToWarehouse({ ...stale, version: 99 })).rejects.toThrow('版本或起始位置已变化'));
    await finish(expect(api.returnToWarehouse({ ...stale, originLocationCode: 'OTHER' })).rejects.toThrow('版本或起始位置已变化'));
    await finish(expect(api.returnToWarehouse({ ...stale, vendor: 'HIKVISION' })).rejects.toThrow('任务配置已变化'));
    await finish(expect(api.returnToWarehouse({ ...stale, taskType: 'PROCESS_ROUTE' } as unknown as typeof stale)).rejects.toThrow('任务配置已变化'));
    await finish(expect(api.returnToWarehouse({ ...stale, destinationLocationCode: 'DEST-001' } as unknown as typeof stale)).rejects.toThrow('不能提交目标位置'));
    const location = await finish(locationBindingApi.getLocation('KW-LOG-SINGLE'));
    await finish(locationBindingApi.unbind({ locationCode: 'KW-LOG-SINGLE', version: location.version, container: stale.object, containerVersion: state.object.version }));
    await finish(flow.returnToWarehouse()); expect(flow.notice.value?.error).toBe(true); expect(flow.options.value).toBe(state);
  });
  it('ignores late receipts and uses the formal creation endpoint in explicit real mode', async () => {
    const flow = useLogisticsCreation(); await finish(flow.scan('CAR-LOG-NORMAL'));
    const options = flow.options.value!;
    let resolve!: (value: TaskCreationResponse) => void;
    const create = vi.spyOn(api, 'returnToWarehouse').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = flow.returnToWarehouse(); expect(flow.canReturn.value).toBe(false); flow.clear();
    resolve({ requestId: create.mock.calls[0][0].requestId, task: { taskId: '1', taskNo: 'RT-LATE', version: 1,
      vendor: options.vendor, taskType: options.taskType, container: options.object, origin: options.origin,
      destination: { locationCode: 'RETURN', locationName: '回库位' }, status: 'QUEUED', statusName: '已创建', triggerMode: 'MANUAL', createdTime: new Date().toISOString() } });
    await pending; expect(flow.options.value).toBeNull(); expect(flow.notice.value).toBeNull();
    create.mockRestore();
    await finish(flow.scan('CAR-LOG-NORMAL'));
    const realRequest = vi.fn((options: UniNamespace.RequestOptions) => {
      options.success?.({ data: { code: 40900, message: '回库目标配置缺失' }, statusCode: 409, header: {}, cookies: [] });
      return {} as UniNamespace.RequestTask;
    });
    vi.stubGlobal('uni', { ...uni, request: realRequest }); vi.stubEnv('VITE_API_MODE', 'real');
    await flow.returnToWarehouse();
    expect(realRequest).toHaveBeenCalledOnce();
    expect(realRequest.mock.calls[0][0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/logistics/tasks'),
      data: { vendor: 'STANDARD', taskType: 'GENERAL', destinationMode: 'RETURN_LINE_SIDE', originLocationCode: 'KW-LOG-NORMAL' } });
    expect(realRequest.mock.calls[0][0].data).not.toHaveProperty('destinationLocationCode');
    expect(flow.notice.value).toEqual({ text: '回库目标配置缺失', error: true });
    expect(flow.options.value).not.toBeNull(); expect(network).toHaveBeenCalled();
  });
});
