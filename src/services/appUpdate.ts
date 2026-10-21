import { getAccessToken, getCurrentApiBaseUrl } from './auth';
import { apiRequest } from './apiTransport';

export const APP_LATEST_VERSION_CONFIG_KEY = 'foundation.app.latest-version';
export const APP_WGT_FILE_ID_CONFIG_KEY = 'foundation.app.wgt-file-id';
const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;
const FILE_ID_PATTERN = /^[1-9]\d*$/;
const UPDATE_POLL_INTERVAL_MS = 60_000;
export const APP_UPDATE_DIAGNOSTICS_KEY = 'foundation.app.update-diagnostics';

interface UpdateDiagnostic {
  time: string;
  stage: string;
  result: string;
  httpStatus?: number;
}

class UpdateCheckError extends Error {}

// Only fixed reason codes/statuses are persisted, never request headers or server messages.
function recordUpdateDiagnostic(stage: string, result: string, httpStatus?: number): void {
  const entry: UpdateDiagnostic = { time: new Date().toISOString(), stage, result, httpStatus };
  try {
    console.info(`[app-update] ${JSON.stringify(entry)}`);
    const stored: unknown = uni.getStorageSync(APP_UPDATE_DIAGNOSTICS_KEY);
    const entries = Array.isArray(stored) ? stored : [];
    uni.setStorageSync(APP_UPDATE_DIAGNOSTICS_KEY, [...entries.slice(-59), entry]);
  } catch {
    // Diagnostic storage must never prevent checking or installing an update.
  }
}

function withCheckTimeout<T>(
  stage: string,
  timeout: number,
  execute: (resolve: (value: T) => void, reject: (error: unknown) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpdateCheckError(`${stage}_timeout`)), timeout);
    const finish = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    };
    try {
      execute(finish, fail);
    } catch (error) {
      fail(error);
    }
  });
}

interface ApiResult<T> {
  code?: number;
  message?: string;
  data?: T;
}

export interface AppUpdateInfo {
  appid: string;
  type: 'wgt';
  version: string;
  url: string;
  mandatory?: boolean;
  title?: string;
  releaseNotes?: string;
  minAppVersion?: string;
  runtimeVersion?: string;
}

export interface AppRuntimeInfo {
  appid: string;
  platform: string;
  appVersion: string;
  wgtVersion: string;
  runtimeVersion: string;
}

export type UpdateDecision =
  | { status: 'ready' }
  | { status: 'skip'; reason: string }
  | { status: 'incompatible'; reason: string };

let checking = false;
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let pollingGeneration = 0;

function parseVersion(version: string): number[] {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`无效版本号：${version}`);
  }
  return version.split('.').map(Number);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

export function evaluateUpdate(
  update: AppUpdateInfo,
  runtime: AppRuntimeInfo
): UpdateDecision {
  if (update.appid !== runtime.appid) {
    return { status: 'skip', reason: '更新包 appid 与当前应用不一致' };
  }
  if (update.type !== 'wgt') {
    return { status: 'skip', reason: '当前客户端只支持 WGT 更新' };
  }

  try {
    if (
      compareVersions(update.version, runtime.appVersion) <= 0
      || compareVersions(update.version, runtime.wgtVersion) <= 0
    ) {
      return { status: 'skip', reason: '当前资源已是最新版本' };
    }
    if (
      update.minAppVersion
      && compareVersions(runtime.appVersion, update.minAppVersion) < 0
    ) {
      return {
        status: 'incompatible',
        reason: `需要先安装 ${update.minAppVersion} 或更高版本的整包`
      };
    }
    if (
      update.runtimeVersion
      && (
        !runtime.runtimeVersion
        || compareVersions(runtime.runtimeVersion, update.runtimeVersion) < 0
      )
    ) {
      return {
        status: 'incompatible',
        reason: '当前 App 运行时过旧，需要先安装新版整包'
      };
    }
  } catch (error) {
    return { status: 'skip', reason: getErrorMessage(error) };
  }

  return { status: 'ready' };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'errMsg' in error) {
    return String(error.errMsg);
  }
  return String(error || '未知错误');
}

