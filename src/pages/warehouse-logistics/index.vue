<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useWarehouseLogistics } from '../../composables/useWarehouseLogistics';
import MaterialRows from '../../components/MaterialRows.vue';
import LocationCascade from '../../components/LocationCascade.vue';
import { locationPath } from '../../services/logistics';

const { options, scanCode, destination, candidates, choosing, detail, busy, disabled, canSubmit, notice, notify, clear, scan, openChoice, closeChoice, choose, openMaterials, closeMaterials, submit } = useWarehouseLogistics();
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
  clear(); input.value = ''; clearTimeout(noticeTimer);
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
    <view class="app-nav">
      <button class="nav-back" :disabled="disabled" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">缴库发起</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="scan-top">
      <ScanInput v-model="input" placeholder="扫描或输入载具/位置编码" :disabled="disabled" show-scan-button compact inline-errors
        @scan="handleScan" @error="notify($event, true)" />
      <view v-if="options" class="card object-card">
        <view class="card-heading"><text>对象信息</text><text class="tag">{{ options.object.containerType === 'VEHICLE' ? '载具' : '料箱' }}</text></view>
        <view class="info"><text>扫描编码</text><text>{{ scanCode }}</text></view>
        <view class="info"><text>容器编号</text><text>{{ options.object.containerCode }}</text></view>
        <view class="info"><text>当前位置</text><text>{{ options.origin.locationCode }} · {{ options.origin.locationName }}</text></view>
        <view class="info"><text>关联物料</text><text>{{ options.totalMaterialQuantity }} 件</text></view>
      </view>
      <view v-if="options" class="card destination-card">
        <view class="card-heading"><text>目标地点</text><text>{{ candidates.length }} 个可选</text></view>
        <button v-if="candidates.length > 1" class="choice" :disabled="disabled" @tap="openChoice">
          <text>{{ destination ? locationPath(destination) : '请选择目标地点' }}</text><text>切换 ›</text>
        </button>
        <view v-else-if="destination" class="single-destination">{{ locationPath(destination) }}</view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <view class="content">
      <view v-if="!options" class="card empty">请先扫描作业对象<view class="empty-hint">识别后查看关联信息，再确认提交</view></view>
      <view v-else class="card list-card">
        <view class="card-heading"><text>关联料箱</text><text>{{ options.boxes.length }} 箱</text></view>
        <scroll-view class="list-scroll" scroll-y :show-scrollbar="true">
          <view class="box-rows">
            <button v-for="box in options.boxes" :key="box.boxCode" class="box-row" :disabled="disabled" @tap="openMaterials(box.boxCode)">
              <view class="box-body"><view>{{ box.boxCode }}</view><view class="secondary">{{ box.materialQuantity }} 件物料</view></view>
              <text class="box-action">查看物料 ›</text>
            </button>
            <view v-if="!options.boxes.length" class="empty">当前对象暂无关联料箱</view>
          </view>
        </scroll-view>
      </view>
    </view>
    <view class="footer">
      <button :disabled="disabled" @tap="clearPage">清空页面</button>
      <button class="primary" :disabled="!canSubmit" @tap="submit">确认发起</button>
    </view>
    <LocationCascade v-if="choosing" title="选择目标地点" :locations="candidates" :selected="destination" @confirm="choose" @cancel="closeChoice" />
    <view v-if="detail" class="modal-mask">
      <view class="modal detail-modal" role="dialog" aria-modal="true" aria-label="箱内物料">
        <view class="detail-heading"><text class="modal-title">箱内物料</text><text class="detail-summary">{{ detail.box.containerCode }} · {{ detail.totalQuantity }} 件</text></view>
        <view class="detail-scroll">
          <MaterialRows v-if="detail.materials.length" :materials="detail.materials" />
          <view v-else class="empty">当前箱子暂无物料</view>
        </view>
        <view class="detail-footer"><button @tap="closeMaterials">关闭</button></view>
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
.object-card { margin-top: 14rpx; }
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
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; padding: 28rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.list-card { display: flex; flex-direction: column; min-height: 0; max-height: 100%; flex: 1; }
.list-card > .card-heading { flex-shrink: 0; }
.list-scroll { flex: 1; height: 0; min-height: 0; }
.box-rows { padding: 0 16rpx; }
.box-row { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; height: auto; line-height: 1.4; padding: 20rpx 0; border: 0; border-bottom: 1px solid #dfebed; border-radius: 0; text-align: left; font-size: 28rpx; color: #254b54; font-weight: normal; }
.box-row:last-child { border-bottom: 0; }
.box-body { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.secondary { font-size: 24rpx; color: #748d93; margin-top: 6rpx; }
.box-action { flex-shrink: 0; color: #087779; font-size: 24rpx; }
.detail-modal { display: flex; flex-direction: column; padding: 0; max-height: 80vh; overflow: hidden; }
.detail-heading { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 20rpx; border-bottom: 1px solid #dfebed; }
.detail-summary { min-width: 0; font-size: 24rpx; color: #748d93; text-align: right; overflow-wrap: anywhere; }
.detail-heading .modal-title { flex-shrink: 0; }
.detail-scroll { max-height: 48vh; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.detail-footer { flex-shrink: 0; padding: 20rpx; }
.choice { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; width: calc(100% - 32rpx); margin: 12rpx 16rpx; padding: 12rpx; height: auto; min-height: 76rpx; line-height: 1.4; text-align: left; color: #254b54; }
.choice text:first-child { min-width: 0; overflow-wrap: anywhere; }
.choice text:last-child { flex-shrink: 0; color: #087779; }
.single-destination { padding: 16rpx; font-size: 28rpx; overflow-wrap: anywhere; }
</style>
