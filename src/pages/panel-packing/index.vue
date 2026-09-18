<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { usePanelPacking } from '../../composables/usePanelPacking';

const { box, review, pending, busy, notice, canJoint, notify, clear, scan, keepBindings, unbindAll, getJoint, remove, submit } = usePanelPacking();
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
      <view class="app-nav__title">板件扫码绑箱</view>
      <view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="packing-top">
      <ScanInput v-model="input" :placeholder="box ? '扫描或输入物料唯一码' : '扫描或输入箱码'"
        :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="box" class="card box-card">
        <view class="card-heading"><text>箱信息</text><text class="tag">已识别</text></view>
        <view class="info"><text>箱子编号</text><text>{{ box.box.containerCode }}</text></view>
        <view class="counts"><text>已绑定 {{ box.totalQuantity }} 件</text><text>本次待绑定 {{ pending.length }} 件</text></view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <scroll-view class="material-list" scroll-y :show-scrollbar="true">
      <view v-if="!box" class="empty">请先扫描箱码</view>
      <view v-else-if="!box.bindings.length && !pending.length" class="empty">请扫描物料唯一码</view>
      <view v-for="item in box?.bindings || []" :key="item.id" class="card material-card">
        <view class="material-heading"><text>{{ item.panelCode || item.materialCode }}</text><text class="tag tag--bound">已绑定</text></view>
        <view class="secondary">{{ item.materialCode }} · {{ item.materialName }}</view>
        <view class="secondary">订单 {{ item.orderNo }}</view>
        <view v-if="item.bindingMode === 'BY_ORDER'" class="secondary">数量 {{ item.quantity }} {{ item.unit }}</view>
      </view>
      <view v-for="item in pending" :key="item.panelCode" class="card material-card">
        <view class="material-heading">
          <text>{{ item.panelCode }}</text>
          <text class="tag">待绑定</text>
          <button class="delete" :aria-label="`删除 ${item.panelCode}`" :disabled="busy" @tap="remove(item.panelCode)">
            <view class="trash-icon" aria-hidden="true" />
          </button>
        </view>
        <view class="secondary">{{ item.materialCode }} · {{ item.materialName }}</view>
        <view class="secondary">订单 {{ item.orderNo }}</view>
      </view>
    </scroll-view>
    <view class="footer">
      <button :disabled="busy" @tap="clearPage">清空页面</button>
      <button :disabled="disabled || !canJoint" @tap="getJoint">获取拼板</button>
      <button class="primary" :disabled="disabled || !pending.length" @tap="submit">确认装箱</button>
    </view>
    <view v-if="review" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="一键解绑确认">
        <view class="modal-title">一键解绑确认</view>
        <view class="modal-content">当前箱子已绑定 {{ review.totalQuantity }} 个物料，是否需要一键解绑？</view>
        <view class="modal-actions">
          <button :disabled="busy" @tap="keepBindings">否</button>
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
.counts { display: flex; flex-wrap: wrap; gap: 8rpx 20rpx; padding: 0 16rpx 14rpx; font-size: 24rpx; }
.material-list { flex: 1; height: 0; min-height: 0; padding: 14rpx 20rpx 0; }
.material-card { padding: 14rpx 16rpx; margin-bottom: 12rpx; }
.material-heading { display: flex; align-items: center; gap: 10rpx; font-size: 28rpx; font-weight: 600; }
.material-heading > text:first-child { flex: 1; min-width: 0; word-break: break-all; }
.secondary { margin-top: 6rpx; font-size: 24rpx; color: #748d93; word-break: break-word; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.tag--bound { color: #52686d; background: #edf1f2; }
.delete { height: 56rpx; width: 56rpx; padding: 0; flex-shrink: 0; border: 0; display: flex; justify-content: center; align-items: center; }
.trash-icon { width: 20rpx; height: 24rpx; border: 2px solid #bb3535; border-top: 0; position: relative; }
.trash-icon::before { content: ''; position: absolute; left: -6rpx; right: -6rpx; top: -6rpx; border-top: 2px solid #bb3535; }
.trash-icon::after { content: ''; position: absolute; width: 8rpx; left: 3rpx; top: -11rpx; border-top: 2px solid #bb3535; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; padding: 28rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-content { font-size: 28rpx; margin: 24rpx 0; line-height: 1.6; }
.modal-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 14rpx; }
.danger { color: #bb3535; border-color: #bb3535; }
</style>
