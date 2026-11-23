<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { onBackPress, onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import OperationNotice from '../../components/OperationNotice.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useLineSideInboundRecords } from '../../composables/useLineSideInboundRecords';
import { inboundModes, syncStatuses } from '../../services/lineSideInboundRecords';
import { displayTaskTime } from '../../services/pendingReceiving';

const flow = useLineSideInboundRecords();
const { boxCode, inboundMode, syncStatus, fromDate, fromTime, toDate, toTime, items, total, loading, refreshing, hasMore,
  listError, notice, selected, detail, detailError } = flow;
const modeKeys = Object.keys(inboundModes) as (keyof typeof inboundModes)[];
const statusKeys = Object.keys(syncStatuses) as (keyof typeof syncStatuses)[];
const modeLabels = ['全部方式', ...Object.values(inboundModes)];
const statusLabels = ['全部状态', ...Object.values(syncStatuses)];
const more = ref(false);
const scrollTop = ref(0);
const inDetail = computed(() => !!selected.value);
let active = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(notice, value => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = ''; }, 6500);
});
async function search() {
  if (!active || inDetail.value) return;
  scrollTop.value = 1; await nextTick(); scrollTop.value = 0;
  await flow.query();
}
function scan(value: string) {
  if (!active || inDetail.value) return;
  boxCode.value = value.trim(); void search();
}
function resetFilters() {
  boxCode.value = ''; inboundMode.value = undefined; syncStatus.value = undefined;
  fromDate.value = ''; toDate.value = ''; fromTime.value = '00:00'; toTime.value = '23:59';
  void search();
}
usePdaScanner(scan);
const { reset: resetKeyboard } = useKeyboardScanner(scan, inDetail);
function pause() { active = false; resetKeyboard(); flow.pause(); clearTimeout(noticeTimer); }
onShow(() => { active = true; void flow.resume(); });
onHide(pause);
onUnmounted(pause);
onBackPress(() => {
  if (!selected.value) return false;
  flow.closeDetail(); return true;
});
function goBack() { uni.navigateBack({ delta: 1 }); }
</script>

<template>
  <view class="app-page records-page">
    <view class="app-nav">
      <button class="nav-back" @tap="goBack">‹ 返回</button><view class="app-nav__title">线边入库记录</view><view />
    </view>
    <OperationNotice :text="notice" error />
    <view class="filters">
      <view class="search-row">
        <ScanInput v-model="boxCode" placeholder="扫描或输入箱码" confirm-type="search" show-scan-button compact inline-errors
          :disabled="inDetail" @scan="scan" @clear="scan('')" @error="notice = $event" />
        <button class="query" :disabled="inDetail" @tap="search">查询</button>
      </view>
      <view class="filter-heading">
        <button class="toggle" :aria-expanded="more" @tap="more = !more">{{ more ? '收起筛选 ▴' : '更多筛选 ▾' }}</button>
        <text class="muted">已加载 {{ items.length }} / {{ total }} 条</text>
      </view>
      <view v-if="more" class="extra-filters">
        <view class="picker-row">
          <picker :range="modeLabels" :value="inboundMode ? modeKeys.indexOf(inboundMode) + 1 : 0" @change="inboundMode = modeKeys[Number($event.detail.value) - 1]">
            <view class="field" role="button" aria-label="入库方式">{{ inboundMode ? inboundModes[inboundMode] : '全部入库方式' }} ▾</view>
          </picker>
          <picker :range="statusLabels" :value="syncStatus ? statusKeys.indexOf(syncStatus) + 1 : 0" @change="syncStatus = statusKeys[Number($event.detail.value) - 1]">
            <view class="field" role="button" aria-label="分拣同步状态">{{ syncStatus ? syncStatuses[syncStatus] : '全部同步状态' }} ▾</view>
          </picker>
        </view>
        <view class="time-row"><text>入库起始</text>
          <picker mode="date" :value="fromDate" @change="fromDate = $event.detail.value"><view class="field" role="button" aria-label="起始日期">{{ fromDate || '选择日期' }}</view></picker>
          <picker mode="time" :value="fromTime" :disabled="!fromDate" @change="fromTime = $event.detail.value"><view class="field" role="button" aria-label="起始时刻">{{ fromTime }}</view></picker>
        </view>
        <view class="time-row"><text>入库截止</text>
          <picker mode="date" :value="toDate" @change="toDate = $event.detail.value"><view class="field" role="button" aria-label="截止日期">{{ toDate || '选择日期' }}</view></picker>
          <picker mode="time" :value="toTime" :disabled="!toDate" @change="toTime = $event.detail.value"><view class="field" role="button" aria-label="截止时刻">{{ toTime }}</view></picker>
        </view>
        <button class="toggle reset" @tap="resetFilters">重置筛选</button>
      </view>
    </view>
    <view class="content">
      <scroll-view class="list" scroll-y :scroll-top="scrollTop" :refresher-enabled="!inDetail" :refresher-triggered="refreshing"
        :lower-threshold="60" @refresherrefresh="flow.refresh" @scrolltolower="flow.loadMore">
        <button v-for="row in items" :key="row.id" class="record" @tap="flow.openDetail(row)">
          <view class="record-heading"><text>箱号 {{ row.boxCode || '—' }}</text><text v-if="row.inboundMode" class="badge">{{ inboundModes[row.inboundMode] || row.inboundMode }}</text></view>
          <view class="meta"><text>入库时间</text><text>{{ row.inboundTime ? displayTaskTime(row.inboundTime) : '—' }}</text></view>
          <view class="meta"><text>入库地标</text><text>{{ row.locationCode || '—' }}</text></view>
          <view v-if="row.lineSideCode" class="meta"><text>线边库</text><text>{{ row.lineSideCode }}</text></view>
          <view v-if="row.shippingNo" class="meta"><text>发货单号</text><text>{{ row.shippingNo }}</text></view>
          <view class="meta"><text>分拣同步</text><text>{{ row.syncStatus ? syncStatuses[row.syncStatus] || row.syncStatus : '—' }}</text></view>
          <view class="record-foot"><text>{{ row.totalQuantity == null ? '' : row.totalQuantity + ' 件' }}</text><text>查看板件明细 ›</text></view>
        </button>
        <view class="list-state" role="status">
          <text v-if="loading">{{ refreshing ? '刷新中…' : '加载中…' }}</text>
          <button v-else-if="listError" @tap="flow.retryList">加载失败，点击重试</button>
          <text v-else-if="!items.length">暂无入库记录</text>
          <text v-else>{{ hasMore ? '上滑加载更多' : '已加载全部记录' }}</text>
        </view>
      </scroll-view>
    </view>
    <view v-if="selected" class="mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="入库板件明细">
        <view class="detail-heading"><text>入库板件明细</text><text class="muted">{{ selected.boxCode }}</text></view>
        <view class="detail-body">
          <template v-if="detail">
            <view v-if="detail.operatorIdentity" class="meta"><text>操作人</text><text>{{ detail.operatorIdentity }}</text></view>
            <view v-if="detail.syncedTime" class="meta"><text>同步时间</text><text>{{ displayTaskTime(detail.syncedTime) }}</text></view>
            <view v-if="detail.syncReason" class="meta"><text>同步说明</text><text>{{ detail.syncReason }}</text></view>
            <view v-for="(line, index) in detail.materials" :key="index" class="material">
              <view class="material-head"><text>{{ line.panelCode || line.materialCode || '—' }}</text><text v-if="line.quantity != null">{{ line.quantity }} 件</text></view>
              <view v-if="line.panelCode && line.materialCode" class="muted">物料 {{ line.materialCode }}</view>
              <view v-if="line.materialBatch" class="muted">批次 {{ line.materialBatch }}</view>
              <view v-if="line.orderNo" class="muted">订单 {{ line.orderNo }}</view>
            </view>
            <view v-if="!detail.materials.length" class="list-state">本次入库没有板件明细</view>
          </template>
          <view v-else-if="detailError" class="list-state" role="alert">{{ detailError }}
            <button @tap="flow.openDetail(selected)">重试查询</button>
          </view>
          <view v-else class="list-state">明细加载中…</view>
        </view>
        <button class="close" @tap="flow.closeDetail">关闭</button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.records-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 16rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-size: 26rpx; line-height: 2.5; }
