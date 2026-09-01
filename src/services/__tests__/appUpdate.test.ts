import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForAppUpdate,
  compareVersions,
  evaluateUpdate,
  startAppUpdatePolling,
  stopAppUpdatePolling,
  type AppRuntimeInfo,
  type AppUpdateInfo
} from '../appUpdate';

const runtime: AppRuntimeInfo = {
  appid: '__UNI__EF475D9',
  platform: 'android',
  appVersion: '1.0.0',
  wgtVersion: '1.0.0',
  runtimeVersion: '5.24.0'
};

const update: AppUpdateInfo = {
  appid: '__UNI__EF475D9',
  type: 'wgt',
  version: '1.0.1',
  url: '/api/v1/files/42/download',
  runtimeVersion: '5.24.0'
};

describe('app update service', () => {
  afterEach(() => {
    stopAppUpdatePolling();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '2.0.1')).toBe(-1);
  });

  it('rejects WGT packages that require a newer native runtime', () => {
    expect(evaluateUpdate(
      { ...update, runtimeVersion: '5.25.0' },
      runtime
    )).toEqual({
      status: 'incompatible',
      reason: '当前 App 运行时过旧，需要先安装新版整包'
    });
  });

  it('skips packages for another appid or an installed version', () => {
    expect(evaluateUpdate({ ...update, appid: 'another-app' }, runtime).status).toBe('skip');
    expect(evaluateUpdate({ ...update, version: '1.0.0' }, runtime).status).toBe('skip');
  });

  it('checks immediately and then once per minute after login', async () => {
    vi.useFakeTimers();
    const request = vi.fn((options: UniNamespace.RequestOptions) => {
      const value = String(options.url).includes('foundation.app.latest-version')
        ? runtime.wgtVersion
        : '42';
      options.success?.({
        statusCode: 200,
        data: { code: 0, data: value },
        header: {},
        cookies: []
      });
      return {} as UniNamespace.RequestTask;
    });
    vi.stubGlobal('uni', {
      getStorageSync: () => ({
        token: 'signed-token',
        baseUrl: 'http://192.168.0.171:18080',
        user: { account: 'admin' }
      }),
      getSystemInfoSync: () => ({
        platform: 'android',
        uniRuntimeVersion: runtime.runtimeVersion
      }),
      request
    });
    vi.stubGlobal('plus', {
      runtime: {
        appid: runtime.appid,
        version: runtime.appVersion,
        getProperty: (_appid: string, callback: (info: { version: string }) => void) => {
          callback({ version: runtime.wgtVersion });
        }
      }
    });

    await startAppUpdatePolling();
    expect(request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('downloads, installs, and restarts after the user confirms', async () => {
    const install = vi.fn((_path, _options, success: () => void) => success());
    const restart = vi.fn();
    const setTitle = vi.fn();
    const close = vi.fn();
    const setRequestHeader = vi.fn();
    const request = vi.fn((options: UniNamespace.RequestOptions) => {
      const value = String(options.url).includes('foundation.app.latest-version')
        ? update.version
        : '42';
      options.success?.({
        statusCode: 200,
        data: { code: 0, data: value },
        header: {},
        cookies: []
      });
      return {} as UniNamespace.RequestTask;
    });
    const createDownload = vi.fn((
      _url: string,
      _options: PlusDownloaderDownloadOptions,
      completed: (download: PlusDownloaderDownload, statusCode: number) => void
    ) => {
      const task = {
        setRequestHeader,
        addEventListener: (
          _type: 'statechanged',
          listener: (download: PlusDownloaderDownload, statusCode: number) => void
        ) => listener({ downloadedSize: 100, totalSize: 100 } as PlusDownloaderDownload, 200),
        start: () => completed({
          filename: '_doc/foundation-app-1.0.1.wgt'
        } as PlusDownloaderDownload, 200)
      };
      return task as unknown as PlusDownloaderDownload;
    });

    vi.stubGlobal('uni', {
      getStorageSync: () => ({
        token: 'signed-token',
        baseUrl: 'http://192.168.0.171:18080',
        user: { account: 'admin' }
      }),
      getSystemInfoSync: () => ({
        platform: 'android',
        uniRuntimeVersion: '5.24.0'
      }),
      request,
      showModal: (options: UniNamespace.ShowModalOptions) => {
        options.success?.({ confirm: true, cancel: false, content: '' });
      }
    });
    vi.stubGlobal('plus', {
      runtime: {
        appid: runtime.appid,
        version: runtime.appVersion,
        getProperty: (_appid: string, callback: (info: { version: string }) => void) => {
          callback({ version: runtime.wgtVersion });
        },
        install,
        restart
      },
      nativeUI: {
        showWaiting: () => ({ setTitle, close })
      },
      downloader: {
        createDownload
      }
    });

    await checkForAppUpdate();

    expect(request).toHaveBeenCalledTimes(2);
    for (const key of ['foundation.app.latest-version', 'foundation.app.wgt-file-id']) {
      expect(request).toHaveBeenCalledWith(expect.objectContaining({
        url: `http://192.168.0.171:18080/api/v1/system/configs/value/${key}`,
        header: { Authorization: 'Bearer signed-token' }
      }));
    }
    expect(createDownload).toHaveBeenCalledWith(
      'http://192.168.0.171:18080/api/v1/files/42/download',
      expect.objectContaining({ filename: '_doc/foundation-app-1.0.1.wgt' }),
      expect.any(Function)
    );
    expect(setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer signed-token');
    expect(install).toHaveBeenCalledWith(
      '_doc/foundation-app-1.0.1.wgt',
      { force: false },
      expect.any(Function),
      expect.any(Function)
    );
    expect(close).toHaveBeenCalled();
    expect(restart).toHaveBeenCalled();
  });
});
