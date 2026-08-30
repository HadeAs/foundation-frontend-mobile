# uni-app Industrial Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a simple uni-app Android-first industrial mobile app with login, a two-tab home screen, one scan menu, and a scan page that supports manual, camera, PDA broadcast, and keyboard-wedge scan inputs.

**Architecture:** Create a fresh uni-app Vue 3 + TypeScript project in the current workspace. Keep UI pages small and put reusable logic in composables/services: authentication mock state, static user profile data, and a scan adapter that normalizes all scan sources into one `ScanResult` stream. Use uni-app navigation for page transitions and a custom bottom tab area inside the home page.

**Tech Stack:** uni-app, Vue 3 Composition API, TypeScript, Vite, Vitest, `uni.scanCode`, App-Plus Android bridge stubs for PDA broadcast integration.

---

## File Structure

- Create `package.json`: npm scripts and dependencies for uni-app, Vue 3, TypeScript, Vite, Vitest.
- Create `index.html`: Vite entry document.
- Create `src/main.ts`: uni-app Vue bootstrap.
- Create `src/App.vue`: global app wrapper.
- Create `src/pages.json`: page registry for login, home, and scan pages.
- Create `src/manifest.json`: uni-app manifest placeholder for Android App.
- Create `src/uni.scss`: global style variables.
- Create `src/styles/theme.scss`: shared color, spacing, and layout styles.
- Create `src/types/scan.ts`: shared scan result types.
- Create `src/services/auth.ts`: local mock login/logout and user data.
- Create `src/services/scanAdapter.ts`: unified scan source adapter.
- Create `src/services/__tests__/auth.test.ts`: auth behavior tests.
- Create `src/services/__tests__/scanAdapter.test.ts`: scan normalization tests.
- Create `src/pages/login/Login.vue`: login page.
- Create `src/pages/home/Home.vue`: home page with top nav, bottom tabs, menu grid, and profile tab.
- Create `src/pages/scan/Scan.vue`: scan input/result page.
- Create `src/env.d.ts`: TypeScript declarations for Vue and uni globals.
- Create `vite.config.ts`: Vite + uni plugin + Vitest config.
- Create `tsconfig.json`: TypeScript config.
- Create `.gitignore`: ignore dependencies, build output, and `.superpowers/`.

## Task 1: Scaffold Project and Test Harness

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/env.d.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "uniapp-industrial-mobile",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:h5": "uni -p h5",
    "build:h5": "uni build -p h5",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@dcloudio/uni-app": "^3.0.0",
    "@dcloudio/uni-app-plus": "^3.0.0",
    "@dcloudio/uni-components": "^3.0.0",
    "@dcloudio/uni-h5": "^3.0.0",
    "@dcloudio/uni-mp-weixin": "^3.0.0",
    "@dcloudio/uni-ui": "^1.5.8",
    "vue": "^3.4.38"
  },
  "devDependencies": {
    "@dcloudio/types": "^3.4.14",
    "@dcloudio/vite-plugin-uni": "^3.0.0",
    "@vitejs/plugin-vue": "^5.1.2",
    "@vue/test-utils": "^2.4.6",
    "jsdom": "^24.1.1",
    "sass": "^1.77.8",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5",
    "vue-tsc": "^2.0.29"
  }
}
```

- [ ] **Step 2: Create Vite and TypeScript config**

Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

export default defineConfig({
  plugins: [uni()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts']
  }
});
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2020", "DOM"],
    "types": ["@dcloudio/types", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue"]
}
```

Create `src/env.d.ts`:

```ts
/// <reference types="@dcloudio/types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare const plus: any;
```

- [ ] **Step 3: Create app entry files**

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>工业移动端</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
unpackage/
.hbuilderx/
.DS_Store
.superpowers/
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: `node_modules/` and `package-lock.json` are created, npm exits with code 0.

## Task 2: Add App Shell, Pages Registry, and Shared Theme

**Files:**
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/pages.json`
- Create: `src/manifest.json`
- Create: `src/uni.scss`
- Create: `src/styles/theme.scss`

- [ ] **Step 1: Add uni-app bootstrap**

Create `src/main.ts`:

```ts
import { createSSRApp } from 'vue';
import App from './App.vue';
import './styles/theme.scss';

