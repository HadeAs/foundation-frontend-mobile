<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import OperationNotice from '../../components/OperationNotice.vue';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useMaterialCall } from '../../composables/useMaterialCall';

const { location, order, result, boxes, selected, busy, disabled, notice, attempt, receipt, canQuery, canSubmit, notify, clear, pause, resume, scan, query, toggle, submit, check } = useMaterialCall();
const taskStates = { QUEUED: '等待派送', DISPATCHED: '调度已受理', FAILED: '派送失败', UNKNOWN: '结果未知', COMPLETED: '运输完成' };
const input = ref('');
let active = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
async function handleScan(value: string) {
  if (!active || disabled.value) return;
  input.value = '';
  await scan(value);
}
usePdaScanner(handleScan);
const { reset: resetKeyboard } = useKeyboardScanner(handleScan, disabled);
function clearPage() { if (!disabled.value) { clear(); input.value = ''; resetKeyboard(); } }
function goBack() { if (!busy.value) uni.navigateBack(); }
onShow(() => { active = true; void resume(); });
onHide(() => { active = false; pause(); input.value = ''; resetKeyboard(); });
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
onUnmounted(() => { active = false; clearTimeout(noticeTimer); pause(); });
</script>

<template>
  <view class="app-page material-call-page">
    <view class="app-nav"><button class="nav-back" :disabled="busy" @tap="goBack">‹ 返回</button><view class="app-nav__title">手动叫料</view><view /></view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="fixed-top">
      <ScanInput v-model="input" placeholder="扫描或输入位置编码" :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="location" class="card location-card">
        <view class="card-heading"><text>位置信息</text><text class="tag">已识别</text></view>
        <view class="info"><text>位置编号</text><text>{{ location.location.locationCode }}</text></view>
        <view class="info"><text>位置名称</text><text>{{ location.location.locationName }}</text></view>
      </view>
      <view v-if="location" class="order-query">
        <input v-model="order" class="order-input" placeholder="请输入生产订单号" aria-label="生产订单号" confirm-type="search" :disabled="disabled" @confirm="query" />
        <button class="secondary" :disabled="!canQuery" @tap="query">查询</button>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
      <view v-if="result && !attempt" class="card-heading list-heading"><text>箱子清单</text><text>已选 {{ selected.length }} / {{ boxes.length }} 箱</text></view>
    </view>
    <scroll-view class="box-list" :class="{ 'box-list--empty': !result && !attempt }" scroll-y :show-scrollbar="true">
      <view v-if="attempt" class="card result-card" role="status">
        <view class="card-heading"><text>叫料结果待确认</text><text v-if="receipt" class="tag">{{ receipt.callNo }}</text></view>
        <view class="request-id">请求标识：{{ attempt.input.requestId }}</view>
        <view class="failure-reason">{{ attempt.reason }}</view>
        <view v-for="task in receipt?.tasks || []" :key="task.taskId" class="task-row">
          <view>{{ task.boxCode }} · {{ taskStates[task.dispatchState] }}</view>
          <view class="request-id">任务编号：{{ task.taskNo }}</view>
          <view v-if="task.reason" class="failure-reason">{{ task.reason }}</view>
        </view>
        <button class="secondary result-query" :disabled="busy" @tap="check">查询叫料结果</button>
      </view>
      <view v-else-if="!result" class="card empty">{{ location ? '请输入生产订单号并查询' : '请先扫描位置' }}<view class="empty-hint">{{ location ? '查询后勾选需要叫料的箱子' : '识别位置后按生产订单查询箱子' }}</view></view>
      <view v-else class="card">
        <view v-if="!result.eligibility.allowed" class="failure-reason batch-reason">{{ result.eligibility.reason }}</view>
        <view v-if="!boxes.length" class="empty">该生产订单暂无可叫料箱子</view>
        <checkbox-group v-for="box in boxes" :key="box.boxCode" @change="toggle(box.boxCode)">
          <label class="box-row" :class="{ 'box-row--selected': selected.includes(box.boxCode), 'box-row--unavailable': !box.eligibility.allowed || !result.eligibility.allowed }">
            <checkbox :value="box.boxCode" :checked="selected.includes(box.boxCode)" :disabled="disabled || !box.eligibility.allowed || !result.eligibility.allowed" color="#0D9496" :aria-label="`选择 ${box.boxCode}`" />
            <view class="box-content"><view class="box-code">{{ box.boxCode }}</view><view v-if="!box.eligibility.allowed" class="failure-reason">{{ box.eligibility.reason }}</view></view>
            <text class="box-quantity">{{ box.materialQuantity }} 件板件</text>
          </label>
        </checkbox-group>
      </view>
    </scroll-view>
    <view class="footer"><button :disabled="disabled" @tap="clearPage">清空页面</button><button class="primary" :disabled="!canSubmit" @tap="submit">确认叫料</button></view>
  </view>
</template>

<style scoped lang="scss">
.material-call-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.fixed-top { padding: 16rpx 20rpx 0; flex-shrink: 0; }
.card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.location-card { margin-top: 14rpx; }
.card-heading { display: flex; justify-content: space-between; align-items: center; gap: 12rpx; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.info { display: flex; justify-content: space-between; gap: 16rpx; padding: 12rpx 16rpx; font-size: 26rpx; }
.info text:first-child { color: #748d93; flex-shrink: 0; }
.info text:last-child { min-width: 0; word-break: break-all; text-align: right; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.order-query { display: grid; grid-template-columns: minmax(0, 1fr) 96rpx; gap: 10rpx; margin-top: 14rpx; }
.order-input { min-width: 0; height: 76rpx; padding: 0 16rpx; border: 1px solid #9fbfc5; border-radius: 8rpx; background: white; font-size: 28rpx; }
.secondary { color: #087779; background: #e6f6f6; border-color: #0d9496; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.list-heading { margin-top: 14rpx; border: 1px solid #cee1e3; border-radius: 10rpx 10rpx 0 0; background: white; }
.list-heading text:last-child { font-size: 24rpx; font-weight: normal; flex-shrink: 0; }
.box-list { flex: 1; height: 0; min-height: 0; padding: 0 20rpx; }
.box-list--empty { padding-top: 14rpx; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.empty-hint { margin-top: 16rpx; font-size: 24rpx; }
.box-row { display: flex; align-items: center; gap: 12rpx; padding: 16rpx; border-bottom: 1px solid #dfebed; }
.box-row checkbox { flex-shrink: 0; transform: scale(0.85); }
.box-content { flex: 1; min-width: 0; }
.box-code { font-size: 28rpx; font-weight: 600; word-break: break-all; }
.box-quantity { flex-shrink: 0; color: #087779; font-size: 24rpx; }
.box-row--selected { background: #edf9f8; }
.box-row--unavailable .box-code { color: #748d93; }
.failure-reason { color: #c23232; font-size: 24rpx; line-height: 1.5; word-break: break-all; }
.batch-reason { padding: 12rpx 16rpx; }
.request-id { color: #748d93; font-size: 22rpx; line-height: 1.5; word-break: break-all; }
.result-card { margin-top: 14rpx; padding-bottom: 16rpx; }
.result-card > .request-id, .result-card > .failure-reason { margin: 12rpx 16rpx; }
.task-row { padding: 12rpx 16rpx; border-top: 1px solid #dfebed; font-size: 26rpx; }
.result-query { margin: 12rpx 16rpx 0; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1.35fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
</style>
