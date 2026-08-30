<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { getCurrentUser, logout } from '../../services/auth';

type HomeTab = 'menu' | 'profile';

const activeTab = shallowRef<HomeTab>('menu');
const fallbackUser = {
  name: '张三',
  employeeNo: 'OP-001',
  team: 'A 班 / 生产部',
  role: '操作员',
  account: 'operator01'
};

const user = computed(() => getCurrentUser() ?? fallbackUser);
const title = computed(() => (activeTab.value === 'menu' ? '首页' : '个人信息'));

function handleLogout() {
  logout();
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
          <view class="profile-avatar">头像</view>
          <view>
            <view class="profile-name">{{ user.name }}</view>
            <view class="profile-role">一线操作员</view>
          </view>
        </view>

        <view class="info-row"><text>姓名</text><text>{{ user.name }}</text></view>
        <view class="info-row"><text>工号</text><text>{{ user.employeeNo }}</text></view>
        <view class="info-row"><text>班组/部门</text><text>{{ user.team }}</text></view>
        <view class="info-row"><text>角色</text><text>{{ user.role }}</text></view>
        <view class="info-row"><text>登录账号</text><text>{{ user.account }}</text></view>
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
  color: #123f7a;
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
  border: 2rpx dashed #8ca5c4;
  color: #64748b;
  font-size: 24rpx;
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
  color: #123f7a;
  font-weight: 700;
  background: #eef4ff;
}
</style>
