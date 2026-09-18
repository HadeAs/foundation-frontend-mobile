import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENVIRONMENTS, AUTH_SESSION_STORAGE_KEY, getAccessToken, getCurrentUser, login, logout } from '../auth';
import { panelPackingApi } from '../panelPacking';
import { apiRequest } from '../apiTransport';

const storage = new Map<string, unknown>();
const requestMock = vi.fn();
const requestTask: UniNamespace.RequestTask = {
  abort() {},
  onHeadersReceived() {},
  offHeadersReceived() {}
};

function respondWith(statusCode: number, data: Record<string, unknown>) {
  requestMock.mockImplementationOnce((options: UniNamespace.RequestOptions) => {
    options.success?.({ statusCode, data, header: {}, cookies: [] });
    return requestTask;
  });
}

describe('auth service', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_MODE', 'real');
    storage.clear();
    requestMock.mockReset();
    vi.stubGlobal('uni', {
      getStorageSync: (key: string) => storage.get(key) ?? '',
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      request: requestMock
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses real login/logout while profile, business and update requests remain mock by default', async () => {
    vi.stubEnv('VITE_API_MODE', '');
    storage.set(`${AUTH_SESSION_STORAGE_KEY}.mock`, { token: 'old-mock-token', user: { name: '旧模拟用户' } });
    expect(getAccessToken()).toBe('');
    respondWith(200, { code: 0, data: { token: 'signed-token', userId: 7, username: 'operator01', realName: '张三' } });
    expect(await login('operator01', 'secret')).toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ method: 'POST', url: `${API_ENVIRONMENTS[0].baseUrl}/api/v1/auth/login` });
    expect(getAccessToken()).toBe('signed-token');
    expect(getCurrentUser()).toMatchObject({ name: '张三', account: 'operator01', department: '系统管理部' });
    expect((await panelPackingApi.getBox('BOX-1')).box.containerCode).toBe('BOX-1');
    const update = await new Promise<UniNamespace.RequestSuccessCallbackResult>((resolve) => {
      apiRequest({ url: '/api/v1/system/configs/value/foundation.app.latest-version', success: resolve });
    });
    expect(update.data).toMatchObject({ data: '' });
    expect(requestMock).toHaveBeenCalledTimes(1);
    requestMock.mockImplementationOnce((options: UniNamespace.RequestOptions) => {
      options.fail?.({ errMsg: 'request:fail timeout' });
      options.complete?.({ errMsg: 'request:fail timeout' });
      return requestTask;
    });
    await logout();
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[1][0]).toMatchObject({ method: 'POST', url: `${API_ENVIRONMENTS[0].baseUrl}/api/v1/auth/logout`, header: { Authorization: 'Bearer signed-token' } });
    expect(getAccessToken()).toBe('');
    expect(storage.has(AUTH_SESSION_STORAGE_KEY)).toBe(false);
    await logout(); expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('never falls back to mock login after a real rejection in mock business mode', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock');
    respondWith(401, { message: '账号或密码错误' });
    expect(await login('admin', 'demo')).toEqual({ ok: false, message: '账号或密码错误' });
    expect(getAccessToken()).toBe('');
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('logs in through the documented API and stores the signed session', async () => {
    respondWith(200, {
      code: 0,
      data: {
        token: 'signed-token',
        expiresAt: '2026-08-31T18:00:00+08:00',
        userId: 7,
        username: 'operator01',
        realName: '张三',
        roles: [{ roleCode: 'operator', roleName: '操作员' }]
      }
    });
    respondWith(200, {
      data: {
        department: { deptName: '仓储部' }
      }
    });

    const result = await login(' operator01 ', 'secret');

    expect(result).toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://192.168.0.171:18080/api/v1/auth/login',
      method: 'POST',
      data: { username: 'operator01', password: 'secret' }
    }));
    expect(getAccessToken()).toBe('signed-token');
    expect(getCurrentUser()).toEqual({
      userId: 7,
      name: '张三',
      role: '操作员',
      account: 'operator01',
      department: '仓储部'
    });
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://192.168.0.171:18080/api/v1/system/users/7',
      method: 'GET',
      header: { Authorization: 'Bearer signed-token' }
    }));
  });

  it('returns the backend error and clears stale session state', async () => {
    respondWith(401, { message: '账号已停用', traceId: 'trace-1' });

    const result = await login('disabled', 'secret');

    expect(result).toEqual({ ok: false, message: '账号已停用（Trace ID: trace-1）' });
    expect(getCurrentUser()).toBeNull();
  });

  it('uses the same-origin proxy for H5 requests', async () => {
    vi.stubEnv('UNI_PLATFORM', 'h5');
    respondWith(401, { message: '用户名或密码错误' });

    await login('operator01', 'secret');

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/v1/auth/login'
    }));
  });

  it.each(['real', 'mock'])('does not send a request when the production address is empty (%s)', async (mode) => {
    vi.stubEnv('VITE_API_MODE', mode);
    const production = API_ENVIRONMENTS.find(({ id }) => id === 'production');

    await expect(login('operator01', 'secret', production?.baseUrl)).resolves.toEqual({
      ok: false,
      message: '当前环境地址未配置'
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports network failures', async () => {
    requestMock.mockImplementationOnce((options: UniNamespace.RequestOptions) => {
      options.fail?.({ errMsg: 'request:fail' });
      return requestTask;
    });

    await expect(login('operator01', 'secret')).resolves.toEqual({
      ok: false,
      message: '无法连接服务，请检查当前环境地址和网络'
    });
  });

  it('notifies the backend on logout and always clears the local session', async () => {
    respondWith(200, {
      data: {
        token: 'signed-token',
        userId: 7,
        username: 'operator01',
        realName: '张三'
      }
    });
    respondWith(200, { data: { department: null } });
    await login('operator01', 'secret');
    requestMock.mockReset();
    requestMock.mockImplementationOnce((options: UniNamespace.RequestOptions) => {
      options.complete?.({ errMsg: 'request:ok' });
      return requestTask;
    });

    await logout();

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://192.168.0.171:18080/api/v1/auth/logout',
      method: 'POST',
      header: { Authorization: 'Bearer signed-token' }
    }));
    expect(getAccessToken()).toBe('');
  });
});
