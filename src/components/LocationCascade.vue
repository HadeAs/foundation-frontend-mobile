<script setup lang="ts">
import { computed, ref } from 'vue';
import { locationPath, type LocationCandidate } from '../services/logistics';
const props = withDefaults(defineProps<{ locations: LocationCandidate[]; selected?: LocationCandidate | null; title?: string }>(), { title: '选择目标位置' });
const emit = defineEmits<{ confirm: [location: LocationCandidate]; cancel: [] }>();
const floor = ref(props.selected?.floorCode || '');
const area = ref(props.selected?.areaCode || '');
const code = ref(props.selected?.locationCode || '');
const floors = computed(() => [...new Map(props.locations.map((item) => [item.floorCode, { code: item.floorCode, name: item.floorName }])).values()]);
const areas = computed(() => [...new Map(props.locations.filter((item) => item.floorCode === floor.value).map((item) => [item.areaCode, { code: item.areaCode, name: item.areaName }])).values()]);
const slots = computed(() => props.locations.filter((item) => item.floorCode === floor.value && item.areaCode === area.value));
const selected = computed(() => slots.value.find((item) => item.locationCode === code.value));
function changeFloor(event: { detail: { value: string | number } }) { floor.value = floors.value[Number(event.detail.value) - 1]?.code || ''; area.value = ''; code.value = ''; }
function changeArea(event: { detail: { value: string | number } }) { area.value = areas.value[Number(event.detail.value) - 1]?.code || ''; code.value = ''; }
function changeSlot(event: { detail: { value: string | number } }) { code.value = slots.value[Number(event.detail.value) - 1]?.locationCode || ''; }
</script>

<template>
  <view class="cascade-mask">
    <view class="cascade-modal" role="dialog" aria-modal="true" :aria-label="title">
      <view class="title">{{ title }}</view>
      <view class="fields">
        <view class="label">楼层</view>
        <picker mode="selector" :range="['请选择楼层', ...floors.map(item => item.name)]" :value="floors.findIndex(item => item.code === floor) + 1" @change="changeFloor">
          <view class="field">{{ floors.find(item => item.code === floor)?.name || '请选择楼层' }}<text>⌄</text></view>
        </picker>
        <view class="label">区域</view>
        <picker mode="selector" :disabled="!floor" :range="['请选择区域', ...areas.map(item => item.name)]" :value="areas.findIndex(item => item.code === area) + 1" @change="changeArea">
          <view class="field" :class="{ muted: !floor }">{{ areas.find(item => item.code === area)?.name || '请选择区域' }}<text>⌄</text></view>
        </picker>
        <view class="label">库位名称</view>
        <picker mode="selector" :disabled="!area" :range="['请选择库位', ...slots.map(item => item.locationName)]" :value="slots.findIndex(item => item.locationCode === code) + 1" @change="changeSlot">
          <view class="field" :class="{ muted: !area }">{{ selected?.locationName || '请选择库位' }}<text>⌄</text></view>
        </picker>
        <view v-if="selected" class="path">{{ locationPath(selected) }}</view>
      </view>
      <view class="actions"><button @tap="emit('cancel')">取消</button><button class="primary" :disabled="!selected" @tap="selected && emit('confirm', selected)">确认选择</button></view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.cascade-mask { position: fixed; inset: 0; z-index: 20; background: #173f4866; display: flex; align-items: center; justify-content: center; padding: 24rpx; }
.cascade-modal { width: 100%; max-width: 440px; max-height: 80vh; display: flex; flex-direction: column; background: white; padding: 24rpx; border-radius: 16rpx; color: #254b54; }
.title { font-size: 30rpx; font-weight: 600; flex-shrink: 0; }
.fields { overflow-y: auto; min-height: 0; padding-bottom: 16rpx; }
.label { margin: 16rpx 0 8rpx; font-size: 24rpx; color: #748d93; }
.field { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; min-height: 76rpx; padding: 12rpx; border: 1px solid #9fbfc5; border-radius: 8rpx; font-size: 28rpx; overflow-wrap: anywhere; }
.field text { flex-shrink: 0; }
.muted { color: #909e9f; background: #f4f7f7; border-color: #b8b8b8; }
.path { font-size: 24rpx; color: #087779; margin-top: 16rpx; overflow-wrap: anywhere; }
.actions { display: grid; grid-template-columns: 1fr 1.5fr; gap: 12rpx; flex-shrink: 0; }
button { margin: 0; height: 76rpx; line-height: 76rpx; padding: 0 8rpx; border: 1px solid #b8d3d6; color: #47686f; background: white; border-radius: 8rpx; font-size: 26rpx; }
button::after { border: 0; }
.primary { color: white; background: #0d9496; border-color: #0d9496; }
button[disabled] { opacity: 0.45; }
</style>
