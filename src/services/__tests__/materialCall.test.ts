import { testRequest } from './helpers/testRequest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MaterialCallPage from '../../pages/material-call/index.vue';
import HomePage from '../../pages/home/index.vue';
import pages from '../../pages.json';
import ScanInput from '../../components/ScanInput.vue';
import { useMaterialCall } from '../../composables/useMaterialCall';
import { materialCallApi as api } from '../materialCall';
import { panelPackingApi } from '../panelPacking';
import { locationBindingApi } from '../locationBinding';
import { logisticsCancellationApi } from '../logisticsCancellation';
import { AUTH_SESSION_STORAGE_KEY } from '../auth';
import { resetMockData } from './fixtures/nariBackend';
import * as mock from './fixtures/nariBackend';
import { ApiRequestError, requestId } from '../nariRequest';
import { seedTestSession } from './helpers/authSession';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const storage = new Map<string, unknown>();
const network = vi.fn(testRequest);
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
async function ready(orderNo = 'MO-20261009-001') {
  const flow = useMaterialCall();
  await finish(flow.scan(' KW-MATERIAL-CALL '));
  flow.order.value = ` ${orderNo} `;
  await finish(flow.query());
  return flow;
}
beforeEach(() => {
  vi.useFakeTimers(); storage.clear(); network.mockClear(); resetMockData();
  hooks.show.length = hooks.hide.length = 0;
  vi.stubGlobal('uni', { request: network, navigateTo: vi.fn(), navigateBack: vi.fn(),
    getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('manual material call Mock workflow', () => {
  it('reuses the location binding query, with the same endpoint and only locationCode', async () => {
    const flow = useMaterialCall();
    const get = vi.spyOn(locationBindingApi, 'getLocation');
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.scan(' KW-03-02 '));
    expect(get).toHaveBeenCalledWith('KW-03-02');
    expect(transport.mock.lastCall?.[0]).toMatchObject({
      url: expect.stringContaining('/api/v1/business/nari-logistics/locations/containers'),
      method: 'GET', data: { locationCode: 'KW-03-02' }
    });
    expect(flow.location.value).toMatchObject({ occupied: false, version: 1 });
    expect(flow.canQuery.value).toBe(false);
    expect(network).toHaveBeenCalled();
  });
  it.each(['KW-BOUND-BOX', 'KW-BOUND-CAR'])('invalidates occupied %s scans and old selections, then accepts the location after unbinding', async (code) => {
    const occupied = await finish(locationBindingApi.getLocation(code));
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    const query = vi.spyOn(api, 'getBoxes'); const submit = vi.spyOn(api, 'submit');
    await finish(flow.scan(code));
    expect(flow.notice.value).toMatchObject({ error: true, text: expect.stringContaining('当前库位已绑定容器，本次扫描无效') });
    expect(flow.location.value).toBeNull(); expect(flow.order.value).toBe('');
    expect(flow.result.value).toBeNull(); expect(flow.selected.value).toEqual([]);
    expect(flow.canQuery.value).toBe(false); expect(flow.canSubmit.value).toBe(false);
    await flow.query(); await flow.submit();
    expect(query).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    expect(await finish(locationBindingApi.getLocation(code))).toEqual(occupied);
    await finish(locationBindingApi.unbind({ locationCode: code, version: occupied.version,
      container: { containerType: occupied.container!.containerType, containerCode: occupied.container!.containerCode },
      containerVersion: occupied.container!.version }));
    await finish(flow.scan(code));
    expect(flow.location.value).toMatchObject({ location: { locationCode: code }, occupied: false, version: 2 });
    flow.order.value = 'MO-20261009-001'; await finish(flow.query());
    expect(flow.boxes.value).toHaveLength(3); expect(flow.notice.value).toBeNull();
  });
  it('blocks occupied locations in Mock order queries and submissions without changing bindings', async () => {
    const flow = await ready(); const box = flow.boxes.value[0];
    await finish(expect(api.getBoxes('KW-BOUND-BOX', 'MO-20261009-001')).rejects.toThrow('当前库位已绑定容器'));
    await finish(expect(api.submit({ requestId: requestId(), destinationLocationCode: 'KW-BOUND-CAR', destinationVersion: 1,
      orderNo: 'MO-20261009-001', boxes: [{ boxCode: box.boxCode, version: box.version }] })).rejects.toThrow('当前库位已绑定容器'));
    await finish(locationBindingApi.bind({ locationCode: 'KW-MATERIAL-CALL', version: 1,
      container: { containerType: 'BOX', containerCode: 'BOX-1' }, containerVersion: 1 }));
    await finish(flow.query()); expect(flow.notice.value?.text).toContain('当前库位已绑定容器');
    await finish(flow.scan('KW-MATERIAL-CALL'));
    expect(flow.location.value).toBeNull(); expect(flow.notice.value?.text).toContain('本次扫描无效');
    expect((await finish(locationBindingApi.getLocation('KW-MATERIAL-CALL'))).container?.containerCode).toBe('BOX-1');
  });
  it('does not accept conflicting occupancy data or a missing occupancy flag', async () => {
    const occupied = await finish(locationBindingApi.getLocation('KW-BOUND-BOX'));
    const free = await finish(locationBindingApi.getLocation('KW-MATERIAL-CALL'));
    const get = vi.spyOn(api, 'getLocation'); const flow = useMaterialCall();
    get.mockResolvedValueOnce({ ...free, occupied: true });
    await flow.scan('KW-MATERIAL-CALL'); expect(flow.location.value).toBeNull(); expect(flow.notice.value?.text).toContain('已绑定容器');
    get.mockResolvedValueOnce({ ...free, container: occupied.container });
    await flow.scan('KW-MATERIAL-CALL'); expect(flow.location.value).toBeNull(); expect(flow.notice.value?.text).toContain('已绑定容器');
    get.mockResolvedValueOnce({ ...free, occupied: undefined as unknown as boolean });
    await flow.scan('KW-MATERIAL-CALL'); expect(flow.location.value).toBeNull(); expect(flow.notice.value?.text).toContain('位置信息不完整');
  });
  it('queries by identified location and normalized order, submits only checked boxes once and clears on success', async () => {
    const query = vi.spyOn(api, 'getBoxes'); const submit = vi.spyOn(api, 'submit');
    const flow = await ready();
    expect(query).toHaveBeenCalledWith('KW-MATERIAL-CALL', 'MO-20261009-001');
    expect(flow.boxes.value.map((box) => box.materialQuantity)).toEqual([2, 4, 6]);
    expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false);
    const [first, second, third] = flow.boxes.value;
    const before = await finish(panelPackingApi.getBox(first.boxCode));
    flow.toggle(first.boxCode); flow.toggle(second.boxCode); flow.toggle(second.boxCode); flow.toggle(third.boxCode);
    expect(flow.canSubmit.value).toBe(true);
    await finish(Promise.all([flow.submit(), flow.submit(), flow.query(), flow.scan('KW-MATERIAL-CALL-2')]));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][0]).toEqual({ requestId: expect.any(String), destinationLocationCode: 'KW-MATERIAL-CALL', destinationVersion: 1,
      orderNo: 'MO-20261009-001', boxes: [{ boxCode: first.boxCode, version: 1 }, { boxCode: third.boxCode, version: 1 }] });
    expect(flow.notice.value?.text).toContain('叫料成功，已提交 2 箱');
    expect(flow.location.value).toBeNull(); expect(flow.order.value).toBe(''); expect(flow.boxes.value).toEqual([]);
    expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false);
    expect(await finish(panelPackingApi.getBox(first.boxCode))).toEqual(before);
    expect(network).toHaveBeenCalled();
  });
  it('keeps displayed boxes and selections while editing the order and updates them only after a successful query', async () => {
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    const result = flow.result.value; const selected = [...flow.selected.value];
    const query = vi.spyOn(api, 'getBoxes'); const submit = vi.spyOn(api, 'submit');
    for (const order of ['MO', 'MO-LONG', '', 'X'.repeat(129)]) {
      flow.order.value = order;
      expect(flow.result.value).toBe(result); expect(flow.selected.value).toEqual(selected);
      expect(flow.canSubmit.value).toBe(false); await flow.submit();
    }
    expect(query).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    flow.order.value = ' MO-20261009-001 '; expect(flow.canSubmit.value).toBe(true);
    flow.order.value = 'MO-LONG';
    const pending = flow.query();
    expect(flow.result.value).toBe(result); expect(flow.selected.value).toEqual(selected); expect(flow.busy.value).toBe(true);
    await finish(pending);
    expect(query).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledWith('KW-MATERIAL-CALL', 'MO-LONG');
    expect(flow.boxes.value).toHaveLength(30); expect(flow.selected.value).toEqual([]);
    flow.toggle('FOREIGN'); expect(flow.selected.value).toEqual([]);
    flow.toggle(flow.boxes.value[0].boxCode);
    await finish(flow.scan('KW-MATERIAL-CALL-2'));
    expect(flow.location.value?.location.locationCode).toBe('KW-MATERIAL-CALL-2');
    expect(flow.order.value).toBe(''); expect(flow.result.value).toBeNull(); expect(flow.selected.value).toEqual([]);
    flow.clear(); expect(flow.location.value).toBeNull(); expect(flow.canQuery.value).toBe(false);
  });
  it('preserves the displayed list when a changed-order query fails and blocks mismatched submissions until queried successfully', async () => {
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    const result = flow.result.value; const selected = [...flow.selected.value];
    flow.order.value = 'MO-LONG';
    const query = vi.spyOn(api, 'getBoxes').mockRejectedValueOnce(new Error('箱子查询失败'));
    const submit = vi.spyOn(api, 'submit');
    await flow.query();
    expect(query).toHaveBeenCalledWith('KW-MATERIAL-CALL', 'MO-LONG');
    expect(flow.result.value).toBe(result); expect(flow.selected.value).toEqual(selected);
    expect(flow.order.value).toBe('MO-LONG'); expect(flow.notice.value?.text).toBe('箱子查询失败');
    expect(flow.canQuery.value).toBe(true); expect(flow.canSubmit.value).toBe(false);
    await flow.submit(); expect(submit).not.toHaveBeenCalled();
    await finish(flow.query());
    expect(flow.result.value?.orderNo).toBe('MO-LONG'); expect(flow.boxes.value).toHaveLength(30);
    expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false);
  });
  it('handles empty orders, unknown locations and invalid or unknown orders without enabling submission', async () => {
    const flow = await ready('MO-EMPTY');
    expect(flow.boxes.value).toEqual([]); expect(flow.notice.value?.text).toBe('该生产订单暂无可叫料箱子');
    expect(flow.canSubmit.value).toBe(false);
    const query = vi.spyOn(api, 'getBoxes'); const submit = vi.spyOn(api, 'submit');
    flow.order.value = ' '; await flow.query();
    flow.order.value = 'X'.repeat(129); await flow.query(); await flow.submit();
    expect(query).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    flow.order.value = 'UNKNOWN'; await finish(flow.query()); expect(flow.notice.value?.text).toBe('生产订单号不存在');
    await finish(flow.scan('UNKNOWN')); expect(flow.notice.value?.text).toBe('库位编码不存在');
    expect(flow.location.value).toBeNull(); expect(flow.order.value).toBe('');
    await flow.scan(' '); expect(flow.notice.value?.text).toContain('有效位置编码');
  });
  it('keeps same-order results on manual query failure but refreshes after failed submissions, with new IDs on retry', async () => {
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    const result = flow.result.value; const selected = [...flow.selected.value];
    const query = vi.spyOn(api, 'getBoxes').mockRejectedValueOnce(new Error('查询失败'));
    await flow.query(); expect(flow.result.value).toBe(result); expect(flow.selected.value).toEqual(selected);
    flow.order.value = 'MO-QUERY-FAIL'; await finish(flow.query());
    expect(flow.notice.value?.text).toContain('查询失败'); expect(flow.location.value).not.toBeNull();
    flow.order.value = 'MO-SUBMIT-FAIL'; await finish(flow.query()); flow.toggle(flow.boxes.value[0].boxCode);
    const location = flow.location.value;
    query.mockClear();
    const submit = vi.spyOn(api, 'submit');
    await finish(flow.submit());
    expect(query).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledWith('KW-MATERIAL-CALL', 'MO-SUBMIT-FAIL');
    expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false);
    await flow.submit(); expect(submit).toHaveBeenCalledOnce();
    flow.toggle(flow.boxes.value[0].boxCode); await finish(flow.submit());
    expect(submit).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0].requestId).not.toBe(submit.mock.calls[1][0].requestId);
    expect(flow.notice.value).toMatchObject({ error: true, text: expect.stringContaining('叫料失败') });
    expect(flow.location.value).toBe(location); expect(flow.order.value).toBe('MO-SUBMIT-FAIL');
    expect(flow.boxes.value).toHaveLength(2); expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false);
  });
  it('replaces stale boxes with the refreshed order list while preserving location, order and the original failure reason', async () => {
    const flow = await ready(); const location = flow.location.value; const order = flow.order.value;
    flow.toggle(flow.boxes.value[0].boxCode);
    const refreshed = { ...flow.result.value!, boxes: [{ ...flow.boxes.value[1], version: 2, materialQuantity: 8 }] };
    const query = vi.spyOn(api, 'getBoxes').mockResolvedValueOnce(refreshed);
    const submit = vi.spyOn(api, 'submit').mockRejectedValueOnce(new ApiRequestError('所选箱子已被叫料', 409));
    await flow.submit();
    expect(submit).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('KW-MATERIAL-CALL', 'MO-20261009-001');
    expect(flow.location.value).toBe(location); expect(flow.order.value).toBe(order);
    expect(flow.result.value).toEqual(refreshed); expect(flow.selected.value).toEqual([]);
    expect(flow.canSubmit.value).toBe(false); expect(flow.canQuery.value).toBe(true);
    expect(flow.notice.value).toEqual({ text: '所选箱子已被叫料', error: true });
    flow.toggle(refreshed.boxes[0].boxCode); expect(flow.canSubmit.value).toBe(true);
  });
  it('preserves the submit failure notice when the refreshed order has no boxes', async () => {
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    vi.spyOn(api, 'submit').mockRejectedValueOnce(new ApiRequestError('箱子已不可用', 409));
    vi.spyOn(api, 'getBoxes').mockResolvedValueOnce({ ...flow.result.value!, boxes: [] });
    await flow.submit();
    expect(flow.location.value).not.toBeNull(); expect(flow.order.value.trim()).toBe('MO-20261009-001');
    expect(flow.result.value?.boxes).toEqual([]); expect(flow.selected.value).toEqual([]);
    expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value).toEqual({ text: '箱子已不可用', error: true });
  });
  it.each(['request', 'response'])('invalidates stale selections if the automatic refresh fails through %s, without retrying submission', async (kind) => {
    const flow = await ready(); const location = flow.location.value; const order = flow.order.value;
    flow.toggle(flow.boxes.value[0].boxCode);
    const submit = vi.spyOn(api, 'submit').mockRejectedValueOnce(new ApiRequestError('叫料失败', 409));
    const query = vi.spyOn(api, 'getBoxes');
    if (kind === 'request') query.mockRejectedValueOnce(new Error('查询服务不可用'));
    else query.mockResolvedValueOnce({ ...flow.result.value!, orderNo: 'OTHER' });
    await flow.submit();
    expect(submit).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledOnce();
    expect(flow.location.value).toBe(location); expect(flow.order.value).toBe(order);
    expect(flow.result.value).toBeNull(); expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false);
    expect(flow.canQuery.value).toBe(true); expect(flow.notice.value?.error).toBe(true);
    expect(flow.notice.value?.text).toContain('叫料失败'); expect(flow.notice.value?.text).toContain('箱子清单刷新失败');
    await flow.submit(); expect(submit).toHaveBeenCalledOnce();
    await finish(flow.query()); expect(flow.boxes.value).toHaveLength(3);
  });
  it('blocks further operations throughout the failure refresh and ignores late refresh results after clearing', async () => {
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    const refreshed = flow.result.value!;
    let resolveRefresh!: (value: typeof refreshed) => void;
    const query = vi.spyOn(api, 'getBoxes').mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const submit = vi.spyOn(api, 'submit').mockRejectedValueOnce(new ApiRequestError('叫料失败', 409));
    const pending = flow.submit(); await Promise.resolve();
    expect(query).toHaveBeenCalledOnce(); expect(flow.busy.value).toBe(true);
    expect(flow.notice.value).toEqual({ text: '叫料失败', error: true });
    expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false);
    await flow.submit(); await flow.query(); await flow.scan('KW-MATERIAL-CALL-2'); flow.toggle(refreshed.boxes[0].boxCode);
    expect(submit).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledOnce();
    expect(flow.location.value?.location.locationCode).toBe('KW-MATERIAL-CALL');
    flow.clear(); resolveRefresh(refreshed); await pending;
    expect(flow.location.value).toBeNull(); expect(flow.order.value).toBe(''); expect(flow.result.value).toBeNull();
    expect(flow.notice.value).toBeNull(); expect(flow.busy.value).toBe(false);
  });
  it('does not refresh an invalidated submission context', async () => {
    const flow = await ready('MO-SUBMIT-FAIL'); flow.toggle(flow.boxes.value[0].boxCode);
    const query = vi.spyOn(api, 'getBoxes');
    const pending = flow.submit(); flow.pause(); await finish(pending);
    expect(query).not.toHaveBeenCalled(); expect(flow.location.value).toBeNull(); expect(flow.notice.value).toBeNull();
    await flow.resume(); await finish(flow.scan('KW-MATERIAL-CALL')); flow.order.value = 'MO-SUBMIT-FAIL'; await finish(flow.query());
    flow.toggle(flow.boxes.value[0].boxCode); query.mockClear();
    const displayed = flow.result.value;
    const changedOrder = flow.submit(); flow.order.value = 'MO-LONG'; await finish(changedOrder);
    expect(query).not.toHaveBeenCalled(); expect(flow.order.value).toBe('MO-LONG'); expect(flow.result.value).toBe(displayed);
    expect(flow.canSubmit.value).toBe(false);
  });
  it('revalidates membership and versions and replays only the same request without changing bindings', async () => {
    const flow = await ready(); const [box, second] = flow.boxes.value;
    const input = { requestId: requestId(), destinationLocationCode: 'KW-MATERIAL-CALL', destinationVersion: 1, orderNo: 'MO-20261009-001',
      boxes: [{ boxCode: box.boxCode, version: box.version }] };
    const receipt = await finish(api.submit(input)); expect(await finish(api.submit(input))).toEqual(receipt);
    await finish(expect(api.submit({ ...input, orderNo: 'MO-LONG' })).rejects.toThrow('相同请求标识'));
    for (const boxes of [[], [input.boxes[0], input.boxes[0]], [{ boxCode: 'BOX-LONG', version: 1 }],
      [{ boxCode: box.boxCode, version: 99 }, { boxCode: second.boxCode, version: 1 }]]) {
      await finish(expect(api.submit({ ...input, requestId: requestId(), boxes })).rejects.toThrow());
    }
    await finish(expect(api.submit({ ...input, requestId: requestId(), destinationVersion: 99 })).rejects.toThrow('位置信息已变化'));
    resetMockData();
    flow.toggle(box.boxCode);
    await finish(panelPackingApi.unbindAll(box.boxCode, 1));
    await finish(flow.submit()); expect(flow.notice.value?.text).toContain('箱子信息已变化');
    expect(flow.selected.value).toEqual([]);
    expect(flow.boxes.value[0]).toMatchObject({ materialQuantity: 0, version: 2 });
    const origin = await finish(locationBindingApi.getLocation(`KW-${second.boxCode}`));
    await finish(locationBindingApi.unbind({ locationCode: origin.location.locationCode, version: origin.version,
      container: { containerType: 'BOX', containerCode: second.boxCode }, containerVersion: second.version }));
    await finish(locationBindingApi.bind({ locationCode: 'KW-MATERIAL-CALL', version: 1,
      container: { containerType: 'BOX', containerCode: second.boxCode }, containerVersion: second.version + 1 }));
    flow.toggle(box.boxCode); await finish(flow.submit()); expect(flow.notice.value?.text).toContain('位置信息已变化');
    expect(flow.location.value?.location.locationCode).toBe('KW-MATERIAL-CALL');
    expect(flow.notice.value?.text).toContain('箱子清单刷新失败'); expect(flow.result.value).toBeNull();
  });
  it.each(['duplicate', 'quantity', 'order', 'location'])('rejects malformed %s query responses without replacing the displayed list', async (kind) => {
    const flow = await ready(); const value = flow.result.value!;
    flow.toggle(value.boxes[0].boxCode); const selected = [...flow.selected.value];
    const invalid = { ...value, boxes: [...value.boxes] };
    if (kind === 'duplicate') invalid.boxes.push(value.boxes[0]);
    if (kind === 'quantity') invalid.boxes[0] = { ...value.boxes[0], materialQuantity: -1 };
    if (kind === 'order') invalid.orderNo = 'OTHER';
    if (kind === 'location') invalid.destination = { ...value.destination, locationCode: 'OTHER' };
    flow.order.value = 'MO-LONG';
    vi.spyOn(api, 'getBoxes').mockResolvedValueOnce(invalid);
    await flow.query(); expect(flow.result.value).toBe(value); expect(flow.selected.value).toEqual(selected);
    expect(flow.notice.value?.error).toBe(true);
    expect(flow.canSubmit.value).toBe(false);
  });
  it('rejects incomplete location and queries the original request after a malformed creation receipt', async () => {
    const flow = useMaterialCall();
    vi.spyOn(api, 'getLocation').mockResolvedValueOnce({ location: { locationCode: 'OTHER', locationName: '错误位置' }, version: 1, occupied: false, eligibility: { allowed: true } });
    await flow.scan('KW-MATERIAL-CALL'); expect(flow.location.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
    await finish(flow.scan('KW-MATERIAL-CALL')); flow.order.value = 'MO-LONG'; await finish(flow.query());
    flow.toggle(flow.boxes.value[0].boxCode);
    vi.spyOn(api, 'submit').mockResolvedValueOnce({ requestId: 'OTHER', callNo: 'CALL-BAD', orderNo: 'MO-LONG',
      destination: { locationCode: 'KW-MATERIAL-CALL', locationName: '叫料接收位' }, tasks: [], createdTime: new Date().toISOString() });
    const check = vi.spyOn(api, 'getResult');
    await finish(flow.submit()); expect(flow.selected.value).toHaveLength(1);
    expect(check).toHaveBeenCalledWith(flow.attempt.value!.input.requestId);
    expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.text).toContain('尚未确认');
  });
  it('ignores late responses after clearing location, query or submission state', async () => {
    const flow = useMaterialCall(); const pendingLocation = flow.scan('KW-MATERIAL-CALL'); flow.clear();
    await finish(pendingLocation); expect(flow.location.value).toBeNull(); expect(flow.notice.value).toBeNull();
    await finish(flow.scan('KW-MATERIAL-CALL')); flow.order.value = 'MO-20261009-001';
    const pendingQuery = flow.query(); flow.clear(); await finish(pendingQuery); expect(flow.result.value).toBeNull();
    await finish(flow.scan('KW-MATERIAL-CALL')); flow.order.value = 'MO-20261009-001'; await finish(flow.query());
    flow.toggle(flow.boxes.value[0].boxCode);
    const pendingSubmit = flow.submit(); flow.pause(); await finish(pendingSubmit);
    expect(flow.location.value).toBeNull(); expect(flow.notice.value).toBeNull(); expect(flow.busy.value).toBe(false);
  });
  it('ignores responses for a changed order', async () => {
    const flow = await ready(); const displayed = flow.result.value;
    flow.order.value = 'MO-LONG'; const pending = flow.query(); flow.order.value = 'MO-EMPTY';
    await finish(pending); expect(flow.result.value).toBe(displayed); expect(flow.busy.value).toBe(false);
    expect(flow.canSubmit.value).toBe(false);
    expect(network).toHaveBeenCalled();
  });
  it('uses the formal location, candidate, submit and result endpoints in explicit real mode', async () => {
    const location = await finish(locationBindingApi.getLocation('KW-MATERIAL-CALL'));
    const realRequest = vi.fn((options: UniNamespace.RequestOptions) => {
      options.success?.({ data: { code: 0, data: location }, statusCode: 200, header: {}, cookies: [] });
      return {} as UniNamespace.RequestTask;
    });
    vi.stubGlobal('uni', { ...uni, request: realRequest });
    expect(await api.getLocation('KW-MATERIAL-CALL')).toEqual(location);
    expect(realRequest).toHaveBeenCalledOnce();
    expect(realRequest.mock.calls[0][0]).toMatchObject({ method: 'GET',
      url: expect.stringContaining('/api/v1/business/nari-logistics/locations/containers'), data: { locationCode: 'KW-MATERIAL-CALL' } });
    await api.getBoxes('KW-MATERIAL-CALL', 'MO-LONG');
    const input = { requestId: requestId(), destinationLocationCode: 'KW-MATERIAL-CALL', destinationVersion: 7, orderNo: 'MO-LONG', boxes: [{ boxCode: 'BOX-1', version: 2 }] };
    await api.submit(input); await api.getResult(input.requestId);
    expect(realRequest).toHaveBeenCalledTimes(4);
    expect(realRequest.mock.calls[1][0]).toMatchObject({ url: expect.stringContaining('/order-calls/candidates'), method: 'GET',
      data: { destinationLocationCode: 'KW-MATERIAL-CALL', orderNo: 'MO-LONG' } });
    expect(realRequest.mock.calls[2][0]).toMatchObject({ url: expect.stringMatching(/\/order-calls$/), method: 'POST', data: input });
    expect(realRequest.mock.calls[3][0]).toMatchObject({ url: expect.stringContaining(`/order-calls/${input.requestId}`), method: 'GET', data: {} });
  });
  it('uses the candidate runtime version rather than the initial location version and reserves one task per selected box', async () => {
    const flow = await ready(); const candidate = { ...flow.result.value!, destinationVersion: 7 };
    vi.spyOn(api, 'getBoxes').mockResolvedValueOnce(candidate); await flow.query();
    flow.toggle(candidate.boxes[0].boxCode);
    const input = { requestId: requestId(), destinationLocationCode: candidate.destination.locationCode, destinationVersion: 7,
      orderNo: candidate.orderNo, boxes: [{ boxCode: candidate.boxes[0].boxCode, version: candidate.boxes[0].version }] };
    const reply = { requestId: input.requestId, callNo: 'CALL-VERSION', orderNo: input.orderNo, destination: candidate.destination,
      tasks: [{ boxCode: input.boxes[0].boxCode, taskId: '100', taskNo: 'WL-VERSION', dispatchState: 'QUEUED' as const }], createdTime: new Date().toISOString() };
    const submit = vi.spyOn(api, 'submit').mockImplementationOnce(async (value) => ({ ...reply, requestId: value.requestId }));
    await flow.submit(); expect(submit.mock.calls[0][0].destinationVersion).toBe(7);
    submit.mockRestore();
    const normal = await ready(); normal.toggle(normal.boxes.value[0].boxCode); normal.toggle(normal.boxes.value[1].boxCode);
    const create = vi.spyOn(api, 'submit'); await finish(normal.submit());
    const created = await create.mock.results[0].value;
    expect(created.tasks).toHaveLength(2); expect(new Set(created.tasks.map((task: { taskId: string }) => task.taskId)).size).toBe(2);
    const current = await finish(api.getBoxes('KW-MATERIAL-CALL', 'MO-20261009-001'));
    expect(current.boxes.map((box) => box.eligibility.allowed)).toEqual([false, false, true]);
    const task = created.tasks[0];
    expect((await finish(logisticsCancellationApi.query(current.boxes[0].boxCode, 1))).records[0].taskId).toBe(task.taskId);
    await finish(logisticsCancellationApi.cancel(task.taskId, { requestId: requestId(), version: 1 }));
    expect((await finish(api.getBoxes('KW-MATERIAL-CALL', 'MO-20261009-001'))).boxes[0].eligibility.allowed).toBe(true);
  });
  it('disables unavailable boxes and batch eligibility while displaying backend reasons', async () => {
    const flow = await ready('MO-BOX-BLOCKED');
    flow.toggle(flow.boxes.value[0].boxCode); expect(flow.selected.value).toEqual([]);
    flow.toggle(flow.boxes.value[1].boxCode); expect(flow.canSubmit.value).toBe(true);
    await finish(flow.query()); expect(flow.selected.value).toEqual([]);
    const value = flow.result.value!;
    await finish(expect(api.submit({ requestId: requestId(), orderNo: value.orderNo, destinationLocationCode: value.destination.locationCode,
      destinationVersion: value.destinationVersion, boxes: value.boxes.slice(0, 2).map(({ boxCode, version }) => ({ boxCode, version })) })).rejects.toThrow('该箱当前不可叫料'));
    expect((await finish(api.getBoxes('KW-MATERIAL-CALL', value.orderNo))).boxes[1].eligibility.allowed).toBe(true);
    flow.order.value = 'MO-BATCH-BLOCKED'; await finish(flow.query()); flow.toggle(flow.boxes.value[0].boxCode);
    expect(flow.selected.value).toEqual([]); expect(flow.canSubmit.value).toBe(false); expect(flow.notice.value?.text).toBe('当前订单暂不可叫料');
  });
  it('recovers a created batch after an uncertain POST without refreshing candidates or sending a second POST', async () => {
    const flow = await ready('MO-SUBMIT-UNKNOWN'); flow.toggle(flow.boxes.value[0].boxCode);
    const create = vi.spyOn(api, 'submit'); const check = vi.spyOn(api, 'getResult'); const query = vi.spyOn(api, 'getBoxes');
    await finish(flow.submit());
    expect(check).toHaveBeenCalledWith(create.mock.calls[0][0].requestId); expect(create).toHaveBeenCalledOnce(); expect(query).not.toHaveBeenCalled();
    expect(flow.notice.value?.text).toContain('叫料成功'); expect(flow.location.value).toBeNull(); expect(flow.attempt.value).toBeNull();
    expect((await finish(api.getResult(create.mock.calls[0][0].requestId))).tasks).toHaveLength(1);
  });
  it.each([new Error('网络连接中断'), new ApiRequestError('请求超时', 408)])('queries the original request after %s instead of refreshing candidates or retrying POST', async (failure) => {
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    const submit = vi.spyOn(api, 'submit').mockRejectedValueOnce(failure);
    const check = vi.spyOn(api, 'getResult').mockRejectedValue(new ApiRequestError('暂未查询到', 404));
    const query = vi.spyOn(api, 'getBoxes'); await flow.submit();
    const id = submit.mock.calls[0][0].requestId;
    expect(check).toHaveBeenCalledWith(id); expect(query).not.toHaveBeenCalled(); expect(flow.attempt.value?.input.requestId).toBe(id);
    await flow.submit(); await flow.check(); expect(submit).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalledTimes(2);
    expect(flow.canSubmit.value).toBe(false);
  });
  it.each(['MO-RESULT-MISSING', 'MO-RESULT-FAIL', 'MO-DISPATCH-UNKNOWN'])('keeps %s correlated and locked across clear, leaving and re-entering', async (orderNo) => {
    const flow = await ready(orderNo); flow.toggle(flow.boxes.value[0].boxCode);
    const create = vi.spyOn(api, 'submit'); const query = vi.spyOn(api, 'getBoxes'); const check = vi.spyOn(api, 'getResult');
    await finish(flow.submit()); const id = flow.attempt.value!.input.requestId;
    expect(flow.canSubmit.value).toBe(false); expect(flow.canQuery.value).toBe(false); expect(flow.disabled.value).toBe(true);
    flow.clear(); await flow.scan('KW-MATERIAL-CALL-2'); await flow.query(); await flow.submit();
    expect(flow.location.value?.location.locationCode).toBe('KW-MATERIAL-CALL'); expect(create).toHaveBeenCalledOnce(); expect(query).not.toHaveBeenCalled();
    flow.pause(); const restored = useMaterialCall();
    expect(restored.attempt.value?.input.requestId).toBe(id); expect(restored.order.value).toBe(orderNo);
    await finish(restored.resume()); await finish(restored.check()); await restored.submit();
    expect(restored.attempt.value?.input.requestId).toBe(id); expect(check.mock.calls.every(([request]) => request === id)).toBe(true);
    expect(create).toHaveBeenCalledOnce(); expect(query).not.toHaveBeenCalled();
    if (orderNo === 'MO-DISPATCH-UNKNOWN') expect(restored.receipt.value?.tasks[0].reason).toBe('等待核实调度受理结果');
    else expect(restored.notice.value?.text).toContain(orderNo === 'MO-RESULT-MISSING' ? '暂未查询到' : '查询暂不可用');
  });
  it('retains request IDs across reloads and isolates accounts and environments', async () => {
    const mockFlow = await ready(); const location = mockFlow.location.value!; const candidates = mockFlow.result.value!;
    vi.spyOn(api, 'getLocation').mockResolvedValue(location); vi.spyOn(api, 'getBoxes').mockResolvedValue(candidates);
    vi.spyOn(api, 'submit').mockRejectedValue(new ApiRequestError('服务超时', 500)); vi.spyOn(api, 'getResult').mockRejectedValue(new ApiRequestError('暂未查询到', 404));
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode); await flow.submit();
    const id = flow.attempt.value!.input.requestId; flow.pause(); resetMockData();
    const restored = useMaterialCall(); expect(restored.attempt.value?.input.requestId).toBe(id); await restored.resume();
    seedTestSession('other'); expect(useMaterialCall().attempt.value).toBeNull();
    seedTestSession(); const session = uni.getStorageSync(AUTH_SESSION_STORAGE_KEY);
    uni.setStorageSync(AUTH_SESSION_STORAGE_KEY, { ...session, baseUrl: 'https://another.example.test' });
    expect(useMaterialCall().attempt.value).toBeNull(); seedTestSession();
    expect(useMaterialCall().attempt.value?.input.requestId).toBe(id);
    expect(JSON.stringify([...storage.values()])).not.toContain('Authorization');
  });
  it('ignores historical mock records without dropping real pending requests', async () => {
    const flow = await ready('MO-RESULT-MISSING'); flow.toggle(flow.boxes.value[0].boxCode); await finish(flow.submit());
    const realKey = [...storage.keys()].find((key) => key.startsWith('foundation.material-calls.real.'))!;
    const record = storage.get(realKey);
    storage.set(realKey.replace('material-calls.real.', 'material-calls.mock.'), record);
    storage.delete(realKey);
    expect(useMaterialCall().attempt.value).toBeNull();
    storage.set(realKey, record);
    expect(useMaterialCall().attempt.value?.input.requestId).toBe(flow.attempt.value?.input.requestId);
  });
  it('does not submit if the request identifier cannot be persisted', async () => {
    const flow = await ready(); flow.toggle(flow.boxes.value[0].boxCode);
    vi.spyOn(uni, 'setStorageSync').mockImplementationOnce(() => { throw new Error('磁盘已满'); });
    const submit = vi.spyOn(api, 'submit'); await flow.submit();
    expect(submit).not.toHaveBeenCalled(); expect(flow.attempt.value).toBeNull(); expect(flow.selected.value).toHaveLength(1);
    expect(flow.notice.value?.text).toContain('未提交叫料'); expect(flow.canSubmit.value).toBe(true);
  });
  it('shows a dispatch failure as an existing task, without refreshing or blindly reposting its boxes', async () => {
    const flow = await ready('MO-DISPATCH-FAIL'); flow.toggle(flow.boxes.value[0].boxCode);
    const query = vi.spyOn(api, 'getBoxes'); const submit = vi.spyOn(api, 'submit');
    await finish(flow.submit()); expect(query).not.toHaveBeenCalled(); expect(flow.notice.value?.text).toContain('叫料任务已创建');
    expect(flow.notice.value?.text).toContain('调度派送失败'); expect(flow.notice.value?.error).toBe(true);
    await flow.submit(); expect(submit).toHaveBeenCalledOnce(); expect(flow.location.value).toBeNull();
    expect((await finish(api.getBoxes('KW-MATERIAL-CALL', 'MO-DISPATCH-FAIL'))).boxes[0].eligibility.allowed).toBe(false);
  });
  it('resolves UNKNOWN dispatch through GET and clears only after its result is known', async () => {
    const flow = await ready('MO-DISPATCH-UNKNOWN'); flow.toggle(flow.boxes.value[0].boxCode); await finish(flow.submit());
    const value = flow.receipt.value!;
    vi.spyOn(api, 'getResult').mockResolvedValueOnce({ ...value, tasks: value.tasks.map((task) => ({ ...task, dispatchState: 'DISPATCHED' })) });
    await flow.check(); expect(flow.attempt.value).toBeNull(); expect(flow.location.value).toBeNull(); expect(flow.notice.value?.text).toContain('叫料成功');
  });
  it('keeps malformed result-query task sets unresolved and never enables a new POST', async () => {
    const flow = await ready('MO-DISPATCH-UNKNOWN'); flow.toggle(flow.boxes.value[0].boxCode); await finish(flow.submit());
    const value = flow.receipt.value!; const submit = vi.spyOn(api, 'submit');
    vi.spyOn(api, 'getResult').mockResolvedValueOnce({ ...value, tasks: [] });
    await flow.check(); expect(flow.notice.value?.text).toContain('叫料回执不完整'); await flow.submit(); expect(submit).not.toHaveBeenCalled();
    expect(flow.attempt.value?.input.requestId).toBe(value.requestId);
  });
  it('enforces the 1000-box batch limit without truncating the candidate list or automatically splitting it', async () => {
    const flow = await ready(); const value = flow.result.value!;
    const boxes = Array.from({ length: 1001 }, (_, index) => ({ ...value.boxes[0], boxCode: `BOX-BATCH-${index}` }));
    vi.spyOn(api, 'getBoxes').mockResolvedValueOnce({ ...value, boxes }); await flow.query();
    boxes.forEach((box) => flow.toggle(box.boxCode));
    expect(flow.boxes.value).toHaveLength(1001); expect(flow.selected.value).toHaveLength(1000);
    expect(flow.notice.value?.text).toContain('一次最多选择1000箱');
    const submit = vi.spyOn(api, 'submit'); flow.selected.value.push(boxes[1000].boxCode);
    await flow.submit(); expect(submit).not.toHaveBeenCalled();
    await finish(expect(api.submit({ requestId: requestId(), orderNo: value.orderNo, destinationLocationCode: value.destination.locationCode,
      destinationVersion: value.destinationVersion, boxes: boxes.map(({ boxCode, version }) => ({ boxCode, version })) })).rejects.toThrow('有效且不重复'));
  });
  it('shows unavailable reasons and an inline result-query card with locked inputs, including after re-entry', async () => {
    const wrapper = mount(MaterialCallPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' },
      'checkbox-group': { template: '<div data-checkbox-group><slot /></div>' }, checkbox: true } } });
    const submit = vi.spyOn(api, 'submit'); const check = vi.spyOn(api, 'getResult');
    try {
      hooks.show.forEach((show) => show());
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'KW-MATERIAL-CALL'); await vi.advanceTimersByTimeAsync(200);
      await wrapper.get('.order-input').setValue('MO-BOX-BLOCKED'); await wrapper.get('.order-query button').trigger('tap'); await vi.advanceTimersByTimeAsync(200);
      expect(wrapper.get('.box-row--unavailable').text()).toContain('该箱当前不可叫料');
      expect(wrapper.get('.box-row--unavailable checkbox-stub').attributes('disabled')).toBe('true');
      await wrapper.get('[data-checkbox-group]').trigger('change'); expect(wrapper.findAll('.box-row--selected')).toHaveLength(0);
      await wrapper.get('.order-input').setValue('MO-RESULT-MISSING'); await wrapper.get('.order-query button').trigger('tap'); await vi.advanceTimersByTimeAsync(200);
      await wrapper.get('[data-checkbox-group]').trigger('change'); await wrapper.findAll('.footer button')[1].trigger('tap'); await vi.advanceTimersByTimeAsync(400);
      const id = submit.mock.calls[0][0].requestId;
      expect(wrapper.get('.result-card').text()).toContain(id); expect(wrapper.get('.result-card').text()).toContain('暂未查询到');
      expect(wrapper.get('.order-input').attributes('disabled')).toBeDefined(); expect(wrapper.getComponent(ScanInput).props('disabled')).toBe(true);
      expect(wrapper.findAll('.footer button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
      expect(wrapper.get('.nav-back').attributes('disabled')).toBeUndefined();
      await wrapper.get('.result-query').trigger('tap'); await vi.advanceTimersByTimeAsync(200);
      hooks.hide.forEach((hide) => hide()); hooks.show.forEach((show) => show()); await vi.advanceTimersByTimeAsync(200);
      expect(wrapper.get('.result-card').text()).toContain(id); expect(wrapper.get('.location-card').text()).toContain('KW-MATERIAL-CALL');
      expect(submit).toHaveBeenCalledOnce(); expect(check.mock.calls.every(([value]) => value === id)).toBe(true);
    } finally { wrapper.unmount(); }
  });
  it('adds an open homepage menu and route and keeps the confirmation button disabled until a box is checked', async () => {
    const home = mount(HomePage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
    const menu = home.findAll('button').find((button) => button.text() === '手动叫料')!;
    await menu.trigger('tap'); expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/material-call/index' });
    expect(home.findAll('.menu-entry')).toHaveLength(16); home.unmount(); hooks.show.length = 0;
    expect(pages.pages.find((page) => page.path === 'pages/material-call/index')?.style.disableScroll).toBe(true);
    const wrapper = mount(MaterialCallPage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' },
      'checkbox-group': { template: '<div data-checkbox-group><slot /></div>' }, checkbox: true } } });
    try {
      hooks.show.forEach((show) => show());
      const confirm = () => wrapper.findAll('.footer button')[1];
      expect(confirm().attributes('disabled')).toBeDefined();
      expect(wrapper.getComponent(ScanInput).props('placeholder')).toBe('扫描或输入位置编码');
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'KW-BOUND-CAR'); await vi.advanceTimersByTimeAsync(200);
      expect(wrapper.find('.location-card').exists()).toBe(false); expect(wrapper.find('.order-query').exists()).toBe(false);
      expect(wrapper.text()).toContain('本次扫描无效'); expect(confirm().attributes('disabled')).toBeDefined();
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'KW-MATERIAL-CALL'); await vi.advanceTimersByTimeAsync(200);
      await wrapper.get('.order-input').setValue('MO-SUBMIT-FAIL'); await wrapper.get('.order-query button').trigger('tap');
      await vi.advanceTimersByTimeAsync(200);
      await wrapper.get('[data-checkbox-group]').trigger('change');
      const refresh = vi.spyOn(api, 'getBoxes');
      await confirm().trigger('tap'); await vi.advanceTimersByTimeAsync(200);
      expect(wrapper.get('.location-card').text()).toContain('KW-MATERIAL-CALL');
      expect(wrapper.get('.order-input').attributes('disabled')).toBeDefined();
      await vi.advanceTimersByTimeAsync(200);
      expect(refresh).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledWith('KW-MATERIAL-CALL', 'MO-SUBMIT-FAIL');
      expect((wrapper.get('.order-input').element as HTMLInputElement).value).toBe('MO-SUBMIT-FAIL');
      expect(wrapper.findAll('.box-row')).toHaveLength(2); expect(wrapper.findAll('.box-row--selected')).toHaveLength(0);
      expect(confirm().attributes('disabled')).toBeDefined(); expect(wrapper.text()).toContain('叫料失败');
      await wrapper.get('[data-checkbox-group]').trigger('change'); expect(confirm().attributes('disabled')).toBeUndefined();
      refresh.mockClear();
      await wrapper.get('.order-input').setValue('MO-20261009-001');
      expect(wrapper.findAll('.box-row')).toHaveLength(2); expect(wrapper.findAll('.box-row--selected')).toHaveLength(1);
      expect(refresh).not.toHaveBeenCalled(); expect(confirm().attributes('disabled')).toBeDefined();
      await wrapper.get('.order-query button').trigger('tap');
      expect(wrapper.findAll('.box-row')).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(200); expect(wrapper.findAll('.box-row')).toHaveLength(3);
      expect(wrapper.findAll('.box-row--selected')).toHaveLength(0);
      expect(confirm().attributes('disabled')).toBeDefined();
      await wrapper.get('[data-checkbox-group]').trigger('change'); expect(confirm().attributes('disabled')).toBeUndefined();
      await confirm().trigger('tap'); await vi.advanceTimersByTimeAsync(200);
      expect(wrapper.find('.location-card').exists()).toBe(false); expect(wrapper.text()).toContain('叫料成功');
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'KW-MATERIAL-CALL'); hooks.hide.forEach((hide) => hide());
      await vi.advanceTimersByTimeAsync(200); expect(wrapper.find('.location-card').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
