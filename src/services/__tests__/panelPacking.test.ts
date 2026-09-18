import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelPacking } from '../../composables/usePanelPacking';
import { panelPackingApi, type BoxBindings, type Panel } from '../panelPacking';

vi.mock('../auth', () => ({ getAccessToken: () => 'test-token', getCurrentApiBaseUrl: () => 'http://test.local' }));
const request = vi.fn();
const box = (): BoxBindings => ({ box: { containerType: 'BOX', containerCode: 'BOX-1', version: 2 }, empty: true, totalQuantity: 0, bindings: [], eligibility: { allowed: true } });
const panel = (panelCode = 'P1', orderNo = 'O1'): Panel => ({ panelCode, orderNo, materialCode: 'M1', materialName: '板件', eligibility: { allowed: true } });
function fullBox(): BoxBindings {
  return { ...box(), empty: false, totalQuantity: 1, bindings: [{ id: '1', version: 1, bindingMode: 'BY_CODE', panelCode: 'BOUND', orderNo: 'OLD', materialCode: 'M1', materialName: '板件', quantity: 1, unit: '件' }] };
}
function respond(data: unknown, statusCode = 200, code = 0, message = 'ok') {
  request.mockImplementationOnce((options: UniNamespace.RequestOptions) => {
    options.success?.({ statusCode, data: { code, data, message }, header: {}, cookies: [] });
  });
}
function receipt(version = 3) { return { requestId: 'r1', operationNo: 'OP1', affectedCount: 1, processedTime: '2026-09-16T00:00:00Z', box: { boxCode: 'BOX-1', version, materialQuantity: 0 } }; }

beforeEach(() => { request.mockReset(); vi.stubGlobal('uni', { request }); vi.unstubAllEnvs(); vi.stubEnv('VITE_API_MODE', 'real'); });

