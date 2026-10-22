<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from "vue";
import { onHide } from '@dcloudio/uni-app';
import OperationNotice from '../../components/OperationNotice.vue';
import { login } from "../../services/auth";
import { DEFAULT_API_BASE_URL, normalizeEnvironmentAddress, readEnvironmentSettings, saveEnvironmentSettings } from '../../services/environment';
import { startAppUpdatePolling } from "../../services/appUpdate";

const REMEMBERED_ACCOUNT_KEY = "foundation.mobile.remembered-account";
const account = shallowRef(
  (uni.getStorageSync(REMEMBERED_ACCOUNT_KEY) as string) || "",
);
const password = shallowRef("");
const rememberAccount = shallowRef(true);
const submitting = shallowRef(false);
const notice = shallowRef('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function clearNotice() {
  clearTimeout(noticeTimer);
  notice.value = '';
}
onHide(clearNotice);
onUnmounted(clearNotice);
const settings = readEnvironmentSettings();
const customEnabled = shallowRef(settings.enabled);
const customAddress = shallowRef(settings.address);
const addressDialog = shallowRef(false);
const addressDraft = shallowRef('');
const addressError = shallowRef('');
const loginAddress = computed(() => customEnabled.value ? customAddress.value : DEFAULT_API_BASE_URL);

function showError(message: string) {
  clearNotice();
  notice.value = message;
  noticeTimer = setTimeout(clearNotice, 6500);
}

function openAddressDialog() {
  if (submitting.value) return;
  clearNotice();
  addressDraft.value = customAddress.value;
  addressError.value = '';
  addressDialog.value = true;
}

function changeCustomEnvironment(event: { detail: { value: string[] } }) {
  if (submitting.value || addressDialog.value) return;
  const enabled = event.detail.value.includes('custom');
  try {
    saveEnvironmentSettings({ enabled, address: customAddress.value });
    customEnabled.value = enabled;
    clearNotice();
    if (enabled && !customAddress.value) openAddressDialog();
  } catch {
    showError('无法保存环境设置，请重试');
  }
}

function saveAddress() {
  let address: string;
  try { address = normalizeEnvironmentAddress(addressDraft.value); }
  catch (error) { addressError.value = (error as Error).message; return; }
  try {
    saveEnvironmentSettings({ enabled: customEnabled.value, address });
    customAddress.value = address;
    addressDialog.value = false;
    clearNotice();
  } catch {
    addressError.value = '无法保存自定义地址，请重试';
  }
}

async function handleLogin() {
  if (submitting.value || addressDialog.value) {
    return;
  }

  clearNotice();
  if (customEnabled.value && !customAddress.value.trim()) {
    showError('请先配置自定义环境地址，或取消勾选使用默认地址');
    return;
  }
  submitting.value = true;
  const result = await login(
    account.value,
    password.value,
    loginAddress.value,
  );
  submitting.value = false;

  if (!result.ok) {
    showError(result.message ?? '账号或密码错误');
    return;
  }

  if (rememberAccount.value) {
    uni.setStorageSync(REMEMBERED_ACCOUNT_KEY, account.value.trim());
  } else {
    uni.removeStorageSync(REMEMBERED_ACCOUNT_KEY);
  }
  await startAppUpdatePolling();
  uni.reLaunch({ url: "/pages/home/index" });
}
</script>

