<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { fetchWarehouseTaskById } from '../../services/warehouseTasks';
import type { WarehouseTask, WarehouseTaskStatus } from '../../types/warehouseTask';

const task = shallowRef<WarehouseTask | null>(null);
const loading = shallowRef(false);

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function statusClass(status: WarehouseTaskStatus) {
  return {
    'detail-status--created': status === '已创建',
    'detail-status--running': status === '进行中',
    'detail-status--done': status === '已完成'
  };
}

async function loadTask(id: string) {
  loading.value = true;
  try {
    task.value = await fetchWarehouseTaskById(id);
  } finally {
    loading.value = false;
  }
}

function getRouteTaskId() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const currentPage = pages[pages.length - 1] as { options?: Record<string, string | undefined> } | undefined;
  const pageId = currentPage?.options?.id;
  if (pageId) {
    return decodeURIComponent(pageId);
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const hashQuery = window.location.hash.split('?')[1] ?? '';
  return decodeURIComponent(new URLSearchParams(hashQuery).get('id') ?? '');
}

onMounted(() => {
  const id = getRouteTaskId();
  if (id) {
    void loadTask(id);
  }
});
</script>

<template>
  <view class="app-page">
    <view class="app-nav">
      <view class="app-nav__button" @tap="goBack">返回</view>
      <view class="app-nav__title">任务详情</view>
      <view class="app-nav__spacer"></view>
    </view>

    <view class="app-content">
      <view v-if="loading" class="detail-loading">加载中...</view>

      <view v-else-if="task" class="detail-card">
        <view class="detail-order">{{ task.orderNo }}</view>
        <view class="detail-status" :class="statusClass(task.status)">{{ task.status }}</view>
        <view class="detail-row"><text>创建人</text><text>{{ task.creator }}</text></view>
        <view class="detail-row"><text>创建时间</text><text>{{ task.createdAt }}</text></view>
        <view class="detail-row"><text>入库地点</text><text>{{ task.location }}</text></view>
      </view>

      <view v-else class="detail-loading">未找到任务</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.detail-card {
  position: relative;
  padding: 28rpx 24rpx 18rpx;
  border: 2rpx solid #d8e2ef;
  border-radius: 8rpx;
  background: #ffffff;
}

.detail-order {
  padding-right: 132rpx;
  color: #102a43;
  font-size: 38rpx;
  font-weight: 800;
  line-height: 1.25;
  word-break: break-all;
}

.detail-status {
  position: absolute;
  top: 24rpx;
  right: 24rpx;
  min-width: 112rpx;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  text-align: center;
  font-size: 24rpx;
  font-weight: 700;
}

.detail-status--created {
  background: #e8f1ff;
  color: #1d4ed8;
}

.detail-status--running {
  background: #fff3d6;
  color: #b45309;
}

.detail-status--done {
  background: #e5f8ed;
  color: #15803d;
}

.detail-row {
  min-height: 76rpx;
  border-top: 2rpx solid #edf2f7;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  color: #64748b;
  font-size: 28rpx;
}

.detail-row:first-of-type {
  margin-top: 24rpx;
}

.detail-row text:last-child {
  color: #102a43;
  font-weight: 700;
  text-align: right;
}

.detail-loading {
  min-height: 240rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 28rpx;
}
</style>
