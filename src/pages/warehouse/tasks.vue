<script setup lang="ts">
import { shallowRef } from 'vue';
import ScanInput from '../../components/ScanInput.vue';
import { usePagedQuery } from '../../composables/usePagedQuery';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { fetchLatestWarehouseTasks, fetchWarehouseTasksPage } from '../../services/warehouseTasks';
import type { WarehouseTask, WarehouseTaskStatus } from '../../types/warehouseTask';

const scanInputRef = shallowRef<InstanceType<typeof ScanInput> | null>(null);
const {
  queryText,
  items: tasks,
  hasMore,
  initialLoading,
  loadingMore,
  refreshing,
  clearQuery,
  setQuery,
  loadNextPage,
  refreshLatest
} = usePagedQuery<WarehouseTask>({
  pageSize: 10,
  fetchPage: fetchWarehouseTasksPage,
  fetchLatest: fetchLatestWarehouseTasks,
  getId: (task) => task.id
});

usePdaScanner((value) => {
  scanInputRef.value?.setScanResult(value, { emitScan: false });
});

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function handleScanResult(value: string) {
  setQuery(value);
}

function statusClass(status: WarehouseTaskStatus) {
  return {
    'task-status--created': status === '已创建',
    'task-status--running': status === '进行中',
    'task-status--done': status === '已完成'
  };
}

function openTask(task: WarehouseTask) {
  uni.navigateTo({ url: `/pages/warehouse/task-detail?id=${encodeURIComponent(task.id)}` });
}
</script>

<template>
  <view class="app-page warehouse-page">
    <view class="app-nav">
      <view class="app-nav__button" @tap="goBack">返回</view>
      <view class="app-nav__title">入库任务</view>
      <view class="app-nav__spacer"></view>
    </view>

    <view class="task-search">
      <ScanInput
        ref="scanInputRef"
        v-model="queryText"
        placeholder="请输入或扫描任务单号"
        confirm-type="search"
        @scan="handleScanResult"
        @clear="clearQuery"
      />
    </view>

    <view v-if="initialLoading" class="task-loading-mask">
      <view class="task-loading-box">加载中...</view>
    </view>

    <scroll-view
      class="task-list"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @scrolltolower="loadNextPage"
      @refresherrefresh="refreshLatest"
    >
      <view
        v-for="task in tasks"
        :key="task.id"
        class="task-card"
        @tap="openTask(task)"
      >
        <view class="task-card__info">
          <view class="task-card__order">{{ task.orderNo }}</view>
          <view class="task-card__row"><text>创建人</text><text>{{ task.creator }}</text></view>
          <view class="task-card__row"><text>创建时间</text><text>{{ task.createdAt }}</text></view>
          <view class="task-card__row"><text>入库地点</text><text>{{ task.location }}</text></view>
        </view>
        <view class="task-card__status">
          <view class="task-status" :class="statusClass(task.status)">{{ task.status }}</view>
        </view>
      </view>

      <view v-if="!initialLoading && tasks.length === 0" class="task-loading">暂无任务数据</view>
      <view v-if="loadingMore" class="task-loading">正在加载下一页...</view>
      <view v-else-if="!hasMore" class="task-loading">没有更多任务</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.warehouse-page {
  position: relative;
  height: 100vh;
  overflow: hidden;
}

.task-search {
  flex: none;
  z-index: 2;
  padding: 24rpx;
  background: #f3f6fb;
}

.task-list {
  flex: 1;
  min-height: 0;
  padding: 0 24rpx;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.task-loading-mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 232rpx;
  bottom: 0;
  z-index: 3;
  background: rgba(243, 246, 251, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
}

.task-loading-box {
  min-width: 180rpx;
  min-height: 84rpx;
  padding: 0 32rpx;
  border: 2rpx solid #d8e2ef;
  border-radius: 8rpx;
  background: #ffffff;
  color: #123f7a;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pull-refresh {
  height: 0;
  overflow: hidden;
  color: #64748b;
  font-size: 24rpx;
  line-height: 44px;
  text-align: center;
  transition: height 0.16s ease;
}

.pull-refresh--active {
  color: #123f7a;
  font-weight: 700;
}

.task-card {
  margin-bottom: 20rpx;
  padding: 24rpx;
  border: 2rpx solid #d8e2ef;
  border-radius: 8rpx;
  background: #ffffff;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 124rpx;
  align-items: center;
  gap: 18rpx;
}

.task-card__info {
  min-width: 0;
}

.task-card__order {
  width: 100%;
  margin-bottom: 18rpx;
  color: #102a43;
  font-size: 34rpx;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card__row {
  min-height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 20rpx;
  color: #64748b;
  font-size: 26rpx;
}

.task-card__row text:first-child {
  flex: none;
  width: 104rpx;
}

.task-card__row text:last-child {
  min-width: 0;
  color: #102a43;
  font-weight: 600;
  text-align: left;
}

.task-card__status {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.task-status {
  flex: none;
  min-width: 112rpx;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  text-align: center;
  font-size: 24rpx;
  font-weight: 700;
}

.task-status--created {
  background: #e8f1ff;
  color: #1d4ed8;
}

.task-status--running {
  background: #fff3d6;
  color: #b45309;
}

.task-status--done {
  background: #e5f8ed;
  color: #15803d;
}

.task-loading {
  padding: 28rpx 0;
  color: #64748b;
  font-size: 26rpx;
  text-align: center;
}

</style>
