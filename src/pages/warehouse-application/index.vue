<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import PendingSubmission from '../../components/PendingSubmission.vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { onBackPress, onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useWarehouseApplication } from '../../composables/useWarehouseApplication';
import type { MaterialLine } from '../../services/vehicleLoading';
import MaterialRows from '../../components/MaterialRows.vue';

const { pending, storageError, object, orders, busy, writing, disabled, canSubmit, notice, notify, clear, pause, resume, scan, submit } = useWarehouseApplication();
const contentStateNames = { UNKNOWN: '未确认', EMPTY: '已确认空载', LOADED: '已确认非空' };
const input = ref('');
const expanded = ref<string[]>([]);
const selection = ref<{ orderNo: string; boxes: { boxCode: string; materials: MaterialLine[] }[] } | null>(null);
const scanDisabled = computed(() => disabled.value || !!selection.value);
const boxOrders = computed(() => {
  const result = new Map<string, { orderNo: string; quantity: number; materials: MaterialLine[] }[]>();
  for (const order of orders.value) {
    for (const box of order.boxes) {
      const rows = result.get(box.boxCode) || [];
      rows.push({ orderNo: order.orderNo, quantity: box.materials.reduce((n, line) => n + line.quantity, 0), materials: box.materials });
      result.set(box.boxCode, rows);
    }
  }
  return result;
});
function toggleBox(code: string) {
  expanded.value = expanded.value.includes(code) ? expanded.value.filter(item => item !== code) : [...expanded.value, code];
}
watch(object, () => { expanded.value = []; selection.value = null; }, { flush: 'sync' });
let active = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
async function handleScan(value: string) {
  if (!active || scanDisabled.value) return;
  input.value = '';
  await scan(value);
}
usePdaScanner(handleScan);
const { reset: resetKeyboard } = useKeyboardScanner(handleScan, scanDisabled);
function clearPage() { if (!disabled.value) { clear(); input.value = ''; resetKeyboard(); } }
function goBack() { if (!busy.value) uni.navigateBack(); }
onBackPress(() => {
  if (selection.value) { selection.value = null; return true; }
  return busy.value;
});
onShow(() => { active = true; resume(); });
onHide(() => {
  active = false;
  pause(); input.value = '';
  resetKeyboard();
});
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
onUnmounted(() => {
  active = false;
  clearTimeout(noticeTimer);
  pause();
});
</script>

