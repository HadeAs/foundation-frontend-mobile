import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ScanInput from '../../components/ScanInput.vue';
import InboundLocationPicker from '../../pages/line-side-inbound/InboundLocationPicker.vue';
import { useLineSideInbound } from '../../composables/useLineSideInbound';
import { lineSideInboundApi as api, type DraftBox, type InboundBatch } from '../lineSideInbound';
import { ApiRequestError } from '../nariRequest';
import { seedTestSession } from './helpers/authSession';

const location = { locationCode: '4F-01', locationName: '一号地标', locationVersion: 2, factoryId: '1' };
const box = (code: string, version = 2): DraftBox => ({ boxCode: code, allowed: true, boxVersion: version,
  shippingOperationId: '9007199254741001', contentHash: '0'.repeat(64), totalQuantity: 3 });
const scanResult = (rows: DraftBox[]) => ({ location, locationRequired: false, scanType: 'VEHICLE' as const,
  scanCode: 'CAR', factoryId: '1', boxes: rows, allowed: true });
const receipt = (input: InboundBatch) => ({ requestId: input.requestId, locationCode: input.locationCode,
  groupKey: 'group1', affectedBoxCount: input.items.length, processedTime: '2026-11-20T07:00:00Z',
  records: input.items.map((item, i) => ({ id: String(i + 10), groupKey: 'group1', locationCode: input.locationCode, boxCode: item.boxCode })) });

