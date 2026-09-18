<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { onShow, onHide } from '@dcloudio/uni-app';
import { usePendingReceiving } from '../../composables/usePendingReceiving';
import { displayTaskTime } from '../../services/pendingReceiving';

const flow = usePendingReceiving();
const { vehicleCode, locationCode, items, total, loading, refreshing, error, notice, hasMore } = flow;
const scrollTop = ref(0);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = ''; }, 6500);
});
async function query() {
  scrollTop.value = 1;
  await nextTick();
  scrollTop.value = 0;
  await flow.query();
}
onShow(() => { void query(); });
onHide(() => { flow.dispose(); clearTimeout(noticeTimer); });
onUnmounted(() => { flow.dispose(); clearTimeout(noticeTimer); });
function goBack() { uni.navigateBack({ delta: 1 }); }
</script>

<template>
  <view class="app-page pending-page">
    <view class="app-nav">
      <button class="nav-back" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">待接收物料清单</view>
      <view></view>
    </view>
    <OperationNotice :text="notice" error />
    <view class="filters">
      <input v-model="vehicleCode" placeholder="载具号" aria-label="载具号" :maxlength="128" confirm-type="search" @confirm="query" />
      <input v-model="locationCode" placeholder="库位号" aria-label="库位号" :maxlength="128" confirm-type="search" @confirm="query" />
      <button class="query-button" :disabled="loading" @tap="query">查询</button>
    </view>
    <view class="content">
      <view class="list-card">
        <view class="card-heading"><text>待接收物料清单</text><text class="count">已加载 {{ items.length }} / {{ total }} 条</text></view>
        <scroll-view class="list-scroll" scroll-y refresher-enabled :refresher-triggered="refreshing" :scroll-top="scrollTop"
          :lower-threshold="60" @scrolltolower="flow.loadMore" @refresherrefresh="flow.refresh">
          <view class="rows">
            <view v-for="task in items" :key="task.taskId" class="task-record">
              <view class="task-number">任务号 {{ task.taskNo }}</view>
              <view class="record-meta">{{ task.object.containerType === 'BOX' ? '箱号' : '载具号' }} {{ task.object.containerCode }}</view>
              <view class="record-meta">库位号 {{ task.location?.locationCode || '—' }}</view>
              <view class="record-meta">创建时间 {{ displayTaskTime(task.createdTime) }}</view>
            </view>
            <view class="list-status" role="status">
              <text v-if="loading">{{ refreshing ? '刷新中…' : '加载中…' }}</text>
              <button v-else-if="error" class="retry" @tap="flow.retry">加载失败，点击重试</button>
              <text v-else-if="!items.length">暂无待接收物料清单</text>
              <text v-else>{{ hasMore ? '上滑加载更多' : '已加载全部任务' }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.pending-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.filters { flex-shrink: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 112rpx; gap: 10rpx; padding: 16rpx 20rpx 0; }
input { min-width: 0; height: 76rpx; box-sizing: border-box; border: 1px solid #9fbfc5; border-radius: 8rpx; background: white; padding: 0 14rpx; font-size: 28rpx; }
.query-button { background: #e6f6f6; color: #087779; border-color: #0d9496; }
.content { flex: 1; height: 0; min-height: 0; display: flex; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.list-card { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.card-heading { flex-shrink: 0; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8rpx; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.count { font-size: 24rpx; font-weight: normal; }
.list-scroll { flex: 1; height: 0; min-height: 0; }
.rows { padding: 0 16rpx; }
.task-record { padding: 18rpx 0; border-bottom: 1px solid #dfebed; overflow-wrap: anywhere; }
.task-number { font-size: 28rpx; font-weight: 600; }
.record-meta { margin-top: 6rpx; font-size: 24rpx; color: #748d93; line-height: 1.5; }
.list-status { padding: 24rpx 0; text-align: center; font-size: 24rpx; color: #748d93; }
.retry { display: inline-block; padding: 0 20rpx; }
</style>
