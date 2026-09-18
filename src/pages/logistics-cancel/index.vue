<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { onShow, onHide } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useLogisticsCancellation } from '../../composables/useLogisticsCancellation';
import { displayTaskTime } from '../../services/pendingReceiving';
import { triggerModeName } from '../../services/logisticsCancellation';

const flow = useLogisticsCancellation();
const { keyword, items, loading, refreshing, error, notice, hasMore, selected, submitting, checking, attempts } = flow;
const scrollTop = ref(0);
const scanDisabled = computed(() => loading.value || !!selected.value || !!submitting.value);
let active = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
async function query() {
  scrollTop.value = 1; await nextTick(); scrollTop.value = 0;
  await flow.query();
}
async function handleScan(value: string) {
  if (!active || scanDisabled.value) return;
  keyword.value = value.trim();
  await query();
}
usePdaScanner(handleScan);
const { reset: resetKeyboard } = useKeyboardScanner(handleScan, scanDisabled);
function pause() {
  active = false; resetKeyboard(); flow.pause(); clearTimeout(noticeTimer);
}
onShow(() => { active = true; void flow.resume(); });
onHide(pause);
onUnmounted(pause);
function goBack() { uni.navigateBack({ delta: 1 }); }
</script>

<template>
  <view class="app-page cancellation-page">
    <view class="app-nav">
      <button class="nav-back" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">取消物流任务</view><view></view>
    </view>
    <OperationNotice :text="notice?.message" :error="notice?.error" />
    <view class="scan-top">
      <ScanInput v-model="keyword" placeholder="容器码/AGV编号或名称" confirm-type="search" :disabled="scanDisabled"
        show-scan-button compact inline-errors @scan="handleScan" @clear="handleScan('')" @error="notice = { message: $event, error: true }" />
    </view>
    <view class="content">
      <scroll-view class="list-scroll" scroll-y refresher-enabled :refresher-triggered="refreshing" :scroll-top="scrollTop"
        :lower-threshold="60" @scrolltolower="flow.loadMore" @refresherrefresh="flow.refresh">
        <view class="rows">
          <view v-for="attempt in attempts" :key="attempt.requestId" class="result-card" role="status">
            <view class="task-number">{{ attempt.taskNo }}</view>
            <view class="result-message">{{ attempt.reason }}</view>
            <button class="query-button small" :disabled="checking.includes(attempt.taskId) || submitting === attempt.taskId" @tap="flow.check(attempt.taskId)">
              {{ checking.includes(attempt.taskId) ? '查询中…' : '刷新取消结果' }}
            </button>
          </view>
          <view v-for="task in items" :key="task.taskId" class="task-card">
            <view class="card-heading"><text class="task-number">{{ task.taskNo }}</text><text class="tag">{{ task.vendor === 'STANDARD' ? '斯坦德' : '海康' }}</text></view>
            <view class="details">
              <text class="label">AGV</text><text class="agv">{{ [task.agvCode, task.agvName].filter(Boolean).join(' · ') || '—' }}</text>
              <text class="label">关联容器</text><text>{{ task.container.containerCode }}</text>
              <text class="label">起始位置</text><text>{{ task.origin.locationCode }} · {{ task.origin.locationName }}</text>
              <text class="label">目标位置</text><text>{{ task.destination.locationCode }} · {{ task.destination.locationName }}</text>
              <view class="status-actions">
                <view class="status-info">
                  <text>当前状态</text><text>{{ task.statusName }}</text>
                  <text>发起方式</text><text>{{ triggerModeName(task.triggerMode) }}</text>
                </view>
                <button class="danger small" :disabled="!!submitting || flow.isPending(task.taskId)" @tap="flow.open(task)">取消任务</button>
              </view>
              <text class="label">发起时间</text><text>{{ displayTaskTime(task.createdTime) }}</text>
            </view>
          </view>
          <view class="list-status" role="status">
            <text v-if="loading">{{ refreshing ? '刷新中…' : '加载中…' }}</text>
            <button v-else-if="error" class="retry" @tap="flow.retry">加载失败，点击重试</button>
            <text v-else-if="!items.length">暂无可取消任务</text>
            <text v-else>{{ hasMore ? '上滑加载更多' : '已加载全部任务' }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
    <view v-if="selected" class="modal-mask" @tap.self="flow.close">
      <view class="modal" role="dialog" aria-modal="true" aria-label="确认取消任务">
        <view class="modal-title">确认取消任务</view>
        <view class="modal-body">确认取消物流任务 {{ selected.taskNo }}？取消后无法在 App 中恢复。</view>
        <view class="modal-actions"><button :disabled="!!submitting" @tap="flow.close">暂不取消</button><button class="danger" :disabled="!!submitting" @tap="flow.confirm">{{ submitting ? '提交中…' : '确认取消' }}</button></view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.cancellation-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 16rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { padding: 0; border: 0; background: transparent; color: white; text-align: left; }
.scan-top { flex-shrink: 0; padding: 16rpx 20rpx 0; }
.query-button { background: #e6f6f6; color: #087779; border-color: #0d9496; }
.content { flex: 1; height: 0; min-height: 0; display: flex; flex-direction: column; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.list-scroll { flex: 1; height: 0; min-height: 0; }
.rows { display: flex; flex-direction: column; gap: 14rpx; }
.task-card, .result-card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; padding: 16rpx; overflow-wrap: anywhere; }
.card-heading { display: flex; justify-content: space-between; align-items: center; gap: 8rpx; }
.task-number { font-size: 28rpx; font-weight: 600; }
.tag { flex-shrink: 0; padding: 4rpx 12rpx; background: #e6f6f6; color: #087779; font-size: 24rpx; border-radius: 24rpx; }
.details { margin-top: 14rpx; display: grid; grid-template-columns: 112rpx minmax(0, 1fr); gap: 6rpx 12rpx; font-size: 24rpx; line-height: 1.5; }
.label, .status-info > text:nth-child(odd) { color: #748d93; }
.agv { white-space: nowrap; overflow-x: auto; }
.status-actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 12rpx; }
.status-info { flex: 1; min-width: 0; display: grid; grid-template-columns: 112rpx minmax(0, 1fr); gap: 6rpx 12rpx; }
.status-actions button { flex-shrink: 0; }
.small { height: 60rpx; line-height: 60rpx; font-size: 24rpx; }
.danger { color: #bc3535; border-color: #d44242; }
.result-card { border-color: #b8d3d6; }
.result-message { margin: 10rpx 0; font-size: 24rpx; line-height: 1.5; }
.list-status { padding: 24rpx 0; text-align: center; font-size: 24rpx; color: #748d93; }
.retry { display: inline-block; }
.modal-mask { position: fixed; inset: 0; z-index: 20; background: #163e4970; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { width: 100%; max-height: 80vh; overflow-y: auto; border-radius: 16rpx; background: white; padding: 20rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-body { margin: 24rpx 0; font-size: 28rpx; line-height: 1.6; overflow-wrap: anywhere; }
.modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12rpx; }
</style>
