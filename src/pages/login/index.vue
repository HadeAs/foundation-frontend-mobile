<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { API_ENVIRONMENTS, login } from "../../services/auth";
import { startAppUpdatePolling } from "../../services/appUpdate";

const REMEMBERED_ACCOUNT_KEY = "foundation.mobile.remembered-account";
const account = shallowRef(
  (uni.getStorageSync(REMEMBERED_ACCOUNT_KEY) as string) || "",
);
const password = shallowRef("");
const rememberAccount = shallowRef(true);
const submitting = shallowRef(false);
const environmentIndex = shallowRef(0);
const environmentNames = API_ENVIRONMENTS.map(({ label }) => label);
const selectedEnvironment = computed(
  () => API_ENVIRONMENTS[environmentIndex.value],
);

function handleEnvironmentChange(event: Event) {
  const value = (event as unknown as { detail?: { value?: string | number } })
    .detail?.value;
  const index = Number(value);
  if (Number.isInteger(index) && API_ENVIRONMENTS[index]) {
    environmentIndex.value = index;
  }
}

async function handleLogin() {
  if (submitting.value) {
    return;
  }

  submitting.value = true;
  const result = await login(
    account.value,
    password.value,
    selectedEnvironment.value.baseUrl,
  );
  submitting.value = false;

  if (!result.ok) {
    uni.showToast({ title: result.message ?? "账号或密码错误", icon: "none" });
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
        <text>{{ rememberAccount ? "☑" : "☐" }} 记住账号</text>
      </view>

      <button
        class="login-button"
        :disabled="submitting"
        :loading="submitting"
        @tap="handleLogin"
      >
        登录
      </button>
    </view>

    <picker
      class="environment-switch"
      :value="environmentIndex"
      :range="environmentNames"
      @change="handleEnvironmentChange"
    >
      <view class="environment-switch__text">{{
        selectedEnvironment.label
      }}</view>
    </picker>
  </view>
</template>

<style scoped lang="scss">
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

.environment-switch {
  margin: auto auto 0;
  padding: 24rpx 40rpx 8rpx;
}

.environment-switch__text {
  color: #64748b;
  font-size: 28rpx;
  text-align: center;
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
  background: #0d9496;
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 700;
}

.login-button[disabled] {
  opacity: 0.68;
}
</style>
