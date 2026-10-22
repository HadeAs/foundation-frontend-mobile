export const DEFAULT_API_BASE_URL = 'http://192.168.0.171:18080';
export const ENVIRONMENT_STORAGE_KEY = 'foundation.mobile.custom-environment';

export interface EnvironmentSettings { enabled: boolean; address: string }

// Accept an IPv4 origin only: no credentials, API path, query, or fragment.
// Avoid URL dependency because some App-Plus runtimes do not expose it.
export function normalizeEnvironmentAddress(value: string): string {
  const match = /^(https?:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\/?$/i.exec(value.trim());
  if (!match || match[2].split('.').some(part => Number(part) > 255 || (part.length > 1 && part.startsWith('0'))) ||
    (match[3] !== undefined && (Number(match[3]) < 1 || Number(match[3]) > 65535))) {
    throw new Error('请输入有效的 IP 地址，可带端口或 http://、https://，不要包含接口路径');
  }
  const protocol = (match[1] || 'http://').toLowerCase();
  const port = match[3] ? Number(match[3]) : undefined;
  const defaultPort = (protocol === 'http://' && port === 80) || (protocol === 'https://' && port === 443);
  return `${protocol}${match[2]}${port && !defaultPort ? `:${port}` : ''}`;
}

export function readEnvironmentSettings(): EnvironmentSettings {
  const stored = uni.getStorageSync(ENVIRONMENT_STORAGE_KEY) as Partial<EnvironmentSettings> | '';
  return { enabled: !!stored && stored.enabled === true, address: stored && typeof stored.address === 'string' ? stored.address : '' };
}

export function saveEnvironmentSettings(settings: EnvironmentSettings): void {
  uni.setStorageSync(ENVIRONMENT_STORAGE_KEY, settings);
}

export function getRequestBaseUrl(baseUrl: string): string {
  // Only the fixed default environment uses the existing H5 /api proxy.
  return process.env.UNI_PLATFORM === 'h5' && baseUrl === DEFAULT_API_BASE_URL ? '' : baseUrl;
}