<template>
  <view class="app-page application-page">
    <view class="app-nav">
      <button class="nav-back" :disabled="busy || !!selection" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">缴库申请</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="scan-top">
      <ScanInput v-model="input" placeholder="扫描或输入载具/箱子编码" :disabled="scanDisabled" show-scan-button compact inline-errors
        @scan="handleScan" @error="notify($event, true)" />
      <view v-if="object" class="card object-card">
        <view class="card-heading"><text>对象信息</text><text class="tag">{{ object.object.containerType === 'VEHICLE' ? '载具' : '料箱' }}</text></view>
        <view class="info"><text>扫描编码</text><text>{{ object.scanCode }}</text></view>
        <view class="info"><text>容器编号</text><text>{{ object.object.containerCode }}</text></view>
        <view class="info"><text>当前位置</text><text>{{ object.object.location ? object.object.location.locationCode + ' · ' + object.object.location.locationName : '—' }}</text></view>
        <view class="info"><text>实际内容</text><text>{{ contentStateNames[object.object.contentState || 'UNKNOWN'] }}</text></view>
        <view class="info"><text>关联物料</text><text>{{ object.totalMaterialQuantity }} 件</text></view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <view class="content">
      <PendingSubmission v-if="(pending && !writing) || storageError" :code="pending?.input.object.containerCode" :request-id="pending?.input.requestId"
        :reason="pending?.reason" :storage-error="storageError" :busy="busy" @reload="resume" />
      <view v-else-if="!object" class="card empty">请先扫描作业对象<view class="empty-hint">识别后查看关联信息，再确认提交</view></view>
      <view v-else-if="!object.totalMaterialQuantity && object.scanType === 'BOX'" class="card empty">当前对象无可处理物料<view class="empty-hint">请核对对象或扫描其他容器</view></view>
      <scroll-view v-else-if="object.scanType === 'VEHICLE'" class="list-scroll" scroll-y>
        <view class="card">
          <view class="card-heading">按订单汇总</view>
          <view v-if="!orders.length" class="empty">暂无关联板件</view>
          <button :disabled="scanDisabled" v-for="order in orders" :key="order.orderNo" class="box-row" @tap="selection = order">
            <text class="box-body">{{ order.orderNo }}</text><text class="box-action">{{ order.quantity }} 件 · 详情 ›</text>
          </button>
        </view>
        <view class="card">
          <view class="card-heading">按料箱汇总</view>
          <view v-if="!object.boxes.length" class="empty">暂无关联料箱</view>
          <view v-for="box in object.boxes" :key="box.boxCode">
            <button class="box-row" :disabled="scanDisabled" :aria-expanded="expanded.includes(box.boxCode)" @tap="toggleBox(box.boxCode)">
              <text class="box-body">{{ box.boxCode }}</text><text class="box-action">{{ box.materialQuantity }} 件 · {{ expanded.includes(box.boxCode) ? '收起' : '展开' }}</text>
            </button>
            <view v-if="expanded.includes(box.boxCode)" class="box-orders">
              <button :disabled="scanDisabled" v-for="order in boxOrders.get(box.boxCode)" :key="order.orderNo" class="box-row" @tap="selection = { orderNo: order.orderNo, boxes: [{ boxCode: box.boxCode, materials: order.materials }] }">
                <text class="box-body">{{ order.orderNo }}</text><text class="box-action">{{ order.quantity }} 件 · 详情 ›</text>
              </button>
              <view v-if="!box.materialQuantity" class="info">箱内暂无板件</view>
            </view>
          </view>
        </view>
      </scroll-view>
      <view v-else class="card list-card">
        <view class="card-heading"><text>关联物料</text><text>{{ object.totalMaterialQuantity }} 件</text></view>
        <scroll-view class="list-scroll" scroll-y>
          <view v-for="order in orders" :key="order.orderNo" class="order-group">
            <view class="order-heading"><text>订单 {{ order.orderNo }}</text><text>{{ order.quantity }} 件</text></view>
            <MaterialRows v-for="box in order.boxes" :key="box.boxCode" :materials="box.materials" show-batch grouped-by-order />
          </view>
        </scroll-view>
      </view>
    </view>
    <view class="footer">
      <button :disabled="scanDisabled" @tap="clearPage">清空页面</button>
      <button class="primary" :disabled="!canSubmit || !!selection" @tap="submit">{{ writing ? '提交中…' : pending ? '重试原请求' : '确认申请' }}</button>
    </view>
    <view v-if="selection" class="modal-mask">
      <view class="modal detail-modal" role="dialog" aria-modal="true" aria-label="订单板件明细">
        <view class="detail-heading">订单 {{ selection.orderNo }}</view>
        <view class="detail-scroll">
          <view v-for="box in selection.boxes" :key="box.boxCode">
            <view class="order-heading">{{ box.boxCode }}</view>
            <MaterialRows :materials="box.materials" grouped-by-order show-batch />
          </view>
        </view>
        <view class="detail-footer"><button @tap="selection = null">关闭</button></view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.box-orders { padding-left: 20rpx; }
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
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; padding: 28rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-content { font-size: 28rpx; margin: 24rpx 0; line-height: 1.6; word-break: break-word; }
.modal-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 14rpx; }
.list-card { display: flex; flex-direction: column; min-height: 0; max-height: 100%; flex: 1; }
.list-card > .card-heading { flex-shrink: 0; }
.list-scroll { flex: 1; height: 0; min-height: 0; }
.order-group + .order-group { border-top: 1px solid #dfebed; }
.order-heading { display: flex; justify-content: space-between; align-items: center; gap: 12rpx; padding: 12rpx 16rpx; background: #edf6f6; font-size: 24rpx; font-weight: 600; }
.order-heading text:first-child { min-width: 0; overflow-wrap: anywhere; }
.order-heading text:last-child { flex-shrink: 0; }
.box-rows { padding: 0 16rpx; }
.box-row { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; height: auto; line-height: 1.4; padding: 16rpx; border: 0; border-bottom: 1px solid #dfebed; border-radius: 0; text-align: left; font-size: 28rpx; color: #254b54; font-weight: normal; }
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
