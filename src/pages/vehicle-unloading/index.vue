<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useVehicleUnloading } from '../../composables/useVehicleUnloading';

const { vehicle, loaded, selected, confirmation, busy, disabled, notice, confirmCount, notify, clear, scan, toggle, requestUnload, cancel, submit } = useVehicleUnloading();
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
      <view class="app-nav__title">卸车</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="packing-top">
      <ScanInput v-model="input" :placeholder="vehicle ? '扫描箱子编码' : '扫描或输入载具编码'"
        :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="vehicle" class="card box-card">
        <view class="card-heading"><text>载具信息</text><text class="tag">已识别</text></view>
        <view class="info"><text>载具编号</text><text>{{ vehicle.vehicle.containerCode }}</text></view>
        <view class="info"><text>载具类型</text><text>载具</text></view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
      <view v-if="vehicle" class="card-heading list-heading"><text>载具内箱</text><text>已选 {{ selected.length }} / {{ loaded.length }} 条</text></view>
    </view>
    <scroll-view class="material-list" :class="{ 'material-list--initial': !vehicle }" scroll-y :show-scrollbar="true">
      <view v-if="!vehicle" class="card empty">请先扫描载具<view class="empty-hint">获取载具所有位置内的箱子</view></view>
      <view v-else class="card">
        <view v-if="!loaded.length" class="empty">该载具暂无已装载箱子</view>
        <checkbox-group v-for="item in loaded" :key="item.id" @change="toggle(item.id)">
          <label class="binding-row" :class="{ 'selected-row': selected.includes(item.id) }">
            <checkbox :value="item.id" :checked="selected.includes(item.id)" :disabled="disabled" color="#0D9496" :aria-label="`选择 ${item.box.containerCode}`" />
            <view class="binding-body">
              <view class="binding-code">{{ item.box.containerCode }}</view>
              <view class="secondary">载具库位 {{ item.slotCode }}</view>
            </view>
            <text class="binding-quantity">1 箱</text>
          </label>
        </checkbox-group>
      </view>
    </scroll-view>
    <view class="footer">
      <button :disabled="disabled" @tap="clearPage">清空页面</button>
      <button class="danger" :disabled="disabled || !loaded.length" @tap="requestUnload('all')">全部卸载</button>
      <button class="primary" :disabled="disabled || !selected.length" @tap="requestUnload('selected')">卸载所选（{{ selected.length }}）</button>
    </view>
    <view v-if="confirmation" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="确认卸载">
        <view class="modal-title">{{ confirmation === 'all' ? '确认全部卸载' : '确认卸车' }}</view>
        <view class="modal-content">将解除载具 {{ vehicle?.vehicle.containerCode }} 各位置中{{ confirmation === 'all' ? '全部' : '已选' }} {{ confirmCount }} 条“箱—载具库位”关系，保留箱内板件及历史操作记录。</view>
        <view class="modal-actions">
          <button :disabled="busy" @tap="cancel">取消</button>
          <button class="danger" :disabled="busy" @tap="submit">{{ busy ? '卸载中…' : '确认卸载' }}</button>
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
.material-list { flex: 1; height: 0; min-height: 0; padding: 0 20rpx; }
/* Keep spacing outside the 100%-height scroll content to avoid margin collapse. */
.material-list--initial { padding-top: 14rpx; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.empty-hint { margin-top: 16rpx; font-size: 24rpx; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1fr 1.35fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; padding: 28rpx; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-content { font-size: 28rpx; margin: 24rpx 0; line-height: 1.6; }
.modal-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 14rpx; }
.danger { color: #bb3535; border-color: #bb3535; }

.list-heading { margin-top: 14rpx; border: 1px solid #cee1e3; border-radius: 10rpx 10rpx 0 0; background: white; }
.list-heading text:last-child { font-size: 24rpx; font-weight: normal; }
.binding-row { display: flex; align-items: center; gap: 12rpx; padding: 16rpx; border-bottom: 1px solid #dfebed; }
.binding-row checkbox { flex-shrink: 0; transform: scale(0.85); }
.binding-body { flex: 1; min-width: 0; }
.binding-code { font-size: 28rpx; font-weight: 600; word-break: break-all; }
.secondary { margin-top: 6rpx; font-size: 24rpx; color: #748d93; word-break: break-word; }
.binding-quantity { flex-shrink: 0; color: #087779; font-size: 24rpx; }
.selected-row { background: #edf9f8; }
</style>