export function createApp() {
  const app = createSSRApp(App);
  return { app };
}
```

Create `src/App.vue`:

```vue
<script setup lang="ts"></script>

<template>
  <slot />
</template>

<style lang="scss">
page {
  min-height: 100%;
  background: #f3f6fb;
  color: #102a43;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
</style>
```

- [ ] **Step 2: Register pages**

Create `src/pages.json`:

```json
{
  "pages": [
    {
      "path": "pages/login/Login",
      "style": {
        "navigationStyle": "custom"
      }
    },
    {
      "path": "pages/home/Home",
      "style": {
        "navigationStyle": "custom"
      }
    },
    {
      "path": "pages/scan/Scan",
      "style": {
        "navigationStyle": "custom"
      }
    }
  ],
  "globalStyle": {
    "navigationStyle": "custom",
    "backgroundColor": "#f3f6fb"
  }
}
```

Create `src/manifest.json`:

```json
{
  "name": "工业移动端",
  "appid": "__UNI__INDUSTRIAL_MOBILE",
  "description": "简易版工业系统移动端",
  "versionName": "0.1.0",
  "versionCode": "100",
  "app-plus": {
    "usingComponents": true,
    "nvueCompiler": "uni-app",
    "compilerVersion": 3,
    "distribute": {
      "android": {
        "permissions": [
          "<uses-permission android:name=\"android.permission.CAMERA\"/>"
        ]
      }
    }
  }
}
```

- [ ] **Step 3: Add shared SCSS**

Create `src/uni.scss`:

```scss
$industrial-blue: #123f7a;
$industrial-blue-light: #d8e4f3;
$industrial-bg: #f3f6fb;
$industrial-text: #102a43;
```

Create `src/styles/theme.scss`:

```scss
* {
  box-sizing: border-box;
}

.app-page {
  min-height: 100vh;
  background: #f3f6fb;
  display: flex;
  flex-direction: column;
}

.app-nav {
  height: 96rpx;
  background: #123f7a;
  color: #ffffff;
  display: grid;
  grid-template-columns: 112rpx 1fr 128rpx;
  align-items: center;
  padding: 0 24rpx;
  gap: 12rpx;
}

.app-nav__title {
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
}

.app-nav__button {
  min-height: 60rpx;
  border-radius: 8rpx;
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-content {
  flex: 1;
  padding: 28rpx 24rpx;
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS or only dependency-related type warnings that must be fixed before continuing.

## Task 3: Implement Auth Mock with Tests

**Files:**
- Create: `src/services/auth.ts`
- Create: `src/services/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing auth tests**

Create `src/services/__tests__/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/services/__tests__/auth.test.ts
```

Expected: FAIL because `src/services/auth.ts` does not exist.

- [ ] **Step 3: Implement auth service**

Create `src/services/auth.ts`:

```ts
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
```

- [ ] **Step 4: Run auth tests**

Run:

```bash
npm run test -- src/services/__tests__/auth.test.ts
```

Expected: PASS.

## Task 4: Implement Scan Adapter with Tests

**Files:**
- Create: `src/types/scan.ts`
- Create: `src/services/scanAdapter.ts`
- Create: `src/services/__tests__/scanAdapter.test.ts`

- [ ] **Step 1: Write failing scan adapter tests**

Create `src/services/__tests__/scanAdapter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createScanResult, normalizeKeyboardBuffer, scanWithCamera } from '../scanAdapter';

describe('scan adapter', () => {
  it('creates a normalized manual scan result', () => {
    const result = createScanResult(' EQP-001 ', 'manual', 1783400000000);

    expect(result).toEqual({
      value: 'EQP-001',
      source: 'manual',
      scannedAt: 1783400000000
    });
  });

  it('extracts keyboard wedge input when Enter terminates the scan', () => {
    const result = normalizeKeyboardBuffer(['E', 'Q', 'P', '-', '0', '0', '1', 'Enter'], 1783400000000);

    expect(result).toEqual({
      value: 'EQP-001',
      source: 'keyboard',
      scannedAt: 1783400000000
    });
  });

  it('returns null for incomplete keyboard input', () => {
    const result = normalizeKeyboardBuffer(['E', 'Q', 'P'], 1783400000000);

    expect(result).toBeNull();
  });

  it('wraps uni.scanCode results as camera source', async () => {
    const scanCode = vi.fn().mockImplementation(({ success }) => {
      success({ result: 'CAM-001' });
    });

    const result = await scanWithCamera({ scanCode } as unknown as UniNamespace.Uni, 1783400000000);

    expect(result).toEqual({
      value: 'CAM-001',
      source: 'camera',
      raw: { result: 'CAM-001' },
      scannedAt: 1783400000000
    });
  });
});
```

- [ ] **Step 2: Run scan adapter test to verify it fails**

Run:

```bash
npm run test -- src/services/__tests__/scanAdapter.test.ts
```

Expected: FAIL because scan adapter files do not exist.

- [ ] **Step 3: Implement scan types**

Create `src/types/scan.ts`:

```ts
export type ScanSource = 'manual' | 'camera' | 'pda-broadcast' | 'keyboard';

export interface ScanResult {
  value: string;
  source: ScanSource;
  raw?: unknown;
  scannedAt: number;
}
```

- [ ] **Step 4: Implement scan adapter**

Create `src/services/scanAdapter.ts`:

```ts
import type { ScanResult, ScanSource } from '../types/scan';

interface UniLike {
  scanCode(options: {
    success: (res: { result?: string }) => void;
    fail: (error: unknown) => void;
  }): void;
}

export function createScanResult(
  value: string,
  source: ScanSource,
  scannedAt = Date.now(),
  raw?: unknown
): ScanResult {
  const result: ScanResult = {
    value: value.trim(),
    source,
    scannedAt
  };

  if (raw !== undefined) {
    result.raw = raw;
  }

  return result;
}

export function normalizeKeyboardBuffer(keys: string[], scannedAt = Date.now()): ScanResult | null {
  if (keys[keys.length - 1] !== 'Enter') {
    return null;
  }

  const value = keys.slice(0, -1).join('').trim();
  return value ? createScanResult(value, 'keyboard', scannedAt) : null;
}

export function scanWithCamera(uniApi: UniLike = uni, scannedAt = Date.now()): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    uniApi.scanCode({
      success: (res) => {
        const value = res.result ?? '';
        resolve(createScanResult(value, 'camera', scannedAt, res));
      },
      fail: reject
    });
  });
}

