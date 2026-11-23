<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import ScanInput from '../../components/ScanInput.vue';
import { lineSideInboundApi as api, validCode, validLocation, type InboundLocation } from '../../services/lineSideInbound';

const props = defineProps<{ factoryId: string; checking: boolean }>();
const emit = defineEmits<{ choose: [code: string]; close: [] }>();
const input = ref('');
const rows = ref<InboundLocation[]>([]);
const error = ref('');
const loading = ref(false);
const more = ref(false);
let page = 0;
let applied = '';
let generation = 0;
async function search(append = false, exact?: string) {
  if (props.checking || (append && (loading.value || !more.value))) return;
  const value = exact ?? (append ? applied : input.value.trim());
  if (value && !validCode(value)) { error.value = '地标编码或名称过长'; return; }
  const id = ++generation;
  const next = append ? page + 1 : 1;
  if (!append) { page = 0; rows.value = []; more.value = false; applied = value; }
  loading.value = true; error.value = '';
  try {
    const result = await api.locations({ ...(props.factoryId && { factoryId: props.factoryId }),
      ...(exact ? { locationCode: exact } : value && { keyword: value }) }, next);
    if (id !== generation) return;
    if (result?.current !== next || !Array.isArray(result.records) || !result.records.every(validLocation)) throw new Error('地标列表返回不完整，请重试');
    if (exact) {
      const matching = result.records.filter(row => row.locationCode === exact);
      if (matching.length !== 1) throw new Error('未找到唯一有效的四楼入库地标');
      emit('choose', matching[0].locationCode);
    } else {
      rows.value = append ? rows.value.concat(result.records) : result.records;
      page = next; more.value = page < result.pages;
    }
  } catch (e) { if (id === generation) error.value = e instanceof Error ? e.message : '地标查询失败，请重试'; }
  finally { if (id === generation) loading.value = false; }
}
function scan(raw: string) {
  const code = raw.trim();
  if (!code || props.checking) return;
  input.value = code; void search(false, code);
}
defineExpose({ scan });
onMounted(() => { void search(); });
onUnmounted(() => { generation++; });
</script>

<template>
  <view class="mask">
    <view class="dialog" role="dialog" aria-modal="true" aria-label="选择入库地标">
      <view class="heading">选择入库地标</view>
      <view class="search">
        <ScanInput v-model="input" compact inline-errors show-scan-button placeholder="扫描地标或输入名称" :disabled="checking"
          @error="error = $event" @scan="scan" />
        <button :disabled="checking" @tap="search()">查询</button>
      </view>
      <scroll-view class="options" scroll-y @scrolltolower="search(true)">
        <button v-for="row in rows" :key="row.locationCode" class="option" :disabled="checking" @tap="emit('choose', row.locationCode)">
          <text>{{ row.locationName || row.locationCode }}</text><text v-if="row.locationName">{{ row.locationCode }}</text>
        </button>
        <view v-if="error" role="alert" class="error">{{ error }}</view>
        <view v-if="loading || checking" class="state">{{ checking ? '预检中…' : '查询中…' }}</view>
        <button v-else-if="more" @tap="search(true)">加载更多</button>
        <view v-else-if="!rows.length && !error" class="state">暂无可选入库地标</view>
      </scroll-view>
      <button class="close" :disabled="checking" @tap="emit('close')">关闭</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.mask { position: fixed; inset: 0; z-index: 25; background: #163e4970; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.dialog { width: 100%; max-width: 440px; max-height: 80vh; padding: 18rpx; background: white; border-radius: 16rpx; display: flex; flex-direction: column; gap: 14rpx; }
.heading { font-size: 30rpx; font-weight: 600; }
.search { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10rpx; }
button { margin: 0; padding: 0 16rpx; color: #087779; background: #e6f6f6; border: 1px solid #b8d3d6; border-radius: 8rpx; font-size: 26rpx; line-height: 2.5; }
button::after { border: 0; }
.options { min-height: 0; max-height: 46vh; overflow-y: auto; }
.option { width: 100%; display: flex; flex-direction: column; align-items: flex-start; padding: 12rpx 8rpx; text-align: left; background: white; border: 0; border-bottom: 1px solid #dfebed; border-radius: 0; line-height: 1.55; color: #254b54; word-break: break-all; }
.option text + text, .state { color: #687f85; font-size: 24rpx; }
.state, .error { padding: 14rpx 4rpx; }
.error { color: #a32626; font-size: 25rpx; }
.close { flex-shrink: 0; background: white; }
</style>