button::after { border: 0; }
.nav-back, .toggle { border: 0; background: transparent; text-align: left; }
.nav-back { color: white; padding: 0 8rpx; font-weight: 600; }
.filters { flex-shrink: 0; padding: 16rpx 20rpx 0; }
.search-row { display: grid; grid-template-columns: minmax(0,1fr) 100rpx; gap: 10rpx; }
.query { color: #087779; background: #e6f6f6; border-color: #0d9496; font-weight: 600; }
.filter-heading, .record-heading, .record-foot, .material-head, .detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.toggle { padding: 0 4rpx; color: #087779; }
.extra-filters { display: grid; gap: 8rpx; margin-bottom: 12rpx; }
.picker-row, .time-row { display: grid; align-items: center; gap: 10rpx; grid-template-columns: 1fr 1fr; }
.time-row { grid-template-columns: auto minmax(0,1fr) minmax(0,.65fr); font-size: 24rpx; }
.field { text-align: center; border: 1px solid #b8d3d6; border-radius: 8rpx; background: white; font-size: 25rpx; padding: 10rpx 4rpx; }
.reset { justify-self: end; line-height: 2; }
.content { flex: 1; min-height: 0; padding: 0 20rpx calc(14rpx + env(safe-area-inset-bottom)); display: flex; }
.list { flex: 1; min-height: 0; height: 100%; }
.record { box-sizing: border-box; width: 100%; margin-bottom: 12rpx; padding: 15rpx 16rpx; text-align: left; border-color: #cee1e3; color: #254b54; line-height: 1.5; overflow-wrap: anywhere; }
.record-heading, .material-head, .detail-heading { font-weight: 600; font-size: 28rpx; }
.badge { flex-shrink: 0; border-radius: 20rpx; padding: 2rpx 12rpx; background: #e6f6f6; color: #087779; font-size: 23rpx; }
.meta { display: grid; grid-template-columns: 108rpx minmax(0,1fr); margin-top: 6rpx; font-size: 24rpx; }
.meta text:first-child, .muted, .list-state { color: #687f85; font-size: 24rpx; }
.record-foot { color: #087779; margin-top: 8rpx; font-size: 24rpx; }
.list-state { padding: 20rpx 0; text-align: center; }
.list-state button { width: fit-content; margin: 8rpx auto; }
.mask { position: fixed; inset: 0; z-index: 20; background: #163e4970; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { width: 100%; max-width: 440px; max-height: 80vh; max-height: 80dvh; background: white; border-radius: 16rpx; display: flex; flex-direction: column; overflow: hidden; }
.detail-heading, .close { flex-shrink: 0; }
.detail-heading { padding: 18rpx; border-bottom: 1px solid #dfebed; }
.detail-heading .muted { min-width: 0; overflow-wrap: anywhere; text-align: right; }
.detail-body { min-height: 0; overflow-y: auto; padding: 0 18rpx; overflow-wrap: anywhere; }
.material { padding: 14rpx 0; border-bottom: 1px solid #dfebed; line-height: 1.5; }
.material-head text:last-child:not(:first-child) { flex-shrink: 0; color: #087779; font-size: 24rpx; }
.close { margin: 16rpx; }
</style>