export function createPdaBroadcastResult(value: string, raw?: unknown, scannedAt = Date.now()): ScanResult {
  return createScanResult(value, 'pda-broadcast', scannedAt, raw);
}
```

- [ ] **Step 5: Run scan adapter tests**

Run:

```bash
npm run test -- src/services/__tests__/scanAdapter.test.ts
```

Expected: PASS.

## Task 5: Build Login Page

**Files:**
- Create: `src/pages/login/Login.vue`
- Modify: `src/services/auth.ts`

- [ ] **Step 1: Create login page**

Create `src/pages/login/Login.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { login } from '../../services/auth';

const account = ref('operator01');
const password = ref('123456');
const rememberAccount = ref(true);

function handleLogin() {
  const result = login(account.value, password.value);

  if (!result.ok) {
    uni.showToast({ title: result.message ?? '账号或密码错误', icon: 'none' });
    return;
  }

  uni.reLaunch({ url: '/pages/home/Home' });
}
</script>

<template>
  <view class="login-page">
    <view class="login-panel">
      <view class="login-logo">LOGO</view>
      <view class="login-title">工业移动端</view>

      <input v-model="account" class="login-input" placeholder="账号" />
      <input v-model="password" class="login-input" placeholder="密码" password />

      <view class="login-row" @tap="rememberAccount = !rememberAccount">
        <text>{{ rememberAccount ? '☑' : '☐' }} 记住账号</text>
        <text>本地模拟登录</text>
      </view>

      <button class="login-button" @tap="handleLogin">登录</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.login-page {
  min-height: 100vh;
  background: #f3f6fb;
  padding: 120rpx 48rpx 48rpx;
}

.login-panel {
  width: 100%;
}

.login-logo {
  width: 128rpx;
  height: 128rpx;
  border: 2rpx dashed #9fb0c4;
  border-radius: 16rpx;
  margin: 0 auto 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 24rpx;
}

