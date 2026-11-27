<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import OperationNotice from '../../components/OperationNotice.vue';
import { landmarkPageSize, landmarkQueryApi, type Landmark, type LandmarkStatus } from '../../services/landmarkQuery';

const scopes = [{ name: '全部地标', value: 'ALL' }, { name: '斯坦德潜伏车地标', value: 'STANDARD' }] as const;
const floors = ['全部楼层', '1 楼', '2 楼', '3 楼', '4 楼'];
const statusNames: Record<LandmarkStatus, string> = { FREE: '空闲', OCCUPIED: '占用', RESERVED: '预占', UNKNOWN: '未知' };
const scopeIndex = ref(0);
const floorIndex = ref(0);
const rows = ref<Landmark[]>([]);
const total = ref(0);
const page = ref(0);
const pages = ref(0);
const loading = ref(false);
const refreshing = ref(false);
const error = ref('');
const notice = ref('');
let failedPage = 1;
let active = false;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function load(target: number) {
  if (!active) return;
  const current = ++revision;
  loading.value = true; error.value = ''; notice.value = ''; clearTimeout(timer);
  try {
    const data = await landmarkQueryApi.list(scopes[scopeIndex.value].value, floorIndex.value || undefined, target);
    if (current !== revision) return;
    if (!data || data.current !== target || data.size !== landmarkPageSize || !Number.isSafeInteger(data.total) || data.total < 0 ||
      data.pages !== Math.ceil(data.total / landmarkPageSize) || !Array.isArray(data.records) ||
      data.records.length > Math.min(landmarkPageSize, Math.max(0, data.total - (target - 1) * landmarkPageSize)) ||
      !data.records.every(row => row && typeof row.locationId === 'string' && row.locationId.trim() &&
        typeof row.locationCode === 'string' && row.locationCode.trim() && Number.isInteger(row.floorNumber) && row.floorNumber >= 1 && row.floorNumber <= 4)) {
      throw new Error('地标列表返回不完整，请重试');
    }
    const byId = new Map((target === 1 ? [] : rows.value).map(row => [row.locationId, row]));
    data.records.forEach(row => byId.set(row.locationId, row));
    rows.value = [...byId.values()]; total.value = data.total; pages.value = data.pages; page.value = target;
  } catch (cause) {
    if (current !== revision) return;
    failedPage = target;
    error.value = cause instanceof Error ? cause.message : '地标查询失败，请重试';
    notice.value = error.value; timer = setTimeout(() => { notice.value = ''; }, 6500);
  } finally { if (current === revision) { loading.value = false; refreshing.value = false; } }
}
function resetList() {
  rows.value = []; page.value = 0; pages.value = 0; total.value = 0; refreshing.value = false;
  void load(1);
}
function changeFilter(kind: 'scope' | 'floor', event: { detail: { value: number | string } }) {
  const index = Number(event.detail.value);
  const filter = kind === 'scope' ? scopeIndex : floorIndex;
  if (!active || !Number.isInteger(index) || index < 0 || index >= (kind === 'scope' ? scopes.length : floors.length) || filter.value === index) return;
  filter.value = index; resetList();
}
function loadMore() { if (!loading.value && !error.value && page.value < pages.value) void load(page.value + 1); }
function refresh() { if (active && !loading.value) { refreshing.value = true; void load(1); } }
function pause() { active = false; revision++; clearTimeout(timer); notice.value = ''; loading.value = false; refreshing.value = false; }
function goBack() { uni.navigateBack({ delta: 1 }); }
onShow(() => { active = true; resetList(); });
onHide(pause);
onUnmounted(pause);
</script>

<template>
  <view class="app-page landmark-page">
    <view class="app-nav"><button class="nav-back" @tap="goBack">‹ 返回</button><view class="app-nav__title">地标查询</view><view /></view>
    <OperationNotice :text="notice" error />
    <view class="filters">
      <picker :range="scopes" range-key="name" :value="scopeIndex" @change="changeFilter('scope', $event)">
        <view class="picker-field" role="button" aria-label="地标范围"><text>{{ scopes[scopeIndex].name }}</text><text>⌄</text></view>
      </picker>
      <picker :range="floors" :value="floorIndex" @change="changeFilter('floor', $event)">
        <view class="picker-field" role="button" aria-label="楼层"><text>{{ floors[floorIndex] }}</text><text>⌄</text></view>
      </picker>
    </view>
    <view class="panel">
      <view class="heading"><text>地标</text><text v-if="page">{{ total }} 个</text></view>
      <scroll-view :key="scopeIndex + '-' + floorIndex" class="list" scroll-y refresher-enabled :refresher-triggered="refreshing"
        :lower-threshold="60" @refresherrefresh="refresh" @scrolltolower="loadMore">
        <view v-for="row in rows" :key="row.locationId" class="row">
          <view class="row-heading"><text class="code">{{ row.locationCode }}</text><text class="tag">{{ statusNames[row.status] || '未知' }}</text></view>
          <view class="meta">{{ row.floorNumber }} 楼<text v-if="row.locationName"> · {{ row.locationName }}</text></view>
        </view>
        <view class="list-state" role="status">
          <text v-if="loading">{{ refreshing ? '刷新中…' : '加载中…' }}</text>
          <button v-else-if="error" @tap="load(failedPage)">加载失败，点击重试</button>
          <text v-else-if="!rows.length">暂无地标</text>
          <button v-else-if="page < pages" @tap="loadMore">加载更多</button>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.landmark-page { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding-top: var(--status-bar-height, 0px); color: #254b54; }
.app-nav { flex-shrink: 0; height: 88rpx; grid-template-columns: 104rpx 1fr 104rpx; padding: 0 16rpx; gap: 0; }
.app-nav__title { font-size: 32rpx; }
button { margin: 0; background: transparent; color: #087779; font-size: 26rpx; }
button::after { border: 0; }
.nav-back { padding: 0; text-align: left; color: white; font-weight: 600; }
.filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10rpx; margin: 16rpx 20rpx 14rpx; }
.picker-field { display: flex; align-items: center; justify-content: space-between; gap: 4rpx; min-height: 72rpx; padding: 8rpx 12rpx; border: 1px solid #9fbfc5; border-radius: 8rpx; background: white; font-size: 26rpx; }
.panel { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; margin: 0 20rpx calc(14rpx + env(safe-area-inset-bottom)); border: 1px solid #cee1e3; border-radius: 10rpx; background: white; }
.heading, .row-heading { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.heading { flex-shrink: 0; padding: 12rpx 16rpx; border-bottom: 1px solid #dfebed; font-size: 28rpx; font-weight: 600; }
.list { flex: 0 1 auto; min-height: 0; height: auto; }
.row { margin: 0 16rpx; padding: 16rpx 0; border-bottom: 1px solid #dfebeb; overflow-wrap: anywhere; }
.code { min-width: 0; font-size: 28rpx; font-weight: 600; }
.tag { flex-shrink: 0; padding: 4rpx 12rpx; border-radius: 24rpx; background: #e6f6f6; color: #087779; font-size: 24rpx; }
.meta, .list-state { font-size: 24rpx; color: #687f85; }
.meta { margin-top: 6rpx; }
.list-state { text-align: center; }
.list-state > text { display: block; padding: 20rpx; }
</style>
