<script setup lang="ts">
import { scanWithCamera } from '../services/scanAdapter';

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  confirmType?: string;
  showScanButton?: boolean;
  scanOnBlur?: boolean;
}>(), {
  placeholder: '请输入或扫描',
  confirmType: 'done',
  showScanButton: false,
  scanOnBlur: false
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  scan: [value: string];
  clear: [];
}>();

function updateValue(event: Event) {
  const detailValue = (event as unknown as { detail?: { value?: string } }).detail?.value;
  const targetValue = (event.target as HTMLInputElement | null)?.value;
  emit('update:modelValue', detailValue ?? targetValue ?? '');
}

function emitScan(value = props.modelValue) {
  const trimmed = value.trim();
  if (trimmed) {
    emit('scan', trimmed);
  }
}

function clearValue() {
  emit('update:modelValue', '');
  emit('clear');
}

async function handleCameraScan() {
  try {
    const result = await scanWithCamera();
    setScanResult(result.value);
  } catch {
    uni.showToast({ title: '扫码失败', icon: 'none' });
  }
}

function setScanResult(value: string, options: { emitScan?: boolean } = {}) {
  emit('update:modelValue', value);
  if (options.emitScan !== false) {
    emitScan(value);
  }
}

defineExpose({ setScanResult });
</script>

<template>
  <view class="scan-input" :class="{ 'scan-input--with-button': showScanButton }">
    <view class="scan-input__field">
      <input
        class="scan-input__control"
        :value="modelValue"
        :placeholder="placeholder"
        :confirm-type="confirmType"
        @input="updateValue"
        @confirm="emitScan()"
        @blur="scanOnBlur && emitScan()"
      />
      <view v-if="modelValue" class="scan-input__clear" @tap="clearValue">×</view>
    </view>
    <view v-if="showScanButton" class="scan-input__button" @tap="handleCameraScan">扫码</view>
  </view>
</template>

<style scoped lang="scss">
.scan-input {
  height: 88rpx;
  border: 2rpx solid #a9b8ca;
  border-radius: 8rpx;
  background: #ffffff;
  display: grid;
  grid-template-columns: 1fr;
  overflow: hidden;
}

.scan-input--with-button {
  height: 92rpx;
  border-color: #8ca5c4;
  grid-template-columns: 1fr 96rpx;
}

.scan-input__field {
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr 64rpx;
}

.scan-input__control {
  min-width: 0;
  height: 100%;
  padding: 0 24rpx;
  color: #102a43;
  font-size: 28rpx;
}

.scan-input--with-button .scan-input__control {
  font-size: 30rpx;
}

.scan-input__clear {
  color: #64748b;
  font-size: 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scan-input--with-button .scan-input__clear {
  font-size: 38rpx;
}

.scan-input__button {
  border-left: 2rpx solid #b7c4d4;
  background: #e8f7f7;
  color: #0d9496;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
