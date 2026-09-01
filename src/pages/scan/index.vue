<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, watch } from "vue";
import ScanInput from "../../components/ScanInput.vue";
import { usePdaScanner } from "../../composables/usePdaScanner";
import {
  createPdaBroadcastResult,
  createScanResult,
  normalizeKeyboardBuffer,
} from "../../services/scanAdapter";
import type { ScanResult } from "../../types/scan";

const scanValue = shallowRef("");
const scanResult = shallowRef<ScanResult | null>(null);
const scanInputRef = shallowRef<InstanceType<typeof ScanInput> | null>(null);
const keyboardBuffer = shallowRef<string[]>([]);
let keyboardTimer: ReturnType<typeof setTimeout> | null = null;
let inputTimer: ReturnType<typeof setTimeout> | null = null;

usePdaScanner((value, raw) => {
  scanInputRef.value?.setScanResult(value, { emitScan: false });
  scanResult.value = createPdaBroadcastResult(value, raw);
});

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function clearScan() {
  scanValue.value = "";
  scanResult.value = null;
  keyboardBuffer.value = [];
}

function applyScanResult(result: ScanResult) {
  scanValue.value = result.value;
  scanResult.value = result;
}

function handleScanResult(value: string) {
  applyScanResult(createScanResult(value, "manual"));
}

function handleKeyboardEvent(event: KeyboardEvent) {
  if (keyboardTimer) {
    clearTimeout(keyboardTimer);
  }

  keyboardBuffer.value = [...keyboardBuffer.value, event.key];
  const result = normalizeKeyboardBuffer(keyboardBuffer.value);

  if (result) {
    applyScanResult(result);
    keyboardBuffer.value = [];
    return;
  }

  keyboardTimer = setTimeout(() => {
    keyboardBuffer.value = [];
  }, 300);
}

watch(scanValue, (value) => {
  if (inputTimer) {
    clearTimeout(inputTimer);
  }

  inputTimer = setTimeout(() => {
    const trimmed = value.trim();
    if (trimmed && scanResult.value?.value !== trimmed) {
      applyScanResult(createScanResult(trimmed, "keyboard"));
    }
  }, 120);
});

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeyboardEvent);
  }
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", handleKeyboardEvent);
  }

  if (keyboardTimer) {
    clearTimeout(keyboardTimer);
  }

  if (inputTimer) {
    clearTimeout(inputTimer);
  }

});
</script>

<template>
  <view class="app-page">
    <view class="app-nav">
      <view class="app-nav__button" @tap="goBack">返回</view>
      <view class="app-nav__title">扫描录入</view>
      <view class="app-nav__spacer"></view>
    </view>

    <view class="app-content scan-content">
      <ScanInput
        ref="scanInputRef"
        v-model="scanValue"
        placeholder="请输入或扫描编码"
        show-scan-button
        scan-on-blur
        @scan="handleScanResult"
        @clear="clearScan"
      />

      <view v-if="scanResult" class="result-card">
        <view class="result-label">扫描结果</view>
        <view class="result-value">{{ scanResult.value }}</view>
      </view>
    </view>

    <view class="scan-footer">
      <button class="clear-button" @tap="clearScan">清空</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.scan-content {
  padding-bottom: 144rpx;
}

.result-card {
  min-height: 236rpx;
  margin-top: 28rpx;
  border: 2rpx solid #a9b8ca;
  border-radius: 12rpx;
  background: #ffffff;
  padding: 24rpx;
}

.result-label {
  color: #64748b;
  font-size: 26rpx;
}

.result-value {
  min-height: 104rpx;
  margin-top: 16rpx;
  border: 2rpx dashed #9fb0c4;
  border-radius: 8rpx;
  background: #f8fafc;
  color: #102a43;
  font-size: 32rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  word-break: break-all;
}

.scan-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom));
}

.clear-button {
  width: 100%;
  height: 88rpx;
  border-radius: 8rpx;
  background: #0d9496;
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 700;
}
</style>