function getRuntimeInfo(): Promise<AppRuntimeInfo> {
  const systemInfo = uni.getSystemInfoSync();
  const appid = plus.runtime.appid || '';
  const appVersion = plus.runtime.version || '0.0.0';
  return withCheckTimeout('runtime', 10_000, (resolve, reject) => {
    plus.runtime.getProperty(appid, (widgetInfo) => {
      if (!widgetInfo || typeof widgetInfo.version !== 'string') {
        reject(new UpdateCheckError('invalid_runtime_response'));
        return;
      }
      resolve({
        appid,
        platform: systemInfo.platform.toLowerCase(),
        appVersion,
        wgtVersion: widgetInfo.version || appVersion,
        runtimeVersion: systemInfo.uniRuntimeVersion || ''
      });
    });
  });
}

function requestConfigValue(baseUrl: string, key: string, token: string): Promise<string> {
  return withCheckTimeout('config', 15_000, (resolve, reject) => {
    apiRequest({
      url: `${baseUrl}/api/v1/system/configs/value/${encodeURIComponent(key)}`,
      method: 'GET',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 10_000,
      success: (response) => {
        const body = response.data as ApiResult<string>;
        recordUpdateDiagnostic(key, 'response', response.statusCode);
        if (!body || typeof body !== 'object' || (body.data != null && typeof body.data !== 'string')) {
          reject(new UpdateCheckError('invalid_config_response'));
          return;
        }
        if (
          response.statusCode >= 200
          && response.statusCode < 300
          && (body.code === undefined || body.code === 0)
        ) {
          resolve(body.data?.trim() || '');
          return;
        }
        reject(new UpdateCheckError(`config_rejected_http_${response.statusCode}`));
      },
      fail: () => reject(new UpdateCheckError('config_network_failure'))
    });
  });
}

async function requestLatestUpdate(
  baseUrl: string,
  runtime: AppRuntimeInfo
): Promise<AppUpdateInfo | null> {
  const token = getAccessToken();
  const [version, fileId] = await Promise.all([
    requestConfigValue(baseUrl, APP_LATEST_VERSION_CONFIG_KEY, token),
    requestConfigValue(baseUrl, APP_WGT_FILE_ID_CONFIG_KEY, token)
  ]);
  if (!version && !fileId) {
    return null;
  }
  if (!version) {
    throw new UpdateCheckError('missing_latest_version');
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new UpdateCheckError('invalid_latest_version');
  }
  if (!FILE_ID_PATTERN.test(fileId)) {
    throw new UpdateCheckError('invalid_wgt_file_id');
  }

  return {
    appid: runtime.appid,
    type: 'wgt',
    version,
    url: `/api/v1/files/${fileId}/download`,
    title: '发现新版本',
    releaseNotes: `发现新版本 ${version}，是否立即更新？`
  };
}

