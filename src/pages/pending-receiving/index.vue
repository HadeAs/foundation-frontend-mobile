<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import PendingSubmission from '../../components/PendingSubmission.vue';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { onShow, onHide, onLoad, onBackPress } from '@dcloudio/uni-app';
import { usePendingReceiving } from '../../composables/usePendingReceiving';
import { displayTaskTime, type PendingApplication } from '../../services/pendingReceiving';

const flow = usePendingReceiving();
const { vehicleCode, locationCode, items, total, loading, refreshing, error, notice, noticeError, hasMore,
  selectedIds, reason, confirming, submitting, selectionLocked, pending, storageError,
  detailApplication, detailRows, detailLoading, detailError } = flow;
const selectionCount = computed(() => pending.value?.input.items.length ?? selectedIds.value.size);
const scrollTop = ref(0);
const scannedCode = ref('');
let opening = false;
onLoad(query => { if (typeof query?.scanCode === 'string') scannedCode.value = query.scanCode; });
function openApplication(row: PendingApplication) {
  if (opening || !scannedCode.value) return;
  opening = true;
  uni.navigateTo({
    url: `/pages/receiving/index?applicationId=${row.applicationId}&scanCode=${encodeURIComponent(scannedCode.value)}`,
    fail: () => { noticeError.value = true; notice.value = '无法打开缴库接收，请重试'; },
    complete: () => { opening = false; }
  });
}
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = ''; }, 6500);
});
async function query() {
  scrollTop.value = 1;
  await nextTick();
  scrollTop.value = 0;
  await flow.query();
}
onShow(() => { flow.resume(); void query(); });
onHide(() => { flow.dispose(); clearTimeout(noticeTimer); });
onUnmounted(() => { flow.dispose(); clearTimeout(noticeTimer); });
function goBack() { uni.navigateBack({ delta: 1 }); }
onBackPress(() => {
  if (!detailApplication.value) return false;
  flow.closeDetail(); return true;
});
</script>

