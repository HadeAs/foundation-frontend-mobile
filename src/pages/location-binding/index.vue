<script setup lang="ts">
import OperationNotice from '../../components/OperationNotice.vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useLocationBinding } from '../../composables/useLocationBinding';

const { location, container, confirmation, busy, disabled, scanDisabled, canBind, canUnbind, notice, notify, clear, scan, requestUnbind, cancel, submit } = useLocationBinding();
const input = ref('');
const placeholder = computed(() => location.value?.occupied ? '请先解绑当前容器' : location.value ? '扫描或输入载具/箱子编码' : '扫描或输入库位编码');
let active = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
async function handleScan(value: string) {
  if (!active || scanDisabled.value) return;
  input.value = '';
  await scan(value);
}
usePdaScanner(handleScan);
const { reset: resetKeyboard } = useKeyboardScanner(handleScan, scanDisabled);
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
  <view class="app-page location-page">
    <view class="app-nav">
      <button class="nav-back" :disabled="disabled" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">位置绑定</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="scan-top">
      <ScanInput v-model="input" :placeholder="placeholder" :disabled="scanDisabled" show-scan-button compact inline-errors
        @scan="handleScan" @error="notify($event, true)" />
      <view v-if="busy" class="processing" role="status">处理中…</view>
    </view>
    <scroll-view class="content" scroll-y :show-scrollbar="true">
      <view class="content-inner">
        <view v-if="!location" class="card empty">请先扫描库位<view class="empty-hint">查询库位及已绑定容器；空闲库位可绑定载具或箱子</view></view>
        <template v-else>
          <view class="card">
            <view class="card-heading"><text>库位信息</text><text class="tag">{{ location.occupied ? '已占用' : '空闲' }}</text></view>
            <view class="info"><text>库位编号</text><text>{{ location.location.locationCode }}</text></view>
            <view class="info"><text>库位名称</text><text>{{ location.location.locationName }}</text></view>
            <view class="info"><text>库位类型</text><text>{{ location.location.locationType || '—' }}</text></view>
          </view>
          <view v-if="container" class="card">
            <view class="card-heading"><text>容器信息</text><text class="tag" :class="{ 'tag--bound': location.occupied }">{{ location.occupied ? '已绑定' : '待绑定' }}</text></view>
            <view class="info"><text>容器编号</text><text>{{ container.containerCode }}</text></view>
            <view class="info"><text>容器类型</text><text>{{ container.containerType === 'VEHICLE' ? '载具' : '箱子' }}</text></view>
          </view>
          <view v-else class="card empty">当前库位无绑定容器<view class="empty-hint">{{ location.eligibility.allowed ? '继续扫描载具或箱子进行绑定' : '当前库位不可操作，请清空后重新扫描' }}</view></view>
        </template>
      </view>
    </scroll-view>
    <view class="footer">
      <button :disabled="disabled" @tap="clearPage">清空页面</button>
      <button v-if="location?.occupied" class="danger" :disabled="!canUnbind" @tap="requestUnbind">解绑容器</button>
      <button v-else class="primary" :disabled="!canBind" @tap="submit">确认绑定</button>
    </view>
    <view v-if="confirmation" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="确认解绑容器">
        <view class="modal-title">确认解绑容器</view>
        <view class="modal-content">将解除库位 {{ location?.location.locationCode }} 与{{ container?.containerType === 'VEHICLE' ? '载具' : '箱子' }} {{ container?.containerCode }} 的绑定关系，保留容器内部装载、板件及历史操作记录。</view>
        <view class="modal-actions">
          <button :disabled="busy" @tap="cancel">取消</button>
          <button class="danger" :disabled="busy" @tap="submit">{{ busy ? '解绑中…' : '确认解绑' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.location-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.scan-top { padding: 16rpx 20rpx 0; flex-shrink: 0; }
.content { flex: 1; height: 0; min-height: 0; }
.content-inner { padding: 14rpx 20rpx 0; }
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
</style>
