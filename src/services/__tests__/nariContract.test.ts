import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import document from '../../../docs/nari-logistics.openapi.json';
import { panelPackingApi as panels } from '../panelPacking';
import { vehicleLoadingApi as loading } from '../vehicleLoading';
import { locationBindingApi as locations } from '../locationBinding';
import { warehouseApplicationApi as application } from '../warehouseApplication';
import { receivingApi as receiving } from '../receiving';
import { pendingReceivingApi as pending } from '../pendingReceiving';
import { shippingApi as shipping } from '../shipping';
import { logisticsApi as logistics } from '../logistics';
import { logisticsCancellationApi as cancellation } from '../logisticsCancellation';
import { emptyVehicleApi as empty } from '../emptyVehicle';
import { trafficApi as traffic } from '../traffic';
import { warehouseLogisticsApi as warehouse } from '../warehouseLogistics';
import { materialCallApi as call } from '../materialCall';
import { boxVehicleBindingApi as direct } from '../boxVehicleBinding';
import { seedTestSession } from './helpers/authSession';

const requestId = '47ab7945-b324-4ed4-a10a-af734b83de07';
const object = { containerType: 'VEHICLE' as const, containerCode: 'CAR-契约/1' };
const operation = { requestId, version: 2 };
const items = [{ id: '9007199254741001', version: 3 }];
const locationOperation = { locationCode: '位置/1', version: 2, container: object, containerVersion: 3 };
const logisticsInput = { requestId, object, version: 2, vendor: 'STANDARD' as const, taskType: 'GENERAL' as const,
  originLocationCode: '起点/1', destinationLocationCode: '终点/2' };