beforeEach(() => {
  const storage = new Map<string, unknown>();
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, data: unknown) => storage.set(key, data) });
  seedTestSession();
  vi.spyOn(api, 'preview').mockImplementation(async (code, codes) => ({ location: { ...location, locationCode: code },
    allowed: true, boxes: codes.map(c => box(c)) }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('line-side inbound batch', () => {
  it('stages unidentified destinations, supports ground-first empty preview, then validates all retained boxes when switching', async () => {
    vi.spyOn(api, 'scan').mockResolvedValue({ ...scanResult([box('B1'), box('B2')]), locationRequired: true, location: null, allowed: false });
    const flow = useLineSideInbound(); await flow.scan(' CAR ');
    expect(api.scan).toHaveBeenCalledWith('CAR', undefined); expect(flow.location.value).toBeNull();
    expect(flow.boxes.value).toHaveLength(2); expect(flow.canSubmit.value).toBe(false);
    await flow.chooseLocation('4F-01'); expect(api.preview).toHaveBeenCalledWith('4F-01', ['B1', 'B2']); expect(flow.canSubmit.value).toBe(true);
    flow.remove('B1');
    await flow.chooseLocation('4F-02'); expect(api.preview).toHaveBeenLastCalledWith('4F-02', ['B2']);
    flow.clear(); await flow.chooseLocation('4F-01'); expect(api.preview).toHaveBeenLastCalledWith('4F-01', []);
    expect(flow.canSubmit.value).toBe(false);
  });
  it('serializes consecutive scans, deduplicates by canonical box, refreshes individual versions and submits only the final scope', async () => {
    const scan = vi.spyOn(api, 'scan').mockResolvedValueOnce(scanResult([box('B1'), box('B2')]))
      .mockResolvedValueOnce(scanResult([{ ...box('B2', 3), expectedId: '999', expectedVersion: 5 }, box('B3')]))
      .mockResolvedValueOnce({ ...scanResult([box('B3', 4)]), scanType: 'BOX' });
    const submit = vi.spyOn(api, 'submit').mockImplementation(async input => receipt(input));
    const flow = useLineSideInbound();
    await Promise.all([flow.scan('C1'), flow.scan('C2'), flow.scan('B3')]);
    expect(scan.mock.calls).toEqual([['C1', undefined], ['C2', '4F-01'], ['B3', '4F-01']]);
    expect(flow.boxes.value.map(row => row.boxCode)).toEqual(['B1','B2','B3']);
    flow.remove('B1'); await Promise.all([flow.submit(), flow.submit()]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].items).toEqual([
      { boxCode: 'B2', boxVersion: 3, shippingOperationId: '9007199254741001', contentHash: '0'.repeat(64), expectedId: '999', expectedVersion: 5 },
      { boxCode: 'B3', boxVersion: 4, shippingOperationId: '9007199254741001', contentHash: '0'.repeat(64) }]);
    expect(flow.boxes.value).toHaveLength(0); expect(flow.location.value).toBeNull(); expect(flow.notice.value?.text).toContain('2 箱');
    expect(flow.release.asking.value).toBe(true);
    expect(flow.release.pending.value?.input.receivingRequestId).toBe(submit.mock.calls[0][0].requestId);
  });
  it('keeps the previous draft for empty, conflicting, unknown and oversized vehicle scans', async () => {
    const scan = vi.spyOn(api, 'scan').mockResolvedValueOnce(scanResult([box('B1')]))
      .mockResolvedValueOnce({ ...scanResult([]), allowed: false, reason: '空车' })
      .mockResolvedValueOnce({ ...scanResult([box('B2'), { ...box('B3'), allowed: false, reason: 'AGV仍在途' }]), allowed: false })
      .mockRejectedValueOnce(new ApiRequestError('容器不存在', 404))
      .mockResolvedValueOnce(scanResult(Array.from({ length: 100 }, (_, i) => box('X' + i))));
    const flow = useLineSideInbound(); await flow.scan('B1');
    for (const [code, reason] of [['C1', '空车'],['C2','B3：AGV仍在途'],['X','容器不存在'],['C3','100']]) {
      await flow.scan(code); expect(flow.notice.value?.text).toContain(reason); expect(flow.boxes.value.map(b => b.boxCode)).toEqual(['B1']);
    }
    expect(scan).toHaveBeenCalledTimes(5);
  });
  it('preserves draft on invalid landmark or incomplete preview, and marks individual conflicts when switching', async () => {
    vi.spyOn(api, 'scan').mockResolvedValue(scanResult([box('B1'), box('B2')]));
    const flow = useLineSideInbound(); await flow.scan('C1');
    vi.mocked(api.preview).mockResolvedValueOnce({ location: null, allowed: false, reason: '无效地标', boxes: [] })
      .mockResolvedValueOnce({ location: { ...location, locationCode: 'L2' }, allowed: true, boxes: [box('B1')] })
      .mockResolvedValueOnce({ location: { ...location, locationCode: 'L2' }, allowed: false, boxes: [box('B1'),
        { ...box('B2'), allowed: false, registeredLocationCode: 'L1', reason: '登记地标不符' }] });
    expect(await flow.chooseLocation('L0')).toBe(false); expect(await flow.chooseLocation('L2')).toBe(false);
    expect(flow.location.value?.locationCode).toBe('4F-01');
    expect(await flow.chooseLocation('L2')).toBe(true); expect(flow.boxes.value[1].reason).toBe('登记地标不符');
    expect(flow.canSubmit.value).toBe(false); flow.remove('B2'); expect(flow.canSubmit.value).toBe(true);
  });
  it('surfaces structured HTTP 409 at the affected box, keeps both boxes and sends a new UUID after editing', async () => {
    vi.spyOn(api, 'scan').mockResolvedValue(scanResult([box('B1'), box('B2')]));
    let conflict = true;
    const attempts: InboundBatch[] = [];
    vi.stubGlobal('uni', { ...uni, request: (options: UniNamespace.RequestOptions) => {
      const body = options.data as unknown as InboundBatch; attempts.push(body);
      const response = conflict ? { code: 40900, message: '整批未入库', data: { failures: [{ boxCode: 'B2', registeredLocationCode: '4F-03', reason: '已被接收' }] } }
        : { code: 0, data: receipt(body) };
      options.success?.({ statusCode: conflict ? 409 : 200, data: response, header: {}, cookies: [] });
    } });
    const flow = useLineSideInbound(); await flow.scan('CAR'); await flow.submit();
    expect(flow.pending.value).toBeNull(); expect(flow.boxes.value).toHaveLength(2);
    expect(flow.boxes.value[1]).toMatchObject({ allowed: false, reason: '已被接收', registeredLocationCode: '4F-03' });
    expect(flow.canSubmit.value).toBe(false); flow.remove('B2'); conflict = false; await flow.submit();
    expect(attempts[0].requestId).not.toBe(attempts[1].requestId); expect(attempts[1].items.map(row => row.boxCode)).toEqual(['B1']);
  });
  it('replays exact persisted payload after timeout or an incomplete success, even after reopening; isolates accounts', async () => {
    vi.spyOn(api, 'scan').mockResolvedValue(scanResult([box('B1')]));
    const post = vi.spyOn(api, 'submit').mockRejectedValueOnce(new Error('网络超时'))
      .mockImplementationOnce(async input => ({ ...receipt(input), records: [] })).mockImplementation(async input => receipt(input));
    const flow = useLineSideInbound(); await flow.scan('C1'); await flow.submit(); flow.clear(); flow.remove('B1');
    expect(flow.boxes.value).toHaveLength(1); expect(flow.pending.value).not.toBeNull(); flow.pause();
    seedTestSession('another-user'); expect(useLineSideInbound().pending.value).toBeNull(); seedTestSession();
    const restored = useLineSideInbound(); restored.resume(); await restored.submit();
    expect(restored.pending.value?.reason).toContain('回执不完整'); await restored.submit();
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1]); expect(post.mock.calls[1]).toEqual(post.mock.calls[2]);
    expect(restored.pending.value).toBeNull(); expect(restored.boxes.value).toHaveLength(0);
  });
  it('discards queued reads when leaving the screen and blocks submission with missing paired credentials', async () => {
    let finish!: (r: ReturnType<typeof scanResult>) => void;
    const scan = vi.spyOn(api, 'scan').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(scanResult([{ ...box('B1'), expectedId: '77', expectedVersion: null }]));
    const flow = useLineSideInbound(); const first = flow.scan('OLD'); const queued = flow.scan('SKIP');
    await Promise.resolve(); flow.pause(); flow.resume(); finish(scanResult([box('OLD')]));
    await Promise.all([first, queued]); expect(flow.boxes.value).toHaveLength(0); await flow.scan('B1');
    expect(scan).toHaveBeenCalledTimes(2); expect(flow.canSubmit.value).toBe(false);
  });
});

