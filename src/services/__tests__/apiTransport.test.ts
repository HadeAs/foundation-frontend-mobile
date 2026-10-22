import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiRequest } from '../apiTransport';
import { ApiRequestError, request } from '../nariRequest';
import { AUTH_SESSION_STORAGE_KEY } from '../auth';

const task = { abort: vi.fn(), onHeadersReceived: vi.fn(), offHeadersReceived: vi.fn() };
function setup(send: (options: UniNamespace.RequestOptions) => UniNamespace.RequestTask, authenticated = true) {
  const network = vi.fn(send);
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => authenticated && key === AUTH_SESSION_STORAGE_KEY
    ? { token: 'test-token', baseUrl: 'https://api.example.test', user: { account: 'operator' } } : '' });
  return network;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('real API transport', () => {
  it.each(['', 'mock', 'real'])('always forwards to uni.request regardless of obsolete mode %s', (mode) => {
    vi.stubEnv('VITE_API_MODE', mode);
    const network = setup(() => task);
    const success = vi.fn(); const fail = vi.fn(); const complete = vi.fn();
    const options: UniNamespace.RequestOptions = { url: '/api/v1/example', method: 'POST', data: { code: '中文/1' },
      header: { Authorization: 'Bearer test-token' }, timeout: 15000, success, fail, complete };
    const result = apiRequest(options);
    expect(network).toHaveBeenCalledOnce(); expect(network).toHaveBeenCalledWith(options);
    expect(result).toBe(task); result.abort(); expect(task.abort).toHaveBeenCalledOnce();
  });

  it.each(['h5', 'app'])('uses the documented base URL and bearer token on %s', async (platform) => {
    vi.stubEnv('UNI_PLATFORM', platform);
    const network = setup((options) => {
      options.success?.({ statusCode: 200, data: { code: 0, data: { records: [] } }, header: {}, cookies: [] });
      return task;
    });
    await expect(request('/traffic/areas', 'GET', { page: 1, size: 20 })).resolves.toEqual({ records: [] });
    expect(network).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.example.test/api/v1/business/nari-logistics/traffic/areas',
      method: 'GET', data: { page: 1, size: 20 }, header: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }
    }));
  });

  it.each([400, 401, 403, 404, 409, 500])('preserves HTTP %s and the backend reason without simulated fallback', async (statusCode) => {
    const network = setup((options) => {
      options.success?.({ statusCode, data: { code: 40000, message: '后端返回的失败原因', data: null }, header: {}, cookies: [] });
      return task;
    });
    await expect(request('/logistics/tasks', 'POST', {})).rejects.toMatchObject({ message: '后端返回的失败原因', statusCode });
    expect(network).toHaveBeenCalledOnce();
  });

  it('rejects a nonzero business code or missing success data', async () => {
    for (const data of [{ code: 40000, message: '业务拒绝', data: null }, { code: 0, data: null }, null]) {
      setup((options) => {
        // Exercise malformed JSON bodies even though uni's type excludes null.
        options.success?.({ statusCode: 200, data: data as UniNamespace.RequestSuccessCallbackResult['data'], header: {}, cookies: [] });
        return task;
      });
      await expect(request('/panels', 'GET', { panelCode: 'P1' })).rejects.toBeInstanceOf(ApiRequestError);
    }
  });

  it('does not retry or fabricate data after a network timeout', async () => {
    const network = setup((options) => { options.fail?.({ errMsg: 'request:fail timeout' }); return task; });
    await expect(request('/order-calls', 'POST', {})).rejects.toThrow('未能确认处理结果');
    expect(network).toHaveBeenCalledOnce();
  });

  it('blocks unauthenticated business requests', async () => {
    const network = setup(() => task, false);
    await expect(request('/panels', 'GET', { panelCode: 'P1' })).rejects.toThrow('登录已失效');
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps fixtures, mode switches and obsolete demo routes out of application source', () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.name === '__tests__' ? []
        : entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
    }
    const source = files(resolve('src')).filter((file) => /\.(ts|vue|json)$/.test(file))
      .map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/mockApi|isMockApi|VITE_API_MODE|resolveMockRequest|getMockSessionId|__tests__\/|pages\/inventory\/query|pages\/container\/management|pages\/warehouse\/tasks|pages\/warehouse\/task-detail/);
  });
});
