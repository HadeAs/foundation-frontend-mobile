interface ApiResult<T> {
  code?: number;
  message?: string;
  data?: T;
  traceId?: string;
}

interface ApiRole {
  roleCode?: string;
  roleName?: string;
}

interface LoginResponse {
  token?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  userId?: number;
  username?: string;
  realName?: string;
  roles?: ApiRole[];
}

interface UserDetailResponse {
  department?: {
    deptName?: string;
  } | null;
}

interface StoredSession {
  token: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  baseUrl: string;
  user: UserProfile;
}

export interface UserProfile {
  userId: number;
  name: string;
  role: string;
  account: string;
  department: string;
}

export interface LoginResult {
  ok: boolean;
  message?: string;
}

export const API_ENVIRONMENTS = [
  { id: 'test', label: '测试环境', baseUrl: 'http://192.168.0.171:18080' },
  { id: 'production', label: '生产环境', baseUrl: '' }
] as const;

export const AUTH_SESSION_STORAGE_KEY = 'foundation.mobile.auth-session';

function readStoredSession(): StoredSession | null {
  if (typeof uni === 'undefined') {
    return null;
  }

  const stored = uni.getStorageSync(AUTH_SESSION_STORAGE_KEY) as Partial<StoredSession> | '';
  return stored && typeof stored.token === 'string' && stored.token && stored.user
    ? stored as StoredSession
    : null;
}

function clearStoredSession(): void {
  if (typeof uni !== 'undefined') {
    uni.removeStorageSync(AUTH_SESSION_STORAGE_KEY);
  }
}

function requestLogin(baseUrl: string, username: string, password: string) {
  return new Promise<UniNamespace.RequestSuccessCallbackResult>((resolve, reject) => {
    uni.request({
      url: `${baseUrl}/api/v1/auth/login`,
      method: 'POST',
      data: { username, password },
      header: { 'Content-Type': 'application/json' },
      timeout: 15_000,
      success: resolve,
      fail: reject
    });
  });
}

function requestUserDetail(baseUrl: string, userId: number, token: string) {
  return new Promise<UniNamespace.RequestSuccessCallbackResult>((resolve, reject) => {
    uni.request({
      url: `${baseUrl}/api/v1/system/users/${userId}`,
      method: 'GET',
      header: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
      success: resolve,
      fail: reject
    });
  });
}

function getRequestBaseUrl(baseUrl: string): string {
  return process.env.UNI_PLATFORM === 'h5' ? '' : baseUrl;
}

async function getDepartmentName(baseUrl: string, userId: number, token: string): Promise<string> {
  if (!userId) {
    return '未分配部门';
  }

  try {
    const response = await requestUserDetail(baseUrl, userId, token);
    const body = response.data as ApiResult<UserDetailResponse>;
    return body?.data?.department?.deptName || '未分配部门';
  } catch {
    return '未分配部门';
  }
}

function formatApiMessage(body: ApiResult<unknown> | undefined, fallback: string): string {
  if (!body?.message) {
    return fallback;
  }
  return body.traceId ? `${body.message}（Trace ID: ${body.traceId}）` : body.message;
}

export async function login(
  account: string,
  password: string,
  baseUrl: string = API_ENVIRONMENTS[0].baseUrl
): Promise<LoginResult> {
  const username = account.trim();
  if (!username || !password) {
    return { ok: false, message: '请输入账号和密码' };
  }
  if (!baseUrl) {
    return { ok: false, message: '当前环境地址未配置' };
  }

  const requestBaseUrl = getRequestBaseUrl(baseUrl);
  try {
    const response = await requestLogin(requestBaseUrl, username, password);
    const body = response.data as ApiResult<LoginResponse>;
    const data = body?.data;

    if (response.statusCode < 200 || response.statusCode >= 300 || !data?.token) {
      clearStoredSession();
      return {
        ok: false,
        message: formatApiMessage(body, response.statusCode === 401 ? '账号或密码错误' : '登录失败，请稍后重试')
      };
    }

    const user = {
      userId: data.userId ?? 0,
      name: data.realName || data.username || username,
      role: data.roles?.map((role) => role.roleName || role.roleCode).filter(Boolean).join('、') || '未分配角色',
      account: data.username || username,
      department: await getDepartmentName(requestBaseUrl, data.userId ?? 0, data.token)
    };
    const session: StoredSession = {
      token: data.token,
      expiresAt: data.expiresAt,
      refreshExpiresAt: data.refreshExpiresAt,
      baseUrl: requestBaseUrl,
      user
    };
    uni.setStorageSync(AUTH_SESSION_STORAGE_KEY, session);
    return { ok: true };
  } catch {
    clearStoredSession();
    return { ok: false, message: '无法连接服务，请检查当前环境地址和网络' };
  }
}

export async function logout(): Promise<void> {
  const session = readStoredSession();
  clearStoredSession();
  if (!session) {
    return;
  }

  await new Promise<void>((resolve) => {
    uni.request({
      url: `${session.baseUrl}/api/v1/auth/logout`,
      method: 'POST',
      header: { Authorization: `Bearer ${session.token}` },
      timeout: 5_000,
      complete: () => resolve()
    });
  });
}

export function getCurrentUser(): UserProfile | null {
  const user = readStoredSession()?.user;
  return user ? { ...user, department: user.department || '未分配部门' } : null;
}

export function getAccessToken(): string {
  return readStoredSession()?.token ?? '';
}

export function getCurrentApiBaseUrl(): string {
  return readStoredSession()?.baseUrl || API_ENVIRONMENTS[0].baseUrl;
}
