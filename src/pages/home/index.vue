<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import manifest from '../../manifest.json';
import { getAccessToken, getCurrentUser, logout } from '../../services/auth';
import { stopAppUpdatePolling } from '../../services/appUpdate';

const activeTab = ref<'menu' | 'profile'>('menu');
const appVersion = ref(manifest.versionName);
const user = ref(getCurrentUser());
const leaving = ref(false);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const avatarInitial = computed(() => Array.from(user.value?.name.trim() || '')[0]?.toUpperCase() || '用');
const title = computed(() => activeTab.value === 'menu' ? '首页' : '个人信息');
const groups = [
  { name: '常规作业', menus: [
    ['scan-line', '板件扫码绑箱'], ['list-plus', '板件快捷绑箱'], ['package-minus', '板件解绑'],
    ['forklift', '装车'], ['unplug', '卸车'], ['map-pin-check', '位置绑定'], ['clipboard-check', '缴库申请']
  ] },
  { name: '库房作业', menus: [
    ['package-check', '物料接收'], ['clipboard-list', '待接收物料清单'], ['package-open', '成品发货']
  ] },
  { name: '物流作业', menus: [
    ['route', '发起物流任务'], ['circle-x', '取消物流任务'], ['truck', '呼叫空载具'],
    ['shield-check', '交通管制'], ['warehouse', '缴库发起']
  ] }
];

onShow(() => {
  if (!getAccessToken()) { uni.reLaunch({ url: '/pages/login/index' }); return; }
  user.value = getCurrentUser();
  if (typeof plus !== 'undefined') {
    plus.runtime.getProperty(plus.runtime.appid || '', (info) => {
      appVersion.value = info.version || plus.runtime.version || manifest.versionName;
    });
  }
});
function openMenu(name: string) {
  if (name === '物料接收') { uni.navigateTo({ url: '/pages/receiving/index' }); return; }
  if (name === '缴库发起') { uni.navigateTo({ url: '/pages/warehouse-logistics/index' }); return; }
  if (name === '交通管制') { uni.navigateTo({ url: '/pages/traffic-control/index' }); return; }
  if (name === '呼叫空载具') { uni.navigateTo({ url: '/pages/empty-vehicle/index' }); return; }
  if (name === '取消物流任务') { uni.navigateTo({ url: '/pages/logistics-cancel/index' }); return; }
  if (name === '发起物流任务') { uni.navigateTo({ url: '/pages/logistics-create/index' }); return; }
  if (name === '成品发货') { uni.navigateTo({ url: '/pages/shipping/index' }); return; }
  if (name === '待接收物料清单') { uni.navigateTo({ url: '/pages/pending-receiving/index' }); return; }
  if (name === '板件扫码绑箱') { uni.navigateTo({ url: '/pages/panel-packing/index' }); return; }
  if (name === '板件快捷绑箱') { uni.navigateTo({ url: '/pages/order-packing/index' }); return; }
  if (name === '板件解绑') { uni.navigateTo({ url: '/pages/panel-unbinding/index' }); return; }
  if (name === '装车') { uni.navigateTo({ url: '/pages/vehicle-loading/index' }); return; }
  if (name === '卸车') { uni.navigateTo({ url: '/pages/vehicle-unloading/index' }); return; }
  if (name === '位置绑定') { uni.navigateTo({ url: '/pages/location-binding/index' }); return; }
  if (name === '缴库申请') { uni.navigateTo({ url: '/pages/warehouse-application/index' }); return; }
  clearTimeout(noticeTimer);
  notice.value = `${name}尚未开发，将按菜单顺序逐项开放`;
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3500);
}
function switchTab(tab: 'menu' | 'profile') {
  activeTab.value = tab;
  notice.value = '';
}
async function handleLogout() {
  if (leaving.value) return;
  leaving.value = true;
  stopAppUpdatePolling();
  await logout();
  uni.reLaunch({ url: '/pages/login/index' });
}
onUnmounted(() => clearTimeout(noticeTimer));
</script>

