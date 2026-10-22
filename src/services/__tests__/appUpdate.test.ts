import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_UPDATE_DIAGNOSTICS_KEY,
  APP_LATEST_VERSION_CONFIG_KEY,
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

function setupCheck() {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const diagnostics: unknown[] = [];
  const request = vi.fn((options: UniNamespace.RequestOptions) => {
    options.success?.({
      statusCode: 200,
      data: { code: 0, data: options.url.includes(APP_LATEST_VERSION_CONFIG_KEY) ? '1.0.0' : '42' },
      header: {}, cookies: []
    });
    return {} as UniNamespace.RequestTask;
  });
  const getProperty = vi.fn((_id: string, callback: (info: { version: string }) => void) => {
    callback({ version: '1.0.0' });
  });
  const showModal = vi.fn((_options: UniNamespace.ShowModalOptions) => {});
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => key === APP_UPDATE_DIAGNOSTICS_KEY ? diagnostics : {
      token: 'secret-test-token', baseUrl: 'http://192.168.0.171:18080', user: { account: 'admin' }
    },
    setStorageSync: (_key: string, entries: unknown[]) => { diagnostics.splice(0, diagnostics.length, ...entries); },
    getSystemInfoSync: () => ({ platform: 'android', uniRuntimeVersion: '5.24.0' }),
    request, showModal
  });
  vi.stubGlobal('plus', { runtime: { appid: runtime.appid, version: '1.0.0', getProperty } });
  return { request, getProperty, showModal, diagnostics };
}

