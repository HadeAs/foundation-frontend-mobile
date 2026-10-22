import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_API_BASE_URL, ENVIRONMENT_STORAGE_KEY, getRequestBaseUrl, normalizeEnvironmentAddress, readEnvironmentSettings, saveEnvironmentSettings } from '../environment';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('environment settings', () => {
  it.each([
    [' 192.168.0.171:18080/ ', DEFAULT_API_BASE_URL],
    ['192.168.0.172', 'http://192.168.0.172'],
    ['HTTPS://192.168.0.172:18443/', 'https://192.168.0.172:18443'],
    ['http://192.168.0.172:80', 'http://192.168.0.172'],
    ['https://192.168.0.172:443', 'https://192.168.0.172']
  ])('normalizes %s without changing the target', (input, expected) => {
    expect(normalizeEnvironmentAddress(input)).toBe(expected);
  });

  it.each(['', '999.1.1.1', '192.168.1', '192.168.0.1:0', '192.168.0.1:65536', '192.168.0.01',
    'http://user:pass@192.168.0.1', 'ftp://192.168.0.1', '//192.168.0.1', 'http://192.168.0.1/api',
    'http://192.168.0.1?key=x', 'http://192.168.0.1#part', 'http://192.168.0.1\\evil'])('rejects invalid or ambiguous origin %s', input => {
    expect(() => normalizeEnvironmentAddress(input)).toThrow('请输入有效的 IP 地址');
  });

  it('persists enablement and keeps the address when disabled', () => {
    const storage = new Map<string, unknown>();
    vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
    expect(readEnvironmentSettings()).toEqual({ enabled: false, address: '' });
    saveEnvironmentSettings({ enabled: true, address: DEFAULT_API_BASE_URL });
    expect(readEnvironmentSettings()).toEqual({ enabled: true, address: DEFAULT_API_BASE_URL });
    saveEnvironmentSettings({ enabled: false, address: DEFAULT_API_BASE_URL });
    expect(storage.get(ENVIRONMENT_STORAGE_KEY)).toEqual({ enabled: false, address: DEFAULT_API_BASE_URL });
  });

  it.each(['h5', 'app'])('only uses the proxy for the default H5 environment (%s)', platform => {
    vi.stubEnv('UNI_PLATFORM', platform);
    expect(getRequestBaseUrl(DEFAULT_API_BASE_URL)).toBe(platform === 'h5' ? '' : DEFAULT_API_BASE_URL);
    expect(getRequestBaseUrl('http://192.168.0.172:18081')).toBe('http://192.168.0.172:18081');
  });
});
