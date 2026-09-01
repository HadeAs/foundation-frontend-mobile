<script setup lang="ts">
import { shallowRef } from 'vue';
import ScanInput from '../../components/ScanInput.vue';
import { usePagedQuery } from '../../composables/usePagedQuery';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { fetchInventoryPage, fetchLatestInventoryItems } from '../../services/inventory';
import type { InventoryItem, InventoryStatus } from '../../types/inventory';

const scanInputRef = shallowRef<InstanceType<typeof ScanInput> | null>(null);
const {
  queryText,
  items,
  hasMore,
  initialLoading,
  loadingMore,
  refreshing,
  clearQuery,
  setQuery,
  loadNextPage,
  refreshLatest
} = usePagedQuery<InventoryItem>({
  pageSize: 10,
  fetchPage: fetchInventoryPage,
  fetchLatest: fetchLatestInventoryItems,
  getId: (item) => item.id
});

usePdaScanner((value) => {
  scanInputRef.value?.setScanResult(value, { emitScan: false });
});

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function handleScanResult(value: string) {
  setQuery(value);
}

function statusClass(status: InventoryStatus) {
  return {
    'inventory-status--normal': status === '正常',
    'inventory-status--locked': status === '锁定',
    'inventory-status--expired': status === '过期'
  };
}

</script>

<template>
  <view class="app-page inventory-page">
    <view class="app-nav">
      <view class="app-nav__button" @tap="goBack">返回</view>
      <view class="app-nav__title">库存查询</view>
      <view class="app-nav__spacer"></view>
    </view>

    <view class="inventory-search">
      <ScanInput
        ref="scanInputRef"
        v-model="queryText"
        placeholder="扫描或输入条码/物料/容器/库位"
        confirm-type="search"
        @scan="handleScanResult"
        @clear="clearQuery"
      />
    </view>

    <view v-if="initialLoading" class="inventory-loading-mask">
      <view class="inventory-loading-box">加载中...</view>
    </view>

    <scroll-view
      class="inventory-list"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @scrolltolower="loadNextPage"
      @refresherrefresh="refreshLatest"
    >
      <view v-for="item in items" :key="item.id" class="inventory-card">
        <view class="inventory-card__info">
          <view class="inventory-card__barcode">{{ item.barcodeNo }}</view>
          <view class="inventory-card__grid">
            <view class="inventory-card__row"><text>批次号</text><text>{{ item.batchNo }}</text></view>
            <view class="inventory-card__row"><text>物料编码</text><text>{{ item.materialCode }}</text></view>
            <view class="inventory-card__row"><text>物料名称</text><text>{{ item.materialName }}</text></view>
            <view class="inventory-card__row"><text>数量</text><text>{{ item.quantity }}({{ item.unit }})</text></view>
            <view class="inventory-card__row"><text>所在容器</text><text>{{ item.containerCode }}</text></view>
            <view class="inventory-card__row"><text>所在库位</text><text>{{ item.locationCode }}</text></view>
          </view>
        </view>
        <view class="inventory-card__status">
          <view class="inventory-status" :class="statusClass(item.status)">{{ item.status }}</view>
        </view>
      </view>

      <view v-if="!initialLoading && items.length === 0" class="inventory-empty">暂无库存数据</view>
      <view v-if="loadingMore" class="inventory-loading">正在加载下一页...</view>
      <view v-else-if="!hasMore && items.length > 0" class="inventory-loading">没有更多库存</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.inventory-page {
  position: relative;
  height: 100vh;
  overflow: hidden;
}

.inventory-search {
  flex: none;
  z-index: 2;
  padding: 24rpx;
  background: #f2f8f8;
}

.inventory-list {
  flex: 1;
  min-height: 0;
  padding: 0 24rpx;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.inventory-loading-mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 232rpx;
  bottom: 0;
  z-index: 3;
  background: rgba(243, 246, 251, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
}

.inventory-loading-box {
  min-width: 180rpx;
  min-height: 84rpx;
  padding: 0 32rpx;
  border: 2rpx solid #d8e2ef;
  border-radius: 8rpx;
  background: #ffffff;
  color: #0d9496;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pull-refresh {
  height: 0;
  overflow: hidden;
  color: #64748b;
  font-size: 24rpx;
  line-height: 44px;
  text-align: center;
  transition: height 0.16s ease;
}

.pull-refresh--active {
  color: #0d9496;
  font-weight: 700;
}

.inventory-card {
  margin-bottom: 20rpx;
  padding: 24rpx;
  border: 2rpx solid #d8e2ef;
  border-radius: 8rpx;
  background: #ffffff;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 118rpx;
  align-items: center;
  gap: 18rpx;
}

.inventory-card__info {
  min-width: 0;
}

.inventory-card__barcode {
  width: 100%;
  margin-bottom: 18rpx;
  color: #102a43;
  font-size: 34rpx;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inventory-card__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4rpx;
}

.inventory-card__row {
  min-width: 0;
  min-height: 40rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
  color: #64748b;
  font-size: 24rpx;
}

.inventory-card__row text:first-child {
  flex: none;
  width: 112rpx;
}

.inventory-card__row text:last-child {
  min-width: 0;
  color: #102a43;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inventory-card__status {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.inventory-status {
  flex: none;
  min-width: 96rpx;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  text-align: center;
  font-size: 24rpx;
  font-weight: 700;
}

.inventory-status--normal {
  background: #e5f8ed;
  color: #15803d;
}

.inventory-status--locked {
  background: #fff3d6;
  color: #b45309;
}

.inventory-status--expired {
  background: #fee2e2;
  color: #b91c1c;
}

.inventory-empty,
.inventory-loading {
  padding: 28rpx 0;
  color: #64748b;
  font-size: 26rpx;
  text-align: center;
}
</style>
