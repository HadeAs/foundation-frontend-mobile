import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockData } from '../mockApi';
import * as mock from '../mockApi';
import { seedTestSession } from './helpers/authSession';
import { panelPackingApi } from '../panelPacking';
import { vehicleLoadingApi } from '../vehicleLoading';
import { locationBindingApi as api, type LocationContainers, type ContainerCandidate } from '../locationBinding';
import { useLocationBinding } from '../../composables/useLocationBinding';

const storage = new Map<string, unknown>();
const network = vi.fn(() => { throw new Error('Mock 不得调用真实网络'); });
async function finish<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }
beforeEach(async () => {
  vi.stubEnv('VITE_API_MODE', 'mock');
  vi.useFakeTimers();
  storage.clear();
  network.mockClear();
  resetMockData();
  vi.stubGlobal('uni', { request: network,
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key) });
  seedTestSession();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('location binding Mock workflow', () => {
  it('scans location then container using exact new request fields; binds once and clears', async () => {
    const flow = useLocationBinding();
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    expect(flow.canBind.value).toBe(false);
    await finish(flow.scan(' KW-03-02 '));
    expect(transport.mock.lastCall?.[0].data).toEqual({ locationCode: 'KW-03-02' });
    expect(flow.scanDisabled.value).toBe(false);
    await finish(flow.scan(' BOX-NR-240819 '));
    expect(transport.mock.lastCall?.[0].data).toEqual({ scanCode: 'BOX-NR-240819' });
    expect(flow.canBind.value).toBe(true);
    expect(flow.scanDisabled.value).toBe(true);
    await flow.scan('CAR-EMPTY');
    expect(flow.container.value?.containerCode).toBe('BOX-NR-240819');
    transport.mockClear();
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.lastCall?.[0].data).toEqual({ locationCode: 'KW-03-02', version: 1,
      container: { containerType: 'BOX', containerCode: 'BOX-NR-240819' }, containerVersion: 1, requestId: expect.any(String) });
    expect(flow.location.value).toBeNull();
    expect(flow.container.value).toBeNull();
    expect(flow.notice.value?.text).toBe('位置绑定成功');
    await finish(flow.scan('KW-03-02'));
    expect(flow.location.value).toMatchObject({ occupied: true, version: 2, container: { containerCode: 'BOX-NR-240819', version: 2 } });
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['KW-BOUND-BOX', 'KW-BOUND-CAR'])('shows %s, blocks new scans and confirms unbind without deleting contents', async (code) => {
    const boxBefore = await finish(panelPackingApi.getBox('BOX-NR-240818'));
    const loadsBefore = await finish(vehicleLoadingApi.getLoads('CAR-NR-0098'));
    const flow = useLocationBinding();
    await finish(flow.scan(code));
    const target = flow.container.value!;
    expect(flow.canUnbind.value).toBe(true);
    expect(flow.canBind.value).toBe(false);
    const get = vi.spyOn(api, 'getContainer');
    await flow.scan('BOX-1');
    expect(get).not.toHaveBeenCalled();
    const unbind = vi.spyOn(api, 'unbind');
    await flow.submit();
    expect(unbind).not.toHaveBeenCalled();
    flow.requestUnbind();
    flow.cancel();
    expect(flow.container.value).toEqual(target);
    flow.requestUnbind();
    await finish(Promise.all([flow.submit(), flow.submit()]));
    expect(unbind).toHaveBeenCalledOnce();
    expect(unbind).toHaveBeenCalledWith({ locationCode: code, version: 1,
      container: { containerType: target.containerType, containerCode: target.containerCode }, containerVersion: target.version });
    expect(flow.confirmation.value).toBe(false);
    expect(flow.location.value).toBeNull();
    await finish(flow.scan(code));
    expect(flow.location.value).toMatchObject({ occupied: false, version: 2 });
    expect(flow.container.value).toBeNull();
    expect(flow.scanDisabled.value).toBe(false);
    expect((await finish(panelPackingApi.getBox('BOX-NR-240818'))).bindings).toEqual(boxBefore.bindings);
    expect((await finish(vehicleLoadingApi.getLoads('CAR-NR-0098'))).loads).toEqual(loadsBefore.loads);
  });

  it('clearing only clears the page; empty location supports a vehicle after unbinding elsewhere', async () => {
    const flow = useLocationBinding();
    await finish(flow.scan('KW-BOUND-CAR'));
    flow.clear();
    expect((await finish(api.getLocation('KW-BOUND-CAR'))).occupied).toBe(true);
    await finish(flow.scan('KW-03-02'));
    await finish(flow.scan('CAR-NR-0098'));
    expect(flow.notice.value?.text).toBe('该容器已绑定其他库位，请先解绑');
    expect(flow.container.value).toBeNull();
    await finish(flow.scan('CAR-EMPTY'));
    await finish(flow.submit());
    expect((await finish(api.getLocation('KW-03-02'))).container?.containerType).toBe('VEHICLE');
  });

  it('rejects invalid/unknown/ambiguous/unavailable scans and keeps the chosen location', async () => {
    const flow = useLocationBinding();
    const get = vi.spyOn(api, 'getLocation');
    await flow.scan('  ');
    await flow.scan('X'.repeat(129));
    expect(get).not.toHaveBeenCalled();
    await finish(flow.scan('UNKNOWN'));
    expect(flow.notice.value?.text).toBe('库位编码不存在');
    await finish(flow.scan('KW-BLOCKED'));
    expect(flow.scanDisabled.value).toBe(true);
    expect(flow.notice.value?.text).toContain('停用');
    flow.clear();
    await finish(flow.scan('KW-03-02'));
    for (const [code, reason] of [['UNKNOWN', '载具或箱子编码不存在'], ['CONTAINER-AMBIGUOUS', '无法唯一识别'],
      ['BOX-LOCATION-BLOCKED', '暂不允许绑定'], ['BOX-LOADED', '已装车']]) {
      await finish(flow.scan(code));
      expect(flow.notice.value?.text).toContain(reason);
      expect(flow.location.value?.location.locationCode).toBe('KW-03-02');
      expect(flow.pending.value).toBeNull();
    }
  });

  it.each(['bind', 'unbind'])('retains state on %s failure and sends a new request only on manual retry', async (mode) => {
    const flow = useLocationBinding();
    await finish(flow.scan(mode === 'bind' ? 'KW-SUBMIT-FAIL' : 'KW-UNBIND-FAIL'));
    if (mode === 'bind') await finish(flow.scan('BOX-1'));
    else flow.requestUnbind();
    const state = flow.location.value;
    const selected = flow.container.value;
    const transport = vi.spyOn(mock, 'resolveMockRequest');
    await finish(flow.submit());
    expect(flow.location.value).toBe(state);
    expect(flow.container.value).toBe(selected);
    expect(flow.confirmation.value).toBe(mode === 'unbind');
    expect(flow.notice.value?.error).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    const first = transport.mock.lastCall?.[0].data as { requestId: string };
    await finish(flow.submit());
    expect((transport.mock.lastCall?.[0].data as { requestId: string }).requestId).not.toBe(first.requestId);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('rechecks both versions, occupancy and exact relationship before writes', async () => {
    const data = { locationCode: 'KW-03-02', version: 1, container: { containerType: 'BOX' as const, containerCode: 'BOX-1' }, containerVersion: 1 };
    await finish(panelPackingApi.bind('BOX-1', 1, ['MU-240901-0037']));
    expect(await finish(api.bind(data).catch((error: Error) => error.message))).toContain('信息已变化');
    expect((await finish(api.getLocation('KW-03-02'))).occupied).toBe(false);
    await finish(api.bind({ ...data, containerVersion: 2 }));
    expect(await finish(api.unbind({ ...data, containerVersion: 3 }).catch((error: Error) => error.message))).toContain('信息已变化');
    expect(await finish(api.bind({ ...data, version: 2, container: { containerType: 'BOX', containerCode: 'BOX-NR-240819' } }).catch((error: Error) => error.message))).toContain('已绑定容器');
    expect(await finish(api.unbind({ ...data, version: 2, container: { containerType: 'BOX', containerCode: 'BOX-NR-240819' } }).catch((error: Error) => error.message))).toContain('绑定关系已变化');
    expect((await finish(api.getLocation('KW-03-02'))).container?.containerCode).toBe('BOX-1');
  });

  it('rejects inconsistent query data and honors backend container type/canonical code', async () => {
    const valid = await finish(api.getLocation('KW-BOUND-CAR'));
    const get = vi.spyOn(api, 'getLocation');
    const flow = useLocationBinding();
    for (const bad of [{ ...valid, version: 0 }, { ...valid, container: undefined }, { ...valid, occupied: false },
      { ...valid, location: { ...valid.location, locationName: '' } }, { ...valid, eligibility: { allowed: false } }]) {
      get.mockResolvedValueOnce(bad as LocationContainers);
      await flow.scan('KW-BOUND-CAR');
      expect(flow.location.value).toBeNull();
      expect(flow.notice.value?.text).toBe('库位信息不完整，请重新扫描');
    }
    get.mockRestore();
    await finish(flow.scan('KW-03-02'));
    const candidate = vi.spyOn(api, 'getContainer');
    candidate.mockResolvedValueOnce({ container: { containerCode: 'X', containerType: 'OTHER', version: 1 }, eligibility: { allowed: true } } as unknown as ContainerCandidate);
    await flow.scan('X');
    expect(flow.pending.value).toBeNull();
    candidate.mockResolvedValueOnce({ container: { containerCode: 'canonical', containerType: 'VEHICLE', version: 7 }, eligibility: { allowed: true } });
    await flow.scan('alias');
    expect(flow.container.value).toMatchObject({ containerCode: 'canonical', containerType: 'VEHICLE', version: 7 });
  });

  it('drops late location/container/submission responses after clearing and locks concurrent input', async () => {
    const flow = useLocationBinding();
    const query = flow.scan('KW-03-02');
    await flow.scan('KW-BOUND-CAR');
    flow.clear();
    await finish(query);
    expect(flow.location.value).toBeNull();
    await finish(flow.scan('KW-03-02'));
    const containerQuery = flow.scan('BOX-1');
    flow.clear();
    await finish(containerQuery);
    expect(flow.container.value).toBeNull();
    await finish(flow.scan('KW-03-02'));
    await finish(flow.scan('BOX-1'));
    const submit = flow.submit();
    expect(flow.scanDisabled.value).toBe(true);
    flow.clear();
    await finish(submit);
    expect(flow.location.value).toBeNull();
    expect(flow.notice.value).toBeNull();
  });
});
