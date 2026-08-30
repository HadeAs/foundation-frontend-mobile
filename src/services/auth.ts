export interface UserProfile {
  name: string;
  employeeNo: string;
  team: string;
  role: string;
  account: string;
}

export interface LoginResult {
  ok: boolean;
  message?: string;
}

const demoUser: UserProfile = {
  name: '张三',
  employeeNo: 'OP-001',
  team: 'A 班 / 生产部',
  role: '操作员',
  account: 'operator01'
};

let currentUser: UserProfile | null = null;

export function login(account: string, password: string): LoginResult {
  if (account.trim() === 'operator01' && password === '123456') {
    currentUser = { ...demoUser };
    return { ok: true };
  }

  currentUser = null;
  return { ok: false, message: '账号或密码错误' };
}

export function logout(): void {
  currentUser = null;
}

export function getCurrentUser(): UserProfile | null {
  return currentUser ? { ...currentUser } : null;
}
