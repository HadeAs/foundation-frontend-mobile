<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import manifest from '../../manifest.json';
import { getAccessToken, getCurrentUser, logout } from '../../services/auth';
import { stopAppUpdatePolling } from '../../services/appUpdate';

type HomeTab = 'menu' | 'profile';

const activeTab = shallowRef<HomeTab>('menu');
const appVersion = shallowRef(manifest.versionName);
const user = getCurrentUser() ?? {
  userId: 0,
  name: '未登录',
  role: '未分配角色',
  account: '-',
  department: '未分配部门'
};
const avatarInitial = Array.from(user.name.trim())[0]?.toUpperCase() || '用';
const title = computed(() => (activeTab.value === 'menu' ? '首页' : '个人信息'));

onMounted(() => {
  if (!getAccessToken()) {
    uni.reLaunch({ url: '/pages/login/index' });
  }

  if (typeof plus !== 'undefined') {
    plus.runtime.getProperty(plus.runtime.appid || '', (widgetInfo) => {
      appVersion.value = widgetInfo.version || plus.runtime.version || manifest.versionName;
    });
  }
});

async function handleLogout() {
  stopAppUpdatePolling();
  await logout();
  uni.reLaunch({ url: '/pages/login/index' });
}

function openScan() {
  uni.navigateTo({ url: '/pages/scan/index' });
}

function openWarehouseTasks() {
  uni.navigateTo({ url: '/pages/warehouse/tasks' });
}

function openInventoryQuery() {
  uni.navigateTo({ url: '/pages/inventory/query' });
}

function openContainerManagement() {
  uni.navigateTo({ url: '/pages/container/management' });
}
</script>

<template>
  <view class="app-page">
    <view class="app-nav app-nav--title-only">
      <view class="app-nav__title">{{ title }}</view>
    </view>

    <view v-if="activeTab === 'menu'" class="app-content">
      <view class="menu-grid">
        <view class="menu-tile" @tap="openScan">
          <view class="menu-icon">
            <image class="menu-icon__image" src="/static/icons/scan.svg" mode="aspectFit" />
          </view>
          <view class="menu-name">扫描录入</view>
        </view>
        <view class="menu-tile" @tap="openWarehouseTasks">
          <view class="menu-icon">
            <image class="menu-icon__image" src="/static/icons/warehouse.svg" mode="aspectFit" />
          </view>
          <view class="menu-name">入库任务</view>
        </view>
        <view class="menu-tile" @tap="openInventoryQuery">
          <view class="menu-icon">
            <image class="menu-icon__image" src="/static/icons/inventory.svg" mode="aspectFit" />
          </view>
          <view class="menu-name">库存查询</view>
        </view>
        <view class="menu-tile" @tap="openContainerManagement">
          <view class="menu-icon">
            <image class="menu-icon__image" src="/static/icons/container.svg" mode="aspectFit" />
          </view>
          <view class="menu-name">容器管理</view>
        </view>
      </view>
    </view>

    <view v-else class="app-content">
      <view class="profile-card">
        <view class="profile-head">
          <view class="profile-avatar">{{ avatarInitial }}</view>
          <view>
            <view class="profile-name">{{ user.name }}</view>
            <view class="profile-role">{{ user.role }}</view>
          </view>
        </view>

        <view class="info-row"><text>用户 ID</text><text>{{ user.userId }}</text></view>
        <view class="info-row"><text>登录账号</text><text>{{ user.account }}</text></view>
        <view class="info-row"><text>所属部门</text><text>{{ user.department }}</text></view>
        <view class="info-row"><text>当前版本</text><text>{{ appVersion }}</text></view>
      </view>

      <button class="logout-button" @tap="handleLogout">退出登录</button>
    </view>

    <view class="bottom-tabs">
      <view
        class="bottom-tab"
        :class="{ 'bottom-tab--active': activeTab === 'menu' }"
        @tap="activeTab = 'menu'"
      >
        <image
          class="bottom-tab__icon"
          :src="activeTab === 'menu' ? '/static/icons/home-active.svg' : '/static/icons/home.svg'"
          mode="aspectFit"
        />
      </view>
      <view
        class="bottom-tab"
        :class="{ 'bottom-tab--active': activeTab === 'profile' }"
        @tap="activeTab = 'profile'"
      >
        <image
          class="bottom-tab__icon"
          :src="activeTab === 'profile' ? '/static/icons/user-active.svg' : '/static/icons/user.svg'"
          mode="aspectFit"
        />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.menu-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28rpx 20rpx;
}

.menu-tile {
  min-width: 0;
  text-align: center;
}

.menu-icon {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 12rpx;
  background: #ffffff;
  border: 2rpx solid #a9b8ca;
  color: #0d9496;
  font-size: 42rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-icon__image {
  width: 72rpx;
  height: 72rpx;
}

.menu-name {
  margin-top: 12rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: #102a43;
}

.profile-card {
  border: 2rpx solid #a9b8ca;
  border-radius: 12rpx;
  background: #ffffff;
  overflow: hidden;
}

.profile-head {
  display: flex;
  align-items: center;
  gap: 24rpx;
  min-height: 144rpx;
  padding: 24rpx;
  border-bottom: 2rpx solid #e4e9f0;
}

.profile-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  border: 2rpx solid #79b8b9;
  background: #e8f7f7;
  color: #0d9496;
  font-size: 34rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-name {
  font-size: 34rpx;
  font-weight: 700;
  color: #102a43;
}

.profile-role {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #64748b;
}

.info-row {
  min-height: 76rpx;
  padding: 0 24rpx;
  border-bottom: 2rpx solid #edf2f7;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 26rpx;
  color: #64748b;
}

.info-row text:last-child {
  color: #102a43;
  font-weight: 700;
}

.logout-button {
  height: 88rpx;
  margin-top: 32rpx;
  border-radius: 8rpx;
  background: #ffffff;
  border: 2rpx solid #b7c4d4;
  color: #334e68;
  font-size: 30rpx;
  font-weight: 700;
}

.bottom-tabs {
  height: 116rpx;
  background: #ffffff;
  border-top: 2rpx solid #c7d2df;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.bottom-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
}

.bottom-tab__icon {
  width: 58rpx;
  height: 58rpx;
}

.bottom-tab--active {
  color: #0d9496;
  font-weight: 700;
  background: #e8f7f7;
}
</style>