<template>
  <view class="app-page pending-page">
    <view class="app-nav">
      <button class="nav-back" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">缴库待接收</view>
      <view></view>
    </view>
    <OperationNotice :text="notice" :error="noticeError" />
    <view class="filters">
      <input v-model="vehicleCode" placeholder="箱号或载具号" aria-label="箱号或载具号" :maxlength="128" confirm-type="search" @confirm="query" />
      <input v-model="locationCode" placeholder="库位号" aria-label="库位号" :maxlength="128" confirm-type="search" @confirm="query" />
      <button class="query-button" :disabled="loading" @tap="query">查询</button>
    </view>
    <view class="content">
      <view class="list-card">
        <view class="card-heading"><text>缴库待接收</text><text class="count">已加载 {{ items.length }} / {{ total }} 条</text></view>
        <scroll-view class="list-scroll" scroll-y refresher-enabled :refresher-triggered="refreshing" :scroll-top="scrollTop"
          :lower-threshold="60" @scrolltolower="flow.loadMore" @refresherrefresh="flow.refresh">
          <view class="rows">
            <view v-for="task in items" :key="task.applicationId" class="task-record">
              <view class="record-row">
                <checkbox-group v-if="!scannedCode" @change="flow.toggle(task)">
                  <checkbox :id="`select-${task.applicationId}`" :value="task.applicationId" :checked="selectedIds.has(task.applicationId)"
                    :disabled="selectionLocked || task.receivedBoxCount === task.totalBoxCount" color="#0D9496" :aria-label="`选择申请 ${task.applicationNo}`" />
                </checkbox-group>
                <view class="record-body">
                  <view class="record-heading">
                    <button v-if="!scannedCode" class="detail-link task-number" @tap="flow.openDetail(task)">申请单号 {{ task.applicationNo }} ›</button>
                    <template v-else>
                      <text class="task-number">申请单号 {{ task.applicationNo }}</text>
                      <button class="view-application" @tap="openApplication(task)">选择此申请 ›</button>
                    </template>
                  </view>
                  <label :for="scannedCode ? undefined : `select-${task.applicationId}`">
                    <view class="record-meta">{{ task.object.containerType === 'BOX' ? '箱号' : '载具号' }} {{ task.object.containerCode }}</view>
                    <view class="record-meta">库位号 {{ task.object.location?.locationCode || '—' }}</view>
                    <view class="record-meta">接收状态 <text class="receiving-progress">{{ task.statusName }} · 实收 {{ task.receivedBoxCount }}/{{ task.totalBoxCount }} 箱</text></view>
                    <view class="record-meta">创建时间 {{ displayTaskTime(task.createdTime) }}</view>
                  </label>
                </view>
              </view>
            </view>
            <view class="list-status" role="status">
              <text v-if="loading">{{ refreshing ? '刷新中…' : '加载中…' }}</text>
              <button v-else-if="error" class="retry" @tap="flow.retry">加载失败，点击重试</button>
              <text v-else-if="!items.length">暂无待接收的缴库申请</text>
              <text v-else>{{ hasMore ? '上滑加载更多' : '已加载全部申请' }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>
    <view v-if="!scannedCode" class="footer">
      <PendingSubmission v-if="(pending && !submitting) || storageError" :request-id="pending?.input.requestId" :reason="pending?.reason"
        :storage-error="storageError" :busy="submitting" @reload="flow.resume" />
      <button class="danger" :disabled="!selectionCount || loading || submitting || !!storageError" @tap="flow.askNotShelve">
        {{ submitting ? '提交中…' : pending ? '重试原请求' : '不予上架' }}（{{ selectionCount }}）
      </button>
    </view>
    <view v-if="detailApplication" class="modal-mask">
      <view class="modal detail-modal" role="dialog" aria-modal="true" aria-label="缴库申请明细">
        <view class="card-heading"><text>缴库申请明细</text><text class="count">{{ detailApplication.applicationNo }}</text></view>
        <view class="detail-body">
          <view v-if="detailLoading" class="list-status" role="status">正在加载申请明细…</view>
          <view v-else-if="detailError" class="list-status"><button class="retry" @tap="flow.openDetail(detailApplication)">加载失败，点击重试</button></view>
          <view v-else-if="!detailRows.length" class="list-status" role="status">暂无申请明细</view>
          <view v-for="row in detailRows" :key="JSON.stringify([row.materialCode, row.orderNo])" class="task-record">
            <view class="task-number">{{ row.materialCode }}</view>
            <view class="record-meta">订单 {{ row.orderNo }} · {{ row.quantity }} 件</view>
          </view>
        </view>
        <button class="detail-close" @tap="flow.closeDetail">关闭</button>
      </view>
    </view>
    <view v-if="confirming" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="确认不予上架">
        <view class="modal-title">确认不予上架</view>
        <view class="modal-scope">所选 {{ selectionCount }} 笔申请的全部剩余箱将不予上架。</view>
        <textarea v-model="reason" aria-label="不予上架原因" placeholder="填写不予上架原因（必填，最多500字）" :maxlength="500" :disabled="submitting || !!pending" />
        <view class="modal-actions">
          <button :disabled="submitting" @tap="flow.cancelNotShelve">取消</button>
          <button class="danger" :disabled="submitting || !reason.trim() || reason.trim().length > 500 || !!storageError" @tap="flow.confirmNotShelve">{{ submitting ? '提交中…' : '确认提交' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.pending-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.filters { flex-shrink: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 112rpx; gap: 10rpx; padding: 16rpx 20rpx 0; }
input { min-width: 0; height: 76rpx; box-sizing: border-box; border: 1px solid #9fbfc5; border-radius: 8rpx; background: white; padding: 0 14rpx; font-size: 28rpx; }
.query-button { background: #e6f6f6; color: #087779; border-color: #0d9496; }
.content { flex: 1; height: 0; min-height: 0; display: flex; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.list-card { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.card-heading { flex-shrink: 0; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8rpx; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.count { font-size: 24rpx; font-weight: normal; }
.list-scroll { flex: 1; height: 0; min-height: 0; }
.rows { padding: 0 16rpx; }
.task-record { padding: 18rpx 0; border-bottom: 1px solid #dfebed; overflow-wrap: anywhere; }
.record-row { display: flex; align-items: center; gap: 12px; }
.record-row checkbox { flex-shrink: 0; margin: 0; transform: scale(0.85); transform-origin: right center; }
.record-row :deep(.uni-checkbox-input) { margin-right: 0; }
.record-body { flex: 1; min-width: 0; }
.task-number { font-size: 28rpx; font-weight: 600; }
.record-heading { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.view-application { flex-shrink: 0; height: auto; line-height: 1.6; border: 0; font-size: 24rpx; color: #087779; }
.detail-link { padding: 0; border: 0; height: auto; line-height: 1.6; text-align: left; white-space: normal; overflow-wrap: anywhere; color: #087779; }
.record-meta { margin-top: 6rpx; font-size: 24rpx; color: #748d93; line-height: 1.5; }
.receiving-progress { color: #254b54; }
.list-status { padding: 24rpx 0; text-align: center; font-size: 24rpx; color: #748d93; }
.retry { display: inline-block; padding: 0 20rpx; }
.footer { flex-shrink: 0; padding: 0 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.danger { border-color: #bb3535; color: #bb3535; }
.modal-mask { position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; background: #163e4970; }
.modal { box-sizing: border-box; width: 100%; max-width: 440px; max-height: 80vh; overflow-y: auto; padding: 24rpx; border-radius: 16rpx; background: white; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.detail-modal { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
.detail-modal .count { overflow-wrap: anywhere; }
.detail-body { min-height: 0; overflow-y: auto; padding: 0 16rpx; }
.detail-close { flex-shrink: 0; margin: 16rpx; }
.modal-scope { margin: 16rpx 0; font-size: 26rpx; }
.modal textarea { box-sizing: border-box; width: 100%; height: 120rpx; padding: 12rpx; border: 1px solid #9fbfc5; border-radius: 8rpx; font-size: 26rpx; }
.modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12rpx; margin-top: 20rpx; }
</style>
