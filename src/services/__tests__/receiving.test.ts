import { testRequest } from './helpers/testRequest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockData } from './fixtures/nariBackend';
import * as mock from './fixtures/nariBackend';
import { seedTestSession } from './helpers/authSession';
import { receivingApi as api, type ReceivingResult } from '../receiving';
import { pendingReceivingApi } from '../pendingReceiving';
import { panelPackingApi } from '../panelPacking';
import { vehicleLoadingApi } from '../vehicleLoading';
import { requestId } from '../nariRequest';
import { useReceiving } from '../../composables/useReceiving';

const storage = new Map<string, unknown>();
const network = vi.fn(testRequest);
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.useFakeTimers(); storage.clear(); network.mockClear(); resetMockData();
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('receiving', () => {
  it('queries by code only, submits the task version once, clears and removes the received task from pending', async () => {
    const flow = useReceiving();
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.scan(' CAR-RECEIVE '));
    expect(transport.mock.lastCall?.[0].data).toEqual({ scanCode: 'CAR-RECEIVE' });
    expect(flow.result.value?.boxes).toHaveLength(3);
    expect(flow.result.value?.totalMaterialQuantity).toBe(7);
    const task = flow.result.value!.task!;
    expect(task.version).not.toBe(flow.result.value?.object.version);
    transport.mockClear();
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.lastCall?.[0].data).toEqual({ requestId: expect.any(String), taskId: task.taskId, version: task.version,
      object: { containerType: 'VEHICLE', containerCode: 'CAR-RECEIVE' } });
    expect(flow.result.value).toBeNull();
    expect(flow.notice.value?.text).toContain('接收完成');
    const page = await finish(pendingReceivingApi.query({ vehicleCode: 'CAR-RECEIVE' }, 1));
    expect(page.total).toBe(0);
    await finish(flow.scan('CAR-RECEIVE'));
    expect(flow.result.value?.task?.status).toBe('RECEIVED');
    expect(flow.canClearWms.value).toBe(true);
    expect(flow.canReceive.value).toBe(false);
    expect(network).toHaveBeenCalled();
  });
  it('cleans WMS independently before receiving, asks for confirmation, retains the task and rejects stale versions', async () => {
    const flow = useReceiving();
    await finish(flow.scan('CAR-RECEIVE'));
    const before = flow.result.value!;
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    flow.askClearWms();
    expect(flow.confirmingClear.value).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    flow.cancelClearWms();
    await flow.submit(true);
    expect(transport).not.toHaveBeenCalled();
    flow.askClearWms();
    await finish(flow.submit(true));
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.lastCall?.[0].data).toEqual({ requestId: expect.any(String), taskId: before.task!.taskId, version: before.task!.version,
      object: { containerType: 'VEHICLE', containerCode: 'CAR-RECEIVE' } });
    expect(flow.result.value).toBeNull();
    expect(flow.notice.value?.text).toContain('WMS 历史已清空');
    const stale = api.confirm({ requestId: requestId(), taskId: before.task!.taskId, version: before.task!.version,
      object: { containerType: before.object.containerType, containerCode: before.object.containerCode } });
    const rejected = expect(stale).rejects.toThrow('接收任务已变化'); await finish(rejected);
    await finish(flow.scan('CAR-RECEIVE'));
    expect(flow.result.value?.task?.status).toBe('PENDING');
    expect(flow.result.value?.boxes).toEqual(before.boxes);
    expect(flow.result.value?.task?.version).toBe(before.task!.version + 1);
    await finish(flow.submit());
    expect(flow.result.value).toBeNull();
  });
  it('receives boxes without unbinding panels or unloading a vehicle', async () => {
    const flow = useReceiving();
    const panelsBefore = await finish(panelPackingApi.getBox('BOX-NR-240818'));
    const loadsBefore = await finish(vehicleLoadingApi.getLoads('CAR-NR-0098'));
    await finish(flow.scan('BOX-NR-240818'));
    expect(flow.materials.value).toHaveLength(3);
    await finish(flow.submit());
    expect(await finish(panelPackingApi.getBox('BOX-NR-240818'))).toEqual(panelsBefore);
    await finish(flow.scan('CAR-NR-0098'));
    expect(flow.result.value?.boxes).toHaveLength(3); // task contents differ from LES's one loaded box
    await finish(flow.submit());
    expect(await finish(vehicleLoadingApi.getLoads('CAR-NR-0098'))).toEqual(loadsBefore);
  });
  it('shares the transport version and progress between single-box and remaining-vehicle receiving', async () => {
    const scope = await finish(api.query('CAR-RECEIVE'));
    const box = await finish(api.query(scope.boxes[0].boxCode));
    expect(box.task!.taskId).toBe(scope.task!.taskId); expect(box.task!.totalBoxCount).toBe(3); expect(box.boxes).toHaveLength(1);
    const single = await finish(api.confirm({ requestId: requestId(), taskId: box.task!.taskId, version: box.task!.version,
      object: { containerType: 'BOX', containerCode: box.object.containerCode }, remark: '先接收单箱' }));
    expect(single.affectedCount).toBe(1);
    const partial = await finish(api.query('CAR-RECEIVE'));
    expect(partial.task).toMatchObject({ version: single.version, status: 'PARTIAL', totalBoxCount: 3, receivedBoxCount: 1 });
    expect(partial.boxes).toEqual(scope.boxes);
    const receivedBox = await finish(api.query(box.object.containerCode));
    expect(receivedBox.task).toMatchObject({ status: 'PARTIAL', receivedBoxCount: 1, eligibility: { allowed: false, reason: '该箱已接收' } });
    expect((await finish(api.query(box.object.containerCode, single.taskId))).task!.eligibility.allowed).toBe(false);
    const rest = await finish(api.confirm({ requestId: requestId(), taskId: single.taskId, version: partial.task!.version,
      object: { containerType: 'VEHICLE', containerCode: 'CAR-RECEIVE' }, remark: '剩余整批' }));
    expect(rest.affectedCount).toBe(2); expect(rest.version).toBe(single.version + 1);
    const finished = await finish(api.query('CAR-RECEIVE', rest.taskId));
    expect(finished.task).toMatchObject({ status: 'RECEIVED', receivedBoxCount: 3, version: rest.version });
    expect(finished.boxes).toEqual(scope.boxes);
  });
  it('disables no-task results, handles errors without old context, and leaves cleanup independent of receiving eligibility', async () => {
    const flow = useReceiving();
    for (const code of ['BOX-1', 'CAR-EMPTY']) {
      await finish(flow.scan(code));
      expect(flow.result.value?.boxes).toEqual([]);
      expect(flow.canReceive.value).toBe(false); expect(flow.canClearWms.value).toBe(false);
      const transport = vi.spyOn(mock, 'resolveMockRequest'); transport.mockClear();
      flow.askClearWms(); await flow.submit(); await flow.submit(true);
      expect(transport).not.toHaveBeenCalled();
    }
    for (const code of ['UNKNOWN', 'CONTAINER-AMBIGUOUS', 'CAR-RECEIVE-MULTI', 'CAR-RECEIVE-INCOMPLETE', ' ', 'X'.repeat(129)]) {
      await finish(flow.scan('CAR-RECEIVE'));
      await finish(flow.scan(code));
      expect(flow.result.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
    }
    await finish(flow.scan('CAR-RECEIVE-BLOCKED'));
    expect(flow.canReceive.value).toBe(false); expect(flow.canClearWms.value).toBe(true);
    expect(flow.notice.value?.text).toBe('当前任务暂不允许接收');
  });
  it('opens complete context-specific materials, locks background actions and handles detail failure', async () => {
    const flow = useReceiving();
    await finish(flow.scan('CAR-RECEIVE-LONG'));
    expect(flow.result.value?.boxes).toHaveLength(225);
    expect(flow.result.value?.totalMaterialQuantity).toBe(254);
    const boxCode = flow.result.value!.boxes[0].boxCode;
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.openMaterials(boxCode));
    expect(transport.mock.lastCall?.[0].data).toEqual({ boxCode, context: 'RECEIVING' });
    expect(flow.detail.value?.materials).toHaveLength(30);
    await flow.scan('BOX-1'); await flow.submit(); flow.askClearWms();
    expect(transport).toHaveBeenCalledOnce();
    flow.closeMaterials();
    await flow.openMaterials('FOREIGN'); expect(transport).toHaveBeenCalledOnce();
    await finish(flow.scan('CAR-RECEIVE-DETAIL-FAIL'));
    await finish(flow.openMaterials(flow.result.value!.boxes[0].boxCode));
    expect(flow.detail.value).toBeNull();
    expect(flow.notice.value?.text).toBe('箱内物料查询失败，请重试');
    expect(flow.canReceive.value).toBe(true);
    await finish(flow.scan('BOX-RECEIVE-LONG'));
    expect(flow.materials.value).toHaveLength(30);
  });
  it.each([false, true])('preserves data on failure, sends a fresh UUID on manual retry: cleanup=%s', async (cleanup) => {
    const flow = useReceiving();
    await finish(flow.scan(cleanup ? 'CAR-RECEIVE-CLEAR-FAIL' : 'CAR-RECEIVE-FAIL'));
    const before = flow.result.value;
    if (cleanup) flow.askClearWms();
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.submit(cleanup));
    expect(flow.result.value).toBe(before); expect(flow.notice.value?.error).toBe(true);
    expect(flow.confirmingClear.value).toBe(cleanup);
    const first = transport.mock.lastCall?.[0].data as { requestId: string };
    await finish(flow.submit(cleanup));
    expect((transport.mock.lastCall?.[0].data as { requestId: string }).requestId).not.toBe(first.requestId);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('rejects mismatched/missing task contents and invalid receipts without claiming success', async () => {
    const flow = useReceiving();
    const valid = await finish(api.query('CAR-RECEIVE'));
    const query = vi.spyOn(api, 'query');
    for (const invalid of [{ ...valid, totalMaterialQuantity: 3 }, { ...valid, task: undefined }, { ...valid, boxes: [] },
      { ...valid, task: { ...valid.task, taskId: 123 } }, { ...valid, task: { ...valid.task, object: { ...valid.object, containerCode: 'WRONG' } } }]) {
      query.mockResolvedValueOnce(invalid as ReceivingResult);
      await flow.scan('CAR-RECEIVE');
      expect(flow.result.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
    }
    query.mockRestore(); await finish(flow.scan('CAR-RECEIVE'));
    vi.spyOn(api, 'confirm').mockResolvedValueOnce({ requestId: 'wrong', operationNo: 'OP', affectedCount: 3, processedTime: new Date().toISOString(),
      taskId: valid.task!.taskId, object: { containerType: 'VEHICLE', containerCode: 'CAR-RECEIVE' }, version: valid.task!.version + 1 });
    await flow.submit();
    expect(flow.result.value).not.toBeNull(); expect(flow.notice.value?.text).toContain('未能确认成功');
  });
  it('ignores late responses after clear/disposal for scan, detail and writes', async () => {
    const flow = useReceiving();
    const scan = flow.scan('CAR-RECEIVE'); flow.clear(); await finish(scan);
    expect(flow.result.value).toBeNull();
    await finish(flow.scan('CAR-RECEIVE'));
    const detail = flow.openMaterials(flow.result.value!.boxes[0].boxCode); flow.clear(); await finish(detail);
    expect(flow.detail.value).toBeNull();
    await finish(flow.scan('CAR-RECEIVE'));
    const submit = flow.submit(); flow.clear(); await finish(submit);
    expect(flow.result.value).toBeNull(); expect(flow.notice.value).toBeNull();
  });
  it('scopes WMS cleanup, replays identical requests and rejects UUID reuse for a different action', async () => {
    const data = await finish(api.query('CAR-RECEIVE'));
    const input = { requestId: requestId(), taskId: data.task!.taskId, version: data.task!.version, object: { containerType: data.object.containerType, containerCode: data.object.containerCode } };
    const invalid = api.clearWms({ ...input, object: { containerType: 'BOX', containerCode: 'BOX-NR-240818' } });
    await finish(expect(invalid).rejects.toThrow('清理对象与接收任务不匹配'));
    const first = await finish(api.clearWms(input));
    expect(first.affectedCount).toBe(3);
    expect(await finish(api.clearWms(input))).toEqual(first);
    const otherAction = api.confirm(input);
    await finish(expect(otherAction).rejects.toThrow('相同请求标识'));
    const after = await finish(api.query('CAR-RECEIVE'));
    expect((await finish(api.clearWms({ ...input, requestId: requestId(), version: after.task!.version }))).affectedCount).toBe(0);
    expect((await finish(api.query('BOX-NR-240818'))).task).toBeDefined();
  });
});