.login-title {
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #102a43;
  margin-bottom: 64rpx;
}

.login-input {
  height: 88rpx;
  border: 2rpx solid #a9b8ca;
  border-radius: 8rpx;
  background: #ffffff;
  margin-bottom: 24rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: #102a43;
}

.login-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #64748b;
  font-size: 24rpx;
  margin: 4rpx 0 36rpx;
}

.login-button {
  height: 92rpx;
  border-radius: 8rpx;
  background: #123f7a;
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 700;
}
</style>
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 6: Build Home Page with Bottom Tabs and 3-Column Menu

**Files:**
- Create: `src/pages/home/Home.vue`

- [ ] **Step 1: Create home page**

Create `src/pages/home/Home.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { getCurrentUser, logout } from '../../services/auth';

type HomeTab = 'menu' | 'profile';

const activeTab = ref<HomeTab>('menu');
const user = computed(() => getCurrentUser() ?? {
  name: '张三',
  employeeNo: 'OP-001',
  team: 'A 班 / 生产部',
  role: '操作员',
  account: 'operator01'
});

const title = computed(() => activeTab.value === 'menu' ? '首页' : '个人信息');

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function handleLogout() {
  logout();
  uni.reLaunch({ url: '/pages/login/Login' });
}

function openScan() {
  uni.navigateTo({ url: '/pages/scan/Scan' });
}
</script>

<template>
  <view class="app-page">
    <view class="app-nav">
      <view class="app-nav__button" @tap="goBack">返回</view>
      <view class="app-nav__title">{{ title }}</view>
      <view class="app-nav__button" @tap="handleLogout">退出</view>
    </view>

    <view v-if="activeTab === 'menu'" class="app-content">
      <view class="menu-grid">
        <view class="menu-tile" @tap="openScan">
          <view class="menu-icon">扫</view>
          <view class="menu-name">扫描录入</view>
        </view>
      </view>
    </view>

    <view v-else class="app-content">
      <view class="profile-card">
        <view class="profile-head">
          <view class="profile-avatar">头像</view>
          <view>
            <view class="profile-name">{{ user.name }}</view>
            <view class="profile-role">一线操作员</view>
          </view>
        </view>

        <view class="info-row"><text>姓名</text><text>{{ user.name }}</text></view>
        <view class="info-row"><text>工号</text><text>{{ user.employeeNo }}</text></view>
        <view class="info-row"><text>班组/部门</text><text>{{ user.team }}</text></view>
        <view class="info-row"><text>角色</text><text>{{ user.role }}</text></view>
        <view class="info-row"><text>登录账号</text><text>{{ user.account }}</text></view>
      </view>

      <button class="logout-button" @tap="handleLogout">退出登录</button>
    </view>

    <view class="bottom-tabs">
      <view
        class="bottom-tab"
        :class="{ 'bottom-tab--active': activeTab === 'menu' }"
        @tap="activeTab = 'menu'"
      >
        功能菜单
      </view>
      <view
        class="bottom-tab"
        :class="{ 'bottom-tab--active': activeTab === 'profile' }"
        @tap="activeTab = 'profile'"
      >
        个人信息
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.menu-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28rpx 20rpx;
}

.menu-tile {
  min-width: 0;
  text-align: center;
}

.menu-icon {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 12rpx;
  background: #ffffff;
  border: 2rpx solid #a9b8ca;
  color: #123f7a;
  font-size: 42rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-name {
  margin-top: 12rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: #102a43;
}

.profile-card {
  border: 2rpx solid #a9b8ca;
  border-radius: 12rpx;
  background: #ffffff;
  overflow: hidden;
}

.profile-head {
  display: flex;
  align-items: center;
  gap: 24rpx;
  min-height: 144rpx;
  padding: 24rpx;
  border-bottom: 2rpx solid #e4e9f0;
}

.profile-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  border: 2rpx dashed #8ca5c4;
  color: #64748b;
  font-size: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-name {
  font-size: 34rpx;
  font-weight: 700;
  color: #102a43;
}

.profile-role {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #64748b;
}

.info-row {
  min-height: 76rpx;
  padding: 0 24rpx;
  border-bottom: 2rpx solid #edf2f7;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 26rpx;
  color: #64748b;
}

.info-row text:last-child {
  color: #102a43;
  font-weight: 700;
}

.logout-button {
  height: 88rpx;
  margin-top: 32rpx;
  border-radius: 8rpx;
  background: #ffffff;
  border: 2rpx solid #b7c4d4;
  color: #334e68;
  font-size: 30rpx;
  font-weight: 700;
}

.bottom-tabs {
  height: 116rpx;
  background: #ffffff;
  border-top: 2rpx solid #c7d2df;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.bottom-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: #64748b;
}

.bottom-tab--active {
  color: #123f7a;
  font-weight: 700;
  background: #eef4ff;
}
</style>
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 7: Build Scan Page

**Files:**
- Create: `src/pages/scan/Scan.vue`

- [ ] **Step 1: Create scan page**

Create `src/pages/scan/Scan.vue`:

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { createPdaBroadcastResult, createScanResult, normalizeKeyboardBuffer, scanWithCamera } from '../../services/scanAdapter';
import type { ScanResult } from '../../types/scan';

const scanValue = ref('');
const scanResult = ref<ScanResult | null>(null);
const keyboardBuffer = ref<string[]>([]);
let keyboardTimer: ReturnType<typeof setTimeout> | null = null;

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function clearScan() {
  scanValue.value = '';
  scanResult.value = null;
  keyboardBuffer.value = [];
}

function applyScanResult(result: ScanResult) {
  scanValue.value = result.value;
  scanResult.value = result;
}

function handleManualConfirm() {
  if (!scanValue.value.trim()) {
    return;
  }

  applyScanResult(createScanResult(scanValue.value, 'manual'));
}

async function handleCameraScan() {
  try {
    const result = await scanWithCamera();
    applyScanResult(result);
  } catch {
    uni.showToast({ title: '扫码失败', icon: 'none' });
  }
}

function handleKeyboardEvent(event: KeyboardEvent) {
  if (keyboardTimer) {
    clearTimeout(keyboardTimer);
  }

  keyboardBuffer.value.push(event.key);
  const result = normalizeKeyboardBuffer(keyboardBuffer.value);

  if (result) {
    applyScanResult(result);
    keyboardBuffer.value = [];
    return;
  }

  keyboardTimer = setTimeout(() => {
    keyboardBuffer.value = [];
  }, 300);
}

function handlePdaBroadcast(value: string, raw?: unknown) {
  if (!value.trim()) {
    return;
  }

  applyScanResult(createPdaBroadcastResult(value, raw));
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyboardEvent);
    window.addEventListener('pda-scan', ((event: CustomEvent<{ value: string }>) => {
      handlePdaBroadcast(event.detail.value, event.detail);
    }) as EventListener);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeyboardEvent);
  }

  if (keyboardTimer) {
    clearTimeout(keyboardTimer);
  }
});
</script>

<template>
  <view class="app-page">
    <view class="app-nav">
      <view class="app-nav__button" @tap="goBack">返回</view>
      <view class="app-nav__title">扫描录入</view>
      <view class="app-nav__button" @tap="clearScan">清空</view>
    </view>

    <view class="app-content">
      <view class="scan-input">
        <input
          v-model="scanValue"
          class="scan-field"
          placeholder="请输入或扫描编码"
          confirm-type="done"
          @confirm="handleManualConfirm"
          @blur="handleManualConfirm"
        />
        <view class="scan-button" @tap="handleCameraScan">扫码</view>
      </view>

      <view v-if="scanResult" class="result-card">
        <view class="result-label">扫描结果</view>
        <view class="result-value">{{ scanResult.value }}</view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.scan-input {
  height: 92rpx;
  border: 2rpx solid #8ca5c4;
  border-radius: 8rpx;
  background: #ffffff;
  display: grid;
  grid-template-columns: 1fr 96rpx;
  overflow: hidden;
}

.scan-field {
  min-width: 0;
  height: 92rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: #102a43;
}

.scan-button {
  border-left: 2rpx solid #b7c4d4;
  background: #eef4fb;
  color: #123f7a;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-card {
  min-height: 236rpx;
  margin-top: 28rpx;
  border: 2rpx solid #a9b8ca;
  border-radius: 12rpx;
  background: #ffffff;
  padding: 24rpx;
}

.result-label {
  color: #64748b;
  font-size: 26rpx;
}

.result-value {
  min-height: 104rpx;
  margin-top: 16rpx;
  border: 2rpx dashed #9fb0c4;
  border-radius: 8rpx;
  background: #f8fafc;
  color: #102a43;
  font-size: 32rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  word-break: break-all;
}
</style>
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Verify no-result state**

Run the H5 dev server:

```bash
npm run dev:h5 -- --host 127.0.0.1
```

Expected: scan page with no scan result does not show a result card or empty-state text.

## Task 8: Add Android PDA Broadcast Hook Notes and Final Verification

**Files:**
- Create: `docs/pda-scanner-integration.md`
- Modify: `docs/superpowers/specs/2026-07-07-uniapp-industrial-mobile-design.md`

- [ ] **Step 1: Document PDA integration contract**

Create `docs/pda-scanner-integration.md`:

```md
# PDA Scanner Integration

