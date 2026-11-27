<script setup lang="ts">
import { releaseStatusNames, type useReceivingVehicleRelease } from '../composables/useReceivingVehicleRelease';
const props = defineProps<{ flow: ReturnType<typeof useReceivingVehicleRelease> }>();
const { visible, asking, pending, vehicles, storageError, writing } = props.flow;
</script>

<template>
  <view v-if="visible" class="release-mask">
    <view class="release-dialog" role="dialog" aria-modal="true" aria-label="车位解绑">
      <view class="heading">{{ asking ? '是否解绑车与位置关系？' : '车位解绑结果' }}</view>
      <view v-if="storageError">{{ storageError }}</view>
      <template v-else-if="!asking && pending">
        <view>{{ pending.reason }}</view><view>接收请求 {{ pending.input.receivingRequestId }}</view>
      </template>
      <view class="vehicle-list" v-else-if="vehicles.length">
        <view v-for="row in vehicles" :key="row.vehicleCode + '/' + row.locationCode" class="vehicle">
          <text>{{ row.vehicleCode }} · {{ row.locationCode }}</text><text>{{ releaseStatusNames[row.status] }}</text>
        </view>
      </view>
      <view class="actions">
        <button v-if="storageError" @tap="flow.restore">重新读取</button>
        <template v-else-if="pending">
          <button v-if="asking" :disabled="writing" @tap="flow.close">暂不解绑</button>
          <button class="primary" :disabled="writing" @tap="flow.confirm">{{ writing ? '处理中…' : asking ? '确认解绑' : '核实原解绑请求' }}</button>
        </template>
        <button v-else class="primary" @tap="flow.close">完成</button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.release-mask { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 24rpx; background: #173f4866; }
.release-dialog { padding: 24rpx; width: 100%; max-width: 440px; border-radius: 14rpx; background: white; color: #254b54; font-size: 26rpx; overflow-wrap: anywhere; }
.heading { font-size: 30rpx; font-weight: 600; margin-bottom: 14rpx; }
.vehicle-list { overflow: auto; max-height: 50vh; }
.vehicle { display: flex; justify-content: space-between; gap: 12rpx; padding: 12rpx 0; }
.actions { display: flex; gap: 12rpx; margin-top: 20rpx; }
button { flex: 1; margin: 0; font-size: 26rpx; }
.primary { background: #0d9496; color: white; }
</style>