function resolveDownloadUrl(baseUrl: string, url: string): string {
  const resolved = /^https?:\/\//i.test(url)
    ? url
    : `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  if (!/^https?:\/\//i.test(resolved)) {
    throw new Error('更新包下载地址必须使用 HTTP 或 HTTPS');
  }
  return resolved;
}

function showConfirm(update: AppUpdateInfo): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: update.title || '发现新版本',
      content: update.releaseNotes || `资源版本 ${update.version} 已发布，是否立即更新？`,
      showCancel: !update.mandatory,
      cancelText: '稍后',
      confirmText: '立即更新',
      success: ({ confirm }) => resolve(confirm),
      fail: () => resolve(false)
    });
  });
}

function downloadWgt(
  url: string,
  version: string,
  waiting: PlusNativeUIWaitingObj
): Promise<string> {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const task = plus.downloader.createDownload(url, {
      filename: `_doc/foundation-app-${version}.wgt`,
      timeout: 120,
      retry: 2
    }, (download, statusCode) => {
      if (statusCode >= 200 && statusCode < 300 && download.filename) {
        resolve(download.filename);
        return;
      }
      reject(new Error(`下载更新包失败（HTTP ${statusCode}）`));
    });
    if (token) {
      task.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    task.addEventListener('statechanged', (download) => {
      if (download.totalSize) {
        const progress = Math.floor((download.downloadedSize || 0) * 100 / download.totalSize);
        waiting.setTitle(`下载更新 ${progress}%`);
      }
    });
    task.start();
  });
}

function installWgt(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    plus.runtime.install(
      filePath,
      { force: false },
      () => resolve(),
      (error) => reject(new Error(getErrorMessage(error)))
    );
  });
}

function showRestartPrompt(mandatory: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '更新完成',
      content: '新版本已安装，需要重启应用后生效。',
      showCancel: !mandatory,
      cancelText: '稍后',
      confirmText: '立即重启',
      success: ({ confirm }) => resolve(confirm),
      fail: () => resolve(false)
    });
  });
}

function showUpdateError(error: unknown, mandatory: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '更新失败',
      content: `${getErrorMessage(error)}${mandatory ? '\n请检查网络后重试。' : ''}`,
      showCancel: !mandatory,
      cancelText: '关闭',
      confirmText: mandatory ? '重试' : '确定',
      success: ({ confirm }) => resolve(mandatory && confirm),
      fail: () => resolve(false)
    });
  });
}

function showIncompatibleUpdate(reason: string): void {
  uni.showModal({
    title: '需要整包更新',
    content: reason,
    showCancel: false,
    confirmText: '知道了'
  });
}

async function applyUpdate(update: AppUpdateInfo, baseUrl: string): Promise<void> {
  recordUpdateDiagnostic('confirmation', 'waiting');
  if (!await showConfirm(update)) {
    recordUpdateDiagnostic('confirmation', 'deferred');
    return;
  }

  const downloadUrl = resolveDownloadUrl(baseUrl, update.url);
  do {
    const waiting = plus.nativeUI.showWaiting('下载更新 0%', { back: 'none' });
    try {
      recordUpdateDiagnostic('download', 'started');
      const filePath = await downloadWgt(downloadUrl, update.version, waiting);
      waiting.setTitle('正在安装更新...');
      recordUpdateDiagnostic('install', 'started');
      await installWgt(filePath);
      waiting.close();

      recordUpdateDiagnostic('restart_confirmation', 'waiting');
      if (await showRestartPrompt(Boolean(update.mandatory))) {
        recordUpdateDiagnostic('restart', 'confirmed');
        plus.runtime.restart();
      }
      return;
    } catch (error) {
      recordUpdateDiagnostic('apply', 'failed');
      waiting.close();
      if (!await showUpdateError(error, Boolean(update.mandatory))) {
        return;
      }
    }
  } while (update.mandatory);
}

export async function checkForAppUpdate(): Promise<void> {
  // #ifdef APP-PLUS
  if (checking || typeof plus === 'undefined' || typeof uni === 'undefined') {
    return;
  }

  checking = true;
  const generation = pollingGeneration;
  try {
    const token = getAccessToken();
    recordUpdateDiagnostic('check', 'started');
    const baseUrl = getCurrentApiBaseUrl();
    if (!baseUrl) {
      return;
    }

    recordUpdateDiagnostic('runtime', 'reading');
    const runtime = await getRuntimeInfo();
    if (generation !== pollingGeneration || token !== getAccessToken()) {
      return;
    }
    recordUpdateDiagnostic('config', 'reading');
    const update = await requestLatestUpdate(baseUrl, runtime);
    if (generation !== pollingGeneration || token !== getAccessToken() || baseUrl !== getCurrentApiBaseUrl()) {
      return;
    }
    if (!update) {
      recordUpdateDiagnostic('check', 'not_configured');
      return;
    }

    const decision = evaluateUpdate(update, runtime);
    recordUpdateDiagnostic('decision', decision.status);
    if (decision.status === 'incompatible') {
      showIncompatibleUpdate(decision.reason);
      return;
    }
    if (decision.status === 'skip') {
      return;
    }

    await applyUpdate(update, baseUrl);
  } catch (error) {
    recordUpdateDiagnostic('check', error instanceof UpdateCheckError ? error.message : 'unexpected_failure');
  } finally {
    checking = false;
    recordUpdateDiagnostic('check', 'finished');
  }
  // #endif
}

export function stopAppUpdatePolling(): void {
  pollingGeneration += 1;
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

export async function startAppUpdatePolling(): Promise<void> {
  // #ifdef APP-PLUS
  if (!getAccessToken()) {
    stopAppUpdatePolling();
    return;
  }

  if (!pollingTimer) {
    pollingTimer = setInterval(() => {
      if (!getAccessToken()) {
        stopAppUpdatePolling();
        return;
      }
      void checkForAppUpdate();
    }, UPDATE_POLL_INTERVAL_MS);
  }
  await checkForAppUpdate();
  // #endif
}
