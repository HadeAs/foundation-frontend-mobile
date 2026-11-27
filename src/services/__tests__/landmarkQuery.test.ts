import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LandmarkPage from '../../pages/landmark-query/index.vue';
import { landmarkQueryApi, type Landmark } from '../landmarkQuery';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({
  onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn)
}));
beforeEach(() => { hooks.show.length = 0; hooks.hide.length = 0; });
afterEach(() => vi.restoreAllMocks());
const statuses = ['FREE', 'OCCUPIED', 'RESERVED', 'UNKNOWN'] as const;
const row = (n: number, floor = 1): Landmark => ({
  locationId: String(n), locationCode: 'LM-' + n, locationName: '接驳位', floorNumber: floor, status: statuses[(n - 1) % 4]
});
const page = (records: Landmark[], total = records.length, current = 1) =>
  ({ records, total, current, pages: Math.ceil(total / 20), size: 20 });
function open() {
  const wrapper = mount(LandmarkPage, { global: { stubs: {
    picker: { name: 'Picker', template: '<div><slot /></div>' }, 'scroll-view': { template: '<div><slot /></div>' }
  } } });
  hooks.show.forEach(fn => fn());
  return wrapper;
}

it('shows all four server states, retries the failed page and appends without duplicate rows', async () => {
  const first = Array.from({ length: 20 }, (_, i) => row(i + 1));
  const api = vi.spyOn(landmarkQueryApi, 'list').mockResolvedValueOnce(page(first, 22))
    .mockRejectedValueOnce(new Error('地标服务暂不可用'))
    .mockResolvedValueOnce(page([{ ...row(20), status: 'OCCUPIED' }, row(21)], 22, 2));
  const view = open();
  try {
    await flushPromises();
    expect(view.findAll('.row')).toHaveLength(20);
    expect(view.findAll('.tag').slice(0, 4).map(tag => tag.text())).toEqual(['空闲', '占用', '预占', '未知']);
    expect(view.get('.heading').text()).toContain('22 个');
    await view.get('.list').trigger('scrolltolower'); await flushPromises();
    expect(view.get('[role="alert"]').text()).toBe('地标服务暂不可用');
    expect(view.findAll('.row')).toHaveLength(20);
    await view.get('.list-state button').trigger('tap'); await flushPromises();
    expect(view.findAll('.row')).toHaveLength(21); expect(view.findAll('.tag')[19].text()).toBe('占用');
    await view.get('.list').trigger('scrolltolower');
    expect(api.mock.calls).toEqual([['ALL', undefined, 1], ['ALL', undefined, 2], ['ALL', undefined, 2]]);
  } finally { view.unmount(); }
});

it('restarts on filter changes and discards older responses including after hiding', async () => {
  let completeOld!: (result: ReturnType<typeof page>) => void;
  let completeRefresh!: (result: ReturnType<typeof page>) => void;
  const api = vi.spyOn(landmarkQueryApi, 'list').mockResolvedValueOnce(page([row(1)]))
    .mockReturnValueOnce(new Promise(resolve => { completeOld = resolve; }))
    .mockResolvedValueOnce(page([row(9, 4)]))
    .mockReturnValueOnce(new Promise(resolve => { completeRefresh = resolve; }))
    .mockResolvedValueOnce(page([]));
  const view = open();
  try {
    await flushPromises();
    const [scope, floor] = view.findAllComponents({ name: 'Picker' });
    scope.vm.$emit('change', { detail: { value: '1' } });
    floor.vm.$emit('change', { detail: { value: '4' } });
    await flushPromises();
    completeOld(page([row(2)])); await flushPromises();
    expect(view.findAll('.code').map(item => item.text())).toEqual(['LM-9']);
    expect(view.get('.meta').text()).toContain('4 楼');
    expect(api.mock.calls.slice(0, 3)).toEqual([['ALL', undefined, 1], ['STANDARD', undefined, 1], ['STANDARD', 4, 1]]);
    await view.get('.list').trigger('refresherrefresh'); hooks.hide.forEach(fn => fn());
    completeRefresh(page([row(3)])); await flushPromises();
    expect(view.findAll('.code').map(item => item.text())).toEqual(['LM-9']);
    hooks.show.forEach(fn => fn()); await flushPromises();
    expect(api).toHaveBeenLastCalledWith('STANDARD', 4, 1); expect(view.text()).toContain('暂无地标');
  } finally { view.unmount(); }
});