describe('app update service', () => {
  afterEach(() => {
    stopAppUpdatePolling();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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

  it.each(['http://192.168.0.171:18080', 'http://192.168.0.172:18081'])('updates from session server %s after confirmation', async (baseUrl) => {
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
        baseUrl,
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
        url: `${baseUrl}/api/v1/system/configs/value/${key}`,
        header: { Authorization: 'Bearer signed-token' }
      }));
    }
    expect(createDownload).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/files/42/download`,
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

  it('recovers the next minute after a missing native callback and ignores its late result', async () => {
    const { getProperty, request, diagnostics } = setupCheck();
    let lateCallback: ((info: { version: string }) => void) | undefined;
    getProperty.mockImplementationOnce((_id, callback) => { lateCallback = callback; });
    const first = startAppUpdatePolling();
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(diagnostics).toContainEqual(expect.objectContaining({ result: 'runtime_timeout' }));
    lateCallback?.({ version: '1.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('bounds missing request callbacks and retries without displaying a failure modal', async () => {
    const { request, showModal, diagnostics } = setupCheck();
    request.mockImplementationOnce(() => ({} as UniNamespace.RequestTask));
    const first = startAppUpdatePolling();
    await vi.advanceTimersByTimeAsync(15_000);
    await first;
    expect(diagnostics).toContainEqual(expect.objectContaining({ result: 'config_timeout' }));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(request).toHaveBeenCalledTimes(4);
    expect(showModal).not.toHaveBeenCalled();
  });

  it('records HTTP and malformed-response failures without storing server messages or credentials', async () => {
    const { request, diagnostics } = setupCheck();
    request.mockImplementationOnce((options) => {
      options.success?.({ statusCode: 401, data: { message: 'secret-test-token' }, header: {}, cookies: [] });
      return {} as UniNamespace.RequestTask;
    });
    await checkForAppUpdate();
    expect(diagnostics).toContainEqual(expect.objectContaining({ httpStatus: 401 }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ result: 'config_rejected_http_401' }));
    request.mockImplementationOnce((options) => {
      options.success?.({ statusCode: 200, data: { code: 0, data: 123 }, header: {}, cookies: [] });
      return {} as UniNamespace.RequestTask;
    });
    await checkForAppUpdate();
    expect(diagnostics).toContainEqual(expect.objectContaining({ result: 'invalid_config_response' }));
    for (let index = 0; index < 12; index += 1) await checkForAppUpdate();
    expect(diagnostics).toHaveLength(60);
    expect(JSON.stringify(diagnostics)).not.toContain('secret-test-token');
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('secret-test-token');
  });

  it('restores polling on foreground entry without duplicate timers or in-flight checks', async () => {
    const { request, getProperty } = setupCheck();
    await startAppUpdatePolling();
    stopAppUpdatePolling();
    await startAppUpdatePolling();
    expect(request).toHaveBeenCalledTimes(4);
    let complete: ((info: { version: string }) => void) | undefined;
    getProperty.mockImplementationOnce((_id, callback) => { complete = callback; });
    const foreground = startAppUpdatePolling();
    await startAppUpdatePolling();
    expect(getProperty).toHaveBeenCalledTimes(3);
    complete?.({ version: '1.0.0' });
    await foreground;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(8);
  });

  it('does not continue a stopped check after its native callback returns', async () => {
    const { getProperty, request } = setupCheck();
    let complete: ((info: { version: string }) => void) | undefined;
    getProperty.mockImplementationOnce((_id, callback) => { complete = callback; });
    const pending = startAppUpdatePolling();
    stopAppUpdatePolling();
    complete?.({ version: '1.0.0' });
    await pending;
    expect(request).not.toHaveBeenCalled();
  });

  it('ignores a late config result after timeout and permits a later update confirmation', async () => {
    const { request, showModal } = setupCheck();
    let late: UniNamespace.RequestOptions | undefined;
    request.mockImplementationOnce((options) => {
      late = options;
      return {} as UniNamespace.RequestTask;
    });
    const first = startAppUpdatePolling();
    await vi.advanceTimersByTimeAsync(15_000);
    await first;
    late?.success?.({ statusCode: 200, data: { code: 0, data: '1.0.1' }, header: {}, cookies: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(showModal).not.toHaveBeenCalled();
    request.mockImplementationOnce((options) => {
      options.success?.({ statusCode: 200, data: { code: 0, data: '1.0.1' }, header: {}, cookies: [] });
      return {} as UniNamespace.RequestTask;
    });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(showModal).toHaveBeenCalledTimes(1);
    showModal.mock.calls[0][0].success?.({ confirm: false, cancel: true, content: '' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(6);
  });

  it('continues checking when diagnostic persistence is unavailable', async () => {
    const { request } = setupCheck();
    uni.setStorageSync = () => { throw new Error('storage full'); };
    await checkForAppUpdate();
    await checkForAppUpdate();
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('keeps confirmation, download, install and restart waits exclusive beyond check deadlines', async () => {
    const { request, showModal } = setupCheck();
    request.mockImplementation((options) => {
      options.success?.({ statusCode: 200,
        data: { code: 0, data: options.url.includes(APP_LATEST_VERSION_CONFIG_KEY) ? '1.0.1' : '42' },
        header: {}, cookies: [] });
      return {} as UniNamespace.RequestTask;
    });
    let downloaded: ((download: PlusDownloaderDownload, code: number) => void) | undefined;
    let installed: (() => void) | undefined;
    const createDownload = vi.fn((_url, _options, callback) => {
      downloaded = callback;
      return { setRequestHeader: vi.fn(), addEventListener: vi.fn(), start: vi.fn() };
    });
    const install = vi.fn((_path, _options, callback) => { installed = callback; });
    const restart = vi.fn();
    Object.assign(plus.runtime, { install, restart });
    Object.assign(plus, {
      downloader: { createDownload },
      nativeUI: { showWaiting: () => ({ setTitle: vi.fn(), close: vi.fn() }) }
    });
    const pending = startAppUpdatePolling();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(createDownload).not.toHaveBeenCalled();
    showModal.mock.calls[0][0].success?.({ confirm: true, cancel: false, content: '' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(createDownload).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    downloaded?.({ filename: '_doc/test.wgt' } as PlusDownloaderDownload, 200);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(install).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    installed?.();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(showModal).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(restart).not.toHaveBeenCalled();
    showModal.mock.calls[1][0].success?.({ confirm: false, cancel: true, content: '' });
    await pending;
  });
});
