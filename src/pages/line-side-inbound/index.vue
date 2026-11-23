<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { onBackPress, onHide, onShow } from '@dcloudio/uni-app';
import ScanInput from '../../components/ScanInput.vue';
import OperationNotice from '../../components/OperationNotice.vue';
import PendingSubmission from '../../components/PendingSubmission.vue';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';
import { usePdaScanner } from '../../composables/usePdaScanner';
import { useLineSideInbound } from '../../composables/useLineSideInbound';
import InboundLocationPicker from './InboundLocationPicker.vue';

const flow = useLineSideInbound();
const { location, boxes, factoryId, blockReason, checking, writing, pending, storageError, scans, locked, busy, canSubmit, notice } = flow;
const picking = ref(false);
const picker = ref<InstanceType<typeof InboundLocationPicker>>();
const input = ref('');
const unavailable = computed(() => locked.value || (!!scans.value && picking.value));
let active = false;
let timer: ReturnType<typeof setTimeout> | undefined;
function scan(value: string) {
  if (!active || locked.value) return;
  if (picking.value) { picker.value?.scan(value); return; }
  input.value = '';
  return flow.scan(value);
}
usePdaScanner(scan);
const { reset: resetKeyboard } = useKeyboardScanner(scan, unavailable);
async function choose(code: string) {
  if (await flow.chooseLocation(code)) picking.value = false;
}
function clearPage() { if (!busy.value) { input.value = ''; flow.clear(); resetKeyboard(); } }
function goBack() { if (!writing.value) uni.navigateBack({ delta: 1 }); }
onBackPress(() => {
  if (writing.value || checking.value) return true;
  if (picking.value) { picking.value = false; return true; }
  return false;
});
onShow(() => { active = true; flow.resume(); });
function pause() { active = false; flow.pause(); resetKeyboard(); }
onHide(pause);
onUnmounted(() => { pause(); clearTimeout(timer); });
watch(notice, value => {
  clearTimeout(timer);
  if (value) timer = setTimeout(() => { notice.value = null; }, value.error ? 6500 : 2500);
});
</script>

<template>
  <view class="app-page inbound-page">
    <view class="app-nav">
      <button class="back" :disabled="writing" @tap="goBack">‹ 返回</button><view class="app-nav__title">线边入库</view><view />
    </view>
    <OperationNotice :text="notice?.text" :error="notice?.error" />
    <view class="top">
      <ScanInput v-model="input" compact inline-errors show-scan-button placeholder="扫描或输入料箱码、料车码" :disabled="locked || picking"
        @scan="scan" @error="flow.notify($event, true)" />
      <view class="card landmark">
        <view class="heading"><text>入库地标</text>
          <button class="link" :disabled="busy" @tap="picking = true">{{ location ? '更换地标' : '扫描 / 选择地标' }} ›</button>
        </view>
        <view v-if="location" class="site">{{ location.locationName }} {{ location.locationCode }}</view>
        <view v-else-if="boxes.length" class="hint">请确定地标以校验已扫料箱</view>
      </view>
      <PendingSubmission v-if="storageError || (pending && !writing)" :busy="writing" :request-id="pending?.input.requestId"
        :reason="pending?.reason" :storage-error="storageError" @reload="flow.resume" />
      <view v-if="blockReason" class="error">{{ blockReason }}</view>
      <view class="heading list-head"><text>待入库料箱 · {{ boxes.length }} 箱</text>
        <text v-if="scans || checking" role="status" class="hint">校验中…</text>
        <button v-else-if="location && boxes.length" class="link" :disabled="busy" @tap="choose(location.locationCode)">重新预检</button>
      </view>
    </view>
    <view v-if="!boxes.length" class="empty">请扫描料箱或料车</view>
    <scroll-view v-else class="list" scroll-y>
      <view class="rows">
        <view v-for="box in boxes" :key="box.boxCode" class="box">
          <view class="heading"><text>{{ box.boxCode }}</text>
            <button class="remove" :aria-label="'移除 ' + box.boxCode" :disabled="busy" @tap="flow.remove(box.boxCode)">移除</button>
          </view>
          <view v-if="box.totalQuantity != null" class="hint">物料 {{ box.totalQuantity }} 件</view>
          <view v-if="box.shippingNo" class="hint">发货单号 {{ box.shippingNo }}</view>
          <view v-if="box.registeredLocationCode && box.registeredLocationCode !== location?.locationCode" class="hint">登记地标 {{ box.registeredLocationCode }}</view>
          <view v-if="location && !box.allowed" class="error">{{ box.reason || '未通过入库预检' }}</view>
        </view>
      </view>
    </scroll-view>
    <view class="actions">
      <button :disabled="busy" @tap="clearPage">清空页面</button>
      <button class="primary" :disabled="pending ? writing || !!storageError : !canSubmit" @tap="flow.submit">
        {{ writing ? '入库中…' : pending ? '重试原请求' : '入库' }}
      </button>
    </view>
    <InboundLocationPicker v-if="picking" ref="picker" :factory-id="factoryId" :checking="checking" @choose="choose" @close="picking = false" />
  </view>
</template>

<style scoped lang="scss">
.inbound-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; padding: 0 12rpx; color: #47686f; background: white; border: 1px solid #b8d3d6; border-radius: 8rpx; font-size: 26rpx; font-weight: 600; }
button::after { border: 0; }
button[disabled] { opacity: .55; }
.back, .link, .remove { border: 0; background: transparent; }
.back { color: white; text-align: left; }
.top { padding: 16rpx 20rpx 0; flex-shrink: 0; }
.card, .list-head, .empty, .rows { background: white; border: 1px solid #cee1e3; border-radius: 10rpx; }
.landmark { margin: 14rpx 0; padding: 8rpx 16rpx; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 10rpx; font-size: 28rpx; font-weight: 600; }
.heading text, .site, .hint, .error { min-width: 0; overflow-wrap: anywhere; }
.link, .remove { color: #087779; flex-shrink: 0; padding: 0 4rpx; font-size: 24rpx; line-height: 2; }
.site { padding-bottom: 6rpx; font-size: 27rpx; }
.list-head { border-radius: 10rpx 10rpx 0 0; padding: 8rpx 16rpx; min-height: 62rpx; }
.list { flex: 1; height: 0; min-height: 0; padding: 0 20rpx; }
.rows, .empty { border-top: 0; border-radius: 0 0 10rpx 10rpx; padding: 0 16rpx; }
.box { padding: 10rpx 0; border-bottom: 1px solid #dfebed; }
.box:last-child { border: 0; }
.remove, .error { color: #ab3434; }
.hint, .empty { color: #687f85; }
.hint, .error { font-size: 24rpx; line-height: 1.55; }
.empty { margin: 0 20rpx; text-align: center; padding: 48rpx 12rpx; font-size: 27rpx; }
.actions { margin-top: auto; flex-shrink: 0; display: grid; grid-template-columns: 1fr 1.35fr; gap: 10rpx; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); }
.actions button { line-height: 72rpx; }
.primary { background: #0d9496; color: white; border-color: #0d9496; }
</style>
