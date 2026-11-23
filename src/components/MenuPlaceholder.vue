<script setup lang="ts">
defineProps<{ title: string }>();

function goBack() {
  uni.navigateBack({ delta: 1 });
}
</script>

<template>
  <view class="app-page placeholder-page">
    <view class="app-nav">
      <button class="back" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">{{ title }}</view>
      <view />
    </view>
    <view class="notice">功能待开放</view>
  </view>
</template>

<style scoped lang="scss">
.placeholder-page { padding-top: var(--status-bar-height, 0px); }
.app-nav { height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
.back { margin: 0; padding: 0 8rpx; text-align: left; color: white; background: transparent; font-size: 26rpx; }
.back::after { border: 0; }
.notice { margin: 16rpx 20rpx; padding: 40rpx 16rpx; text-align: center; background: white; color: #47686f; border: 1px solid #cee1e3; border-radius: 10rpx; font-size: 26rpx; }
</style>