<template>
  <view class="login-page">
    <view class="login-notice"><OperationNotice :text="notice" error /></view>
    <view class="login-panel">
      <view class="login-logo">LOGO</view>
      <view class="login-title">工业移动端</view>

      <input v-model="account" class="login-input" placeholder="账号" />
      <input
        v-model="password"
        class="login-input"
        placeholder="密码"
        password
      />

      <view class="login-row" @tap="rememberAccount = !rememberAccount">
        <text>{{ rememberAccount ? "☑" : "☐" }}</text>
        <text>记住账号</text>
      </view>

      <button
        class="login-button"
        :disabled="submitting || addressDialog"
        :loading="submitting"
        @tap="handleLogin"
      >
        登录
      </button>
    </view>

    <view class="environment-settings">
      <view class="environment-controls">
        <checkbox-group @change="changeCustomEnvironment">
          <label class="environment-enable">
            <checkbox value="custom" :checked="customEnabled" :disabled="submitting || addressDialog" color="#0D9496" />
            <text>使用自定义环境地址</text>
          </label>
        </checkbox-group>
        <button class="environment-settings-button" aria-label="设置自定义环境地址"
          :disabled="submitting || addressDialog" @tap="openAddressDialog">
          <text aria-hidden="true">⚙</text>
        </button>
      </view>
      <text v-if="customEnabled" class="environment-address">{{ customAddress || '尚未配置地址' }}</text>
    </view>

    <view v-if="addressDialog" class="address-mask">
      <view class="address-dialog" role="dialog" aria-modal="true" aria-label="自定义环境地址">
        <view class="address-title">自定义环境地址</view>
        <text class="address-hint">输入 IP 和端口，例如 192.168.0.171:18080；省略协议时使用 HTTP。</text>
        <input v-model="addressDraft" class="login-input address-input" aria-label="服务器 IP 地址"
          placeholder="IP:端口 或 http(s)://IP:端口" :maxlength="128" :focus="addressDialog" @confirm="saveAddress" />
        <text v-if="addressError" class="address-error" role="alert">{{ addressError }}</text>
        <view class="address-actions">
          <button @tap="addressDialog = false">取消</button>
          <button class="address-save" @tap="saveAddress">保存</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.login-notice {
  position: fixed;
  top: var(--status-bar-height, 0px);
  left: 0;
  right: 0;
  z-index: 30;
}
.login-page {
  min-height: 100vh;
  background: #f2f8f8;
  padding: 120rpx 48rpx 48rpx;
  display: flex;
  flex-direction: column;
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

.environment-settings { margin-top: auto; padding-top: 40rpx; color: #64748b; }
.environment-controls { display: flex; align-items: center; justify-content: center; gap: 16rpx; }
.environment-enable { display: flex; align-items: center; gap: 12px; font-size: 24rpx; }
.environment-enable checkbox { margin: 0; }
.environment-enable :deep(.uni-checkbox-input) { margin-right: 0; }
.environment-settings-button { width: 80rpx; height: 80rpx; min-width: 44px; min-height: 44px; padding: 0; margin: 0; display: flex; align-items: center; justify-content: center; color: #0d9496; background: transparent; border: 0; font-size: 40rpx; }
.environment-settings-button::after { border: 0; }
.environment-address { display: block; text-align: center; font-size: 22rpx; word-break: break-all; }
.address-mask { position: fixed; inset: 0; z-index: 40; background: rgba(16, 42, 67, 0.35); display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.address-dialog { width: 100%; max-width: 640rpx; max-height: 80vh; overflow-y: auto; background: white; padding: 24rpx; border: 1px solid #cee1e3; border-radius: 16rpx; }
.address-title { color: #254b54; font-size: 30rpx; font-weight: 600; margin-bottom: 16rpx; }
.address-hint { display: block; color: #64748b; font-size: 24rpx; line-height: 1.5; margin-bottom: 16rpx; }
.address-input { height: 80rpx; font-size: 26rpx; padding: 0 16rpx; margin-bottom: 16rpx; }
.address-error { display: block; color: #bb3535; font-size: 24rpx; margin-bottom: 16rpx; }
.address-actions { display: flex; gap: 12rpx; }
.address-actions button { flex: 1; margin: 0; height: 76rpx; line-height: 76rpx; font-size: 26rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; }
.address-actions button::after { border: 0; }
.address-actions .address-save { background: #0d9496; border-color: #0d9496; color: white; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }

.login-row {
  display: flex;
  gap: 12px;
  align-items: center;
  color: #64748b;
  font-size: 24rpx;
  margin: 4rpx 0 36rpx;
}

.login-button {
  height: 92rpx;
  border-radius: 8rpx;
  background: #0d9496;
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 700;
}

.login-button[disabled] {
  opacity: 0.68;
}
</style>
