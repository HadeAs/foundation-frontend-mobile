<script setup lang="ts">
import { shallowRef } from 'vue';
import { login } from '../../services/auth';

const account = shallowRef('operator01');
const password = shallowRef('123456');
const rememberAccount = shallowRef(true);

function handleLogin() {
  const result = login(account.value, password.value);

  if (!result.ok) {
    uni.showToast({ title: result.message ?? '账号或密码错误', icon: 'none' });
    return;
  }

  uni.reLaunch({ url: '/pages/home/index' });
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
