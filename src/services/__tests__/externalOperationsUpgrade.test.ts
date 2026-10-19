import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ShippingPage from '../../pages/shipping/index.vue';
import ApplicationPage from '../../pages/warehouse-application/index.vue';
import ReceivingPage from '../../pages/receiving/index.vue';
import ScanInput from '../../components/ScanInput.vue';
import { useShipping } from '../../composables/useShipping';
import { useWarehouseApplication } from '../../composables/useWarehouseApplication';
import { useReceiving } from '../../composables/useReceiving';
import { useTrafficControl } from '../../composables/useTrafficControl';
import { shippingApi, type ShippingRequest } from '../shipping';
import { warehouseApplicationApi, type ApplicationObject } from '../warehouseApplication';
import { receivingApi, type ReceivingResult } from '../receiving';
import { trafficApi, type TrafficArea } from '../traffic';
import { ApiRequestError } from '../nariRequest';
import { AUTH_SESSION_STORAGE_KEY } from '../auth';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const time = '2026-10-19T01:00:00Z';
const storage = new Map<string, unknown>();
const snapshot = (): ApplicationObject => ({ scanType: 'BOX', scanCode: 'BOX-1', object: { containerType: 'BOX', containerCode: 'BOX-1', version: 7 },
  boxes: [{ boxCode: 'BOX-1', version: 7, materialQuantity: 1, materials: [{ lineType: 'PANEL', panelCode: 'PANEL-1', materialCode: 'MAT-1', orderNo: 'SO-1', quantity: 1 }] }],
  totalMaterialQuantity: 1, eligibility: { allowed: true } });
const shippingReceipt = (input: ShippingRequest) => ({ requestId: input.requestId, object: { ...input.object, version: 9 }, shippingNo: 'SHIP-1',
  canCreateLogisticsTask: false, processedTime: time });