describe('line-side inbound scanner and location picker', () => {
  it('uses the current confirmed text even if input model updates for consecutive codes have not rendered', async () => {
    const wrapper = mount(ScanInput, { props: { modelValue: '旧值' } });
    try {
      for (const value of [' B1 ', 'B2', '']) await wrapper.get('input').trigger('confirm', { detail: { value } });
      expect(wrapper.emitted('scan')).toEqual([['B1'], ['B2']]);
      await wrapper.get('input').trigger('confirm');
      expect(wrapper.emitted('scan')?.at(-1)).toEqual(['旧值']);
    } finally { wrapper.unmount(); }
  });
  it('queries by keyword, paginates using the applied search, and accepts only a unique exact landmark scan', async () => {
    const list = vi.spyOn(api, 'locations').mockImplementation(async (q, page = 1) => ({
      current: page, pages: 2, records: q.locationCode === 'UNKNOWN' ? [] : [{ ...location, locationCode: page === 2 ? '4F-02' : '4F-01' }]
    }));
    const wrapper = mount(InboundLocationPicker, { props: { factoryId: '1', checking: false }, global: {
      stubs: { 'scroll-view': { template: '<div><slot /></div>' } }
    } });
    try {
      await flushPromises(); expect(list).toHaveBeenCalledWith({ factoryId: '1' }, 1);
      wrapper.getComponent(ScanInput).vm.$emit('update:modelValue', ' 东侧 '); await flushPromises();
      await wrapper.get('.search button').trigger('tap'); await flushPromises();
      wrapper.getComponent(ScanInput).vm.$emit('update:modelValue','未应用'); await flushPromises();
      await wrapper.findAll('button').find(el => el.text() === '加载更多')!.trigger('tap'); await flushPromises();
      expect(list).toHaveBeenLastCalledWith({ keyword: '东侧', factoryId: '1' }, 2);
      wrapper.getComponent(ScanInput).vm.$emit('scan', 'UNKNOWN'); await flushPromises();
      expect(wrapper.emitted('choose')).toBeUndefined(); expect(wrapper.get('[role="alert"]').text()).toContain('未找到');
      wrapper.getComponent(ScanInput).vm.$emit('scan', '4F-01'); await flushPromises();
      expect(list).toHaveBeenLastCalledWith({ locationCode: '4F-01', factoryId: '1' }, 1);
      expect(wrapper.emitted('choose')).toEqual([['4F-01']]);
    } finally { wrapper.unmount(); }
  });
});
