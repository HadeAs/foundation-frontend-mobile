<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useEmptyVehicle } from '../../composables/useEmptyVehicle';
import { locationPath } from '../../services/logistics';
import LocationCascade from '../../components/LocationCascade.vue';

const { options, origin, candidates, choosing, replacement, busy, disabled, canSubmit, notice, notify, clear, scan, openChoice, closeChoice, choose, submit, cancelReplacement, confirmReplacement } = useEmptyVehicle();
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
    <view class="app-nav"><button class="nav-back" :disabled="disabled" @tap="goBack">‹ 返回</button><view class="app-nav__title">呼叫空载具</view><view /></view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="scan-top">
      <ScanInput v-model="input" placeholder="扫描或输入目标位置" :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <view class="content">
      <view v-if="!options" class="card empty">请扫描目标位置<view class="empty-hint">查询可用起始位置及其空载具</view></view>
      <template v-else>
        <view class="card">
          <view class="card-heading"><text>目标位置</text><text class="tag">已识别</text></view>
          <view class="info"><text>位置编号</text><text>{{ options.destination.locationCode }}</text></view>
          <view class="info"><text>位置名称</text><text>{{ options.destination.locationName }}</text></view>
        </view>
        <view class="card">
          <view class="card-heading"><text>起始位置</text><text>{{ candidates.length }} 个可选</text></view>
          <button v-if="candidates.length" class="choice" :disabled="disabled" @tap="openChoice">
            <text>{{ origin ? locationPath(origin.origin) : '请选择起始位置' }}</text><text>{{ origin ? '切换' : '选择' }} ›</text>
          </button>
          <view v-else class="empty">暂无可用空载具</view>
          <view v-if="origin" class="info"><text>空载具</text><text>{{ origin.vehicle.containerCode }}</text></view>
        </view>
      </template>
    </view>
    <view class="footer"><button :disabled="disabled" @tap="clearPage">清空页面</button><button class="primary" :disabled="!canSubmit" @tap="submit">确认呼叫</button></view>
    <LocationCascade v-if="choosing" :locations="candidates" :selected="origin?.origin" title="选择起始位置" @confirm="choose" @cancel="closeChoice" />
    <view v-if="replacement" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="替换目标位置">
        <view class="modal-title">替换目标位置</view>
        <view class="modal-body">将清空当前目标位置和空载具候选，是否继续识别 {{ replacement }}？</view>
        <view class="modal-actions"><button @tap="cancelReplacement">取消</button><button class="primary" @tap="confirmReplacement">确认替换</button></view>
      </view>
    </view>
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
.card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.card + .card { margin-top: 14rpx; }
.card-heading { display: flex; justify-content: space-between; align-items: center; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.info { display: flex; justify-content: space-between; gap: 16rpx; padding: 12rpx 16rpx; font-size: 26rpx; }
.info text:first-child { color: #748d93; flex-shrink: 0; }
.info text:last-child { min-width: 0; word-break: break-all; text-align: right; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.empty-hint { margin-top: 16rpx; font-size: 24rpx; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1.35fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.choice { margin: 14rpx 16rpx; width: calc(100% - 32rpx); min-height: 76rpx; height: auto; line-height: 1.5; padding: 14rpx; display: flex; align-items: center; justify-content: space-between; gap: 16rpx; text-align: left; font-weight: normal; }
.choice text:first-child { min-width: 0; overflow-wrap: anywhere; }
.choice text:last-child { flex-shrink: 0; color: #087779; }
.content { overflow-y: auto; }
.content > .card { flex-shrink: 0; }
.modal-mask { position: fixed; inset: 0; z-index: 20; background: #163e4970; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { width: 100%; max-width: 440px; max-height: 80vh; overflow-y: auto; background: white; border-radius: 16rpx; padding: 24rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-body { margin: 24rpx 0; font-size: 28rpx; line-height: 1.6; overflow-wrap: anywhere; }
.modal-actions { display: grid; grid-template-columns: 1fr 1.35fr; gap: 12rpx; }
</style>