const applicationReceipt = (requestId: string) => ({ requestId, applicationNo: 'APPLY-1', sapDocumentNos: ['SAP-1'], wmsPendingCreated: true, processedTime: time });
beforeEach(() => {
  hooks.show.length = hooks.hide.length = 0;
  storage.clear();
  vi.stubGlobal('uni', { navigateBack: vi.fn(), getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(['shipping', 'application'] as const)('%s external checkpoint recovery', kind => {
  function setup() {
    const get = kind === 'shipping' ? vi.spyOn(shippingApi, 'getObject').mockResolvedValue(snapshot()) : vi.spyOn(warehouseApplicationApi, 'getObject').mockResolvedValue(snapshot());
    const send = kind === 'shipping' ? vi.spyOn(shippingApi, 'submit').mockRejectedValue(new ApiRequestError('外部结果待核实', 503)) :
      vi.spyOn(warehouseApplicationApi, 'submit').mockRejectedValue(new ApiRequestError('外部结果待核实', 503));
    const create = kind === 'shipping' ? useShipping : useWarehouseApplication;
    return { get, send, create, flow: create() };
  }
  it('keeps exact UUID and old version through clear, scanning and reopening without automatic writes', async () => {
    const { flow, create, get, send } = setup(); await flow.scan('BOX-1'); await flow.submit();
    const original = JSON.parse(JSON.stringify(flow.pending.value!.input));
    flow.clear(); await flow.scan('BOX-2'); expect(get).toHaveBeenCalledOnce();
    flow.pause(); const reopened = create(); reopened.resume();
    expect(reopened.pending.value?.input).toEqual(original); expect(reopened.canSubmit.value).toBe(true); expect(send).toHaveBeenCalledOnce();
    await reopened.submit(); expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(reopened.pending.value?.input.version).toBe(7);
  });
  it.each([404, 409])('preserves an already uncertain operation when its manual replay returns %s', async status => {
    const { flow, send } = setup(); await flow.scan('BOX-1'); await flow.submit();
    const original = flow.pending.value!.input;
    send.mockRejectedValue(new ApiRequestError('明确失败，原记录未找到', status)); await flow.submit();
    expect(flow.pending.value?.input).toEqual(original); expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });
  it('settles a valid late success without restoring hidden page content', async () => {
    const { flow, create } = setup(); await flow.scan('BOX-1');
    let release!: () => void;
    if (kind === 'shipping') vi.mocked(shippingApi.submit).mockImplementation(input => new Promise(resolve => { release = () => resolve(shippingReceipt(input)); }));
    else vi.mocked(warehouseApplicationApi.submit).mockImplementation((_object, _version, id) => new Promise(resolve => { release = () => resolve(applicationReceipt(id!)); }));
    const work = flow.submit(); flow.pause(); release(); await work;
    expect(flow.object.value).toBeNull(); expect(flow.notice.value).toBeNull(); expect(create().pending.value).toBeNull();
  });
  it('does not POST if the original request cannot be saved', async () => {
    const { flow, send } = setup(); await flow.scan('BOX-1');
    vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('disk full'); });
    await flow.submit(); expect(send).not.toHaveBeenCalled(); expect(flow.storageError.value).toBeTruthy(); expect(flow.canSubmit.value).toBe(false);
  });
  it('preserves the saved request if recording completion fails', async () => {
    const { flow, create } = setup(); await flow.scan('BOX-1'); await flow.submit(); const original = flow.pending.value!.input;
    if (kind === 'shipping') vi.mocked(shippingApi.submit).mockImplementation(async input => shippingReceipt(input));
    else vi.mocked(warehouseApplicationApi.submit).mockImplementation(async (_object, _version, id) => applicationReceipt(id!));
    vi.spyOn(uni, 'setStorageSync').mockImplementation((key, value) => { if (value === null) throw new Error('disk full'); storage.set(key, value); });
    await flow.submit(); expect(flow.storageError.value).toBeTruthy(); expect(flow.object.value).not.toBeNull();
    expect(create().pending.value?.input).toEqual(original);
  });
  it('isolates pending records by account and environment and rejects writes from the old page', async () => {
    const { flow, create, send } = setup(); await flow.scan('BOX-1'); await flow.submit();
    seedTestSession('another-user'); flow.resume(); await flow.submit(); expect(send).toHaveBeenCalledOnce(); expect(create().pending.value).toBeNull();
    seedTestSession();
    const session = uni.getStorageSync(AUTH_SESSION_STORAGE_KEY); uni.setStorageSync(AUTH_SESSION_STORAGE_KEY, { ...session, baseUrl: 'https://another.example' });
    expect(create().pending.value).toBeNull();
    seedTestSession(); expect(create().pending.value).not.toBeNull();
  });
  it('keeps corrupt stored records and permits only local re-reading until repaired', async () => {
    const { flow, create, send } = setup(); await flow.scan('BOX-1'); await flow.submit();
    const key = [...storage.keys()].find(key => key.startsWith(kind === 'shipping' ? 'foundation.shipping.real.' : 'foundation.warehouse-applications.real.'))!;
    const valid = storage.get(key); storage.set(key, { invalid: true });
    const reopened = create(); expect(reopened.storageError.value).toBeTruthy(); await reopened.scan('BOX-1'); await reopened.submit();
    expect(send).toHaveBeenCalledOnce(); expect(storage.get(key)).toEqual({ invalid: true });
    storage.set(key, valid); reopened.resume(); expect(reopened.storageError.value).toBe(''); expect(reopened.pending.value).not.toBeNull();
  });
});

it.each(['SAP部分成功，等待核实', 'MES_REJECTED，未产生外部效果'])('does not derive warehouse application recovery from an error message: %s', async message => {
  vi.spyOn(warehouseApplicationApi, 'getObject').mockResolvedValue(snapshot());
  const send = vi.spyOn(warehouseApplicationApi, 'submit').mockRejectedValue(new ApiRequestError(message, 409));
  const flow = useWarehouseApplication(); await flow.scan('BOX-1'); await flow.submit(); await flow.submit();
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]); expect(flow.pending.value).not.toBeNull();
});