<template>
  <view class="home-page">
    <view class="home-nav"><text>{{ title }}</text></view>
    <view class="notice-anchor"><view v-if="notice" class="notice" role="status" aria-live="polite">{{ notice }}</view></view>
    <scroll-view class="home-body" scroll-y>
      <view v-if="activeTab === 'menu'" class="menu-content">
        <view v-for="group in groups" :key="group.name" class="menu-group">
          <view class="menu-heading">{{ group.name }}</view>
          <view class="menu-grid">
            <button v-for="[icon, name] in group.menus" :key="name" class="menu-entry" @tap="openMenu(name)">
              <image :src="`/static/icons/menu/${icon}.svg`" class="menu-icon" mode="aspectFit" aria-hidden="true" />
              <text>{{ name }}</text>
            </button>
          </view>
        </view>
      </view>
      <view v-else class="profile-content">
        <view class="profile-card">
          <view class="profile-head">
            <view class="profile-avatar">{{ avatarInitial }}</view>
            <view class="profile-identity">
              <view class="profile-name">{{ user?.name || '未登录' }}</view>
              <view class="profile-role">{{ user?.role || '未分配角色' }}</view>
            </view>
          </view>
          <view class="info-row"><text>用户 ID</text><text>{{ user?.userId ?? '-' }}</text></view>
          <view class="info-row"><text>登录账号</text><text>{{ user?.account || '-' }}</text></view>
          <view class="info-row"><text>所属部门</text><text>{{ user?.department || '未分配部门' }}</text></view>
          <view class="info-row"><text>当前版本</text><text>{{ appVersion }}</text></view>
        </view>
        <button class="logout-button" :disabled="leaving" :loading="leaving" @tap="handleLogout">退出登录</button>
      </view>
    </scroll-view>
    <view class="bottom-tabs" role="tablist" aria-label="主导航">
      <button class="bottom-tab" :class="{ 'bottom-tab--active': activeTab === 'menu' }" role="tab"
        aria-label="首页" :aria-selected="activeTab === 'menu'" @tap="switchTab('menu')">
        <image :src="activeTab === 'menu' ? '/static/icons/home-active.svg' : '/static/icons/home.svg'" mode="aspectFit" />
      </button>
      <button class="bottom-tab" :class="{ 'bottom-tab--active': activeTab === 'profile' }" role="tab"
        aria-label="个人信息" :aria-selected="activeTab === 'profile'" @tap="switchTab('profile')">
        <image :src="activeTab === 'profile' ? '/static/icons/user-active.svg' : '/static/icons/user.svg'" mode="aspectFit" />
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.home-page { height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: #f2f8f8; color: #20454a; padding-top: var(--status-bar-height, 0px); font-size: 14px; line-height: 1.4; }
button { margin: 0; font-family: inherit; line-height: 1.4; }
button::after { border: 0; }
button:focus-visible { outline: 2px solid #0d9496; outline-offset: -3px; }
.home-nav { flex-shrink: 0; height: 44px; display: flex; align-items: center; justify-content: center; background: #0d9496; color: white; font-size: 16px; font-weight: 500; }
.home-body { flex: 1; height: 0; min-height: 0; }
.menu-content, .profile-content { padding: 10px; }
.menu-group + .menu-group { margin-top: 12px; }
.menu-heading { margin-bottom: 6px; font-size: 13px; font-weight: 600; }
.menu-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 6px; }
.menu-entry { width: 100%; min-width: 0; min-height: 76px; padding: 8px 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 1px solid #b8d6d6; border-radius: 7px; color: #20454a; background: white; font-size: 12px; font-weight: 400; text-align: center; }
.menu-entry:active { background: #e8f7f7; }
.menu-entry text { max-width: 100%; overflow-wrap: anywhere; }
.menu-icon { width: 22px; height: 22px; flex-shrink: 0; }
.bottom-tabs { flex-shrink: 0; display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #cfe1e1; background: white; padding-bottom: env(safe-area-inset-bottom); }
.bottom-tab { height: 48px; display: flex; align-items: center; justify-content: center; background: transparent; border: 0; border-radius: 0; padding: 0; }
.bottom-tab image { width: 24px; height: 24px; }
.bottom-tab--active { background: #e8f7f7; }
.profile-card { background: white; border: 1px solid #b8d6d6; border-radius: 7px; overflow: hidden; }
.profile-head { display: flex; align-items: center; gap: 12px; padding: 14px 12px; border-bottom: 1px solid #dfebed; }
.profile-avatar { flex-shrink: 0; width: 48px; height: 48px; border: 1px solid #79b8b9; border-radius: 50%; background: #e8f7f7; color: #0d9496; font-size: 22px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.profile-identity { min-width: 0; }
.profile-name { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.profile-role { color: #71878a; font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
.info-row { min-height: 40px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 1px solid #edf2f3; font-size: 13px; }
.info-row:last-child { border-bottom: 0; }
.info-row text:first-child { color: #71878a; flex-shrink: 0; }
.info-row text:last-child { min-width: 0; font-weight: 500; text-align: right; overflow-wrap: anywhere; }
.logout-button { margin-top: 12px; min-height: 40px; border: 1px solid #b8d6d6; border-radius: 7px; background: white; color: #355b60; font-size: 14px; font-weight: 500; display: flex; align-items: center; justify-content: center; }
.notice-anchor { height: 0; position: relative; z-index: 10; }
.notice { position: absolute; top: 6px; left: 10px; right: 10px; padding: 10px 12px; border: 1px solid #0d949650; border-radius: 6px; background: rgba(232, 247, 247, 0.96); box-shadow: 0 4px 12px #20454a22; color: #086c6e; font-size: 13px; }
</style>