The scan page consumes normalized scan events through `src/services/scanAdapter.ts`.

Supported scan sources:

- `manual`: user types a value in the scan input and confirms.
- `camera`: `uni.scanCode` returns a result.
- `keyboard`: a scanner sends characters followed by Enter.
- `pda-broadcast`: an Android native bridge receives a PDA broadcast and forwards it to the page.

For Zebra DataWedge, configure the profile to send barcode data through Intent Broadcast. The native Android layer should extract the scanned string and emit a JS event equivalent to:

```js
window.dispatchEvent(new CustomEvent('pda-scan', {
  detail: {
    value: 'EQP-20260707-001',
    raw: {}
  }
}));
```

The page intentionally displays only the scan result value. Source and raw event data remain available in the normalized `ScanResult` object for diagnostics and later expansion.
```

- [ ] **Step 2: Run all checks**

Run:

```bash
npm run test
npm run typecheck
npm run build:h5
```

Expected:

- `npm run test`: PASS.
- `npm run typecheck`: PASS.
- `npm run build:h5`: PASS and creates `dist/` or `unpackage/` build output.

- [ ] **Step 3: Manual browser verification**

Run:

```bash
npm run dev:h5 -- --host 127.0.0.1
```

Verify:

- Login page appears first.
- Demo credentials `operator01` / `123456` enter the home page.
- Wrong credentials show toast text `账号或密码错误`.
- Home top nav has `返回`, title, and `退出`.
- Home bottom tabs switch between `功能菜单` and `个人信息`.
- Function menu shows a 3-column grid with one `扫描录入` tile.
- Scan page top nav has `返回`, title `扫描录入`, and `清空`.
- Scan page no-result state shows no result card and no empty text.
- Manual input plus confirm displays only the scanned value.
- `清空` clears input and result.

- [ ] **Step 4: Commit if repository exists**

If `git status --short` works, run:

```bash
git add .
git commit -m "feat: build industrial mobile scan prototype"
```

Expected: commit succeeds. If the workspace is not a git repository, skip commit and note that in the final report.

## Self-Review

Spec coverage:

- Login page: Task 5.
- Local mock login/user data: Task 3 and Task 5.
- Home with bottom tabs: Task 6.
- Top navigation with title and buttons: Task 2 shared styles, Task 6, Task 7.
- 3-column function menu: Task 6.
- Single scan menu only: Task 6.
- Scan page input at top and result below: Task 7.
- No-result blank state: Task 7 verification.
- Manual, camera, PDA broadcast, keyboard scan sources: Task 4 and Task 7.
- Static profile fields: Task 3 and Task 6.
- Final verification: Task 8.

Placeholder scan:

- No task contains unresolved TBD/TODO items.
- PDA native Android implementation is represented as a documented integration contract and a JS event hook, because the confirmed scope requires support for the scenario without a specific native plugin package or DataWedge profile file.

Type consistency:

- `ScanResult`, `ScanSource`, `createScanResult`, `scanWithCamera`, `normalizeKeyboardBuffer`, and `createPdaBroadcastResult` are defined before page usage.
- `UserProfile`, `login`, `logout`, and `getCurrentUser` are defined before page usage.
