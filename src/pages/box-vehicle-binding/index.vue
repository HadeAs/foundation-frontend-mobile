<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import OperationNotice from '../../components/OperationNotice.vue';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useBoxVehicleBinding } from '../../composables/useBoxVehicleBinding';

const { vehicle, review, rebind, pending, busy, disabled, notice, canSubmit, notify, clear, pause, resume,
  scan, keepBindings, chooseRebind, remove, unbindAll, submit } = useBoxVehicleBinding();
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
onShow(() => { active = true; resume(); });
onHide(() => { active = false; pause(); input.value = ''; resetKeyboard(); });
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
onUnmounted(() => { active = false; clearTimeout(noticeTimer); pause(); });
</script>

<template>
  <view class="app-page binding-page">
    <view class="app-nav">
      <button class="nav-back" :disabled="busy" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">料箱绑车</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="fixed-top">
      <ScanInput v-model="input" :placeholder="vehicle ? '扫描或输入料箱编码' : '扫描或输入料车编码'"
        :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="vehicle" class="card vehicle-card">
        <view class="card-heading"><text>料车信息</text><text class="tag">已识别</text></view>
        <view class="info"><text>料车编号</text><text>{{ vehicle.vehicle.vehicleCode }}</text></view>
        <view class="info"><text>料车名称</text><text>{{ vehicle.vehicle.displayName }}</text></view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
      <view v-if="vehicle" class="card-heading list-heading">
        <text>已绑定 {{ vehicle.bindingCount }} 箱</text><text>本次待绑定 {{ pending.length }} 箱</text>
      </view>
    </view>
    <scroll-view class="box-list" :class="{ 'box-list--initial': !vehicle }" :scroll-y="!!vehicle && !!(vehicle.bindingCount + pending.length)" :show-scrollbar="true">
      <view v-if="!vehicle" class="card empty">请先扫描料车<view class="empty-hint">识别料车后连续扫描料箱</view></view>
      <view v-else class="card list-card">
        <view v-if="!vehicle.bindingCount && !pending.length" class="empty">请扫描料箱编码</view>
        <view v-for="line in vehicle.bindings" :key="line.bindingId" class="box-row">
          <text class="box-code">{{ line.box.boxCode }}</text><view class="delete-space" />
          <text class="box-name">{{ line.box.displayName }}</text><text class="tag tag--bound">已绑定</text>
        </view>
        <view v-for="item in pending" :key="item.box.boxCode" class="box-row">
          <text class="box-code">{{ item.box.boxCode }}</text>
          <button class="delete" :aria-label="`删除 ${item.box.boxCode}`" :disabled="disabled" @tap="remove(item.box.boxCode)">
            <view class="trash-icon" aria-hidden="true" />
          </button>
          <text class="box-name">{{ item.box.displayName }}</text><text class="tag">待绑定</text>
        </view>
      </view>
    </scroll-view>
    <view class="footer">
      <button :disabled="disabled" @tap="clearPage">清空页面</button>
      <button class="primary" :disabled="!canSubmit" @tap="submit">确认绑定</button>
    </view>
    <view v-if="review || rebind" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" :aria-label="review ? '一键解绑确认' : '换绑确认'">
        <view class="modal-title">{{ review ? '一键解绑确认' : '换绑确认' }}</view>
        <view class="modal-content">{{ review ? `当前料车已绑定${review.bindingCount}个料箱，是否需要一键解绑` : `已绑定其他容器：${rebind?.currentBinding?.vehicleCode}，是否需要换绑` }}</view>
        <view class="modal-actions">
          <button :disabled="busy" @tap="review ? keepBindings() : chooseRebind(false)">否</button>
          <button class="primary" :disabled="busy" @tap="review ? unbindAll() : chooseRebind(true)">{{ busy ? '处理中…' : '是' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.binding-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.fixed-top { padding: 16rpx 20rpx 0; flex-shrink: 0; }
.card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.vehicle-card { margin-top: 14rpx; }
.card-heading { display: flex; justify-content: space-between; align-items: center; gap: 10rpx; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.info { display: flex; justify-content: space-between; gap: 16rpx; padding: 10rpx 16rpx; font-size: 26rpx; }
.info text:first-child { color: #748d93; flex-shrink: 0; }
.info text:last-child { min-width: 0; word-break: break-all; text-align: right; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.tag--bound { color: #52686d; background: #edf1f2; }
.list-heading { margin-top: 14rpx; border: 1px solid #cee1e3; border-radius: 10rpx 10rpx 0 0; background: white; font-size: 26rpx; }
.box-list { flex: 1; height: 0; min-height: 0; padding: 0 20rpx; }
.box-list--initial { padding-top: 14rpx; }
.list-card { border-radius: 0 0 10rpx 10rpx; padding: 0 16rpx; }
.box-row { height: 65px; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 28px 20px; column-gap: 12rpx; row-gap: 4px; padding: 6px 0; border-bottom: 1px solid #dfebed; align-items: center; }
.box-row:last-child { border-bottom-color: transparent; }
.box-code, .box-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.box-code { font-size: 28rpx; font-weight: 600; }
.box-name { font-size: 24rpx; color: #748d93; }
.box-row .tag { justify-self: end; }
.delete, .delete-space { width: 56rpx; height: 28px; justify-self: end; }
.delete { border: 0; padding: 0; display: flex; justify-content: center; align-items: center; }
.trash-icon { width: 20rpx; height: 24rpx; border: 2px solid #bb3535; border-top: 0; position: relative; }
.trash-icon::before { content: ''; position: absolute; left: -6rpx; right: -6rpx; top: -6rpx; border-top: 2px solid #bb3535; }
.trash-icon::after { content: ''; position: absolute; width: 8rpx; left: 3rpx; top: -11rpx; border-top: 2px solid #bb3535; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.empty-hint { margin-top: 16rpx; font-size: 24rpx; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1.35fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; max-height: 80dvh; padding: 28rpx; display: flex; flex-direction: column; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-content { min-height: 0; overflow-y: auto; font-size: 28rpx; margin: 24rpx 0; line-height: 1.6; word-break: break-all; }
.modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 14rpx; }
</style>
