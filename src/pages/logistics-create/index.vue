<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow, onLoad } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useLogisticsCreation } from '../../composables/useLogisticsCreation';
import { locationPath } from '../../services/logistics';
import LocationCascade from '../../components/LocationCascade.vue';

const { options, destination, candidates, choosing, busy, disabled, canSubmit, notice, notify, clear, scan, openChoice, closeChoice, choose, submit } = useLogisticsCreation();
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
function clearPage() { if (!busy.value) { clear(); input.value = ''; resetKeyboard(); } }
onLoad((query) => {
  if (typeof query?.scanCode === 'string' && query.scanCode) {
    void scan(query.scanCode, typeof query.shippingNo === 'string' ? query.shippingNo : undefined);
  }
});
function goBack() { if (!busy.value) uni.navigateBack(); }
onShow(() => { active = true; });
onHide(() => {
  active = false;
  clear();
  input.value = '';
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
  <view class="app-page application-page">
    <view class="app-nav"><button class="nav-back" :disabled="disabled" @tap="goBack">‹ 返回</button><view class="app-nav__title">发起物流任务</view><view /></view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="scan-top">
      <ScanInput v-model="input" placeholder="扫描或输入载具/起始位置" :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <view class="content">
      <view v-if="!options" class="card empty">请扫描载具或起始位置<view class="empty-hint">系统将返回容器、起始位置和可选目标位置</view></view>
      <template v-else>
        <view class="card">
          <view class="card-heading"><text>运输信息</text><text class="tag">已识别</text></view>
          <view class="info"><text>载具/容器</text><text>{{ options.object.containerCode }}</text></view>
          <view class="info"><text>起始位置</text><text>{{ options.origin.locationCode }} · {{ options.origin.locationName }}</text></view>
        </view>
        <view class="card">
          <view class="card-heading"><text>目标位置</text><text>{{ candidates.length }} 个可选</text></view>
          <button v-if="candidates.length" class="choice" :disabled="disabled || !options.eligibility.allowed" @tap="openChoice">
            <text>{{ destination ? locationPath(destination) : '请选择目标位置' }}</text><text>{{ destination ? '切换' : '选择' }} ›</text>
          </button>
          <view v-else class="empty">暂无可达目标位置</view>
        </view>
      </template>
    </view>
    <view class="footer"><button :disabled="disabled" @tap="clearPage">清空页面</button><button class="primary" :disabled="!canSubmit" @tap="submit">确认创建</button></view>
    <LocationCascade v-if="choosing" :locations="candidates" :selected="destination" @confirm="choose" @cancel="closeChoice" />
  </view>
</template>

<style scoped lang="scss">
.application-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.scan-top { padding: 16rpx 20rpx 0; flex-shrink: 0; }
.content { flex: 1; height: 0; min-height: 0; padding: 14rpx 20rpx 0; display: flex; flex-direction: column; }
.object-card { margin-top: 14rpx; }
.card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.card + .card { margin-top: 14rpx; }
.card-heading { display: flex; justify-content: space-between; align-items: center; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.info { display: flex; justify-content: space-between; gap: 16rpx; padding: 12rpx 16rpx; font-size: 26rpx; }
.info text:first-child { color: #748d93; flex-shrink: 0; }
.info text:last-child { min-width: 0; word-break: break-all; text-align: right; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.tag--bound { background: #edf2f3; color: #47686f; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.empty-hint { margin-top: 16rpx; font-size: 24rpx; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1.35fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.danger { color: #bb3535; border-color: #bb3535; }
.choice { margin: 14rpx 16rpx; width: calc(100% - 32rpx); min-height: 76rpx; height: auto; line-height: 1.5; padding: 14rpx; display: flex; align-items: center; justify-content: space-between; gap: 16rpx; text-align: left; font-weight: normal; }
.choice text:first-child { min-width: 0; overflow-wrap: anywhere; }
.choice text:last-child { flex-shrink: 0; color: #087779; }
.content { overflow-y: auto; }
.content > .card { flex-shrink: 0; }
</style>