const receiving = (version = 7): ReceivingResult => ({ object: snapshot().object, boxes: snapshot().boxes, totalMaterialQuantity: 1,
  task: { taskId: '101', taskNo: 'WL-1', version, object: snapshot().object, status: 'PENDING', statusName: '待接收', createdTime: time,
    totalBoxCount: 1, receivedBoxCount: 0, eligibility: { allowed: true } } });
describe('WMS cleanup version refresh', () => {
  it('does not consider a newer received task proof that an uncertain cleanup was rolled back', async () => {
    const fresh = receiving(99); Object.assign(fresh.task!, { status: 'RECEIVED', statusName: '已接收', receivedBoxCount: 1 });
    vi.spyOn(receivingApi, 'query').mockResolvedValueOnce(receiving()).mockResolvedValue(fresh);
    const send = vi.spyOn(receivingApi, 'clearWms').mockRejectedValueOnce(new ApiRequestError('明确失败或提交未知', 503))
      .mockRejectedValueOnce(new ApiRequestError('SENDING，待核实', 409));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true);
    const original = flow.pending.value!.input;
    expect(flow.result.value?.task?.version).toBe(99); expect(flow.pending.value?.input.version).toBe(7);
    flow.askClearWms(); await flow.submit(true); expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(flow.pending.value?.input).toEqual(original); expect(flow.canReceive.value).toBe(false);
  });
  it('refreshes the same scope after failure, but preserves the original cleanup version and UUID on replay', async () => {
    const query = vi.spyOn(receivingApi, 'query').mockResolvedValueOnce(receiving()).mockResolvedValueOnce(receiving(9)).mockResolvedValueOnce(receiving(11));
    const send = vi.spyOn(receivingApi, 'clearWms').mockRejectedValueOnce(new ApiRequestError('清理结果未知', 503)).mockImplementationOnce(async input =>
      ({ requestId: input.requestId, operationNo: 'CLEAN-1', affectedCount: 1, processedTime: time }));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true);
    expect(query.mock.lastCall).toEqual(['BOX-1', '101']); expect(flow.result.value?.task?.version).toBe(9);
    expect(flow.canReceive.value).toBe(false); expect(flow.pending.value?.input.version).toBe(7);
    flow.pause(); const reopened = useReceiving(); reopened.resume(); expect(send).toHaveBeenCalledOnce();
    reopened.askClearWms(); await reopened.submit(true); expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(query.mock.lastCall).toEqual(['BOX-1', '101']); expect(reopened.result.value).toBeNull(); expect(reopened.pending.value).toBeNull();
  });
  it('does not keep a writable stale snapshot when the post-cleanup task refresh fails', async () => {
    const query = vi.spyOn(receivingApi, 'query').mockResolvedValueOnce(receiving()).mockRejectedValueOnce(new Error('查询失败'));
    vi.spyOn(receivingApi, 'clearWms').mockRejectedValue(new ApiRequestError('WMS不可用', 503));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true);
    expect(query.mock.lastCall).toEqual(['BOX-1', '101']); expect(flow.result.value).toBeNull(); expect(flow.canReceive.value).toBe(false);
    expect(flow.pending.value?.input.version).toBe(7); expect(flow.notice.value?.text).toContain('任务刷新失败');
  });
});

