import { AUTH_SESSION_STORAGE_KEY, API_ENVIRONMENTS } from '../../auth';

// Business tests seed an authenticated session; only auth tests exercise login/logout.
export function seedTestSession(account = 'admin'): void {
  uni.setStorageSync(AUTH_SESSION_STORAGE_KEY, {
    token: 'test-session-token', baseUrl: API_ENVIRONMENTS[0].baseUrl,
    user: { userId: 1, name: 'System Administrator', role: '系统管理员', account, department: '系统管理部' }
  });
}
