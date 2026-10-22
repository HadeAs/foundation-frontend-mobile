import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import LoginPage from '../../pages/login/index.vue';
import { login } from '../auth';
import { DEFAULT_API_BASE_URL, ENVIRONMENT_STORAGE_KEY } from '../environment';

vi.mock('@dcloudio/uni-app', () => ({ onHide: vi.fn() }));
vi.mock('../auth', () => ({ login: vi.fn() }));
vi.mock('../appUpdate', () => ({ startAppUpdatePolling: vi.fn() }));
const storage = new Map<string, unknown>();
let wrapper: VueWrapper;
beforeEach(() => {
  vi.useFakeTimers(); storage.clear(); vi.mocked(login).mockReset();
  vi.mocked(login).mockResolvedValue({ ok: false, message: '后端拒绝' });
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), reLaunch: vi.fn() });
  wrapper = mount(LoginPage);
});
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function toggle(enabled: boolean) {
  await wrapper.get('checkbox-group').trigger('change', { detail: { value: enabled ? ['custom'] : [] } });
}

describe('login custom environment', () => {
  it('removes presets and logs into the fixed default when unchecked', async () => {
    expect(wrapper.find('picker').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('生产环境');
    await wrapper.get('.login-button').trigger('tap'); await flushPromises();
    expect(login).toHaveBeenCalledWith('', '', DEFAULT_API_BASE_URL);
  });

  it('configures, caches and restores the custom address and checkbox', async () => {
    await toggle(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await wrapper.get('.address-input').setValue('192.168.0.172:18081');
    await wrapper.get('.address-save').trigger('tap');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(storage.get(ENVIRONMENT_STORAGE_KEY)).toEqual({ enabled: true, address: 'http://192.168.0.172:18081' });
    wrapper.unmount(); wrapper = mount(LoginPage);
    expect(wrapper.get('checkbox').attributes('checked')).toBeDefined();
    await wrapper.get('.login-button').trigger('tap'); await flushPromises();
    expect(login).toHaveBeenLastCalledWith('', '', 'http://192.168.0.172:18081');
    await toggle(false);
    await wrapper.get('.login-button').trigger('tap'); await flushPromises();
    expect(login).toHaveBeenLastCalledWith('', '', DEFAULT_API_BASE_URL);
    expect(storage.get(ENVIRONMENT_STORAGE_KEY)).toEqual({ enabled: false, address: 'http://192.168.0.172:18081' });
  });

  it('cancels an unsaved edit and blocks enabled-but-empty custom login', async () => {
    await toggle(true);
    await wrapper.get('.address-input').setValue('192.168.0.172:18081');
    await wrapper.get('.address-actions button').trigger('tap');
    await wrapper.get('.login-button').trigger('tap'); await flushPromises();
    expect(login).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain('请先配置自定义环境地址');
    expect(storage.get(ENVIRONMENT_STORAGE_KEY)).toEqual({ enabled: true, address: '' });
  });

  it('does not overwrite a saved address with invalid input or a cancelled edit', async () => {
    storage.set(ENVIRONMENT_STORAGE_KEY, { enabled: true, address: 'http://192.168.0.172:18081' });
    wrapper.unmount(); wrapper = mount(LoginPage);
    await wrapper.get('.environment-settings-button').trigger('tap');
    await wrapper.get('.address-input').setValue('999.1.1.1');
    await wrapper.get('.address-save').trigger('tap');
    expect(wrapper.get('.address-error').text()).toContain('请输入有效的 IP 地址');
    await wrapper.get('.address-actions button').trigger('tap');
    await wrapper.get('.login-button').trigger('tap'); await flushPromises();
    expect(login).toHaveBeenLastCalledWith('', '', 'http://192.168.0.172:18081');
  });

  it('locks environment editing during login', async () => {
    let finish!: (result: { ok: boolean }) => void;
    vi.mocked(login).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await wrapper.get('.login-button').trigger('tap');
    expect(wrapper.get('.environment-settings-button').attributes('disabled')).toBeDefined();
    await toggle(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(storage.has(ENVIRONMENT_STORAGE_KEY)).toBe(false);
    finish({ ok: false }); await flushPromises();
  });
});