const region = (version = 7, status: 'FREE' | 'OCCUPIED' = 'FREE'): TrafficArea => ({ areaCode: 'TC-1', areaName: '区域', version, status });
const regions = (item = region()) => ({ records: [item], total: 1, current: 1, size: 20, pages: 1 });
describe('traffic receipt refresh', () => {
  it('uses freshly queried state/version for the next action instead of a replayed receipt', async () => {
    const query = vi.spyOn(trafficApi, 'query').mockResolvedValueOnce(regions()).mockResolvedValueOnce(regions(region(12, 'OCCUPIED'))).mockResolvedValueOnce(regions(region(13)));
    const send = vi.spyOn(trafficApi, 'act').mockResolvedValueOnce(region(8, 'OCCUPIED')).mockResolvedValueOnce(region(13));
    const flow = useTrafficControl(); await flow.query(); flow.open(flow.items.value[0]); await flow.confirm();
    expect(query).toHaveBeenCalledTimes(2); expect(flow.items.value[0].version).toBe(12);
    flow.open(flow.items.value[0]); await flow.confirm(); expect(send.mock.calls[1][2].version).toBe(12); expect(send.mock.calls[1][1]).toBe('release');
  });
  it('blocks another action until the required refresh succeeds and does not repeat the write', async () => {
    vi.spyOn(trafficApi, 'query').mockResolvedValueOnce(regions()).mockRejectedValueOnce(new Error('刷新失败')).mockResolvedValueOnce(regions(region(12, 'OCCUPIED')));
    const send = vi.spyOn(trafficApi, 'act').mockResolvedValue(region(8, 'OCCUPIED'));
    const flow = useTrafficControl(); await flow.query(); flow.open(flow.items.value[0]); await flow.confirm();
    expect(flow.needsRefresh.value).toBe(true); flow.open(flow.items.value[0]); await flow.confirm(); expect(send).toHaveBeenCalledOnce();
    await flow.retry(); expect(flow.needsRefresh.value).toBe(false); expect(flow.items.value[0].version).toBe(12);
  });
});

it.each(['shipping', 'application', 'cleanup'] as const)('restores the %s pending card with scanning/clear locked, navigation available and explicit retry', async kind => {
  let page;
  let send;
  if (kind === 'cleanup') {
    page = ReceivingPage;
    vi.spyOn(receivingApi, 'query').mockResolvedValue(receiving());
    send = vi.spyOn(receivingApi, 'clearWms').mockRejectedValue(new ApiRequestError('待核实', 503));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true); flow.pause();
  } else if (kind === 'shipping') {
    page = ShippingPage;
    vi.spyOn(shippingApi, 'getObject').mockResolvedValue(snapshot());
    send = vi.spyOn(shippingApi, 'submit').mockRejectedValue(new ApiRequestError('待核实', 503));
    const flow = useShipping(); await flow.scan('BOX-1'); await flow.submit(); flow.pause();
  } else {
    page = ApplicationPage;
    vi.spyOn(warehouseApplicationApi, 'getObject').mockResolvedValue(snapshot());
    send = vi.spyOn(warehouseApplicationApi, 'submit').mockRejectedValue(new ApiRequestError('待核实', 409));
    const flow = useWarehouseApplication(); await flow.scan('BOX-1'); await flow.submit(); flow.pause();
  }
  const wrapper = mount(page, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
  hooks.show.forEach(fn => fn()); await flushPromises();
  expect(wrapper.get('.pending-submission').text()).toContain('BOX-1');
  expect(wrapper.findComponent(ScanInput).props('disabled')).toBe(true);
  expect(wrapper.get('.footer button').attributes('disabled')).toBeDefined();
  expect(wrapper.get('.nav-back').attributes('disabled')).toBeUndefined();
  await wrapper.get('.nav-back').trigger('tap'); expect(uni.navigateBack).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledOnce();
  if (kind === 'cleanup') {
    await wrapper.get('.footer .danger').trigger('tap');
    expect(wrapper.get('.modal-content').text()).toContain('可能影响同箱其他申请');
    expect(send).toHaveBeenCalledOnce();
    await wrapper.get('.modal-actions .danger').trigger('tap');
  } else await wrapper.get('.footer .primary').trigger('tap');
  await flushPromises(); expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]); wrapper.unmount();
});
