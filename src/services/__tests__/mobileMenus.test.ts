import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { buildMobileMenuGroups, mobileMenusApi, type UserMenu, type MobileMenuGroup } from '../mobileMenus';
import { AUTH_SESSION_STORAGE_KEY } from '../auth';
import { DEFAULT_API_BASE_URL } from '../environment';
import { seedTestSession } from './helpers/authSession';
import HomePage from '../../pages/home/index.vue';
import pages from '../../pages.json';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: (fn: () => void) => hooks.show.push(fn), onHide: (fn: () => void) => hooks.hide.push(fn) }));
const storage = new Map<string, unknown>();
const network = vi.fn();
function rows(): UserMenu[] {
  const common = { terminalType: 'MOBILE', status: 1, visible: true };
  return [
    { ...common, menuId: 1, parentId: 0, menuName: 'PDA', menuType: 'DIR' },
    { ...common, menuId: 2, parentId: 1, menuName: '常规作业', menuType: 'DIR', sortNo: 10 },
    { ...common, menuId: 3, parentId: 2, menuName: '后台重命名装箱', menuType: 'MENU', path: '/pages/panel-packing/index', sortNo: 20 },
    { ...common, menuId: 4, parentId: 2, menuName: '板件解绑', menuType: 'MENU', path: '/pages/panel-unbinding/index', sortNo: 10 },
    { ...common, menuId: 5, parentId: 1, menuName: '库房作业', menuType: 'DIR', sortNo: 20 }
  ];
}
function respond(data: UniNamespace.RequestSuccessCallbackResult['data'], statusCode = 200) {
  network.mockImplementation((options: UniNamespace.RequestOptions) => options.success?.({ data, statusCode, header: {}, cookies: [] }));
}
beforeEach(() => {
  storage.clear(); network.mockReset(); hooks.show.length = hooks.hide.length = 0;
  vi.stubGlobal('uni', { request: network, navigateTo: vi.fn(), reLaunch: vi.fn(),
    getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('mobile menu authorization tree', () => {
  it('supports all 18 registered business pages without adding login, home or scan utilities', () => {
    const paths = pages.pages.map(page => '/' + page.path).filter(path => !['/pages/login/index', '/pages/home/index', '/pages/scan/index'].includes(path));
    const data = rows().slice(0, 2);
    paths.forEach((path, index) => data.push({ ...rows()[2], menuId: index + 10, path, sortNo: index }));
    const menus = buildMobileMenuGroups(data)[0].menus;
    expect(menus).toHaveLength(18); expect(menus.map(menu => menu.path)).toEqual(paths);
  });
  it('uses server names and order, hides empty groups and normalizes local paths with a safe fallback icon', () => {
    const data = rows(); data[2].path = 'pages/panel-packing/index'; data[2].icon = 'https://remote/icon'; data[3].icon = 'truck';
    const groups = buildMobileMenuGroups(data.reverse());
    expect(groups).toEqual([{ id: 2, name: '常规作业', menus: [
      { id: 4, name: '板件解绑', path: '/pages/panel-unbinding/index', icon: 'truck' },
      { id: 3, name: '后台重命名装箱', path: '/pages/panel-packing/index', icon: 'scan-line' }
    ] }]);
  });
  it.each([0, 1, 2])('filters disabled, hidden and non-mobile nodes at hierarchy level %s', index => {
    for (const patch of [{ status: 0 }, { visible: false }, { terminalType: 'PC' }, { terminalType: 'OT' }]) {
      const data = rows(); Object.assign(data[index], patch);
      const groups = buildMobileMenuGroups(data);
      expect(groups.flatMap(group => group.menus).map(menu => menu.id)).toEqual(index === 2 ? [4] : []);
    }
  });
  it('does not invent missing ancestors, infer administrator access, or expose menus outside PDA', () => {
    expect(buildMobileMenuGroups([])).toEqual([]);
    expect(buildMobileMenuGroups(rows().slice(1))).toEqual([]);
    const data = rows(); data[1].parentId = 999; expect(buildMobileMenuGroups(data)).toEqual([]);
    data[0].menuName = 'PC'; expect(buildMobileMenuGroups(data)).toEqual([]);
  });
  it.each(['/pages/login/index', '/pages/scan/index', '/unknown', 'https://example.com', '/pages/panel-packing/index?admin=true'])('does not navigate to unsupported paths: %s', path => {
    const data = rows(); data[2].path = path;
    expect(buildMobileMenuGroups(data)[0].menus.map(menu => menu.id)).toEqual([4]);
  });
  it('rejects duplicate ids and excludes external pages', () => {
    const data = rows(); data[2].externalUrl = 'https://example.com'; expect(buildMobileMenuGroups(data)[0].menus).toHaveLength(1);
    expect(() => buildMobileMenuGroups([...data, data[3]])).toThrow('菜单数据重复');
  });
});

describe('current-user menu request', () => {
  it.each(['app', 'h5'])('uses auth/me and the logged-in server/token on %s', async platform => {
    vi.stubEnv('UNI_PLATFORM', platform); respond({ code: 0, data: { menus: rows() } });
    expect(await mobileMenusApi.getGroups()).toHaveLength(1);
    expect(network).toHaveBeenCalledWith(expect.objectContaining({ url: `${platform === 'h5' ? '' : DEFAULT_API_BASE_URL}/api/v1/auth/me`,
      method: 'GET', header: { Authorization: 'Bearer test-session-token' } }));
    const session = storage.get(AUTH_SESSION_STORAGE_KEY) as Record<string, unknown>;
    storage.set(AUTH_SESSION_STORAGE_KEY, { ...session, baseUrl: 'http://127.0.0.1:18081' });
    await mobileMenusApi.getGroups(); expect(network.mock.lastCall?.[0].url).toBe('http://127.0.0.1:18081/api/v1/auth/me');
  });
  it('distinguishes authorized empty menus from failed or incomplete responses', async () => {
    respond({ code: 0, data: { menus: [] } }); expect(await mobileMenusApi.getGroups()).toEqual([]);
    respond({ code: 0, data: {} }); await expect(mobileMenusApi.getGroups()).rejects.toThrow('菜单数据不完整');
    respond({ code: 403, message: '无权访问' }, 403); await expect(mobileMenusApi.getGroups()).rejects.toThrow('无权访问');
    respond({ code: 500, message: '服务异常' }); await expect(mobileMenusApi.getGroups()).rejects.toThrow('服务异常');
    network.mockImplementation((options: UniNamespace.RequestOptions) => options.fail?.({ errMsg: 'timeout' }));
    await expect(mobileMenusApi.getGroups()).rejects.toThrow('无法加载菜单');
    storage.clear(); network.mockClear(); await expect(mobileMenusApi.getGroups()).rejects.toThrow('登录已失效'); expect(network).not.toHaveBeenCalled();
  });
});

describe('dynamic homepage', () => {
  const mountPage = () => mount(HomePage, { global: { stubs: { 'scroll-view': { template: '<div><slot /></div>' } } } });
  it('loads only granted entries, navigates by path after renaming, and refreshes permissions on return', async () => {
    const query = vi.spyOn(mobileMenusApi, 'getGroups').mockResolvedValueOnce(buildMobileMenuGroups(rows())).mockResolvedValueOnce([]);
    const wrapper = mountPage();
    try {
      expect(wrapper.findAll('.menu-entry')).toHaveLength(0);
      hooks.show.forEach(fn => fn()); await flushPromises();
      expect(wrapper.findAll('.menu-entry')).toHaveLength(2);
      await wrapper.findAll('.menu-entry')[1].trigger('tap'); expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/panel-packing/index' });
      hooks.hide.forEach(fn => fn()); hooks.show.forEach(fn => fn()); await flushPromises();
      expect(wrapper.findAll('.menu-entry')).toHaveLength(0); expect(wrapper.text()).toContain('暂无可用菜单'); expect(query).toHaveBeenCalledTimes(2);
      await wrapper.get('[aria-label="个人信息"]').trigger('tap'); expect(wrapper.text()).toContain('当前版本');
    } finally { wrapper.unmount(); }
  });
  it('shows loading and failure states, offers retry, and never falls back to all entries', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(mobileMenusApi, 'getGroups').mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValueOnce(buildMobileMenuGroups(rows()));
    const wrapper = mountPage();
    try {
      hooks.show.forEach(fn => fn()); await flushPromises(); expect(wrapper.text()).toContain('正在加载菜单');
      reject(new Error('服务不可用')); await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toBe('服务不可用'); expect(wrapper.findAll('.menu-entry')).toHaveLength(0);
      await wrapper.get('.menu-retry').trigger('tap'); await flushPromises(); expect(wrapper.findAll('.menu-entry')).toHaveLength(2);
    } finally { wrapper.unmount(); }
  });
  it('ignores old requests after hiding or switching session and server', async () => {
    let resolve!: (groups: MobileMenuGroup[]) => void;
    vi.spyOn(mobileMenusApi, 'getGroups').mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue([]);
    const wrapper = mountPage();
    try {
      hooks.show.forEach(fn => fn()); hooks.hide.forEach(fn => fn());
      const session = storage.get(AUTH_SESSION_STORAGE_KEY) as Record<string, unknown>;
      storage.set(AUTH_SESSION_STORAGE_KEY, { ...session, token: 'other-token', baseUrl: 'http://127.0.0.1:18081' });
      hooks.show.forEach(fn => fn()); await flushPromises(); resolve(buildMobileMenuGroups(rows())); await flushPromises();
      expect(wrapper.findAll('.menu-entry')).toHaveLength(0);
    } finally { wrapper.unmount(); }
  });
  it('blocks stale menu clicks after logout and returns to login', async () => {
    vi.spyOn(mobileMenusApi, 'getGroups').mockResolvedValue(buildMobileMenuGroups(rows()));
    const wrapper = mountPage();
    try {
      hooks.show.forEach(fn => fn()); await flushPromises(); storage.clear();
      await wrapper.get('.menu-entry').trigger('tap'); await flushPromises();
      expect(uni.navigateTo).not.toHaveBeenCalled(); expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' });
      expect(wrapper.findAll('.menu-entry')).toHaveLength(0);
    } finally { wrapper.unmount(); }
  });
});
