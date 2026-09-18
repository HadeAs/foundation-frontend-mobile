import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import LoginPage from '../../pages/login/index.vue';
import OperationNotice from '../../components/OperationNotice.vue';
import { login } from '../auth';

const hooks = vi.hoisted(() => ({ hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({ onHide: (callback: () => void) => hooks.hide.push(callback) }));
vi.mock('../auth', () => ({
  API_ENVIRONMENTS: [{ id: 'test', label: '测试环境', baseUrl: 'http://test.local' }],
  login: vi.fn()
}));
vi.mock('../appUpdate', () => ({ startAppUpdatePolling: vi.fn() }));
let wrapper: VueWrapper;
const toast = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); hooks.hide.length = 0; toast.mockClear(); vi.mocked(login).mockReset();
  vi.stubGlobal('uni', { getStorageSync: () => '', showToast: toast, setStorageSync: vi.fn(), reLaunch: vi.fn() });
  wrapper = mount(LoginPage, { global: { stubs: { picker: { template: '<div><slot /></div>' } } } });
});
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('login failure notice', () => {
  it('uses the standard error notice for the full backend reason and hides after 6.5 seconds', async () => {
    const reason = 'account is locked until 2026-09-18T15:34:42 (Trace ID: test-trace)';
    vi.mocked(login).mockResolvedValueOnce({ ok: false, message: reason });
    await wrapper.get('.login-button').trigger('tap'); await flushPromises();
    expect(wrapper.getComponent(OperationNotice).props()).toMatchObject({ text: reason, error: true });
    expect(wrapper.get('[role="alert"]').text()).toBe(reason);
    expect(toast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6499); expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it('clears the old notice on retry, restarts its timer and cleans up on leave', async () => {
    vi.mocked(login).mockResolvedValue({ ok: false, message: '请输入账号和密码' });
    await wrapper.get('.login-button').trigger('tap'); await flushPromises();
    await vi.advanceTimersByTimeAsync(5000);
    let finish!: (value: { ok: boolean; message: string }) => void;
    vi.mocked(login).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await wrapper.get('.login-button').trigger('tap');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    finish({ ok: false, message: '无法连接服务' }); await flushPromises();
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.get('[role="alert"]').text()).toBe('无法连接服务');
    hooks.hide.forEach((hide) => hide()); await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
