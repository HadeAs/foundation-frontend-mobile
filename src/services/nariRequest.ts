import { getAccessToken, getCurrentApiBaseUrl } from './auth';
import { apiRequest } from './apiTransport';

const prefix = '/api/v1/business/nari-logistics';

export class ApiRequestError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); }
}

export async function request<T>(path: string, method: 'GET' | 'POST', data: Record<string, unknown>): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('登录已失效，请重新登录');
  // H5 follows the existing same-origin /api proxy; App uses the login environment.
  const baseUrl = process.env.UNI_PLATFORM === 'h5' ? '' : getCurrentApiBaseUrl();
  return new Promise((resolve, reject) => {
    apiRequest({
      url: `${baseUrl}${prefix}${path}`,
      method, data,
      header: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
      success(response) {
        const body = response.data as { code?: number; message?: string; data?: T } | null;
        if (response.statusCode >= 200 && response.statusCode < 300 && body?.code === 0 && body.data != null) {
          resolve(body.data);
        } else {
          reject(new ApiRequestError(body?.message || (response.statusCode === 401 ? '登录已失效，请重新登录' : '请求失败，请稍后重试'), response.statusCode));
        }
      },
      fail: () => reject(new Error('网络异常，未能确认处理结果，请核实后重试'))
    });
  });
}

export function requestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // App WebViews may not expose Web Crypto; this ID is for request correlation, not authentication.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const value = Math.floor(Math.random() * 16);
    return (c === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
