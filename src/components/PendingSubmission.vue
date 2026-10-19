<script setup lang="ts">
defineProps<{ code?: string; requestId?: string; reason?: string; storageError?: string; busy: boolean }>();
defineEmits<{ reload: [] }>();
</script>

<template>
  <view class="pending-submission" role="status">
    <view class="title">{{ storageError ? '本地操作记录待核实' : '本次操作结果待确认' }}</view>
    <view v-if="code">容器编号：{{ code }}</view>
    <view v-if="requestId">请求标识：{{ requestId }}</view>
    <view>{{ storageError || reason }}</view>
    <view>请保留本次操作信息，核实结果后继续处理。</view>
    <button v-if="storageError" :disabled="busy" @tap="$emit('reload')">重新读取本地记录</button>
  </view>
</template>

<style scoped lang="scss">
.pending-submission { flex-shrink: 1; min-height: 0; max-height: 40vh; box-sizing: border-box; overflow-y: auto; padding: 16rpx; margin-bottom: 14rpx; border: 1px solid #cee1e3; border-radius: 10rpx; background: white; color: #47686f; font-size: 24rpx; line-height: 1.6; word-break: break-word; }
.title { font-size: 28rpx; font-weight: 600; color: #254b54; }
button { margin: 12rpx 0 0; font-size: 26rpx; color: #087779; background: #e6f6f6; border: 1px solid #b8d3d6; border-radius: 8rpx; }
button::after { border: 0; }
</style>
