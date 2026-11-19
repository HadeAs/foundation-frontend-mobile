import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { receivingApi as api, type ReceivingResult, type ReceivingOperationReceipt, type ReceivingRequest } from '../receiving';
import { ApiRequestError } from '../nariRequest';
import { useReceiving } from '../../composables/useReceiving';
import { usePendingReceiving } from '../../composables/usePendingReceiving';
import { pendingReceivingApi } from '../pendingReceiving';
import { seedTestSession } from './helpers/authSession';

const snapshot = (type: 'BOX' | 'VEHICLE' = 'BOX'): ReceivingResult => {
  const object = { containerType: type, containerCode: type === 'BOX' ? 'BOX-1' : 'CAR-1', version: 3 };
  return { object, task: Object.assign({ taskId: '9007199254741001', taskNo: 'WL-1', version: 7, object,
    status: 'PENDING', statusName: '待接收', createdTime: '2026-10-12T01:00:00Z', eligibility: { allowed: true } },
    { totalBoxCount: type === 'BOX' ? 1 : 3, receivedBoxCount: 0 }),
    boxes: Array.from({ length: type === 'BOX' ? 1 : 3 }, (_, index) => ({ boxCode: 'BOX-' + (index + 1), version: 3, materialQuantity: 1,
      materials: [{ lineType: 'PANEL', panelCode: 'PANEL-' + (index + 1), orderNo: 'SO-1', materialCode: 'MAT-1', quantity: 1 }] })),
    totalMaterialQuantity: type === 'BOX' ? 1 : 3 };
};
const noTask = (value: ReceivingResult): ReceivingResult => ({ object: value.object, boxes: [], totalMaterialQuantity: 0 });
function application(type: 'BOX' | 'VEHICLE' = 'BOX', applicationId = '9007199254741002') {
  const data = snapshot(type);
  const { taskId, taskNo, ...task } = data.task!;
  data.task = { ...task, applicationId, applicationNo: 'JK-0001' };
  return data;
}
const receipt = (input: ReceivingRequest, affectedCount = 1, version = input.version + 1): ReceivingOperationReceipt => ({
  requestId: input.requestId, ...(input.applicationId !== undefined ? { applicationId: input.applicationId } : { taskId: input.taskId }), object: input.object, version,
  affectedCount, processedTime: '2026-10-12T01:00:00Z'
});
beforeEach(() => {
  const storage = new Map<string, unknown>();
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('receiving 2026-10-12.1', () => {
  it.each(['BOX', 'VEHICLE'] as const)('shows a backend-provided %s application in the list and receives the scanned scope directly', async type => {
    const data = snapshot(type);
    const { taskId, taskNo, eligibility, ...progress } = data.task!;
    const summary = { ...progress, applicationId: '9100000000000001', applicationNo: 'JK-0001' };
    data.task = { ...summary, eligibility, version: 12 };
    vi.spyOn(pendingReceivingApi, 'query').mockResolvedValue({ records: [summary], total: 1, size: 20, current: 1, pages: 1 });
    const query = vi.spyOn(api, 'query').mockResolvedValue(data);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input, summary.totalBoxCount));
    const list = usePendingReceiving();
    await list.query();
    expect(list.items.value).toEqual([summary]);
    const flow = useReceiving();
    await flow.scan(data.object.containerCode, list.items.value[0].applicationId);
    expect(query).toHaveBeenCalledWith(data.object.containerCode, { applicationId: summary.applicationId });
    expect(flow.canReceive.value).toBe(true);
    expect(flow.canClearWms.value).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    await flow.submit();
    expect(confirm).toHaveBeenCalledWith({ requestId: expect.any(String), applicationId: summary.applicationId, version: 12,
      object: { containerType: type, containerCode: data.object.containerCode } });
    expect(flow.notice.value?.error).toBe(false);
    expect(flow.pendingConfirmation.value).toBeNull();
  });
  it('accepts material lines without optional names and units', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot()); const flow = useReceiving(); await flow.scan('BOX-1');
    expect(flow.canReceive.value).toBe(true);
  });
  it('uses the application version even when the optional detail number is absent and container snapshots have different versions', async () => {
    const data = application();
    delete data.task!.applicationNo;
    data.task!.object = { ...data.object, version: 2 };
    vi.spyOn(api, 'query').mockResolvedValue(data);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const flow = useReceiving();
    await flow.scan('BOX-1'); await flow.submit();
    expect(confirm.mock.lastCall?.[0].version).toBe(7);
    expect(flow.pendingConfirmation.value).toBeNull();
  });
  it('requires explicit source selection after ambiguity and rejects a different source from the scoped lookup', async () => {
    const query = vi.spyOn(api, 'query').mockRejectedValueOnce(new ApiRequestError('请从清单选择原申请', 409))
      .mockResolvedValueOnce(application('BOX', '2')).mockResolvedValueOnce(application('BOX', '1'));
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const flow = useReceiving();
    await flow.scan('BOX-1');
    expect(flow.unresolvedCode.value).toBe('BOX-1');
    await flow.submit();
    await flow.scan('BOX-1', '1');
    expect(flow.canReceive.value).toBe(false);
    expect(flow.result.value).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    await flow.scan('BOX-1', '1');
    expect(query.mock.calls).toEqual([['BOX-1'], ['BOX-1', { applicationId: '1' }], ['BOX-1', { applicationId: '1' }]]);
    await flow.submit();
    expect(confirm.mock.calls[0][0]).not.toHaveProperty('taskId');
  });
  it('receives one scanned box of a vehicle application and only the remaining boxes on the next car scan', async () => {
    const box = application();
    const car = application('VEHICLE');
    Object.assign(box.task!, { object: car.object, totalBoxCount: 3 });
    Object.assign(car.task!, { version: 8, receivedBoxCount: 1, status: 'PARTIAL', statusName: '部分接收' });
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(box).mockResolvedValueOnce(car).mockResolvedValueOnce(car);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input, input.object.containerType === 'BOX' ? 1 : 2));
    const flow = useReceiving();
    await flow.scan('BOX-1'); await flow.submit();
    await flow.scan('CAR-1'); await flow.submit();
    expect(query.mock.calls).toEqual([['BOX-1'], ['CAR-1']]);
    expect(confirm.mock.calls.map(([input]) => [input.applicationId, input.version, input.object.containerCode])).toEqual([
      [box.task!.applicationId, 7, 'BOX-1'], [car.task!.applicationId, 8, 'CAR-1']
    ]);
    expect(flow.pendingConfirmation.value).toBeNull();
    await flow.scan('CAR-1');
    expect(flow.canReceive.value).toBe(false);
    expect(flow.notice.value?.text).toContain('版本已过期');
  });
  it('only permits car confirmation for the original vehicle and honors the latest eligibility', async () => {
    const wrongCar = application('VEHICLE');
    wrongCar.task!.object = application('BOX').object;
    const blocked = application();
    blocked.task!.eligibility = { allowed: false, reason: '申请箱内容已变更' };
    vi.spyOn(api, 'query').mockResolvedValueOnce(wrongCar).mockResolvedValueOnce(blocked);
    const confirm = vi.spyOn(api, 'confirm');
    const clear = vi.spyOn(api, 'clearWms');
    const flow = useReceiving();
    await flow.scan('CAR-1'); await flow.submit();
    expect(flow.notice.value?.text).toContain('BOX-1');
    await flow.scan('BOX-1', blocked.task!.applicationId); await flow.submit();
    expect(flow.notice.value?.text).toBe('申请箱内容已变更');
    flow.askClearWms(); await flow.submit(true);
    expect(confirm).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  });
  it('keeps the direct request through a transport receipt with the same numeric ID and manually replays after reopening', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(application());
    const confirm = vi.spyOn(api, 'confirm')
      .mockImplementationOnce(async input => ({ requestId: input.requestId, taskId: input.applicationId!, object: input.object,
        affectedCount: 1, version: input.version + 1, processedTime: '2026-11-19T01:00:00Z' }))
      .mockImplementationOnce(async input => receipt(input));
    const flow = useReceiving();
    await flow.scan('BOX-1'); await flow.submit();
    expect(flow.pendingConfirmation.value).not.toBeNull();
    flow.pause();
    const reopened = useReceiving(); reopened.resume();
    expect(reopened.canClearWms.value).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    await reopened.submit();
    expect(confirm.mock.calls[1][0]).toEqual(confirm.mock.calls[0][0]);
    expect(reopened.pendingConfirmation.value).toBeNull();
  });
  it('submits the scanned object identity, not just the shared transport task ID', async () => {
    const value = snapshot(); value.boxes[0].materials[0].materialName = '板件'; value.boxes[0].materials[0].unit = '件';
    vi.spyOn(api, 'query').mockResolvedValue(value);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => Object.assign({ requestId: input.requestId,
      affectedCount: 1, processedTime: '2026-10-12T01:00:00Z' },
      { taskId: value.task!.taskId!, object: { containerType: 'BOX' as const, containerCode: 'BOX-1' }, version: 8 }));
    const flow = useReceiving(); await flow.scan('BOX-1'); await flow.submit();
    expect(confirm).toHaveBeenCalledWith({ requestId: expect.any(String), taskId: value.task!.taskId!, version: 7,
      object: { containerType: 'BOX', containerCode: 'BOX-1' } });
  });
  it('does not treat a receipt without the latest transport version as final success', async () => {
    const value = snapshot(); value.boxes[0].materials[0].materialName = '板件'; value.boxes[0].materials[0].unit = '件';
    vi.spyOn(api, 'query').mockResolvedValue(value);
    vi.spyOn(api, 'confirm').mockImplementation(async input => ({ requestId: input.requestId,
      affectedCount: 1, processedTime: '2026-10-12T01:00:00Z' } as ReceivingOperationReceipt));
    const flow = useReceiving(); await flow.scan('BOX-1'); await flow.submit(); expect(flow.result.value).not.toBeNull();
    expect(flow.notice.value?.error).toBe(true);
  });
  it('confirms only the scanned box in a three-box transport using the task version', async () => {
    const value = snapshot(); value.task!.totalBoxCount = 3;
    vi.spyOn(api, 'query').mockResolvedValue(value);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.remark.value = '  单箱验收  '; await flow.submit();
    expect(confirm.mock.lastCall?.[0]).toMatchObject({ version: 7, object: { containerType: 'BOX', containerCode: 'BOX-1' }, remark: '单箱验收' });
    expect(flow.result.value).toBeNull(); expect(flow.remark.value).toBe('');
  });
  it('confirms only the remaining boxes of a partial transport with a receipt without operationNo', async () => {
    const value = snapshot('VEHICLE'); Object.assign(value.task!, { status: 'PARTIAL', statusName: '部分接收', receivedBoxCount: 1 });
    vi.spyOn(api, 'query').mockResolvedValue(value);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input, 2));
    const flow = useReceiving(); await flow.scan('CAR-1'); await flow.submit();
    expect(confirm.mock.lastCall?.[0].object).toEqual({ containerType: 'VEHICLE', containerCode: 'CAR-1' });
    expect(flow.result.value).toBeNull(); expect(flow.notice.value?.error).toBe(false);
  });
  it.each(['task', 'object', 'version', 'count'])('preserves the scope and reuses the original request on an inconsistent %s receipt', async field => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => {
      const data = receipt(input);
      if (field === 'task') data.taskId = '2';
      if (field === 'object') data.object = { containerType: 'VEHICLE', containerCode: 'CAR-1' };
      if (field === 'version') data.version = input.version;
      if (field === 'count') data.affectedCount = 2;
      return data;
    });
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.remark.value = '验收备注'; await flow.submit();
    expect(flow.result.value).not.toBeNull(); expect(flow.remark.value).toBe('验收备注'); expect(flow.notice.value?.error).toBe(true);
    const first = confirm.mock.lastCall?.[0]; await flow.submit(); expect(confirm.mock.lastCall?.[0]).toEqual(first);
  });
  it('prioritizes new tasks, otherwise re-queries the known scope and uses its latest task version for cleanup', async () => {
    const value = snapshot();
    const completed = snapshot(); Object.assign(completed.task!, { version: 8, status: 'RECEIVED', statusName: '已接收', receivedBoxCount: 1, eligibility: { allowed: false, reason: '该箱已接收' } });
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(value).mockResolvedValueOnce(noTask(value)).mockResolvedValueOnce(completed).mockResolvedValueOnce(completed);
    vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const cleanup = vi.spyOn(api, 'clearWms').mockImplementation(async input => ({ requestId: input.requestId, affectedCount: 0, processedTime: '2026-10-12T01:00:00Z' }));
    const flow = useReceiving(); await flow.scan('BOX-1'); await flow.submit(); await flow.scan('BOX-1');
    expect(query.mock.calls.slice(1)).toEqual([['BOX-1'], ['BOX-1', value.task!.taskId]]);
    expect(flow.canReceive.value).toBe(false); expect(flow.canClearWms.value).toBe(true);
    flow.remark.value = '不应写入清理请求'; flow.askClearWms(); await flow.submit(true);
    expect(cleanup.mock.lastCall?.[0]).toEqual({ requestId: expect.any(String), taskId: value.task!.taskId!, version: 8, object: { containerType: 'BOX', containerCode: 'BOX-1' } });
    expect(query.mock.lastCall).toEqual(['BOX-1', value.task!.taskId]);
    expect(flow.result.value).toBeNull();
    const newer = snapshot(); Object.assign(newer.task!, { taskId: '9007199254741002', version: 1 });
    query.mockResolvedValueOnce(newer); await flow.scan('BOX-1');
    expect(query).toHaveBeenCalledTimes(5); expect(flow.result.value?.task?.taskId).toBe(newer.task!.taskId);
    expect(flow.canReceive.value).toBe(true);
  });
  it.each(['wrong task', 'stale version'])('refuses a known-scope response with %s after successful receiving', async fault => {
    const value = snapshot(); const recovered = snapshot();
    recovered.task!.version = 8;
    if (fault === 'wrong task') recovered.task!.taskId = '2';
    if (fault === 'stale version') recovered.task!.version = 7;
    vi.spyOn(api, 'query').mockResolvedValueOnce(value).mockResolvedValueOnce(noTask(value)).mockResolvedValueOnce(recovered);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const flow = useReceiving(); await flow.scan('BOX-1'); await flow.submit(); await flow.scan('BOX-1');
    expect(flow.result.value).toBeNull(); expect(flow.notice.value?.error).toBe(true); await flow.submit();
    expect(confirm).toHaveBeenCalledOnce();
  });
  it('accepts WMS cleanup without operationNo and refreshes task versions instead of inferring receiving progress', async () => {
    const first = snapshot(); const refreshed = snapshot(); refreshed.task!.version = 12;
    vi.spyOn(api, 'query').mockResolvedValueOnce(first).mockResolvedValue(refreshed);
    vi.spyOn(api, 'clearWms').mockImplementation(async input => ({ requestId: input.requestId, affectedCount: 0, processedTime: '2026-10-12T01:00:00Z' }));
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true);
    expect(flow.result.value).toBeNull(); await flow.scan('BOX-1'); await flow.submit();
    expect(confirm.mock.lastCall?.[0].version).toBe(12);
  });
  it('keeps WMS cleanup independent of receiving eligibility and remarks', async () => {
    const value = snapshot(); value.task!.eligibility = { allowed: false, reason: '当前不允许接收' };
    vi.spyOn(api, 'query').mockResolvedValue(value);
    const confirm = vi.spyOn(api, 'confirm');
    const cleanup = vi.spyOn(api, 'clearWms').mockImplementation(async input => ({ requestId: input.requestId, affectedCount: 9, processedTime: '2026-10-12T01:00:00Z' }));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.remark.value = '备注'; await flow.submit();
    expect(confirm).not.toHaveBeenCalled(); expect(flow.canClearWms.value).toBe(true);
    flow.askClearWms(); expect(flow.notice.value).toBeNull(); await flow.submit(true);
    expect(cleanup.mock.lastCall?.[0]).not.toHaveProperty('remark'); expect(flow.result.value).toBeNull();
  });
  it('accepts at most 500 trimmed remark characters and omits an empty optional remark', async () => {
    const query = vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.remark.value = '字'.repeat(501);
    expect(flow.canReceive.value).toBe(false); await flow.submit(); expect(confirm).not.toHaveBeenCalled();
    flow.remark.value = '字'.repeat(500); expect(flow.canReceive.value).toBe(true); await flow.submit();
    expect(confirm.mock.lastCall?.[0].remark).toHaveLength(500);
    const next = snapshot(); next.task!.version = 9; query.mockResolvedValue(next);
    await flow.scan('BOX-1'); flow.remark.value = '  '; await flow.submit(); expect(confirm.mock.lastCall?.[0]).not.toHaveProperty('remark');
  });
  it.each([408, 409, 503, undefined])('preserves unchanged receiving requests for manual retry after status %s', async status => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const confirm = vi.spyOn(api, 'confirm').mockRejectedValue(status ? new ApiRequestError('结果未知', status) : new Error('网络异常'));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.remark.value = '备注'; await flow.submit();
    const first = confirm.mock.lastCall?.[0]; expect(flow.result.value).not.toBeNull(); expect(flow.remark.value).toBe('备注');
    expect(confirm).toHaveBeenCalledOnce(); await flow.submit(); expect(confirm.mock.lastCall?.[0]).toEqual(first);
    flow.remark.value = '修改备注'; await flow.submit(); expect(confirm.mock.lastCall?.[0]).toEqual(first);
  });
  it('keeps the same confirmation through 503, page reopen and 409, then accepts its completed vehicle receipt', async () => {
    const value = snapshot('VEHICLE');
    Object.assign(value.task!, { status: 'PARTIAL', statusName: '部分接收', receivedBoxCount: 1 });
    const query = vi.spyOn(api, 'query').mockResolvedValue(value);
    const confirm = vi.spyOn(api, 'confirm')
      .mockRejectedValueOnce(new ApiRequestError('WMS 写入失败，请重试原请求', 503))
      .mockRejectedValueOnce(new ApiRequestError('接收结果待核查', 409))
      .mockImplementationOnce(async input => receipt(input, 2));
    const flow = useReceiving();
    await flow.scan('CAR-1');
    flow.remark.value = '剩余两箱';
    await flow.submit();
    const first = confirm.mock.calls[0][0];
    flow.pause();

    const reopened = useReceiving();
    reopened.resume();
    expect(reopened.canReceive.value).toBe(true);
    expect(reopened.canClearWms.value).toBe(false);
    await reopened.scan('BOX-1');
    expect(query).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    await reopened.submit();
    expect(confirm.mock.calls[1][0]).toEqual(first);
    expect(reopened.notice.value?.text).toBe('接收结果待核查');
    await reopened.submit();
    expect(confirm.mock.calls[2][0]).toEqual(first);
    expect(reopened.notice.value).toEqual({ text: '接收完成，当前接收流程已结束', error: false });
    expect(reopened.canReceive.value).toBe(false);
  });
  it('requires confirmation again and retries a network-unknown cleanup with the same UUID', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const cleanup = vi.spyOn(api, 'clearWms').mockRejectedValue(new Error('网络异常'));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true);
    const first = cleanup.mock.lastCall?.[0]; expect(flow.confirmingClear.value).toBe(false); expect(flow.result.value).not.toBeNull();
    flow.cancelClearWms(); flow.askClearWms(); await flow.submit(true); expect(cleanup.mock.lastCall?.[0]).toEqual(first);
  });
  it('uses a fresh UUID on a new manual attempt after a definite first rejection', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const confirm = vi.spyOn(api, 'confirm').mockRejectedValue(new ApiRequestError('明确拒绝', 400));
    const flow = useReceiving(); await flow.scan('BOX-1'); await flow.submit(); const first = confirm.mock.lastCall?.[0];
    await flow.submit(); expect(confirm.mock.lastCall?.[0].requestId).not.toBe(first?.requestId);
  });
  it.each(['counts', 'truncated', 'duplicate panel', 'panel quantity', 'batch'])('rejects malformed complete scope: %s', async fault => {
    const value = snapshot('VEHICLE');
    if (fault === 'counts') value.task!.receivedBoxCount = 4;
    if (fault === 'truncated') { value.boxes.pop(); value.totalMaterialQuantity = 2; }
    if (fault === 'duplicate panel') value.boxes[1].materials[0].panelCode = value.boxes[0].materials[0].panelCode;
    if (fault === 'panel quantity') { value.boxes[0].materials[0].quantity = 2; value.boxes[0].materialQuantity = 2; value.totalMaterialQuantity = 4; }
    if (fault === 'batch') Object.assign(value.boxes[0].materials[0], { materialBatch: 123 });
    vi.spyOn(api, 'query').mockResolvedValue(value); const flow = useReceiving(); await flow.scan('CAR-1');
    expect(flow.result.value).toBeNull(); expect(flow.notice.value?.error).toBe(true);
  });
  it('accepts quantity lines with optional display fields and does not infer physical emptiness from zero bindings', async () => {
    const value = snapshot(); value.boxes[0] = { boxCode: 'BOX-1', version: 3, materialQuantity: 5,
      materials: [{ lineType: 'QUANTITY', orderNo: 'SO-1', materialCode: 'MAT-1', quantity: 5, materialBatch: '000031' }] }; value.totalMaterialQuantity = 5;
    const empty = snapshot(); empty.boxes[0].materials = []; empty.boxes[0].materialQuantity = 0; empty.totalMaterialQuantity = 0;
    empty.object.runtimeUsage = 'FIXTURE'; empty.object.contentState = 'UNKNOWN';
    vi.spyOn(api, 'query').mockResolvedValueOnce(value).mockResolvedValueOnce(empty);
    const flow = useReceiving(); await flow.scan('BOX-1'); expect(flow.materials.value[0].materialBatch).toBe('000031');
    await flow.scan('BOX-1'); expect(flow.result.value?.object.contentState).toBe('UNKNOWN'); expect(flow.canReceive.value).toBe(true);
  });
  it('treats context-specific material details as read-only without replacing the task version', async () => {
    const value = snapshot('VEHICLE'); vi.spyOn(api, 'query').mockResolvedValue(value);
    vi.spyOn(api, 'getMaterials').mockResolvedValue({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 99 },
      sourceSystem: 'WMS', materials: value.boxes[0].materials, totalQuantity: 1 });
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input, 3));
    const flow = useReceiving(); await flow.scan('CAR-1'); await flow.openMaterials('BOX-1'); await flow.submit();
    expect(flow.detail.value?.box.version).toBe(99); expect(confirm).not.toHaveBeenCalled();
    flow.closeMaterials(); await flow.submit(); expect(confirm.mock.lastCall?.[0].version).toBe(7);
  });
  it('drops late known-scope responses on hide and starts the next view without old notes', async () => {
    const value = snapshot(); let resolve!: (data: ReceivingResult) => void;
    const query = vi.spyOn(api, 'query').mockResolvedValueOnce(value).mockResolvedValueOnce(noTask(value))
      .mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(value);
    const confirm = vi.spyOn(api, 'confirm'); const flow = useReceiving(); await flow.scan('BOX-1'); flow.remark.value = '旧备注';
    const pending = flow.scan('BOX-1'); await Promise.resolve(); expect(query).toHaveBeenCalledTimes(3);
    flow.pause(); await flow.scan('BOX-1'); expect(query).toHaveBeenCalledTimes(3); expect(flow.remark.value).toBe('');
    resolve(value); await pending; expect(flow.result.value).toBeNull(); expect(flow.notice.value).toBeNull();
    flow.resume(); await flow.scan('BOX-1'); expect(flow.result.value).toEqual(value); expect(confirm).not.toHaveBeenCalled();
  });
  it('does not apply a late receiving receipt or automatically send writes after a page is hidden', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot()); let resolve!: (data: ReceivingOperationReceipt) => void;
    const confirm = vi.spyOn(api, 'confirm').mockReturnValue(new Promise(done => { resolve = done; }));
    const flow = useReceiving(); await flow.scan('BOX-1'); const pending = flow.submit(); const input = confirm.mock.lastCall![0];
    flow.pause(); resolve(receipt(input)); await pending; flow.resume();
    expect(flow.result.value).toBeNull(); expect(flow.notice.value).toBeNull(); expect(confirm).toHaveBeenCalledOnce();
  });
});
