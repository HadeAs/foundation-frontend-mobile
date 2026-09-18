<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useOrderPacking } from '../../composables/useOrderPacking';

const { box, review, order, quantity, busy, notice, canSubmit, notify, clear, scan, unbindAll, submit } = useOrderPacking();
const input = ref('');
const disabled = computed(() => busy.value || !!review.value);
let active = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

async function handleScan(value: string) {
  if (!active || disabled.value) return;
  input.value = '';
  await scan(value);
}
usePdaScanner(handleScan);

const { reset: resetKeyboard } = useKeyboardScanner(handleScan, disabled);
function clearPage() {
  if (busy.value) return;
  clear();
  input.value = '';
  resetKeyboard();
}
function goBack() { if (!busy.value) uni.navigateBack(); }
onShow(() => {
  active = true;
});
onHide(() => {
  active = false;
  resetKeyboard();
});
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
onUnmounted(() => {
  active = false;
  clearTimeout(noticeTimer);
  clear();
});
</script>

<template>
  <view class="app-page packing-page">
    <view class="app-nav">
      <button class="nav-back" :disabled="busy" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">板件快捷绑箱</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="packing-top">
      <ScanInput v-model="input" :placeholder="box ? '扫物料唯一码带出订单' : '扫描或输入箱码'"
        :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="box" class="card box-card">
        <view class="card-heading"><text>箱子信息</text><text class="tag">空箱</text></view>
        <view class="info"><text>箱子编号</text><text>{{ box.box.containerCode }}</text></view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <scroll-view class="material-list" scroll-y>
      <view v-if="box" class="card">
        <view class="card-heading">订单与数量</view>
        <view class="order-row">
          <label>订单号<input v-model="order" placeholder="扫描带出或手动输入" aria-label="订单号" :maxlength="128" :disabled="disabled" /></label>
          <label>数量<input v-model="quantity" type="number" placeholder="数量" aria-label="数量" :maxlength="10" :disabled="disabled" /></label>
        </view>
      </view>
      <view v-else class="card empty">请先扫描箱码<view class="empty-hint">已有物料须一键解绑后才可装箱</view></view>
    </scroll-view>
    <view class="footer">
      <button :disabled="disabled" @tap="clearPage">清空页面</button>
      <button class="primary" :disabled="!canSubmit" @tap="submit">确认装箱</button>
    </view>
    <view v-if="review" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="一键解绑确认">
        <view class="modal-title">一键解绑确认</view>
        <view class="modal-content">当前箱子已绑定 {{ review.totalQuantity }} 个物料，需要一键解绑后才可以使用此功能，是否确认？</view>
        <view class="modal-actions">
          <button :disabled="busy" @tap="clearPage">否</button>
          <button class="danger" :disabled="busy" @tap="unbindAll">{{ busy ? '解绑中…' : '是，一键解绑' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.packing-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.packing-top { padding: 16rpx 20rpx 0; flex-shrink: 0; }
.card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.box-card { margin-top: 14rpx; }
.card-heading { display: flex; justify-content: space-between; align-items: center; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.info { display: flex; justify-content: space-between; gap: 16rpx; padding: 12rpx 16rpx; font-size: 26rpx; }
.info text:first-child { color: #748d93; flex-shrink: 0; }
.info text:last-child { word-break: break-all; text-align: right; }
.material-list { flex: 1; height: 0; min-height: 0; padding: 14rpx 20rpx 0; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.empty-hint { margin-top: 16rpx; font-size: 24rpx; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1.35fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; padding: 28rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-content { font-size: 28rpx; margin: 24rpx 0; line-height: 1.6; }
.modal-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 14rpx; }
.danger { color: #bb3535; border-color: #bb3535; }
.order-row { display: grid; grid-template-columns: minmax(0, 1fr) 160rpx; gap: 12rpx; padding: 16rpx; }
.order-row label { min-width: 0; font-size: 24rpx; color: #748d93; }
.order-row input { min-width: 0; width: 100%; height: 76rpx; box-sizing: border-box; border: 1px solid #9dbfc4; border-radius: 8rpx; padding: 0 12rpx; font-size: 28rpx; }
</style>
