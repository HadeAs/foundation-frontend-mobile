import { beforeEach, describe, expect, it } from 'vitest';
import { getCurrentUser, login, logout } from '../auth';

describe('auth service', () => {
  beforeEach(() => {
    logout();
  });

  it('logs in with the demo account', () => {
    const result = login('operator01', '123456');

    expect(result.ok).toBe(true);
    expect(getCurrentUser()).toEqual({
      name: '张三',
      employeeNo: 'OP-001',
      team: 'A 班 / 生产部',
      role: '操作员',
      account: 'operator01'
    });
  });

  it('rejects invalid credentials', () => {
    const result = login('bad', 'wrong');

    expect(result.ok).toBe(false);
    expect(result.message).toBe('账号或密码错误');
    expect(getCurrentUser()).toBeNull();
  });

  it('clears user state on logout', () => {
    login('operator01', '123456');
    logout();

    expect(getCurrentUser()).toBeNull();
  });
});
