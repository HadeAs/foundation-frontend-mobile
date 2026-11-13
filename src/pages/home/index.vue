<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import manifest from '../../manifest.json';
import { getAccessToken, getCurrentApiBaseUrl, getCurrentUser, logout } from '../../services/auth';
import { stopAppUpdatePolling } from '../../services/appUpdate';
import OperationNotice from '../../components/OperationNotice.vue';
import { mobileMenusApi, type MobileMenu, type MobileMenuGroup } from '../../services/mobileMenus';

const activeTab = ref<'menu' | 'profile'>('menu');
const appVersion = ref(manifest.versionName);
const user = ref(getCurrentUser());
const leaving = ref(false);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const avatarInitial = computed(() => Array.from(user.value?.name.trim() || '')[0]?.toUpperCase() || '用');
const title = computed(() => activeTab.value === 'menu' ? '首页' : '个人信息');
const groups = ref<MobileMenuGroup[]>([]);
const loadingMenus = ref(false);
const menuError = ref('');
let active = false;
let menuGeneration = 0;
let menuToken = '';
let menuBaseUrl = '';
function resetMenus() {
  menuGeneration++;
  groups.value = []; loadingMenus.value = false; menuError.value = ''; notice.value = '';
  clearTimeout(noticeTimer);
}
async function loadMenus() {
  if (!active || leaving.value) return;
  resetMenus();
  menuToken = getAccessToken(); menuBaseUrl = getCurrentApiBaseUrl();
  if (!menuToken) { uni.reLaunch({ url: '/pages/login/index' }); return; }
  const generation = menuGeneration;
  const current = () => active && generation === menuGeneration && menuToken === getAccessToken() && menuBaseUrl === getCurrentApiBaseUrl();
  loadingMenus.value = true;
  try {
    const result = await mobileMenusApi.getGroups();
    if (current()) groups.value = result;
  } catch (error) {
    if (current()) {
      menuError.value = error instanceof Error ? error.message : '菜单加载失败，请重试';
      notice.value = menuError.value;
      noticeTimer = setTimeout(() => { notice.value = ''; }, 6500);
    }
  } finally { if (current()) loadingMenus.value = false; }
}

onShow(() => {
  active = true;
  void loadMenus();
  if (!getAccessToken()) return;
  user.value = getCurrentUser();
  if (typeof plus !== 'undefined') {
    plus.runtime.getProperty(plus.runtime.appid || '', (info) => {
      appVersion.value = info.version || plus.runtime.version || manifest.versionName;
    });
  }
});
function openMenu(menu: MobileMenu) {
  if (!active || loadingMenus.value || leaving.value) return;
  if (menuToken !== getAccessToken() || menuBaseUrl !== getCurrentApiBaseUrl()) { void loadMenus(); return; }
  if (groups.value.some(group => group.menus.some(item => item.id === menu.id && item.path === menu.path))) {
    uni.navigateTo({ url: menu.path });
  }
}
function switchTab(tab: 'menu' | 'profile') {
  activeTab.value = tab;
  notice.value = '';
}
async function handleLogout() {
  if (leaving.value) return;
  leaving.value = true;
  resetMenus();
  stopAppUpdatePolling();
  await logout();
  uni.reLaunch({ url: '/pages/login/index' });
}
onHide(() => { active = false; resetMenus(); });
onUnmounted(() => { active = false; resetMenus(); });
</script>

<template>
  <view class="home-page">
    <view class="home-nav"><text>{{ title }}</text></view>
    <OperationNotice :text="notice" error />
    <scroll-view class="home-body" scroll-y>
      <view v-if="activeTab === 'menu'" class="menu-content">
        <view v-if="loadingMenus" class="menu-state" role="status">正在加载菜单…</view>
        <view v-else-if="menuError" class="menu-state">
          <text>菜单加载失败</text><button class="menu-retry" @tap="loadMenus">重新加载</button>
        </view>
        <view v-else-if="!groups.length" class="menu-state">暂无可用菜单，请联系管理员分配 PDA 菜单权限</view>
        <view v-for="group in groups" :key="group.id" class="menu-group">
          <view class="menu-heading">{{ group.name }}</view>
          <view class="menu-grid">
            <button v-for="menu in group.menus" :key="menu.id" class="menu-entry" @tap="openMenu(menu)">
              <image :src="`/static/icons/menu/${menu.icon}.svg`" class="menu-icon" mode="aspectFit" aria-hidden="true" />
              <text>{{ menu.name }}</text>
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
.menu-state { padding: 28px 12px; text-align: center; color: #71878a; line-height: 1.6; }
.menu-retry { margin: 12px auto 0; width: 120px; padding: 10px; background: white; color: #087779; border: 1px solid #b8d6d6; border-radius: 7px; font-size: 14px; }
</style>
