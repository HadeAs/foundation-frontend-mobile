import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { trafficApi as api, type TrafficArea, type TrafficPage } from '../traffic';
import { ApiRequestError } from '../nariRequest';
import { useTrafficControl } from '../../composables/useTrafficControl';
import TrafficPageView from '../../pages/traffic-control/index.vue';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const area = (index = 1): TrafficArea => ({ areaCode: 'TC-' + index, areaName: '交管区域' + index, version: 7, status: index % 2 ? 'FREE' : 'OCCUPIED' });
const snapshot = (current = 1, total = 25): TrafficPage => ({ current, total, size: 20, pages: Math.ceil(total / 20),
  records: Array.from({ length: Math.max(0, Math.min(20, total - (current - 1) * 20)) }, (_, index) => area((current - 1) * 20 + index + 1)) });
const result = (value: TrafficArea): TrafficArea => ({ ...value, version: value.version + 1, status: value.status === 'FREE' ? 'OCCUPIED' : 'FREE',
  lastOperatorName: '后端操作人', lastOperationTime: '2026-10-12T01:00:00Z' });
beforeEach(() => { hooks.show.length = hooks.hide.length = 0; vi.stubGlobal('uni', { navigateBack: vi.fn() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('traffic control 2026-10-12.1', () => {
  it('retains backend order, fixed state actions and optional history without adding permission rules', async () => {
    const data = snapshot(1, 2); Object.assign(data.records[0], { allowed: false }); data.records.reverse();
    const get = vi.spyOn(api, 'query').mockResolvedValue(data); const act = vi.spyOn(api, 'act'); const flow = useTrafficControl();
    await flow.query(); expect(get).toHaveBeenCalledWith({}, 1); expect(flow.items.value).toEqual(data.records);
    expect(flow.items.value[0].lastOperationTime).toBeUndefined(); flow.open(flow.items.value[0]); expect(flow.actionName.value).toBe('释放');
    flow.close(); flow.open(flow.items.value[1]); expect(flow.actionName.value).toBe('锁定'); expect(act).not.toHaveBeenCalled();
  });
  it.each(['code', 'name', 'version', 'status', 'operator', 'long operator', 'time', 'date only', 'null time'])('rejects a malformed region as a whole while preserving the prior page: %s', async field => {
    const data = snapshot(1, 2);
    if (field === 'code') data.records[1].areaCode = '';
    if (field === 'name') data.records[1].areaName = ' ';
    if (field === 'version') data.records[1].version = 2147483648;
    if (field === 'status') Object.assign(data.records[1], { status: 'LOCKED' });
    if (field === 'operator') data.records[1].lastOperatorName = '';
    if (field === 'long operator') data.records[1].lastOperatorName = '人'.repeat(129);
    if (field === 'time') data.records[1].lastOperationTime = '昨天';
    if (field === 'date only') data.records[1].lastOperationTime = '2026-10-12';
    if (field === 'null time') Object.assign(data.records[1], { lastOperationTime: null });
    vi.spyOn(api, 'query').mockResolvedValueOnce(snapshot(1, 2)).mockResolvedValueOnce(data);
    const flow = useTrafficControl(); await flow.query(); const before = [...flow.items.value]; await flow.refresh();
    expect(flow.items.value).toEqual(before); expect(flow.error.value).toContain('数据异常'); expect(flow.notice.value?.error).toBe(true);
  });
  it.each(['missing', 'current', 'size', 'total', 'pages', 'page maximum', 'too many', 'out of range', 'duplicate'])('keeps rows and cursor on malformed pagination, then retries that page: %s', async field => {
    const invalid = snapshot(2);
    if (field === 'current') invalid.current = 1;
    if (field === 'size') invalid.size = 200;
    if (field === 'total') invalid.total = Number.MAX_SAFE_INTEGER + 1;
    if (field === 'pages') invalid.pages = 3;
    if (field === 'page maximum') invalid.pages = 2147483648;
    if (field === 'too many') invalid.records = snapshot(1).records;
    if (field === 'out of range') { invalid.total = 20; invalid.pages = 1; }
    if (field === 'duplicate') invalid.records[1] = invalid.records[0];
    const get = vi.spyOn(api, 'query').mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(field === 'missing' ? null as unknown as TrafficPage : invalid).mockResolvedValueOnce(snapshot(2));
    const flow = useTrafficControl(); await flow.query(); await flow.loadMore(); expect(flow.items.value).toHaveLength(20);
    expect(flow.error.value).toContain('数据异常'); expect(flow.hasMore.value).toBe(true); await flow.retry();
    expect(get.mock.lastCall).toEqual([{}, 2]); expect(flow.items.value).toHaveLength(25); expect(flow.hasMore.value).toBe(false);
  });
  it('keeps existing rows on failed search, retains the applied search for retry and ignores superseded responses', async () => {
    let resolve!: (value: TrafficPage) => void;
    const get = vi.spyOn(api, 'query').mockResolvedValueOnce(snapshot(1, 2)).mockRejectedValueOnce(new Error('查询失败')).mockResolvedValueOnce(snapshot(1, 1));
    const flow = useTrafficControl(); await flow.query(); flow.keyword.value = ' 新条件 '; flow.status.value = 'FREE'; await flow.query();
    expect(flow.items.value).toHaveLength(2); expect(get.mock.lastCall).toEqual([{ keyword: '新条件', status: 'FREE' }, 1]);
    flow.keyword.value = '未查询草稿'; await flow.retry(); expect(get.mock.lastCall).toEqual([{ keyword: '新条件', status: 'FREE' }, 1]);
    get.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(snapshot(1, 2));
    const older = flow.query(); flow.keyword.value = ''; const newer = flow.query(); await newer;
    resolve(snapshot(1, 1)); await older; expect(flow.items.value).toHaveLength(2);
  });
  it.each([408, 503, undefined])('preserves the original action/UUID/version after an unknown %s result, including dialog dismissal', async status => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot(1, 2)); const act = vi.spyOn(api, 'act').mockRejectedValue(status ? new ApiRequestError('结果未确认', status) : new Error('网络异常'));
    const flow = useTrafficControl(); await flow.query(); flow.open(flow.items.value[0]); await flow.confirm(); expect(act).toHaveBeenCalledOnce();
    expect(flow.selected.value).not.toBeNull(); expect(flow.items.value[0].status).toBe('FREE'); await flow.confirm(); expect(act.mock.calls[1]).toEqual(act.mock.calls[0]);
    flow.close(); flow.open(flow.items.value[0]); await flow.confirm(); expect(act.mock.calls[2]).toEqual(act.mock.calls[0]);
  });
  it.each([400, 409])('creates a fresh manually confirmed action after explicit rejection %s', async status => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot(1, 1)); const act = vi.spyOn(api, 'act').mockRejectedValue(new ApiRequestError('后端拒绝', status));
    const flow = useTrafficControl(); await flow.query(); flow.open(flow.items.value[0]); await flow.confirm(); await flow.confirm();
    expect(act.mock.calls[1][2].requestId).not.toBe(act.mock.calls[0][2].requestId); expect(flow.selected.value).not.toBeNull();
  });
  it.each(['code', 'version', 'old version', 'state', 'name', 'operator', 'time', 'date only', 'pending', 'primitive'])('does not apply an incomplete action snapshot or rotate the retry UUID: %s', async field => {
    vi.spyOn(api, 'query').mockResolvedValue(snapshot(1, 1)); const data = result(area());
    if (field === 'code') data.areaCode = 'OTHER';
    if (field === 'version') data.version = 2147483648;
    if (field === 'old version') data.version = 7;
    if (field === 'state') data.status = 'FREE';
    if (field === 'name') data.areaName = '';
    if (field === 'operator') data.lastOperatorName = ' ';
    if (field === 'time') data.lastOperationTime = '昨天';
    if (field === 'date only') data.lastOperationTime = '2026-10-12';
    if (field === 'pending') Object.assign(data, { resultType: 'PENDING' });
    const act = vi.spyOn(api, 'act').mockResolvedValue(field === 'primitive' ? 'wrong' as unknown as TrafficArea : data);
    const flow = useTrafficControl(); await flow.query(); flow.open(flow.items.value[0]); await flow.confirm();
    expect(flow.selected.value).not.toBeNull(); expect(flow.items.value[0]).toEqual(area()); expect(flow.notice.value?.message).toContain('操作结果数据异常');
    await flow.confirm(); expect(act.mock.calls[1]).toEqual(act.mock.calls[0]);
  });
  it('changes the intent when selecting another region or observing a new version/state, using only that region version', async () => {
    const get = vi.spyOn(api, 'query').mockResolvedValue(snapshot(1, 2)); const act = vi.spyOn(api, 'act').mockRejectedValue(new Error('网络异常'));
    const flow = useTrafficControl(); await flow.query(); flow.open(flow.items.value[0]); await flow.confirm(); const first = act.mock.lastCall!;
    flow.close(); flow.open(flow.items.value[1]); await flow.confirm(); expect(act.mock.lastCall?.slice(0, 2)).toEqual(['TC-2', 'release']);
    expect(act.mock.lastCall?.[2].requestId).not.toBe(first[2].requestId); flow.close();
    get.mockResolvedValue(snapshot(1, 1)); await flow.refresh(); flow.open(flow.items.value[0]); await flow.confirm(); const old = act.mock.lastCall!;
    flow.close(); const changed = snapshot(1, 1); changed.records[0] = result(area()); get.mockResolvedValue(changed); await flow.refresh();
    flow.open(flow.items.value[0]); await flow.confirm(); expect(act.mock.lastCall?.slice(0, 2)).toEqual(['TC-1', 'release']);
    expect(act.mock.lastCall?.[2].version).toBe(8); expect(act.mock.lastCall?.[2].requestId).not.toBe(old[2].requestId);
  });
  it('updates successful lock/release from the server, including optional history, and refreshes filtered page one without repeating the write', async () => {
    const get = vi.spyOn(api, 'query').mockResolvedValueOnce(snapshot(1, 2)).mockResolvedValueOnce({ ...snapshot(1, 1), records: [area(3)] });
    const act = vi.spyOn(api, 'act').mockResolvedValueOnce({ ...result(area()), lastOperatorName: undefined, lastOperationTime: undefined }).mockResolvedValueOnce(result(result(area())));
    const flow = useTrafficControl(); flow.status.value = 'FREE'; await flow.query(); flow.open(flow.items.value[0]); await flow.confirm();
    expect(flow.items.value.map(item => item.areaCode)).toEqual(['TC-3']); expect(flow.selected.value).toBeNull(); expect(get.mock.lastCall).toEqual([{ status: 'FREE' }, 1]);
    expect(act).toHaveBeenCalledOnce(); flow.status.value = ''; get.mockResolvedValue({ ...snapshot(1, 1), records: [result(area())] }); await flow.query();
    flow.open(flow.items.value[0]); await flow.confirm(); expect(flow.items.value[0]).toEqual(result(result(area()))); expect(flow.notice.value?.message).toBe('释放成功');
  });
  it('blocks background requests in a confirmation, prevents duplicates and does not revive hidden reads or writes', async () => {
    const get = vi.spyOn(api, 'query').mockResolvedValue(snapshot(1, 2)); const flow = useTrafficControl(); await flow.query(); flow.open(flow.items.value[0]);
    await flow.query(); await flow.refresh(); await flow.loadMore(); await flow.retry(); expect(get).toHaveBeenCalledOnce();
    let resolve!: (value: TrafficArea) => void; const act = vi.spyOn(api, 'act').mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = flow.confirm(); await flow.confirm(); flow.close(); expect(flow.selected.value).not.toBeNull(); expect(act).toHaveBeenCalledOnce();
    flow.dispose(); await flow.query(); await flow.refresh(); await flow.loadMore(); await flow.retry(); flow.open(area()); await flow.confirm(); expect(get).toHaveBeenCalledOnce();
    flow.resume(); await flow.query(); resolve(result(area())); await pending;
    expect(flow.items.value[0]).toEqual(area()); expect(flow.notice.value).toBeNull(); expect(flow.selected.value).toBeNull(); expect(act).toHaveBeenCalledOnce();
    let resolveQuery!: (value: TrafficPage) => void; get.mockReturnValueOnce(new Promise(done => { resolveQuery = done; })); const query = flow.refresh();
    flow.dispose(); flow.resume(); resolveQuery(snapshot(1, 1)); await query; expect(flow.items.value).toHaveLength(2); expect(flow.loading.value).toBe(false);
  });
  it('renders missing history as placeholders, fixed state buttons and blocks hidden events until a fresh visible query', async () => {
    const get = vi.spyOn(api, 'query').mockResolvedValue(snapshot(1, 2)); const wrapper = mount(TrafficPageView, {
      global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' }, picker: { name: 'TestPicker', template: '<div><slot /></div>' } } }
    });
    hooks.show.forEach(fn => fn()); await flushPromises(); expect(wrapper.get('.metadata').text()).toBe('最后操作人—操作时间—');
    expect(wrapper.findAll('.small').map(button => button.text())).toEqual(['锁定', '释放']); await wrapper.findAll('.small')[0].trigger('tap');
    await wrapper.get('.nav-back').trigger('tap'); expect(uni.navigateBack).not.toHaveBeenCalled();
    expect(wrapper.get('.keyword-row input').attributes('disabled')).toBeDefined();
    hooks.hide.forEach(fn => fn()); await flushPromises(); await wrapper.get('.keyword-row button').trigger('tap');
    wrapper.findComponent({ name: 'TestPicker' }).vm.$emit('change', { detail: { value: 2 } }); await wrapper.get('.list-status').trigger('scrolltolower');
    await flushPromises(); expect(get).toHaveBeenCalledOnce(); hooks.show.forEach(fn => fn()); await flushPromises();
    expect(get).toHaveBeenCalledTimes(2); expect(get.mock.lastCall).toEqual([{}, 1]); expect(wrapper.find('.modal').exists()).toBe(false); wrapper.unmount();
  });
});
