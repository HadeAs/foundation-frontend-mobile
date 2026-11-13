import { getAccessToken, getCurrentApiBaseUrl } from './auth';
import { apiRequest } from './apiTransport';
import { getRequestBaseUrl } from './environment';

export interface UserMenu {
  menuId: number;
  parentId: number;
  menuName: string;
  menuType: string;
  terminalType: string;
  path?: string;
  icon?: string;
  externalUrl?: string;
  sortNo?: number;
  visible: boolean;
  status: number;
}
export interface MobileMenu { id: number; name: string; path: string; icon: string }
export interface MobileMenuGroup { id: number; name: string; menus: MobileMenu[] }

// Local page/icon registry only; authorization and presentation order come from auth/me.
const pageIcons: Record<string, string> = {
  '/pages/panel-packing/index': 'scan-line',
  '/pages/order-packing/index': 'list-plus',
  '/pages/panel-unbinding/index': 'package-minus',
  '/pages/vehicle-loading/index': 'forklift',
  '/pages/vehicle-unloading/index': 'unplug',
  '/pages/box-vehicle-binding/index': 'truck',
  '/pages/box-vehicle-unbinding/index': 'unplug',
  '/pages/location-binding/index': 'map-pin-check',
  '/pages/warehouse-application/index': 'clipboard-check',
  '/pages/receiving/index': 'package-check',
  '/pages/pending-receiving/index': 'clipboard-list',
  '/pages/shipping/index': 'package-open',
  '/pages/logistics-create/index': 'route',
  '/pages/logistics-cancel/index': 'circle-x',
  '/pages/empty-vehicle/index': 'truck',
  '/pages/traffic-control/index': 'shield-check',
  '/pages/warehouse-logistics/index': 'warehouse',
  '/pages/material-call/index': 'package-open'
};
const icons = new Set(Object.values(pageIcons));
function order(a: UserMenu, b: UserMenu) { return (a.sortNo ?? 0) - (b.sortNo ?? 0) || a.menuId - b.menuId; }

export function buildMobileMenuGroups(rows: UserMenu[]): MobileMenuGroup[] {
  const enabled = rows.filter(row => row && Number.isSafeInteger(row.menuId) && row.menuId > 0 &&
    Number.isSafeInteger(row.parentId) && row.parentId >= 0 && typeof row.menuName === 'string' && row.menuName.trim() &&
    row.terminalType === 'MOBILE' && row.status === 1 && row.visible === true);
  if (new Set(enabled.map(row => row.menuId)).size !== enabled.length) throw new Error('菜单数据重复，请联系管理员');
  const roots = enabled.filter(row => row.parentId === 0 && row.menuType === 'DIR' && row.menuName === 'PDA');
  return roots.sort(order).flatMap(root => enabled.filter(row => row.parentId === root.menuId && row.menuType === 'DIR').sort(order)
    .map(group => ({ id: group.menuId, name: group.menuName,
      menus: enabled.filter(row => row.parentId === group.menuId && row.menuType === 'MENU').sort(order).flatMap(row => {
        const path = typeof row.path === 'string' ? '/' + row.path.trim().replace(/^\//, '') : '';
        if (!Object.prototype.hasOwnProperty.call(pageIcons, path) || row.externalUrl) return [];
        return [{ id: row.menuId, name: row.menuName, path, icon: row.icon && icons.has(row.icon) ? row.icon : pageIcons[path] }];
      })
    })).filter(group => group.menus.length > 0));
}

export const mobileMenusApi = {
  async getGroups(): Promise<MobileMenuGroup[]> {
    const token = getAccessToken();
    if (!token) throw new Error('登录已失效，请重新登录');
    return new Promise((resolve, reject) => {
      apiRequest({
        url: `${getRequestBaseUrl(getCurrentApiBaseUrl())}/api/v1/auth/me`, method: 'GET',
        header: { Authorization: `Bearer ${token}` }, timeout: 15000,
        success(response) {
          const body = response.data as { code?: number; message?: string; data?: { menus?: UserMenu[] } } | null;
          if (response.statusCode < 200 || response.statusCode >= 300 || body?.code !== 0) {
            reject(new Error(body?.message || '菜单加载失败，请重试')); return;
          }
          if (!Array.isArray(body.data?.menus)) { reject(new Error('菜单数据不完整，请重试')); return; }
          try { resolve(buildMobileMenuGroups(body.data.menus)); } catch (error) { reject(error); }
        },
        fail: () => reject(new Error('无法加载菜单，请检查网络后重试'))
      });
    });
  }
};