describe('板件扫码绑箱', () => {
  it('uses real URLs, token and the H5 proxy', async () => {
    vi.stubEnv('UNI_PLATFORM', 'h5');
    respond(box());
    await panelPackingApi.getBox('BOX-1');
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/v1/business/nari-logistics/boxes/bindings', method: 'GET', data: { boxCode: 'BOX-1' }, header: expect.objectContaining({ Authorization: 'Bearer test-token' }) }));
  });
  it('scans box first, accepts mixed orders, blocks duplicates and submits only pending', async () => {
    const flow = usePanelPacking();
    respond(box()); await flow.scan(' BOX-1 ');
    respond(panel()); await flow.scan('P1');
    expect(request.mock.lastCall?.[0].data).toEqual({ panelCode: 'P1' });
    respond(panel('P2', 'OTHER')); await flow.scan('P2');
    await flow.scan('P1');
    expect(request).toHaveBeenCalledTimes(3);
    expect(flow.notice.value?.error).toBe(true);
    flow.remove('P1');
    respond(receipt()); await flow.submit();
    expect(request.mock.lastCall?.[0].data).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), boxCode: 'BOX-1', version: 2, panelCodes: ['P2'] });
    expect(flow.box.value).toBeNull();
    expect(flow.pending.value).toEqual([]);
    expect(flow.notice.value?.text).toBe('装箱成功');
  });
  it('requires pending panels for joint queries, keeps bound records and accepts candidates-only responses', async () => {
    const flow = usePanelPacking();
    respond(fullBox()); await flow.scan('BOX-1');
    expect(flow.box.value).toBeNull();
    expect(flow.review.value?.totalQuantity).toBe(1);
    await flow.scan('P1'); expect(request).toHaveBeenCalledTimes(1);
    flow.keepBindings();
    expect(flow.canJoint.value).toBe(false);
    await flow.getJoint();
    expect(request).toHaveBeenCalledTimes(1);
    respond(panel()); await flow.scan('P1');
    expect(flow.canJoint.value).toBe(true);
    respond({ candidates: [panel('BOUND'), panel(), panel('P2'), panel('P2')] }); await flow.getJoint();
    expect(request.mock.lastCall?.[0].data).toEqual({ pendingPanelCodes: ['P1'] });
    expect(flow.pending.value.map((p) => p.panelCode)).toEqual(['P1', 'P2']);
    expect(flow.box.value?.box.version).toBe(2);
    flow.remove('BOUND'); expect(flow.box.value?.bindings).toHaveLength(1);
    flow.remove('P2');
    respond(receipt()); await flow.submit();
    expect(request.mock.lastCall?.[0].data.panelCodes).toEqual(['P1']);
  });
  it('unbinds once, retains box and uses returned version for subsequent binding', async () => {
    const flow = usePanelPacking();
    respond(fullBox()); await flow.scan('BOX-1');
    respond(receipt(8)); await flow.unbindAll();
    expect(flow.review.value).toBeNull();
    expect(flow.box.value?.box.version).toBe(8);
    expect(flow.box.value?.bindings).toEqual([]);
    respond(panel()); await flow.scan('P1');
    respond(receipt(9)); await flow.submit();
    expect(request.mock.lastCall?.[0].data.version).toBe(8);
  });
  it('keeps pending records on business or network failure; explicit retry is a new request', async () => {
    const flow = usePanelPacking();
    respond(box()); await flow.scan('BOX-1');
    respond(panel()); await flow.scan('P1');
    respond(null, 409, 40900, '箱版本冲突'); await flow.submit();
    const firstId = request.mock.lastCall?.[0].data.requestId;
    expect(flow.notice.value?.text).toBe('箱版本冲突');
    expect(flow.pending.value).toHaveLength(1);
    request.mockImplementationOnce((options: UniNamespace.RequestOptions) => options.fail?.({ errMsg: 'timeout' }));
    await flow.submit();
    expect(request.mock.lastCall?.[0].data.requestId).not.toBe(firstId);
    expect(flow.pending.value).toHaveLength(1);
    expect(flow.busy.value).toBe(false);
  });
  it('keeps the confirmation on unbind failure and supports retry', async () => {
    const flow = usePanelPacking();
    respond(fullBox()); await flow.scan('BOX-1');
    respond(null, 400, 40000, '不允许解绑'); await flow.unbindAll();
    expect(flow.review.value).not.toBeNull();
    expect(flow.box.value).toBeNull();
    expect(flow.notice.value?.text).toBe('不允许解绑');
    respond(receipt()); await flow.unbindAll();
    expect(flow.box.value?.totalQuantity).toBe(0);
  });
  it('rejects disallowed or incomplete panels without modifying the list', async () => {
    const flow = usePanelPacking();
    respond(box()); await flow.scan('BOX-1');
    respond({ ...panel(), eligibility: { allowed: false, reason: '板件已锁定' } }); await flow.scan('P1');
    expect(flow.notice.value?.text).toBe('板件已锁定');
    expect(flow.pending.value).toHaveLength(0);
    respond({ ...panel(), panelCode: '' }); await flow.scan('P1');
    expect(flow.pending.value).toHaveLength(0);
  });
  it('does not partially add joint candidates on overflow, invalid items or request failures', async () => {
    const flow = usePanelPacking();
    respond(box()); await flow.scan('BOX-1');
    respond(panel()); await flow.scan('P1');
    respond({ candidates: Array.from({ length: 1000 }, (_, i) => panel(`J${i}`)) }); await flow.getJoint();
    expect(flow.pending.value).toHaveLength(1);
    respond({ candidates: [panel('VALID'), { ...panel('INVALID'), eligibility: { allowed: false } }] }); await flow.getJoint();
    expect(flow.pending.value).toHaveLength(1);
    respond(null, 400, 40000, '拼板查询失败'); await flow.getJoint();
    expect(flow.notice.value?.text).toBe('拼板查询失败');
    expect(flow.pending.value).toHaveLength(1);
    respond({}); await flow.getJoint();
    expect(flow.notice.value?.text).toBe('拼板结果不完整，请重试');
    respond({ candidates: [] }); await flow.getJoint();
    expect(flow.notice.value?.text).toBe('没有新的可加入板件');
    expect(flow.pending.value).toHaveLength(1);
    flow.remove('P1');
    expect(flow.canJoint.value).toBe(false);
    const calls = request.mock.calls.length;
    await flow.getJoint();
    expect(request).toHaveBeenCalledTimes(calls);
  });
  it('locks edits during joint queries and discards responses after reset or pending-input changes', async () => {
    for (const change of ['clear', 'pending'] as const) {
      const flow = usePanelPacking();
      respond(box()); await flow.scan('BOX-1');
      respond(panel()); await flow.scan('P1');
      let options: UniNamespace.RequestOptions | undefined;
      request.mockImplementationOnce((value: UniNamespace.RequestOptions) => { options = value; });
      const querying = flow.getJoint();
      expect(flow.canJoint.value).toBe(false);
      const calls = request.mock.calls.length;
      await flow.getJoint();
      await flow.scan('P2');
      flow.remove('P1');
      expect(request).toHaveBeenCalledTimes(calls);
      expect(flow.pending.value).toHaveLength(1);
      if (change === 'clear') flow.clear();
      else flow.pending.value = [panel('OTHER')];
      options?.success?.({ statusCode: 200, data: { code: 0, data: { candidates: [panel('LATE')] } }, header: {}, cookies: [] });
      await querying;
      expect(flow.pending.value.map((p) => p.panelCode)).toEqual(change === 'clear' ? [] : ['OTHER']);
      expect(flow.busy.value).toBe(false);
    }
  });
  it('prevents concurrent scans and ignores results after page reset', async () => {
    const flow = usePanelPacking();
    let options: UniNamespace.RequestOptions | undefined;
    request.mockImplementationOnce((value: UniNamespace.RequestOptions) => { options = value; });
    const first = flow.scan('BOX-1');
    await flow.scan('BOX-1'); expect(request).toHaveBeenCalledTimes(1);
    flow.clear();
    options?.success?.({ statusCode: 200, data: { code: 0, data: box() }, header: {}, cookies: [] });
    await first;
    expect(flow.box.value).toBeNull();
    expect(flow.busy.value).toBe(false);
  });
});
