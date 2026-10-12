<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import OperationNotice from '../../components/OperationNotice.vue';
import ScanInput from '../../components/ScanInput.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useBoxVehicleUnbinding } from '../../composables/useBoxVehicleUnbinding';

const { vehicle, bindings, selected, confirmation, busy, disabled, notice, canUnbindAll, canUnbindSelected, confirmCount,
  notify, clear, pause, resume, scan, toggle, requestUnbind, cancel, submit } = useBoxVehicleUnbinding();
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
function clearPage() { if (!disabled.value) { clear(); input.value = ''; resetKeyboard(); } }
function goBack() { if (!busy.value) uni.navigateBack(); }
onShow(() => { active = true; resume(); });
onHide(() => { active = false; pause(); input.value = ''; resetKeyboard(); });
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
onUnmounted(() => { active = false; clearTimeout(noticeTimer); pause(); });
</script>

<template>
  <view class="app-page unbinding-page">
    <view class="app-nav">
      <button class="nav-back" :disabled="busy" @tap="goBack">‹ 返回</button>
      <view class="app-nav__title">料箱解绑</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="fixed-top">
      <ScanInput v-model="input" :placeholder="vehicle ? '扫描料箱编码勾选' : '扫描或输入料车编码'"
        :disabled="disabled" show-scan-button compact inline-errors @scan="handleScan" @error="notify($event, true)" />
      <view v-if="vehicle" class="card vehicle-card">
        <view class="card-heading"><text>料车信息</text><text class="tag">已识别</text></view>
        <view class="info"><text>料车编号</text><text>{{ vehicle.vehicle.vehicleCode }}</text></view>
        <view class="info"><text>料车名称</text><text>{{ vehicle.vehicle.displayName }}</text></view>
      </view>
      <view v-if="busy" class="processing" role="status">处理中…</view>
      <view v-if="vehicle" class="card-heading list-heading"><text>已绑定料箱</text><text>已选 {{ selected.length }} / {{ bindings.length }}</text></view>
    </view>
    <scroll-view class="box-list" :class="{ 'box-list--initial': !vehicle }" :scroll-y="!!bindings.length" :show-scrollbar="true">
      <view v-if="!vehicle" class="card empty">请先扫描料车<view class="empty-hint">获取料车下全部直接绑定料箱</view></view>
      <view v-else class="card list-card">
        <view v-if="!bindings.length" class="empty">该料车暂无已绑定料箱</view>
        <checkbox-group v-for="line in bindings" :key="line.bindingId" @change="toggle(line.bindingId)">
          <label class="binding-row" :class="{ 'selected-row': selected.includes(line.bindingId) }">
            <checkbox :value="line.bindingId" :checked="selected.includes(line.bindingId)" :disabled="disabled"
              color="#0D9496" :aria-label="`选择 ${line.box.boxCode}`" />
            <view class="binding-body"><view class="binding-code">{{ line.box.boxCode }}</view><view class="secondary">{{ line.box.displayName }}</view></view>
          </label>
        </checkbox-group>
      </view>
    </scroll-view>
    <view class="footer">
      <button :disabled="disabled" @tap="clearPage">清空页面</button>
      <button class="danger" :disabled="!canUnbindAll" @tap="requestUnbind('all')">一键解绑</button>
      <button class="primary" :disabled="!canUnbindSelected" @tap="requestUnbind('selected')">解绑勾选（{{ selected.length }}）</button>
    </view>
    <view v-if="confirmation" class="modal-mask">
      <view class="modal" role="dialog" aria-modal="true" aria-label="确认料箱解绑">
        <view class="modal-title">{{ confirmation === 'all' ? '确认一键解绑' : '确认解绑勾选' }}</view>
        <view class="modal-content">确认解除料车 {{ vehicle?.vehicle.vehicleCode }} 与{{ confirmation === 'all' ? '全部' : '已选' }} {{ confirmCount }} 个料箱的关系？仅解除料车—料箱关系，保留箱内板件及历史记录。</view>
        <view class="modal-actions">
          <button :disabled="busy" @tap="cancel">取消</button>
          <button class="danger" :disabled="busy" @tap="submit">{{ busy ? '解绑中…' : '确认解绑' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.unbinding-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 8rpx; font-size: 26rpx; height: 76rpx; line-height: 76rpx; background: white; color: #47686f; border: 1px solid #b8d3d6; border-radius: 8rpx; font-weight: 600; white-space: nowrap; }
button::after { border: 0; }
button[disabled] { opacity: 0.45; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: 2px; }
.nav-back { border: 0; background: transparent; color: white; text-align: left; }
.fixed-top { padding: 16rpx 20rpx 0; flex-shrink: 0; }
.card { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; overflow: hidden; }
.vehicle-card { margin-top: 14rpx; }
.card-heading { display: flex; justify-content: space-between; align-items: center; gap: 10rpx; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.info { display: flex; justify-content: space-between; gap: 16rpx; padding: 10rpx 16rpx; font-size: 26rpx; }
.info text:first-child { color: #748d93; flex-shrink: 0; }
.info text:last-child { min-width: 0; word-break: break-all; text-align: right; }
.tag { font-size: 22rpx; padding: 4rpx 10rpx; border-radius: 6rpx; color: #087779; background: #e6f6f6; flex-shrink: 0; font-weight: normal; }
.list-heading { margin-top: 14rpx; border: 1px solid #cee1e3; border-radius: 10rpx 10rpx 0 0; background: white; }
.list-heading text:last-child { font-size: 24rpx; font-weight: normal; }
.box-list { flex: 1; height: 0; min-height: 0; padding: 0 20rpx; }
.box-list--initial { padding-top: 14rpx; }
.list-card { border-radius: 0 0 10rpx 10rpx; }
.binding-row { display: flex; align-items: center; gap: 12px; min-height: 65px; padding: 16rpx; border-bottom: 1px solid #dfebed; }
checkbox-group:last-child .binding-row { border-bottom: 0; }
.binding-row checkbox { flex-shrink: 0; margin: 0; transform: scale(0.85); transform-origin: right center; }
.binding-row :deep(.uni-checkbox-input) { margin-right: 0; }
.binding-body { flex: 1; min-width: 0; }
.binding-code { font-size: 28rpx; font-weight: 600; word-break: break-all; }
.secondary { margin-top: 6rpx; font-size: 24rpx; color: #748d93; word-break: break-word; }
.selected-row { background: #edf9f8; }
.empty { padding: 52rpx 20rpx; text-align: center; color: #748d93; font-size: 28rpx; }
.empty-hint { margin-top: 16rpx; font-size: 24rpx; }
.processing { font-size: 22rpx; color: #087779; padding-top: 8rpx; }
.footer { flex-shrink: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.35fr); gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.footer .primary { font-size: 22rpx; }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
.danger { color: #bb3535; border-color: #bb3535; }
.modal-mask { position: fixed; inset: 0; background: #173f4866; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.modal { background: white; border-radius: 16rpx; width: 100%; max-width: 440px; max-height: 80dvh; padding: 28rpx; display: flex; flex-direction: column; }
.modal-title { font-size: 30rpx; font-weight: 600; }
.modal-content { min-height: 0; overflow-y: auto; font-size: 28rpx; margin: 24rpx 0; line-height: 1.6; word-break: break-all; }
.modal-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 14rpx; }
</style>
