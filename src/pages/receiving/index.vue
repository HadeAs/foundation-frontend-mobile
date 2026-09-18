<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useReceiving } from '../../composables/useReceiving';
import MaterialRows from '../../components/MaterialRows.vue';

const { result: object, materials, detail, confirmingClear, busy, disabled, canReceive, canClearWms, notice, notify, clear, scan, openMaterials, closeMaterials, askClearWms, cancelClearWms, submit } = useReceiving();
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
  <view class="app-page receiving-page">
    <view class="app-nav">
      <button class="nav-back" :disabled="disabled" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">物料接收</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="scan-top">
      <ScanInput v-model="input" placeholder="扫描箱码或载具码" :disabled="disabled" show-scan-button compact inline-errors
        @scan="handleScan" @error="notify($event, true)" />
      <view v-if="object" class="card object-card">
        <view class="card-heading"><text>接收信息</text><text class="tag">{{ object.object.containerType === 'VEHICLE' ? '载具' : '料箱' }}</text></view>
        <view class="info"><text>任务号</text><text>{{ object.task?.taskNo || '—' }}</text></view>
        <view class="info"><text>对象编号</text><text>{{ object.object.containerCode }}</text></view>
        <view class="info"><text>来源位置</text><text>{{ object.task?.location ? object.task.location.locationCode + ' · ' + object.task.location.locationName : '—' }}</text></view>
        <view class="info"><text>关联物料</text><text>{{ object.totalMaterialQuantity }} 件</text></view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <view class="content">
      <view v-if="!object" class="card empty">请扫描箱子或载具<view class="empty-hint">查询当前待接收任务</view></view>
      <view v-else-if="!object.task" class="card empty">当前{{ object.object.containerType === 'BOX' ? '箱子' : '载具' }}无接收任务<view class="empty-hint">请核对编码或扫描其他容器</view></view>
      <view v-else class="card list-card">
        <view class="card-heading"><text>{{ object.object.containerType === 'VEHICLE' ? '载具内箱' : '箱内物料' }}</text><text>{{ object.object.containerType === 'VEHICLE' ? object.boxes.length + ' 箱' : object.totalMaterialQuantity + ' 件' }}</text></view>
        <scroll-view class="list-scroll" scroll-y :show-scrollbar="true">
          <view v-if="object.object.containerType === 'VEHICLE'" class="box-rows">
            <button v-for="box in object.boxes" :key="box.boxCode" class="box-row" :disabled="disabled" @tap="openMaterials(box.boxCode)">
              <view class="box-body"><view>{{ box.boxCode }}</view><view class="secondary">{{ box.materialQuantity }} 件物料</view></view>
              <text class="box-action">查看物料 ›</text>
            </button>
          </view>
          <MaterialRows v-else :materials="materials" />
        </scroll-view>
      </view>
    </view>
    <view class="footer">
      <button :disabled="disabled" @tap="clearPage">清空页面</button>
      <button class="danger" :disabled="!canClearWms" @tap="askClearWms">清空WMS历史</button>
      <button class="primary" :disabled="!canReceive" @tap="submit()">确认接收</button>
    </view>
    <view v-if="confirmingClear" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="清空WMS历史">
        <view class="modal-title">清空WMS历史</view>
        <view class="modal-content">确认清空 {{ object?.object.containerCode }} 当前接收任务的 WMS 历史绑定？此操作不会确认接收，历史追溯记录仍保留。</view>
        <view class="modal-actions">
          <button :disabled="busy" @tap="cancelClearWms">取消</button>
          <button class="danger" :disabled="busy" @tap="submit(true)">确认清空</button>
        </view>
      </view>
    </view>
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
.receiving-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
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
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1.25fr 1fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.footer button { min-width: 0; padding: 0 4rpx; font-size: 24rpx; white-space: nowrap; }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.danger { color: #bb3535; border-color: #bb3535; }
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; padding: 28rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-content { font-size: 28rpx; margin: 24rpx 0; line-height: 1.6; word-break: break-word; }
.modal-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 14rpx; }
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
</style>
