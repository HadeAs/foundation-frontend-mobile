<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import ContainerTree from "../../components/ContainerTree.vue";
import ScanInput from "../../components/ScanInput.vue";
import { usePdaScanner } from "../../composables/usePdaScanner";
import { fetchContainerDetail } from "../../services/containerManagement";
import type { ContainerDetail } from "../../types/container";

const queryText = shallowRef("");
const detail = shallowRef<ContainerDetail | null>(null);
const loading = shallowRef(false);
const searched = shallowRef(false);
const scanInputRef = shallowRef<InstanceType<typeof ScanInput> | null>(null);
let queryTimer: ReturnType<typeof setTimeout> | undefined;

const hasInput = computed(() => Boolean(queryText.value.trim()));

usePdaScanner((value) => {
  scanInputRef.value?.setScanResult(value, { emitScan: false });
});

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function clearQuery() {
  queryText.value = "";
  detail.value = null;
  searched.value = false;
  loading.value = false;
}

function handleScanResult(value: string) {
  queryText.value = value;
}

async function queryContainer() {
  const code = queryText.value.trim();
  if (!code) {
    detail.value = null;
    searched.value = false;
    loading.value = false;
    return;
  }

  loading.value = true;
  searched.value = true;
  try {
    const result = await fetchContainerDetail(code);
    detail.value = result;
  } finally {
    loading.value = false;
  }
}

watch(queryText, () => {
  if (queryTimer) {
    clearTimeout(queryTimer);
  }

  queryTimer = setTimeout(() => {
    void queryContainer();
  }, 260);
});

onBeforeUnmount(() => {
  if (queryTimer) {
    clearTimeout(queryTimer);
  }
});
</script>

<template>
  <view class="app-page container-page">
    <view class="app-nav">
      <view class="app-nav__button" @tap="goBack">返回</view>
      <view class="app-nav__title">容器管理</view>
      <view class="app-nav__spacer"></view>
    </view>

    <view class="container-search">
      <ScanInput
        ref="scanInputRef"
        v-model="queryText"
        placeholder="扫描或输入容器号"
        confirm-type="search"
        show-scan-button
        @scan="handleScanResult"
        @clear="clearQuery"
      />
    </view>

    <view class="container-content">
      <view v-if="loading" class="container-loading">加载中...</view>

      <view v-else-if="!hasInput" class="container-empty">
        <view class="container-empty__title">请输入容器号</view>
        <view class="container-empty__text"
          >例如 CT-A001、BOX-A001、RACK-B001</view
        >
      </view>

      <view v-else-if="searched && !detail" class="container-empty">
        <view class="container-empty__title">未查询到容器</view>
        <view class="container-empty__text"
          >请检查容器编码后重新扫描或输入</view
        >
      </view>

      <template v-else-if="detail">
        <view class="container-basic">
          <view class="container-basic__title">基本信息</view>
          <view class="container-basic__row"
            ><text>容器编码</text><text>{{ detail.container.code }}</text></view
          >
          <view class="container-basic__row"
            ><text>容器类型</text><text>{{ detail.container.type }}</text></view
          >
        </view>

        <ContainerTree :nodes="detail.children" />
      </template>
    </view>
  </view>
</template>

<style scoped lang="scss">
.container-page {
  min-height: 100vh;
}

.container-search {
  padding: 24rpx;
  background: #f2f8f8;
}

.container-content {
  flex: 1;
  padding: 0 24rpx 32rpx;
}

.container-loading,
.container-empty {
  min-height: 260rpx;
  border: 2rpx dashed #b7c4d4;
  border-radius: 8rpx;
  background: #ffffff;
  color: #64748b;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.container-empty__title {
  color: #102a43;
  font-size: 30rpx;
  font-weight: 800;
}

.container-empty__text {
  margin-top: 10rpx;
  font-size: 24rpx;
}

.container-basic {
  border: 2rpx solid #d8e2ef;
  border-radius: 8rpx;
  background: #ffffff;
}

.container-basic__title {
  min-height: 72rpx;
  padding: 0 24rpx;
  border-bottom: 2rpx solid #edf2f7;
  color: #102a43;
  font-size: 28rpx;
  font-weight: 800;
  display: flex;
  align-items: center;
}

.container-basic__row {
  min-height: 76rpx;
  padding: 0 24rpx;
  border-bottom: 2rpx solid #edf2f7;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  color: #64748b;
  font-size: 26rpx;
}

.container-basic__row:last-child {
  border-bottom: 0;
}

.container-basic__row text:last-child {
  color: #102a43;
  font-weight: 800;
}
</style>
