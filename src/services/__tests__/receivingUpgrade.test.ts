import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { receivingApi as api, type ReceivingResult, type ReceivingOperationReceipt, type ReceivingRequest } from '../receiving';
import { ApiRequestError } from '../nariRequest';
import { useReceiving } from '../../composables/useReceiving';
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
const receipt = (input: ReceivingRequest, affectedCount = 1, version = input.version + 1): ReceivingOperationReceipt => ({
  requestId: input.requestId, taskId: input.taskId, object: input.object, version,
  operationNo: 'RECEIVE-1', affectedCount, processedTime: '2026-10-12T01:00:00Z'
});
beforeEach(() => {
  const storage = new Map<string, unknown>();
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('receiving 2026-10-12.1', () => {
  it('accepts material lines without optional names and units', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot()); const flow = useReceiving(); await flow.scan('BOX-1');
    expect(flow.canReceive.value).toBe(true);
  });
  it('submits the scanned object identity, not just the shared transport task ID', async () => {
    const value = snapshot(); value.boxes[0].materials[0].materialName = '板件'; value.boxes[0].materials[0].unit = '件';
    vi.spyOn(api, 'query').mockResolvedValue(value);
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => Object.assign({ requestId: input.requestId,
      operationNo: 'RECEIVE-1', affectedCount: 1, processedTime: '2026-10-12T01:00:00Z' },
      { taskId: value.task!.taskId, object: { containerType: 'BOX' as const, containerCode: 'BOX-1' }, version: 8 }));
    const flow = useReceiving(); await flow.scan('BOX-1'); await flow.submit();
    expect(confirm).toHaveBeenCalledWith({ requestId: expect.any(String), taskId: value.task!.taskId, version: 7,
      object: { containerType: 'BOX', containerCode: 'BOX-1' } });
  });
  it('does not treat a receipt without the latest transport version as final success', async () => {
    const value = snapshot(); value.boxes[0].materials[0].materialName = '板件'; value.boxes[0].materials[0].unit = '件';
    vi.spyOn(api, 'query').mockResolvedValue(value);
    vi.spyOn(api, 'confirm').mockImplementation(async input => ({ requestId: input.requestId,
      operationNo: 'RECEIVE-1', affectedCount: 1, processedTime: '2026-10-12T01:00:00Z' } as ReceivingOperationReceipt));
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
  it('confirms the remaining boxes of a partial transport, not its material quantity or whole box count', async () => {
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
    const cleanup = vi.spyOn(api, 'clearWms').mockImplementation(async input => ({ requestId: input.requestId, operationNo: 'WMS-1', affectedCount: 0, processedTime: '2026-10-12T01:00:00Z' }));
    const flow = useReceiving(); await flow.scan('BOX-1'); await flow.submit(); await flow.scan('BOX-1');
    expect(query.mock.calls.slice(1)).toEqual([['BOX-1'], ['BOX-1', value.task!.taskId]]);
    expect(flow.canReceive.value).toBe(false); expect(flow.canClearWms.value).toBe(true);
    flow.remark.value = '不应写入清理请求'; flow.askClearWms(); await flow.submit(true);
    expect(cleanup.mock.lastCall?.[0]).toEqual({ requestId: expect.any(String), taskId: value.task!.taskId, version: 8, object: { containerType: 'BOX', containerCode: 'BOX-1' } });
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
  it('does not infer task versions or receiving progress from a generic WMS cleanup receipt', async () => {
    const first = snapshot(); const refreshed = snapshot(); refreshed.task!.version = 12;
    vi.spyOn(api, 'query').mockResolvedValueOnce(first).mockResolvedValue(refreshed);
    vi.spyOn(api, 'clearWms').mockImplementation(async input => ({ requestId: input.requestId, operationNo: 'WMS-1', affectedCount: 0, processedTime: '2026-10-12T01:00:00Z' }));
    const confirm = vi.spyOn(api, 'confirm').mockImplementation(async input => receipt(input));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true);
    expect(flow.result.value).toBeNull(); await flow.scan('BOX-1'); await flow.submit();
    expect(confirm.mock.lastCall?.[0].version).toBe(12);
  });
  it('keeps WMS cleanup independent of receiving eligibility and remarks', async () => {
    const value = snapshot(); value.task!.eligibility = { allowed: false, reason: '当前不允许接收' };
    vi.spyOn(api, 'query').mockResolvedValue(value);
    const confirm = vi.spyOn(api, 'confirm');
    const cleanup = vi.spyOn(api, 'clearWms').mockImplementation(async input => ({ requestId: input.requestId, operationNo: 'WMS-1', affectedCount: 9, processedTime: '2026-10-12T01:00:00Z' }));
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
  it.each([408, 503, undefined])('preserves unchanged receiving requests for manual retry after status %s', async status => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const confirm = vi.spyOn(api, 'confirm').mockRejectedValue(status ? new ApiRequestError('结果未知', status) : new Error('网络异常'));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.remark.value = '备注'; await flow.submit();
    const first = confirm.mock.lastCall?.[0]; expect(flow.result.value).not.toBeNull(); expect(flow.remark.value).toBe('备注');
    expect(confirm).toHaveBeenCalledOnce(); await flow.submit(); expect(confirm.mock.lastCall?.[0]).toEqual(first);
    flow.remark.value = '修改备注'; await flow.submit(); expect(confirm.mock.lastCall?.[0].requestId).not.toBe(first?.requestId);
  });
  it('requires confirmation again and retries a network-unknown cleanup with the same UUID', async () => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const cleanup = vi.spyOn(api, 'clearWms').mockRejectedValue(new Error('网络异常'));
    const flow = useReceiving(); await flow.scan('BOX-1'); flow.askClearWms(); await flow.submit(true);
    const first = cleanup.mock.lastCall?.[0]; expect(flow.confirmingClear.value).toBe(false); expect(flow.result.value).not.toBeNull();
    flow.cancelClearWms(); flow.askClearWms(); await flow.submit(true); expect(cleanup.mock.lastCall?.[0]).toEqual(first);
  });
  it.each([400, 409])('uses a fresh UUID only on a new manual attempt after explicit rejection %s', async status => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot());
    const confirm = vi.spyOn(api, 'confirm').mockRejectedValue(new ApiRequestError('明确拒绝', status));
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
