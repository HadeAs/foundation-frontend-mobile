<script setup lang="ts">
import type { MaterialLine } from '../services/vehicleLoading';
defineProps<{ materials: MaterialLine[] }>();
</script>

<template>
  <view class="material-rows">
    <view v-for="(row, index) in materials" :key="index" class="material-row">
      <view class="material-body">
        <view class="material-code">{{ row.lineType === 'PANEL' ? row.panelCode : row.materialCode }}</view>
        <view class="material-sub">{{ row.lineType === 'PANEL' ? `${row.materialCode} · ` : '' }}{{ row.materialName }}</view>
        <view class="material-sub">订单 {{ row.orderNo }}{{ row.orderLineNo ? ` / ${row.orderLineNo}` : '' }}</view>
        <view v-if="row.lineType === 'QUANTITY'" class="material-sub">数量汇总</view>
      </view>
      <text class="material-quantity">{{ row.quantity }} {{ row.unit }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.material-rows { padding: 0 16rpx; }
.material-row { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 0; border-bottom: 1px solid #dfebed; }
.material-row:last-child { border-bottom: 0; }
.material-body { flex: 1; min-width: 0; }
.material-code { font-size: 28rpx; color: #254b54; overflow-wrap: anywhere; }
.material-sub { font-size: 24rpx; color: #748d93; margin-top: 6rpx; overflow-wrap: anywhere; }
.material-quantity { font-size: 24rpx; color: #087779; max-width: 30%; overflow-wrap: anywhere; text-align: right; }
</style>
