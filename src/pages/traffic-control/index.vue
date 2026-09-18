<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { onShow, onHide } from '@dcloudio/uni-app';
import { useTrafficControl } from '../../composables/useTrafficControl';
import { displayTaskTime } from '../../services/pendingReceiving';

const flow = useTrafficControl();
const { keyword, status, items, loading, refreshing, submitting, selected, error, notice, hasMore, actionName } = flow;
const statusLabels = ['全部状态', '空闲', '占用'];
const statusValues = ['', 'FREE', 'OCCUPIED'] as const;
const statusIndex = computed(() => statusValues.indexOf(status.value));
const disabled = computed(() => loading.value || submitting.value || !!selected.value);
const scrollTop = ref(0);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
async function query() {
  scrollTop.value = 1; await nextTick(); scrollTop.value = 0;
  await flow.query();
}
function changeStatus(event: { detail: { value: string | number } }) {
  const value = statusValues[Number(event.detail.value)];
  if (disabled.value || value === undefined) return;
  status.value = value; void query();
}
function pause() { flow.dispose(); clearTimeout(noticeTimer); }
onShow(() => { void query(); });
onHide(pause);
onUnmounted(pause);
function goBack() { uni.navigateBack({ delta: 1 }); }
</script>

<template>
  <view class="app-page traffic-page">
    <view class="app-nav"><button class="nav-back" @tap="goBack">‹ 返回</button><view class="app-nav__title">交通管制</view><view></view></view>
    <OperationNotice :text="notice?.message" :error="notice?.error" />
    <view class="filters">
      <view class="keyword-row">
        <input v-model="keyword" placeholder="区域编号或名称" aria-label="区域编号或名称" :maxlength="128" :disabled="disabled" confirm-type="search" @confirm="query" />
        <button class="primary" :disabled="disabled" @tap="query">查询</button>
      </view>
      <view class="filter-row">
        <picker :range="statusLabels" :value="statusIndex" :disabled="disabled" @change="changeStatus">
          <view class="status-picker" role="button" :aria-disabled="disabled" aria-label="区域状态筛选"><text>{{ statusLabels[statusIndex] }}</text><text>⌄</text></view>
        </picker>
        <button :disabled="disabled" @tap="flow.refresh">{{ refreshing ? '刷新中…' : '下拉刷新' }}</button>
      </view>
    </view>
    <view class="content">
      <scroll-view class="list-scroll" scroll-y :refresher-enabled="!selected && !submitting" :refresher-triggered="refreshing" :scroll-top="scrollTop"
        :lower-threshold="60" @scrolltolower="flow.loadMore" @refresherrefresh="flow.refresh">
        <view class="rows">
          <view v-for="area in items" :key="area.areaCode" class="area-card">
            <view class="card-heading"><view class="area-title"><text>{{ area.areaCode }}</text><text class="area-name">{{ area.areaName }}</text></view><text class="tag" :class="{ occupied: area.status === 'OCCUPIED' }">{{ area.status === 'FREE' ? '空闲' : '占用' }}</text></view>
            <view class="meta-actions">
              <view class="metadata"><text class="label">最后操作人</text><text>{{ area.lastOperatorName || '—' }}</text><text class="label">操作时间</text><text>{{ area.lastOperationTime ? displayTaskTime(area.lastOperationTime) : '—' }}</text></view>
              <button class="small" :class="area.status === 'FREE' ? 'danger' : 'primary'" :disabled="disabled" @tap="flow.open(area)">{{ area.status === 'FREE' ? '锁定' : '释放' }}</button>
            </view>
          </view>
          <view class="list-status" role="status">
            <text v-if="loading">{{ refreshing ? '刷新中…' : '加载中…' }}</text>
            <button v-else-if="error" @tap="flow.retry">加载失败，点击重试</button>
            <text v-else-if="!items.length">暂无交管区域</text>
            <text v-else>{{ hasMore ? '上滑加载更多' : '已加载全部区域' }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
    <view v-if="selected" class="modal-mask" @tap.self="flow.close">
      <view class="modal" role="dialog" aria-modal="true" :aria-label="`确认${actionName}`">
        <view class="modal-title">确认{{ actionName }}</view>
        <view class="modal-body">确认{{ actionName }}区域 {{ selected.areaCode }}（{{ selected.areaName }}）？</view>
        <view class="modal-actions"><button :disabled="submitting" @tap="flow.close">取消</button><button :class="selected.status === 'FREE' ? 'danger' : 'primary'" :disabled="submitting" @tap="flow.confirm">{{ submitting ? '提交中…' : `确认${actionName}` }}</button></view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.traffic-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 16rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { padding: 0; border: 0; background: transparent; color: white; text-align: left; }
.primary { background: #e6f6f6; color: #087779; border-color: #0d9496; }
.danger { color: #bc3535; border-color: #d44242; }
.filters { flex-shrink: 0; padding: 16rpx 20rpx 0; }
.keyword-row { display: grid; grid-template-columns: minmax(0, 1fr) 112rpx; gap: 10rpx; }
input { min-width: 0; height: 76rpx; box-sizing: border-box; border: 1px solid #9fbfc5; border-radius: 8rpx; background: white; padding: 0 14rpx; font-size: 28rpx; }
.filter-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10rpx; margin-top: 10rpx; }
.status-picker { height: 76rpx; display: flex; align-items: center; justify-content: space-between; padding: 0 16rpx; border: 1px solid #9fbfc5; border-radius: 8rpx; background: white; font-size: 28rpx; }
.content { flex: 1; height: 0; min-height: 0; display: flex; flex-direction: column; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.list-scroll { flex: 1; height: 0; min-height: 0; }
.rows { display: flex; flex-direction: column; gap: 14rpx; }
.area-card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; padding: 16rpx; overflow-wrap: anywhere; }
.card-heading { display: flex; justify-content: space-between; align-items: center; gap: 8rpx; font-size: 28rpx; }
.area-title { min-width: 0; }
.area-name { color: #748d93; font-size: 24rpx; margin-left: 6rpx; }
.tag { flex-shrink: 0; padding: 4rpx 12rpx; background: #e6f6f6; color: #087779; font-size: 24rpx; border-radius: 24rpx; }
.tag.occupied { background: #fff0e8; color: #a94217; }
.meta-actions { display: flex; align-items: center; gap: 12rpx; margin-top: 14rpx; }
.metadata { flex: 1; min-width: 0; display: grid; grid-template-columns: 124rpx minmax(0, 1fr); gap: 6rpx 10rpx; font-size: 24rpx; line-height: 1.5; }
.label { color: #748d93; }
.small { flex-shrink: 0; height: 60rpx; line-height: 60rpx; min-width: 104rpx; font-size: 24rpx; }
.list-status { padding: 24rpx 0; text-align: center; font-size: 24rpx; color: #748d93; }
.list-status button { display: inline-block; }
.modal-mask { position: fixed; inset: 0; z-index: 20; background: #163e4970; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { width: 100%; max-height: 80vh; overflow-y: auto; border-radius: 16rpx; background: white; padding: 20rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-body { margin: 24rpx 0; font-size: 28rpx; line-height: 1.6; overflow-wrap: anywhere; }
.modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12rpx; }
</style>