const { destinationLocationCode: _target, ...returnInput } = logisticsInput;
const prefix = '/api/v1/business/nari-logistics';
const cases: [string, string, () => Promise<unknown>][] = [
  ['get', '/boxes/bindings', () => panels.getBox('箱/1')],
  ['get', '/panels', () => panels.getPanel('板件/1')],
  ['post', '/panels/joint-candidates/query', () => panels.getJoint(['板件/1'])],
  ['post', '/boxes/bindings/bind-by-codes', () => panels.bind('箱/1', 2, ['板件/1'])],
  ['post', '/boxes/bindings/bind-by-codes', () => panels.bind('箱/1', 2, ['板件/1'], { requestId, confirmMixed: true, confirmationToken: 'server-confirmation-token' })],
  ['post', '/boxes/bindings/unbind-all', () => panels.unbindAll('箱/1', 2)],
  ['post', '/boxes/bindings/bind-by-order', () => panels.bindByOrder('箱/1', 2, '订单/1', 3, '123456789ABC000001ABCDEFG00001234')],
  ['post', '/boxes/bindings/bind-by-order', () => panels.bindByOrder('箱/1', 2, '订单/1', 3, '123456789ABC000001ABCDEFG00001234',
    { requestId, confirmMixed: true, confirmationToken: 'server-confirmation-token' })],
  ['post', '/boxes/bindings/unbind-selected', () => panels.unbindSelected('箱/1', 2, items)],
  ['get', '/vehicle-slots', () => loading.getSlot('车位/1')],
  ['get', '/loading/boxes', () => loading.getBox('箱/1')],
  ['post', '/loading/batch-load', () => loading.load([{ boxCode: '箱/1', boxVersion: 2, slotCode: '车位/1', slotVersion: 3 }])],
  ['get', '/vehicles/loads', () => loading.getLoads(object.containerCode)],
  ['get', '/vehicles/direct-bindings', () => direct.getVehicle('料车/1')],
  ['get', '/vehicles/direct-bindings/box-candidates', () => direct.getBox('料车/1', '箱/1')],
  ['post', '/vehicles/direct-bindings/bind', () => direct.bind({ requestId, vehicleCode: '料车/1', vehicleVersion: 2,
    items: [{ boxCode: '箱/1', boxVersion: 3, expectedBinding: null, confirmRebind: false }] })],
  ['post', '/vehicles/direct-bindings/bind', () => direct.bind({ requestId, vehicleCode: '料车/1', vehicleVersion: 2,
    items: [{ boxCode: '箱/1', boxVersion: 3, expectedBinding: { bindingId: '9007199254741001', bindingVersion: 4, vehicleCode: '旧车/2' }, confirmRebind: true }] })],
  ['post', '/vehicles/direct-bindings/unbind-all', () => direct.unbindAll({ requestId, vehicleCode: '料车/1', vehicleVersion: 2 })],
  ['post', '/vehicles/direct-bindings/unbind-selected', () => direct.unbindSelected({ requestId, vehicleCode: '料车/1', vehicleVersion: 2,
    items: [{ bindingId: '9007199254741001', bindingVersion: 3, boxCode: '箱/1', boxVersion: 4 }] })],
  ['post', '/loading/unload-selected', () => loading.unloadSelected(object.containerCode, 2, items)],
  ['post', '/loading/unload-all', () => loading.unloadAll(object.containerCode, 2)],
  ['get', '/locations/containers', () => locations.getLocation('位置/1')],
  ['get', '/locations/container-candidates', () => locations.getContainer(object.containerCode)],
  ['post', '/locations/bind-container', () => locations.bind(locationOperation)],
  ['post', '/locations/unbind-container', () => locations.unbind(locationOperation)],
  ['get', '/warehouse-applications/objects', () => application.getObject(object.containerCode)],
  ['get', '/boxes/materials', () => application.getMaterials('箱/1')],
  ['post', '/warehouse-applications/submit', () => application.submit(object, 2)],
  ['get', '/receiving/tasks', () => receiving.query(object.containerCode)],
  ['get', '/receiving/tasks', () => receiving.query(object.containerCode, '9007199254741001')],
  ['post', '/receiving/confirm', () => receiving.confirm({ ...operation, taskId: '9007199254741001', object })],
  ['post', '/receiving/confirm', () => receiving.confirm({ ...operation, taskId: '9007199254741001', object, remark: '本次接收清点备注' })],
  ['post', '/receiving/clear-wms-bindings', () => receiving.clearWms({ ...operation, taskId: '9007199254741001', object })],
  ['get', '/receiving/pending-tasks', () => pending.query({ vehicleCode: object.containerCode, locationCode: '位置/1' }, 2)],
  ['get', '/shipping/objects', () => shipping.getObject(object.containerCode)],
  ['post', '/shipping/submit', () => shipping.submit({ ...operation, object, scanType: 'VEHICLE', scanCode: object.containerCode })],
  ['get', '/logistics/options', () => logistics.getOptions(object.containerCode)],
  ['post', '/logistics/tasks', () => logistics.create(logisticsInput)],
  ['get', '/logistics/cancellable-tasks', () => cancellation.query('AGV/1', 2)],
  ['post', '/logistics/tasks/{taskId}/cancel', () => cancellation.cancel('9007199254741001', operation)],
  ['post', '/logistics/tasks/{taskId}/cancel', () => cancellation.cancel('9007199254741001', { ...operation, unbindContext: locationOperation })],
  ['get', '/logistics/tasks/{taskId}/cancellation', () => cancellation.result('9007199254741001', requestId)],
  ['get', '/empty-vehicles/origins', () => empty.getOrigins('终点/2')],
  ['post', '/empty-vehicles/call', () => empty.call({ ...operation, originLocationCode: '起点/1', destinationLocationCode: '终点/2', vehicleCode: object.containerCode })],
  ['get', '/traffic/areas', () => traffic.query({ keyword: '区域', status: 'FREE' }, 2)],
  ['post', '/traffic/areas/{areaCode}/lock', () => traffic.act('区域/1', 'lock', operation)],
  ['post', '/traffic/areas/{areaCode}/release', () => traffic.act('区域/1', 'release', operation)],
  ['get', '/warehouse-logistics/options', () => warehouse.getOptions(object.containerCode)],
  ['post', '/warehouse-logistics/tasks', () => warehouse.create({ ...operation, object, scanType: 'VEHICLE', scanCode: object.containerCode, destinationLocationCode: '终点/2' })],
  ['get', '/order-calls/candidates', () => call.getBoxes('终点/2', '订单/1')],
  ['post', '/order-calls', () => call.submit({ requestId, destinationLocationCode: '终点/2', destinationVersion: 2, orderNo: '订单/1', boxes: [{ boxCode: '箱/1', version: 3 }] })],
  ['post', '/logistics/tasks', () => logistics.returnToWarehouse({ ...returnInput, destinationMode: 'RETURN_LINE_SIDE' })],
  ['get', '/locations/containers', () => call.getLocation('位置/1')],
  ['get', '/boxes/materials', () => receiving.getMaterials('箱/1')],
  ['get', '/boxes/materials', () => shipping.getMaterials('箱/1')],
  ['get', '/boxes/materials', () => warehouse.getMaterials('箱/1')]
];

