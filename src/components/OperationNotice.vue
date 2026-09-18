<script setup lang="ts">
withDefaults(defineProps<{ text?: string; error?: boolean }>(), { text: '', error: false });
</script>

<template>
  <view class="notice-anchor">
    <view v-if="text" class="notice" :class="{ 'notice--error': error }" :role="error ? 'alert' : 'status'" :aria-live="error ? 'assertive' : 'polite'">{{ text }}</view>
  </view>
</template>

<style scoped lang="scss">
.notice-anchor { position: relative; height: 0; flex-shrink: 0; z-index: 30; }
.notice { box-sizing: border-box; max-height: 30vh; overflow-y: auto; position: absolute; top: 10rpx; left: 20rpx; right: 20rpx; padding: 16rpx 20rpx; color: #086c6e; background: rgba(229, 248, 246, 0.96); border: 1px solid rgba(13, 148, 150, 0.3); box-shadow: 0 4px 14px #163e4920; border-radius: 8rpx; font-size: 26rpx; word-break: break-word; }
.notice--error { color: #a32626; background: rgba(255, 242, 242, 0.96); border-color: #d442424d; }
</style>
