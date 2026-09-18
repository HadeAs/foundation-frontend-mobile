<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useVehicleLoading } from '../../composables/useVehicleLoading';

const { pairs, pending, completeCount, busy, notice, canSubmit, notify, clear, scan, remove, submit } = useVehicleLoading();
const input = ref('');
const disabled = busy;
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
      <view class="app-nav__title">装车</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="packing-top">
      <ScanInput v-model="input" :placeholder="pending ? '扫描第 ' + pairs.length + ' 对箱子编码' : '扫描载具库位号'"
        :disabled="busy" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view class="pair-count">已完成 {{ completeCount }} 对<text v-if="pending"> · 1 对待补充箱子</text></view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <scroll-view class="material-list" scroll-y :show-scrollbar="true">
      <view v-if="!pairs.length" class="card empty">请先扫描载具库位号<view class="empty-hint">载具库位 → 箱子，按此顺序连续录入</view></view>
      <view v-else class="pair-list">
        <view v-for="(pair, index) in pairs" :key="pair.slot.slotCode" class="card">
          <view class="card-heading">
            <text>第 {{ index + 1 }} 对关联</text>
            <view class="heading-actions">
              <text class="tag">{{ pair.box ? '待装载' : '待扫描箱子' }}</text>
              <button class="delete" :aria-label="'删除关联 ' + pair.slot.slotCode" :disabled="busy" @tap="remove(pair.slot.slotCode)">
                <view class="trash-icon" aria-hidden="true" />
              </button>
            </view>
          </view>
          <view class="info"><text>载具库位号</text><text>{{ pair.slot.slotCode }}</text></view>
          <view class="info"><text>载具编号</text><text>{{ pair.slot.vehicle.containerCode }}</text></view>
          <view class="info"><text>箱子编号</text><text>{{ pair.box?.box.containerCode || '—' }}</text></view>
        </view>
      </view>
    </scroll-view>
    <view class="footer">
      <button :disabled="busy" @tap="clearPage">清空页面</button>
      <button class="primary" :disabled="!canSubmit" @tap="submit">确认装载（{{ completeCount }}）</button>
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

.pair-count { padding-top: 14rpx; font-size: 26rpx; color: #748d93; }
.pair-list { display: flex; flex-direction: column; gap: 14rpx; }
.heading-actions { display: flex; align-items: center; gap: 8rpx; }
.delete { height: 56rpx; width: 56rpx; padding: 0; flex-shrink: 0; border: 0; display: flex; justify-content: center; align-items: center; }
.trash-icon { width: 20rpx; height: 24rpx; border: 2px solid #bb3535; border-top: 0; position: relative; }
.trash-icon::before { content: ''; position: absolute; left: -6rpx; right: -6rpx; top: -6rpx; border-top: 2px solid #bb3535; }
.trash-icon::after { content: ''; position: absolute; width: 8rpx; left: 3rpx; top: -11rpx; border-top: 2px solid #bb3535; }
</style>