interface Schema { $ref?: string; type?: string; nullable?: boolean; required?: string[]; properties?: Record<string, Schema>; items?: Schema; enum?: unknown[]; pattern?: string; format?: string }
interface Operation { parameters?: { name: string; in: string; required?: boolean; schema: Schema }[]; requestBody?: { content: { 'application/json': { schema: Schema } } } }
const contract = document as unknown as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };
function checkFields(value: unknown, schema: Schema) {
  if (schema.$ref) return checkFields(value, contract.components.schemas[schema.$ref.split('/').pop()!]);
  if (schema.nullable && value === null) return;
  if (schema.enum) expect(schema.enum).toContain(value);
  if (schema.type === 'object') {
    expect(value).toBeTypeOf('object'); expect(value).not.toBeNull();
    const data = value as Record<string, unknown>;
    for (const key of schema.required || []) expect(data).toHaveProperty(key);
    for (const [key, field] of Object.entries(data)) {
      expect(schema.properties).toHaveProperty(key);
      checkFields(field, schema.properties![key]);
    }
  } else if (schema.type === 'array') {
    expect(Array.isArray(value)).toBe(true);
    for (const item of value as unknown[]) checkFields(item, schema.items!);
  } else if (schema.type === 'integer') expect(Number.isInteger(value)).toBe(true);
  else if (schema.type) expect(typeof value).toBe(schema.type);
  if (schema.pattern) expect(value).toMatch(new RegExp(schema.pattern));
  if (schema.format === 'uuid') expect(value).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
}
const network = vi.fn((options: UniNamespace.RequestOptions) => {
  options.success?.({ statusCode: 200, data: { code: 0, data: { backend: true } }, header: {}, cookies: [] });
  return { abort() {}, onHeadersReceived() {}, offHeadersReceived() {} };
});
beforeEach(() => {
  const storage = new Map<string, unknown>(); network.mockClear();
  vi.stubEnv('UNI_PLATFORM', 'h5');
  vi.stubGlobal('uni', { request: network, getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value) });
  seedTestSession();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('documented Nari requests', () => {
  it('covers all documented operations', () => {
    // The combined document also contains foundation/CRUD APIs and server-to-server AGV callbacks.
    const expected = Object.entries(contract.paths).filter(([path]) => path.startsWith(`${prefix}/`) && !path.startsWith(`${prefix}/agv/callbacks/`)).flatMap(([path, item]) => Object.keys(item)
      .filter((method) => ['get', 'post'].includes(method)).map((method) => `${method} ${path}`));
    expect([...new Set(cases.map(([method, path]) => `${method} ${prefix}${path}`))].sort()).toEqual(expected.sort());
    expect(expected).toHaveLength(45);
  });
  it.each(['all', 'selected'] as const)('preserves the original request UUID for manually replayed %s panel unbind', async mode => {
    if (mode === 'all') await panels.unbindAll('箱/1', 2, requestId);
    else await panels.unbindSelected('箱/1', 2, items, requestId);
    const data = network.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.requestId).toBe(requestId);
    if (mode === 'all') expect(data).not.toHaveProperty('items');
    else expect(data.items).toEqual(items);
    checkFields(data, contract.paths[`${prefix}/boxes/bindings/unbind-${mode}`].post.requestBody!.content['application/json'].schema);
  });
  it('preserves the original request UUID and exact pair versions for manually replayed loading', async () => {
    const pairs = [{ slotCode: '车位/1', slotVersion: 2, boxCode: '箱/1', boxVersion: 3 }];
    await loading.load(pairs, requestId);
    const data = network.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toEqual({ requestId, items: pairs });
    checkFields(data, contract.paths[`${prefix}/loading/batch-load`].post.requestBody!.content['application/json'].schema);
  });
  it.each(['all', 'selected'] as const)('preserves the original request UUID and unload credentials for manually replayed %s unloading', async mode => {
    if (mode === 'all') await loading.unloadAll(object.containerCode, 2, requestId);
    else await loading.unloadSelected(object.containerCode, 2, items, requestId);
    const data = network.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toEqual({ requestId, vehicleCode: object.containerCode, version: 2, ...(mode === 'selected' ? { items } : {}) });
    checkFields(data, contract.paths[`${prefix}/loading/unload-${mode}`].post.requestBody!.content['application/json'].schema);
  });
  it.each(['bind', 'unbind'] as const)('preserves the original UUID and both current versions for manually replayed location %s', async mode => {
    await locations[mode](locationOperation, requestId);
    const data = network.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toEqual({ ...locationOperation, requestId });
    checkFields(data, contract.paths[`${prefix}/locations/${mode}-container`].post.requestBody!.content['application/json'].schema);
  });
  it('preserves the original UUID and whole object version for a manually replayed warehouse application', async () => {
    await application.submit(object, 2, requestId);
    const data = network.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toEqual({ requestId, object, version: 2 });
    checkFields(data, contract.paths[`${prefix}/warehouse-applications/submit`].post.requestBody!.content['application/json'].schema);
  });
  it.each(cases)('%s %s follows the current contract', async (method, path, invoke) => {
    await expect(invoke()).resolves.toEqual({ backend: true });
    expect(network).toHaveBeenCalledOnce();
    const options = network.mock.calls[0][0];
    const substitutions: Record<string, string> = { taskId: '9007199254741001', areaCode: '区域/1', requestId };
    expect(options.url).toBe(prefix + path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(substitutions[key])));
    expect(options.method).toBe(method.toUpperCase());
    expect(options.header?.Authorization).toBe('Bearer test-session-token');
    const op = contract.paths[prefix + path][method];
    const data = options.data as Record<string, unknown>;
    if (method === 'get') {
      const query = (op.parameters || []).filter((param) => param.in === 'query');
      for (const param of query.filter((param) => param.required)) expect(data).toHaveProperty(param.name);
      for (const [key, value] of Object.entries(data)) {
        const param = query.find((entry) => entry.name === key); expect(param).toBeDefined(); checkFields(value, param!.schema);
      }
    } else {
      checkFields(data, op.requestBody!.content['application/json'].schema);
      if (path === '/logistics/tasks') {
        if (data.destinationMode === 'RETURN_LINE_SIDE') expect(data).not.toHaveProperty('destinationLocationCode');
        else expect(data.destinationLocationCode).toBe('终点/2');
      }
    }
  });
});
