import type { Binding, BoxBindings, Panel } from './panelPacking';
import type { LoadPair, VehicleSlot, Vehicle, LoadedBox, MaterialLine, VehicleLoads } from './vehicleLoading';
import type { LocationContainers, ContainerRef, LocationContainer, LocationOperation } from './locationBinding';
import type { ApplicationObject, BoxContents } from './warehouseApplication';
import type { ReceivingTask } from './pendingReceiving';
import type { ReceivingResult, ReceivingRequest, ClearWmsRequest, ReceivingReceipt } from './receiving';
import type { ShippingObject, ShippingReceipt, ShippingRequest } from './shipping';
import type { CreateLogisticsRequest, LogisticsOptions, TaskCreationResponse, LocationCandidate, LogisticsTask } from './logistics';
import type { CancelTaskRequest, CancellationResult } from './logisticsCancellation';
import type { EmptyVehicleOptions, CallEmptyVehicleRequest } from './emptyVehicle';
import type { TrafficArea, TrafficAction, TrafficActionRequest } from './traffic';
import type { WarehouseLogisticsOptions, WarehouseLogisticsRequest } from './warehouseLogistics';

const prefix = '/api/v1/business/nari-logistics';
class MockHttpError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); }
}
let boxes: Record<string, BoxBindings>;
let panels: Panel[];
let jointGroups: string[][];
let nextId: number;
let slots: Record<string, VehicleSlot>;
let vehicles: Vehicle[];
let receivingEntries: { task: ReceivingTask; boxes: BoxContents[]; wmsBindings: BoxContents[] }[];
let receivingHistory: Map<string, { action: string; input: ReceivingRequest | ClearWmsRequest; receipt: ReceivingReceipt; before: BoxContents[] }>;
let shippingWms: Record<string, MaterialLine[]>;
let shippingHistory: { request: ShippingRequest; receipt: ShippingReceipt; before: BoxContents[]; shipped: BoxContents[] }[];
let logisticsHistory: { input: CreateLogisticsRequest; result: TaskCreationResponse }[];
let emptyCallHistory: { input: CallEmptyVehicleRequest; result: TaskCreationResponse }[];
let warehouseLogisticsHistory: { input: WarehouseLogisticsRequest; result: TaskCreationResponse }[];
let emptyTargets: Record<string, string[]>;
let cancelledTasks: Set<string>;
let cancellationHistory: Map<string, { input: CancelTaskRequest; result: CancellationResult }>;
let cancellationPageFailed: boolean;
let trafficAreas: TrafficArea[];
let trafficHistory: Map<string, { areaCode: string; action: TrafficAction; input: TrafficActionRequest; before: TrafficArea; after: TrafficArea }>;
let trafficPageFailed: boolean;
let loadRelations: Record<string, Pick<LoadedBox, 'id' | 'version'>>;
let locations: Record<string, Omit<LocationContainers, 'occupied' | 'container'> & { container?: ContainerRef }>;

let mockSessionId: string;
export function getMockSessionId(): string { return mockSessionId; }

export function resetMockData() {
  // Pending UI requests must not outlive the in-memory backend they refer to.
  mockSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  logisticsHistory = [];
  emptyCallHistory = [];
  warehouseLogisticsHistory = [];
  emptyTargets = {};
  cancelledTasks = new Set();
  cancellationHistory = new Map();
  cancellationPageFailed = false;
  trafficHistory = new Map();
  trafficPageFailed = false;
  trafficAreas = Array.from({ length: 45 }, (_, index) => ({
    areaCode: `TC-${String(index + 1).padStart(2, '0')}`,
    areaName: ['总装北通道', '二号接驳区', '立库入口', '包装线南通道'][index] || `分页测试区域${index + 1}`,
    version: 1, status: index % 2 ? 'OCCUPIED' : 'FREE',
    lastOperatorName: ['王工', '李工', '系统管理员', '赵工'][index % 4],
    lastOperationTime: new Date(Date.UTC(2026, 8, 17, 1, 22, 16 - index)).toISOString()
  }));
  trafficAreas.push(
    { areaCode: 'TC-LOCK-FAIL', areaName: '锁定失败示例', version: 1, status: 'FREE' },
    { areaCode: 'TC-RELEASE-FAIL', areaName: '释放失败示例', version: 1, status: 'OCCUPIED' },
    { areaCode: 'TC-NO-HISTORY', areaName: '无历史记录区域', version: 1, status: 'FREE' },
    { areaCode: 'TC/特殊#01', areaName: '特殊编码区域', version: 1, status: 'FREE' }
  );
  nextId = 100;
  panels = Array.from({ length: 60 }, (_, index) => ({
    panelCode: `MU-240901-${String(index + 34).padStart(4, '0')}`,
    materialCode: `MAT-${7001 + index % 3}`,
    materialName: ['控制模块', '连接板', '安装支架'][index % 3],
    orderNo: `SO-20260901-${String(18 + index % 3).padStart(3, '0')}`,
    eligibility: { allowed: true }
  }));
  // Mock-only physical panel groups: 0034–0037, 0038–0041, etc.; not a production code rule.
  jointGroups = Array.from({ length: 15 }, (_, index) => panels.slice(index * 4, index * 4 + 4).map((panel) => panel.panelCode));
  const makeBox = (code: string): BoxBindings => ({
    box: { containerType: 'BOX', containerCode: code, containerName: '标准料箱', version: 1 },
    empty: true, totalQuantity: 0, bindings: [], eligibility: { allowed: true }
  });
  boxes = Object.fromEntries(['BOX-NR-240818', 'BOX-NR-240819', 'BOX-1', 'BOX-LONG'].map((code) => [code, makeBox(code)]));
  boxes['BOX-NR-240818'].bindings = panels.slice(0, 3).map(toBinding);
  boxes['BOX-NR-240818'].empty = false;
  boxes['BOX-NR-240818'].totalQuantity = 3;
  const longPanels = Array.from({ length: 30 }, (_, index) => ({ ...panels[0], panelCode: `MU-LONG-${String(index + 1).padStart(4, '0')}` }));
  panels.push(...longPanels);
  boxes['BOX-LONG'].bindings = longPanels.map(toBinding);
  boxes['BOX-LONG'].empty = false;
  boxes['BOX-LONG'].totalQuantity = longPanels.length;
  vehicles = ['CAR-NR-0098', 'CAR-NR-0099'].map((containerCode) => ({ containerType: 'VEHICLE', containerCode, version: 1 }));
  slots = {};
  loadRelations = {};
  for (let index = 1; index <= 12; index++) {
    const suffix = String(index).padStart(2, '0');
    const slotCode = `SLOT-${suffix}`;
    boxes[`BOX-LOAD-${suffix}`] = makeBox(`BOX-LOAD-${suffix}`);
    slots[slotCode] = { slotCode, version: 1, vehicle: vehicles[index <= 6 ? 0 : 1], eligibility: { allowed: true } };
  }
  boxes['BOX-LOADED'] = makeBox('BOX-LOADED');
  boxes['BOX-LOAD-BLOCKED'] = makeBox('BOX-LOAD-BLOCKED');
  slots['SLOT-OCCUPIED'] = { slotCode: 'SLOT-OCCUPIED', version: 1, vehicle: vehicles[0], box: boxes['BOX-LOADED'].box, eligibility: { allowed: true } };
  loadRelations['SLOT-OCCUPIED'] = { id: String(nextId++), version: 1 };
  slots['SLOT-BLOCKED'] = { slotCode: 'SLOT-BLOCKED', version: 1, vehicle: vehicles[0], eligibility: { allowed: false, reason: '该载具库位已停用' } };
  // Query succeeds; submission simulates a backend state change for failure/retry QA.
  slots['SLOT-SUBMIT-FAIL'] = { slotCode: 'SLOT-SUBMIT-FAIL', version: 1, vehicle: vehicles[0], eligibility: { allowed: true } };
  for (const [code, count] of [['CAR-UNLOAD', 3], ['CAR-LONG', 30], ['CAR-UNLOAD-FAIL', 2], ['CAR-EMPTY', 0]] as const) {
    const vehicle: Vehicle = { containerType: 'VEHICLE', containerCode: code, containerName: '标准料车', version: 1 };
    vehicles.push(vehicle);
    for (let i = 1; i <= count; i++) {
      const suffix = `${code.slice(4)}-${String(i).padStart(2, '0')}`;
      const boxCode = `BOX-${suffix}`;
      const slotCode = `SLOT-${suffix}`;
      boxes[boxCode] = makeBox(boxCode);
      slots[slotCode] = { slotCode, version: 1, vehicle, box: boxes[boxCode].box, eligibility: { allowed: true } };
      loadRelations[slotCode] = { id: String(nextId++), version: 1 };
    }
  }
  const unloadPanel: Panel = { ...panels[0], panelCode: 'MU-UNLOAD-0001' };
  panels.push(unloadPanel);
  boxes['BOX-UNLOAD-01'].bindings = [toBinding(unloadPanel)];
  boxes['BOX-UNLOAD-01'].empty = false;
  boxes['BOX-UNLOAD-01'].totalQuantity = 1;
  boxes['BOX-LOCATION-BLOCKED'] = makeBox('BOX-LOCATION-BLOCKED');
  // Deliberately ambiguous master data: scanner must never guess the container type.
  boxes['CONTAINER-AMBIGUOUS'] = makeBox('CONTAINER-AMBIGUOUS');
  vehicles.push({ containerType: 'VEHICLE', containerCode: 'CONTAINER-AMBIGUOUS', version: 1 });
  locations = Object.fromEntries([
    ['KW-03-02', '三号缓存位'], ['KW-BOUND-BOX', '料箱接驳位'], ['KW-BOUND-CAR', '载具接驳位'],
    ['KW-BLOCKED', '停用库位'], ['KW-SUBMIT-FAIL', '提交失败示例库位'], ['KW-UNBIND-FAIL', '作业中接驳位']
  ].map(([locationCode, locationName]) => [locationCode, {
    location: { locationCode, locationName, locationType: '缓存位', floorCode: 'F1', floorName: '一层', areaCode: 'BUFFER', areaName: '缓存区' },
    version: 1, eligibility: { allowed: true }
  }]));
  locations['KW-BOUND-BOX'].container = { containerType: 'BOX', containerCode: 'BOX-NR-240818' };
  locations['KW-BOUND-CAR'].container = { containerType: 'VEHICLE', containerCode: 'CAR-NR-0098' };
  locations['KW-UNBIND-FAIL'].container = { containerType: 'VEHICLE', containerCode: 'CAR-NR-0099' };
  locations['KW-BLOCKED'].eligibility = { allowed: false, reason: '当前库位已停用，不能绑定容器' };
  for (const [code, count] of [['CAR-APPLY', 3], ['CAR-APPLY-LONG', 30]] as const) {
    const vehicle: Vehicle = { containerType: 'VEHICLE', containerCode: code, containerName: '缴库料车', version: 1 };
    vehicles.push(vehicle);
    for (let i = 1; i <= count; i++) {
      const boxCode = `BOX-${code.slice(4)}-${String(i).padStart(2, '0')}`;
      const slotCode = `SLOT-${code.slice(4)}-${i}`;
      boxes[boxCode] = makeBox(boxCode);
      const panel = { ...panels[0], panelCode: `MU-${code.slice(4)}-${i}` };
      panels.push(panel);
      boxes[boxCode].bindings = [toBinding(panel)];
      boxes[boxCode].empty = false;
      boxes[boxCode].totalQuantity = 1;
      slots[slotCode] = { slotCode, version: 1, vehicle, box: boxes[boxCode].box, eligibility: { allowed: true } };
      loadRelations[slotCode] = { id: String(nextId++), version: 1 };
    }
  }
  for (const suffix of ['MES-FAIL', 'SAP-FAIL', 'WMS-FAIL', 'BLOCKED', 'DETAIL-FAIL']) {
    const code = `BOX-APPLY-${suffix}`;
    boxes[code] = makeBox(code);
    boxes[code].bindings = [{ id: String(nextId++), version: 1, bindingMode: 'BY_ORDER', orderNo: 'SO-20260901-018', materialCode: 'MAT-7001', materialName: '控制模块', quantity: 5, unit: '件' }];
    boxes[code].empty = false;
    boxes[code].totalQuantity = 5;
  }
  slots['SLOT-APPLY-DETAIL-FAIL'] = { slotCode: 'SLOT-APPLY-DETAIL-FAIL', version: 1, vehicle: requireVehicle('CAR-APPLY'), box: boxes['BOX-APPLY-DETAIL-FAIL'].box, eligibility: { allowed: true } };
  loadRelations['SLOT-APPLY-DETAIL-FAIL'] = { id: String(nextId++), version: 1 };
  shippingWms = {};
  shippingHistory = [];
  function addShippingBox(code: string, count: number) {
    boxes[code] = makeBox(code);
    const old = { ...panels[0], panelCode: `MU-OLD-${code}` };
    panels.push(old);
    boxes[code].bindings = [toBinding(old)];
    boxes[code].empty = false;
    boxes[code].totalQuantity = 1;
    shippingWms[code] = Array.from({ length: count }, (_, i) => {
      const panel = { ...panels[0], panelCode: `MU-${code}-${i + 1}` };
      panels.push(panel);
      return { lineType: 'PANEL', panelCode: panel.panelCode, materialCode: panel.materialCode, materialName: panel.materialName,
        orderNo: panel.orderNo, quantity: 1, unit: '件' };
    });
  }
  for (const [code, count] of [['CAR-SHIP', 3], ['CAR-SHIP-LONG', 30], ['CAR-SHIP-NO-TASK', 1]] as const) {
    const vehicle: Vehicle = { containerType: 'VEHICLE', containerCode: code, containerName: '发货料车', version: 1 };
    vehicles.push(vehicle);
    for (let i = 1; i <= count; i++) {
      const boxCode = `BOX-${code.slice(4)}-${String(i).padStart(2, '0')}`;
      addShippingBox(boxCode, code === 'CAR-SHIP' ? i : 1);
      const slotCode = `SLOT-${boxCode}`;
      slots[slotCode] = { slotCode, version: 1, vehicle, box: boxes[boxCode].box, eligibility: { allowed: true } };
      loadRelations[slotCode] = { id: String(nextId++), version: 1 };
    }
  }
  for (const suffix of ['SINGLE', 'LONG', 'BLOCKED', 'FAIL', 'DETAIL-FAIL', 'EMPTY']) addShippingBox(`BOX-SHIP-${suffix}`, suffix === 'LONG' ? 30 : suffix === 'EMPTY' ? 0 : 3);
  slots['SLOT-SHIP-DETAIL-FAIL'] = { slotCode: 'SLOT-SHIP-DETAIL-FAIL', version: 1, vehicle: requireVehicle('CAR-SHIP'), box: boxes['BOX-SHIP-DETAIL-FAIL'].box, eligibility: { allowed: true } };
  loadRelations['SLOT-SHIP-DETAIL-FAIL'] = { id: String(nextId++), version: 1 };
  for (const [code, container] of [
    ['KW-SHIP-CAR', { containerType: 'VEHICLE', containerCode: 'CAR-SHIP' }],
    ['KW-SHIP-BOX', { containerType: 'BOX', containerCode: 'BOX-SHIP-SINGLE' }],
    ['KW-SHIP-EMPTY', undefined]
  ] as const) locations[code] = { location: { locationCode: code, locationName: '成品发货接驳位' }, version: 1, container, eligibility: { allowed: true } };
  for (const suffix of ['NORMAL', 'SINGLE', 'LONG', 'BLOCKED', 'NO-END', 'FAIL', 'HIK', 'PROCESS']) {
    const vehicle: Vehicle = { containerType: 'VEHICLE', containerCode: `CAR-LOG-${suffix}`, version: 1 };
    vehicles.push(vehicle);
    const locationCode = `KW-LOG-${suffix}`;
    locations[locationCode] = { location: { locationCode, locationName: '物流起始接驳位' }, version: 1, container: vehicle, eligibility: { allowed: true } };
  }
  for (const suffix of ['NORMAL', 'SINGLE', 'LONG', 'FAIL', 'BLOCKED', 'NO-END', 'DETAIL-FAIL']) {
    const vehicle: Vehicle = { containerType: 'VEHICLE', containerCode: `CAR-WH-${suffix}`, version: 1 };
    vehicles.push(vehicle);
    const locationCode = `KW-WH-${suffix}`;
    locations[locationCode] = { location: { locationCode, locationName: '车间缴库接驳位' }, version: 1, container: vehicle, eligibility: { allowed: true } };
    const count = suffix === 'LONG' ? 225 : 3;
    for (let i = 1; i <= count; i++) {
      const boxCode = `BOX-WH-${suffix}-${String(i).padStart(3, '0')}`;
      const box = makeBox(boxCode);
      const panelCount = suffix === 'LONG' && i === 1 ? 30 : 1;
      box.bindings = Array.from({ length: panelCount }, (_, j) => {
        const panel = { ...panels[0], panelCode: `MU-${boxCode}-${j + 1}` };
        panels.push(panel);
        return toBinding(panel);
      });
      if (suffix === 'NORMAL' && i === 2) box.bindings = [{ id: String(nextId++), version: 1, bindingMode: 'BY_ORDER',
        orderNo: 'SO-20260901-018', materialCode: 'MAT-7001', materialName: '控制模块', quantity: 5, unit: '件' }];
      box.empty = false; box.totalQuantity = box.bindings.reduce((sum, item) => sum + item.quantity, 0); boxes[boxCode] = box;
      const slotCode = `SLOT-${boxCode}`;
      slots[slotCode] = { slotCode, version: 1, vehicle, box: box.box, eligibility: { allowed: true } };
      loadRelations[slotCode] = { id: String(nextId++), version: 1 };
    }
  }
  boxes['BOX-WH-SINGLE'] = makeBox('BOX-WH-SINGLE');
  boxes['BOX-WH-SINGLE'].bindings = [toBinding({ ...panels[0], panelCode: 'MU-WH-SINGLE' })];
  boxes['BOX-WH-SINGLE'].empty = false; boxes['BOX-WH-SINGLE'].totalQuantity = 1;
  locations['KW-WH-BOX'] = { location: { locationCode: 'KW-WH-BOX', locationName: '料箱缴库位' }, version: 1, container: boxes['BOX-WH-SINGLE'].box, eligibility: { allowed: true } };
  locations['KW-WH-EMPTY'] = { location: { locationCode: 'KW-WH-EMPTY', locationName: '空接驳位' }, version: 1, eligibility: { allowed: true } };
  vehicles.push({ containerType: 'VEHICLE', containerCode: 'WH-AMBIGUOUS', version: 1 });
  locations['WH-AMBIGUOUS'] = { location: { locationCode: 'WH-AMBIGUOUS', locationName: '重码位置' }, version: 1, eligibility: { allowed: true } };
  const originCodes = Array.from({ length: 225 }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0');
    const vehicle: Vehicle = { containerType: 'VEHICLE', containerCode: `CAR-CALL-${suffix}`, containerName: `${index + 1}号空载具`, version: index + 1 };
    vehicles.push(vehicle);
    const locationCode = `KW-CALL-ORIGIN-${suffix}`;
    const floor = index < 112 ? 1 : 2; const area = index % 2 + 1;
    locations[locationCode] = { location: { locationCode, locationName: `${index + 1}号空车位`, floorCode: `F${floor}`, floorName: floor === 1 ? '一层' : '二层',
      areaCode: `A${area}`, areaName: area === 1 ? '缓存区' : '接驳区' }, version: 1, container: vehicle, eligibility: { allowed: true } };
    return locationCode;
  });
  for (const [code, count] of [['KW-05-01', 3], ['KW-CALL-SINGLE', 1], ['KW-CALL-NONE', 0], ['KW-CALL-LONG', 225], ['KW-CALL-FAIL', 3], ['KW-CALL-BLOCKED', 3], ['KW-CALL-OCCUPIED', 3]] as const) {
    emptyTargets[code] = originCodes.slice(0, count);
    locations[code] = { location: { locationCode: code, locationName: '空载具接收位' }, version: 1, eligibility: { allowed: true } };
  }
  locations['KW-CALL-BLOCKED'].eligibility = { allowed: false, reason: '目标位置已停用，无法呼叫空载具' };
  const occupier: Vehicle = { containerType: 'VEHICLE', containerCode: 'CAR-CALL-OCCUPIER', version: 1 };
  vehicles.push(occupier);
  locations['KW-CALL-OCCUPIED'].container = occupier;
  receivingHistory = new Map();
  // Receiving contents are task snapshots, not a projection of current LES loading relations.
  const receivingCodes = ['CAR-NR-0098', 'CAR-RECEIVE', 'CAR-RECEIVE-LONG', 'CAR-RECEIVE-FAIL', 'CAR-RECEIVE-CLEAR-FAIL',
    'CAR-RECEIVE-BLOCKED', 'CAR-RECEIVE-DETAIL-FAIL', 'CAR-RECEIVE-INCOMPLETE', 'CAR-RECEIVE-MULTI', 'BOX-RECEIVE', 'BOX-RECEIVE-LONG'];
  receivingEntries = Array.from({ length: 47 }, (_, index) => {
    const code = index === 46 ? 'BOX-NR-240818' : receivingCodes[index] || `CAR-RECEIVE-${index + 1}`;
    const isBox = code.startsWith('BOX-');
    const object: LocationContainer = { containerType: isBox ? 'BOX' : 'VEHICLE', containerCode: code, version: 1 };
    const contents: BoxContents[] = code === 'BOX-NR-240818' ? [boxContents(code)] : Array.from({ length: isBox ? 1 : code === 'CAR-RECEIVE-LONG' ? 225 : 3 }, (_, j) => {
      const boxCode = isBox ? code : `BOX-RCV-${index + 1}-${String(j + 1).padStart(3, '0')}`;
      const materials: MaterialLine[] = Array.from({ length: code.endsWith('-LONG') && j === 0 ? 30 : 1 }, (_, k) => ({
        lineType: 'PANEL', panelCode: `MU-RCV-${index + 1}-${j + 1}-${k + 1}`, materialCode: 'MAT-7001', materialName: '控制模块',
        orderNo: 'SO-20260901-018', quantity: 1, unit: '件'
      }));
      if (code === 'CAR-RECEIVE' && j === 2) materials[0] = { lineType: 'QUANTITY', materialCode: 'MAT-7002', materialName: '连接板', orderNo: 'SO-20260901-019', quantity: 5, unit: '件' };
      return { boxCode, version: 1, materials, materialQuantity: materials.reduce((sum, row) => sum + row.quantity, 0) };
    });
    return { task: {
      taskId: `9007199254741${String(index + 1).padStart(3, '0')}`, taskNo: `RCV-20260917-${String(index + 1).padStart(4, '0')}`, version: 7,
      object, location: isBox ? undefined : { locationCode: `KW-03-0${index % 3 + 1}`, locationName: '缓存位' },
      status: 'PENDING', statusName: '待接收', createdTime: new Date(Date.UTC(2026, 8, 17, 2, Math.floor(index / 2))).toISOString(),
      eligibility: code.endsWith('-BLOCKED') ? { allowed: false, reason: '当前任务暂不允许接收' } : { allowed: true }
    }, boxes: contents, wmsBindings: JSON.parse(JSON.stringify(contents)) };
  });
}
function receivingResult(scanCode: unknown): ReceivingResult {
  if (typeof scanCode !== 'string' || !scanCode.trim() || scanCode.length > 128) throw new Error('扫描编码无效');
  if (scanCode === 'CONTAINER-AMBIGUOUS') throw new Error('该编码匹配多个容器，无法唯一识别');
  if (scanCode === 'CAR-RECEIVE-MULTI') throw new MockHttpError('当前容器存在多个接收任务，请联系管理员核查', 409);
  if (scanCode === 'CAR-RECEIVE-INCOMPLETE') throw new Error('接收任务物料明细缺失，请联系管理员核查');
  const entry = receivingEntries.find((item) => item.task.object.containerCode === scanCode);
  if (entry) {
    const task = entry.task.status === 'PENDING' ? entry.task : undefined;
    return { object: entry.task.object, ...(task ? { task } : {}), boxes: task ? entry.boxes : [],
      totalMaterialQuantity: task ? entry.boxes.reduce((sum, box) => sum + box.materialQuantity, 0) : 0 };
  }
  const candidates: LocationContainer[] = vehicles.filter((vehicle) => vehicle.containerCode === scanCode);
  if (boxes[scanCode]) candidates.push(boxes[scanCode].box);
  if (!candidates.length) throw new MockHttpError('载具或箱子编码不存在', 404);
  if (candidates.length !== 1) throw new Error('该编码匹配多个容器，无法唯一识别');
  return { object: candidates[0], boxes: [], totalMaterialQuantity: 0 };
}
function toBinding(panel: Panel): Binding {
  return { id: String(nextId++), version: 1, bindingMode: 'BY_CODE', panelCode: panel.panelCode,
    materialCode: panel.materialCode, materialName: panel.materialName, orderNo: panel.orderNo, quantity: 1, unit: '件' };
}
function boundBox(panelCode: string): string | undefined {
  return Object.values(boxes).find((box) => box.bindings.some((item) => item.panelCode === panelCode))?.box.containerCode;
}
function requireBox(code: unknown): BoxBindings {
  const box = typeof code === 'string' ? boxes[code] : undefined;
  if (!box) throw new Error('箱子编码不存在');
  return box;
}
function requirePanel(code: unknown): Panel {
  const panel = panels.find((item) => item.panelCode === code);
  if (!panel) throw new Error('物料唯一码不存在');
  return panel;
}
function requireSlot(code: unknown): VehicleSlot {
  const slot = typeof code === 'string' ? slots[code] : undefined;
  if (!slot) throw new Error('载具库位编码不存在');
  return slot;
}
function loadedSlot(boxCode: string): VehicleSlot | undefined {
  return Object.values(slots).find((slot) => slot.box?.containerCode === boxCode);
}
function loadingBox(code: unknown) {
  const { box } = requireBox(code);
  const slot = loadedSlot(box.containerCode);
  const reason = slot ? `箱子已装载至 ${slot.vehicle.containerCode} / ${slot.slotCode}` : code === 'BOX-LOAD-BLOCKED' ? '该箱子状态不允许装车' : undefined;
  return { box, loadedVehicleCode: slot?.vehicle.containerCode, loadedSlotCode: slot?.slotCode, eligibility: { allowed: !reason, reason } };
}
function requireVehicle(code: unknown): Vehicle {
  const vehicle = vehicles.find((item) => item.containerCode === code);
  if (!vehicle) throw new Error('载具编码不存在');
  return vehicle;
}
function vehicleLoads(code: unknown): VehicleLoads {
  const vehicle = requireVehicle(code);
  const loads = Object.values(slots).filter((slot) => slot.vehicle === vehicle).map((slot) => ({
    slotCode: slot.slotCode, slotVersion: slot.version,
    ...(slot.box ? { ...loadRelations[slot.slotCode], box: slot.box } : {}),
    materials: slot.box ? requireBox(slot.box.containerCode).bindings.map(({ id, version, bindingMode, ...item }): MaterialLine => ({
      ...item, lineType: bindingMode === 'BY_CODE' ? 'PANEL' : 'QUANTITY'
    })) : []
  }));
  return { vehicle, loads, loadedBoxCount: loads.filter((row) => row.box).length,
    totalMaterialQuantity: loads.reduce((sum, row) => sum + row.materials.reduce((n, item) => n + item.quantity, 0), 0) };
}
function requireLocation(code: unknown) {
  const location = typeof code === 'string' ? locations[code] : undefined;
  if (!location) throw new Error('库位编码不存在');
  return location;
}
function requireContainer(ref: ContainerRef): LocationContainer {
  if (ref?.containerType === 'BOX') return requireBox(ref.containerCode).box;
  if (ref?.containerType === 'VEHICLE') return requireVehicle(ref.containerCode);
  throw new Error('容器类型无效');
}
function containerLocation(container: ContainerRef) {
  return Object.values(locations).find((item) => item.container?.containerType === container.containerType && item.container.containerCode === container.containerCode);
}
function containerReason(container: ContainerRef) {
  if (containerLocation(container)) return '该容器已绑定其他库位，请先解绑';
  if (container.containerType === 'BOX' && loadedSlot(container.containerCode)) return '该箱子已装车，不能直接绑定库位';
  if (container.containerCode === 'BOX-LOCATION-BLOCKED') return '该容器正在执行任务，暂不允许绑定';
  return undefined;
}
function boxContents(code: string): BoxContents {
  const state = requireBox(code);
  return { boxCode: code, version: state.box.version, materialQuantity: state.totalQuantity,
    materials: state.bindings.map(({ id, version, bindingMode, ...row }): MaterialLine => ({ ...row, lineType: bindingMode === 'BY_CODE' ? 'PANEL' : 'QUANTITY' })) };
}
function applicationObject(scanCode: unknown): ApplicationObject {
  const candidates: LocationContainer[] = vehicles.filter((item) => item.containerCode === scanCode);
  if (typeof scanCode === 'string' && boxes[scanCode]) candidates.push(boxes[scanCode].box);
  if (!candidates.length) throw new Error('载具或箱子编码不存在');
  if (candidates.length !== 1) throw new Error('该编码匹配多个容器，无法唯一识别');
  const object = candidates[0];
  const contents = object.containerType === 'BOX' ? [boxContents(object.containerCode)] :
    Object.values(slots).filter((slot) => slot.vehicle.containerCode === object.containerCode && slot.box).map((slot) => boxContents(slot.box!.containerCode));
  const reason = scanCode === 'BOX-APPLY-BLOCKED' ? '该对象当前状态不允许申请缴库' : undefined;
  return { scanType: object.containerType, scanCode: String(scanCode), object: { ...object, location: containerLocation(object)?.location },
    boxes: contents, totalMaterialQuantity: contents.reduce((sum, box) => sum + box.materialQuantity, 0), eligibility: { allowed: !reason, reason } };
}
function shippingObject(raw: unknown): ShippingObject {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 128) throw new Error('扫描编码无效');
  const candidates = Number(!!boxes[raw]) + vehicles.filter((vehicle) => vehicle.containerCode === raw).length + Number(!!locations[raw]);
  if (!candidates) throw new Error('位置、料车或料箱编码不存在');
  if (candidates !== 1) throw new Error('该编码匹配多个对象，无法唯一识别');
  const location = locations[raw];
  if (location && !location.container) throw new Error('当前位置没有绑定容器');
  const ref = location?.container || (boxes[raw] ? boxes[raw].box : requireVehicle(raw));
  const object = requireContainer(ref);
  const codes = object.containerType === 'BOX' ? [object.containerCode] : Object.values(slots)
    .filter((slot) => slot.vehicle.containerCode === object.containerCode && slot.box).map((slot) => slot.box!.containerCode);
  const contents = codes.map((code) => ({ boxCode: code, version: requireBox(code).box.version, materials: shippingWms[code] || [],
    materialQuantity: (shippingWms[code] || []).reduce((sum, line) => sum + line.quantity, 0) }));
  const reason = object.containerCode === 'BOX-SHIP-BLOCKED' ? '当前对象不允许成品发货' : undefined;
  return { scanType: location ? 'LOCATION' : object.containerType, scanCode: raw,
    object: { ...object, location: containerLocation(object)?.location }, boxes: contents,
    totalMaterialQuantity: contents.reduce((sum, box) => sum + box.materialQuantity, 0), eligibility: { allowed: !reason, reason } };
}
function logisticsOptions(code: unknown): LogisticsOptions {
  const resolved = shippingObject(code);
  const origin = resolved.object.location;
  if (!origin) throw new Error('无法确定起始位置，请先绑定位置');
  // Explicit fixture configuration belongs to the mock backend, never inferred by the page.
  const configurations: Record<string, [LogisticsOptions['vendor'], LogisticsOptions['taskType']]> = {
    'KW-SHIP-CAR': ['STANDARD', 'GENERAL'], 'KW-SHIP-BOX': ['HIKVISION', 'GENERAL'],
    'KW-LOG-HIK': ['HIKVISION', 'GENERAL'], 'KW-LOG-PROCESS': ['STANDARD', 'PROCESS_ROUTE']
  };
  for (const suffix of ['NORMAL', 'SINGLE', 'LONG', 'BLOCKED', 'NO-END', 'FAIL']) configurations[`KW-LOG-${suffix}`] = ['STANDARD', 'GENERAL'];
  const config = configurations[origin.locationCode];
  if (!config) throw new Error('起始位置未配置唯一的物流品牌和任务类型');
  const [vendor, taskType] = config;
  const count = origin.locationCode === 'KW-LOG-SINGLE' ? 1 : origin.locationCode === 'KW-LOG-LONG' ? 225 : origin.locationCode === 'KW-LOG-NO-END' ? 0 : 8;
  const destinations = Array.from({ length: count }, (_, index) => {
    const floor = index < Math.ceil(count / 2) ? 1 : 2;
    const area = index % 2 + 1;
    const location: LocationCandidate = { locationCode: `DEST-${String(index + 1).padStart(3, '0')}`, locationName: `${index + 1}号接驳位`,
      floorCode: `F${floor}`, floorName: floor === 1 ? '一层' : '二层', areaCode: `A${area}`, areaName: area === 1 ? '成品区' : '缓存区' };
    return { location, recommended: index === 0 };
  }).sort((a, b) => a.location.floorCode.localeCompare(b.location.floorCode) || a.location.areaCode.localeCompare(b.location.areaCode) || a.location.locationCode.localeCompare(b.location.locationCode));
  const existing = [...logisticsHistory, ...emptyCallHistory, ...warehouseLogisticsHistory].some((entry) => !cancelledTasks.has(entry.result.task.taskId) && entry.result.task.container.containerType === resolved.object.containerType && entry.result.task.container.containerCode === resolved.object.containerCode);
  const reason = existing ? '该容器已存在未结束物流任务' : origin.locationCode === 'KW-LOG-BLOCKED' ? '当前对象状态不允许创建物流任务' : undefined;
  return { object: resolved.object, origin, vendor, taskType, destinations, recommendedDestination: destinations.find((item) => item.recommended)?.location, eligibility: { allowed: !reason, reason } };
}
function warehouseLogisticsOptions(raw: unknown): WarehouseLogisticsOptions {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 128) throw new Error('扫描编码无效');
  const vehicleMatches = vehicles.filter((vehicle) => vehicle.containerCode === raw);
  const location = locations[raw];
  const matches = vehicleMatches.length + Number(!!location);
  if (!matches) throw new MockHttpError('载具或位置编码不存在', 404);
  if (matches !== 1) throw new Error('该编码无法唯一识别载具或位置');
  if (location && !location.container) throw new Error('当前位置没有有效关联容器');
  const target = location?.container || vehicleMatches[0];
  const object = requireContainer(target);
  if (object.containerType === 'BOX') throw new Error('当前位置绑定的是料箱，不允许缴库发起');
  const origin = location?.location || containerLocation(object)?.location;
  if (!origin) throw new Error('载具未绑定起始位置');
  if (!origin.locationCode.startsWith('KW-WH-')) throw new Error('当前位置未配置缴库路线');
  if (origin.locationCode === 'KW-WH-BLOCKED') throw new Error('当前物料未满足缴库发起条件');
  if (origin.locationCode === 'KW-WH-NO-END') throw new Error('当前无可用库房目标地点');
  if ([...logisticsHistory, ...emptyCallHistory, ...warehouseLogisticsHistory].some((entry) => !cancelledTasks.has(entry.result.task.taskId) &&
      entry.result.task.container.containerCode === object.containerCode && entry.result.task.container.containerType === object.containerType)) throw new Error('当前对象已有未结束物流任务');
  const contents = Object.values(slots)
    .filter((slot) => slot.vehicle.containerCode === object.containerCode && slot.box).map((slot) => boxContents(slot.box!.containerCode));
  const count = origin.locationCode === 'KW-WH-SINGLE' ? 1 : origin.locationCode === 'KW-WH-LONG' ? 225 : 3;
  const destinations = Array.from({ length: count }, (_, i) => {
    const floor = i < Math.ceil(count / 2) ? 1 : 2; const area = i % 2 + 1;
    const candidate: LocationCandidate = { locationCode: `WH-DEST-${String(i + 1).padStart(3, '0')}`, locationName: `${i + 1}号入库接驳台`,
      floorCode: `F${floor}`, floorName: floor === 1 ? '一层' : '二层', areaCode: `A${area}`, areaName: area === 1 ? '成品库' : '暂存库' };
    return { location: candidate, recommended: i === (count === 1 ? 0 : 1) };
  }).sort((a, b) => a.location.floorCode.localeCompare(b.location.floorCode) || a.location.areaCode.localeCompare(b.location.areaCode) || a.location.locationCode.localeCompare(b.location.locationCode));
  return { object: { ...object, location: origin }, origin, vendor: 'STANDARD', taskType: 'GENERAL',
    boxes: contents, totalMaterialQuantity: contents.reduce((sum, box) => sum + box.materialQuantity, 0),
    destinations, recommendedDestination: destinations.find((item) => item.recommended)!.location, eligibility: { allowed: true } };
}
function emptyVehicleOptions(raw: unknown): EmptyVehicleOptions {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 128) throw new Error('目标位置编码无效');
  const target = locations[raw];
  if (!target) throw new Error('目标位置不存在');
  if (target.container) throw new Error('目标位置已有容器，无法呼叫空载具');
  if (!target.eligibility.allowed) throw new Error(target.eligibility.reason);
  const configured = emptyTargets[raw];
  if (!configured) throw new Error('目标位置未配置空载具呼叫规则');
  const pending = [...logisticsHistory, ...emptyCallHistory, ...warehouseLogisticsHistory].map((entry) => entry.result.task).filter((task) => !cancelledTasks.has(task.taskId));
  if (pending.some((task) => task.destination.locationCode === raw)) throw new Error('目标位置已有未结束物流任务');
  const origins = configured.flatMap((code) => {
    const location = locations[code]; const ref = location?.container;
    if (!ref || ref.containerType !== 'VEHICLE' || !location.eligibility.allowed) return [];
    const vehicle = requireVehicle(ref.containerCode);
    if (Object.values(slots).some((slot) => slot.vehicle.containerCode === vehicle.containerCode && slot.box) ||
      pending.some((task) => task.container.containerType === 'VEHICLE' && task.container.containerCode === vehicle.containerCode)) return [];
    return [{ origin: location.location as LocationCandidate, vehicle: { ...vehicle, location: location.location } }];
  }).sort((a, b) => a.origin.floorCode.localeCompare(b.origin.floorCode) || a.origin.areaCode.localeCompare(b.origin.areaCode) || a.origin.locationCode.localeCompare(b.origin.locationCode));
  return { destination: target.location, origins };
}
function cancellationTasks(): LogisticsTask[] {
  const fixtures: LogisticsTask[] = Array.from({ length: 45 }, (_, index) => {
    const scenario = ['NORMAL', 'ACCEPTED', 'FAILED', 'UNKNOWN', 'REJECTED', 'RESULT-FAIL'][index] || `PAGE-${index}`;
    return { taskId: `9007199254741${String(index + 1).padStart(3, '0')}`, taskNo: `WL-CANCEL-${String(index + 1).padStart(3, '0')}`, version: 1,
      vendor: index % 2 ? 'HIKVISION' : 'STANDARD', taskType: index % 6 === 0 ? 'PROCESS_ROUTE' : 'GENERAL',
      container: { containerType: index % 2 ? 'BOX' : 'VEHICLE', containerCode: `CANCEL-${scenario}`, version: 1 },
      origin: { locationCode: 'KW-03-02', locationName: '三号缓存位' }, destination: { locationCode: 'KW-05-01', locationName: '成品库接驳台' },
      ...(index === 44 ? {} : { agvCode: `AGV-${String(index + 1).padStart(3, '0')}`, agvName: index < 6 ? '搬运一号车' : '分页测试车' }),
      status: 'CREATED', statusName: '已创建', triggerMode: index % 6 ? 'MANUAL' : '满载自动发起',
      createdTime: new Date(Date.UTC(2026, 8, 17, 2, 59 - index)).toISOString() };
  });
  return [...logisticsHistory.map((entry) => entry.result.task), ...emptyCallHistory.map((entry) => entry.result.task), ...warehouseLogisticsHistory.map((entry) => entry.result.task), ...fixtures];
}
function mockData(path: string, method: string, data: Record<string, unknown>): unknown {
  if (method === 'GET' && path === `${prefix}/warehouse-logistics/options`) {
    if (Object.keys(data).some((key) => key !== 'scanCode')) throw new Error('缴库发起查询仅接收 scanCode');
    return warehouseLogisticsOptions(data.scanCode);
  }
  if (method === 'POST' && path === `${prefix}/warehouse-logistics/tasks`) {
    const input = data as unknown as WarehouseLogisticsRequest;
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId) ||
        !['VEHICLE', 'LOCATION'].includes(input.scanType)) throw new Error('请求标识或扫描类型无效');
    const previous = warehouseLogisticsHistory.find((entry) => entry.input.requestId === input.requestId);
    if (previous) {
      if (previous.input.object.containerCode !== input.object?.containerCode || previous.input.object.containerType !== input.object?.containerType ||
          ['scanType', 'scanCode', 'version', 'destinationLocationCode'].some((key) => previous.input[key as keyof WarehouseLogisticsRequest] !== input[key as keyof WarehouseLogisticsRequest])) throw new Error('相同请求标识不能用于不同缴库任务内容');
      return previous.result;
    }
    const current = warehouseLogisticsOptions(input.scanCode);
    const scanType = locations[input.scanCode] ? 'LOCATION' : 'VEHICLE';
    if (scanType !== input.scanType || current.object.containerCode !== input.object?.containerCode || current.object.containerType !== input.object?.containerType) throw new Error('扫描对象或位置关联已变化，请重新扫描');
    if (current.object.version !== input.version) throw new MockHttpError('容器版本已变化，请重新扫描', 409);
    const destination = current.destinations.find((item) => item.location.locationCode === input.destinationLocationCode)?.location;
    if (!destination) throw new Error('目标地点不在当前允许范围内');
    if (current.origin.locationCode === 'KW-WH-FAIL') throw new Error('缴库物流任务创建失败：目标地点暂不可用');
    const result: TaskCreationResponse = { requestId: input.requestId, task: { taskId: String(nextId++), taskNo: `WH-MOCK-${nextId++}`, version: 1,
      vendor: current.vendor, taskType: current.taskType, container: current.object, origin: current.origin, destination,
      status: 'CREATED', statusName: '已创建', triggerMode: 'MANUAL', createdTime: new Date().toISOString() } };
    warehouseLogisticsHistory.push({ input: JSON.parse(JSON.stringify(input)), result });
    return result;
  }
  if (method === 'GET' && path === `${prefix}/traffic/areas`) {
    const page = Number(data.page ?? 1); const size = Number(data.size ?? 20);
    if (!Number.isInteger(page) || page < 1 || page > 2147483647 || !Number.isInteger(size) || size < 1 || size > 200) throw new Error('分页参数无效');
    if (data.keyword !== undefined && (typeof data.keyword !== 'string' || !data.keyword.trim() || data.keyword.length > 128)) throw new Error('查询条件无效');
    if (data.status !== undefined && data.status !== 'FREE' && data.status !== 'OCCUPIED') throw new Error('区域状态无效');
    if (data.keyword === 'QUERY-FAIL') throw new Error('交管区域查询失败，请稍后重试');
    if (data.keyword === '分页测试' && page === 2 && !trafficPageFailed) { trafficPageFailed = true; throw new Error('下一页加载失败，请重试'); }
    const keyword = String(data.keyword || '').toLowerCase();
    const matches = trafficAreas.filter((area) => (!data.status || area.status === data.status) &&
      [area.areaCode, area.areaName].some((value) => value.toLowerCase().includes(keyword)))
      .sort((a, b) => a.areaCode.localeCompare(b.areaCode));
    return { records: matches.slice((page - 1) * size, page * size), total: matches.length, current: page, size, pages: Math.ceil(matches.length / size) };
  }
  const trafficMatch = path.startsWith(`${prefix}/traffic/areas/`) && path.match(/\/traffic\/areas\/([^/]+)\/(lock|release)$/);
  if (method === 'POST' && trafficMatch) {
    const areaCode = decodeURIComponent(trafficMatch[1]);
    const action = trafficMatch[2] as TrafficAction;
    const input = data as unknown as TrafficActionRequest;
    if (Object.keys(data).some((key) => key !== 'requestId' && key !== 'version') ||
        typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId) ||
        !Number.isInteger(input.version) || input.version < 1 || input.version > 2147483647) throw new Error('操作参数无效');
    const previous = trafficHistory.get(input.requestId);
    if (previous) {
      if (previous.areaCode !== areaCode || previous.action !== action || previous.input.version !== input.version) throw new Error('相同请求标识不能用于不同交管操作');
      return previous.after;
    }
    const area = trafficAreas.find((item) => item.areaCode === areaCode);
    if (!area) throw new MockHttpError('交管区域不存在', 404);
    if (area.version !== input.version) throw new MockHttpError('区域状态已被其他操作修改，请刷新后重试', 409);
    if (area.status !== (action === 'lock' ? 'FREE' : 'OCCUPIED')) throw new Error('当前状态不允许该操作，请刷新后重试');
    if (areaCode.endsWith('-FAIL')) throw new Error('操作失败：设备暂不可用，请稍后重试');
    const before = { ...area };
    area.version++; area.status = action === 'lock' ? 'OCCUPIED' : 'FREE';
    area.lastOperatorName = '系统管理员'; area.lastOperationTime = new Date().toISOString();
    const after = { ...area };
    trafficHistory.set(input.requestId, { areaCode, action, input: { ...input }, before, after });
    return after;
  }
  if (method === 'GET' && path === `${prefix}/empty-vehicles/origins`) {
    if (Object.keys(data).some((key) => key !== 'destinationLocationCode')) throw new Error('查询仅接收目标位置编码');
    return emptyVehicleOptions(data.destinationLocationCode);
  }
  if (method === 'POST' && path === `${prefix}/empty-vehicles/call`) {
    const input = data as unknown as CallEmptyVehicleRequest;
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error('请求标识无效');
    const previous = emptyCallHistory.find((entry) => entry.input.requestId === input.requestId);
    if (previous) {
      if (['originLocationCode', 'destinationLocationCode', 'vehicleCode', 'version'].some((key) => previous.input[key as keyof CallEmptyVehicleRequest] !== input[key as keyof CallEmptyVehicleRequest])) throw new Error('相同请求标识不能用于不同呼叫内容');
      return previous.result;
    }
    const available = emptyVehicleOptions(input.destinationLocationCode);
    const selected = available.origins.find((item) => item.origin.locationCode === input.originLocationCode && item.vehicle.containerCode === input.vehicleCode);
    if (!selected) throw new Error('起始位置或空载具已不可用，请重新扫描');
    if (selected.vehicle.version !== input.version) throw new Error('空载具版本已变化，请重新扫描');
    if (input.destinationLocationCode === 'KW-CALL-FAIL') throw new Error('呼叫失败：设备暂不可用，请稍后重试');
    const result: TaskCreationResponse = { requestId: input.requestId, task: { taskId: String(nextId++), taskNo: `CALL-MOCK-${nextId++}`, version: 1,
      vendor: 'STANDARD', taskType: 'GENERAL', container: selected.vehicle, origin: selected.origin, destination: available.destination,
      status: 'CREATED', statusName: '已创建', triggerMode: 'MANUAL', createdTime: new Date().toISOString() } };
    emptyCallHistory.push({ input: { ...input }, result });
    return result;
  }
  if (method === 'GET' && path === `${prefix}/logistics/cancellable-tasks`) {
    const page = Number(data.page ?? 1); const size = Number(data.size ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 200) throw new Error('分页参数无效');
    if (data.keyword !== undefined && (typeof data.keyword !== 'string' || !data.keyword.trim() || data.keyword.length > 128)) throw new Error('查询条件无效');
    if (data.keyword === 'QUERY-FAIL') throw new Error('可取消任务查询失败，请稍后重试');
    if (data.keyword === '分页测试车' && page === 2 && !cancellationPageFailed) { cancellationPageFailed = true; throw new Error('下一页加载失败，请重试'); }
    const keyword = String(data.keyword || '').toLowerCase();
    const matches = cancellationTasks().filter((task) => !cancelledTasks.has(task.taskId) &&
      (!data.vendor || task.vendor === data.vendor) && [task.container.containerCode, task.agvCode || '', task.agvName || ''].some((value) => value.toLowerCase().includes(keyword)))
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime) || b.taskId.localeCompare(a.taskId));
    return { records: matches.slice((page - 1) * size, page * size), total: matches.length, size, current: page, pages: Math.ceil(matches.length / size) };
  }
  const cancelMatch = path.match(/\/logistics\/tasks\/([1-9][0-9]{0,18})\/(cancel|cancellation)$/);
  if (cancelMatch && ((method === 'POST' && cancelMatch[2] === 'cancel') || (method === 'GET' && cancelMatch[2] === 'cancellation'))) {
    const taskId = cancelMatch[1];
    const key = `${taskId}:${String(data.requestId)}`;
    const previous = cancellationHistory.get(key);
    const task = cancellationTasks().find((item) => item.taskId === taskId);
    if (!task) throw new MockHttpError('任务不存在', 404);
    if (method === 'GET') {
      if (!previous) throw new MockHttpError('未找到该取消请求，请核实请求标识', 404);
      if (task.container.containerCode === 'CANCEL-RESULT-FAIL') throw new Error('取消结果查询失败，请稍后刷新结果');
      if (previous.result.cancelStatus === 'ACCEPTED') {
        const status = task.container.containerCode === 'CANCEL-FAILED' ? 'FAILED' : task.container.containerCode === 'CANCEL-UNKNOWN' ? 'UNKNOWN' : 'CANCELLED';
        previous.result = { ...previous.result, cancelStatus: status, processedTime: new Date().toISOString(),
          ...(status === 'FAILED' ? { reason: '设备拒绝取消：任务已进入不可中断阶段' } : status === 'UNKNOWN' ? { reason: '暂未取得设备最终取消结果，请刷新结果' } : {}) };
        if (status === 'CANCELLED') cancelledTasks.add(taskId);
      }
      return previous.result;
    }
    const input = data as unknown as CancelTaskRequest;
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error('请求标识无效');
    if (previous) {
      if (previous.input.version !== input.version || previous.input.reason !== input.reason) throw new Error('相同请求标识不能用于不同取消内容');
      return { ...previous.result, cancelStatus: previous.result.cancelStatus === 'CANCELLED' ? 'CANCELLED' : 'ACCEPTED', reason: undefined };
    }
    if (cancelledTasks.has(taskId)) throw new Error('任务已取消，请刷新列表');
    if ([...cancellationHistory.values()].some((entry) => entry.result.taskId === taskId && ['ACCEPTED', 'UNKNOWN'].includes(entry.result.cancelStatus))) throw new Error('取消结果未确认，请查询原取消请求');
    if (task.version !== input.version) throw new Error('任务版本已变化，请刷新列表');
    if (task.container.containerCode === 'CANCEL-REJECTED') throw new Error('当前任务不可取消：设备正在执行交接');
    const accepted = ['CANCEL-ACCEPTED', 'CANCEL-FAILED', 'CANCEL-UNKNOWN', 'CANCEL-RESULT-FAIL'].includes(task.container.containerCode);
    const result: CancellationResult = { requestId: input.requestId, taskId, taskNo: task.taskNo, cancelStatus: accepted ? 'ACCEPTED' : 'CANCELLED', processedTime: new Date().toISOString() };
    cancellationHistory.set(key, { input: { ...input }, result });
    if (!accepted) cancelledTasks.add(taskId);
    return result;
  }
  if (method === 'GET' && path === `${prefix}/logistics/options`) {
    if (Object.keys(data).some((key) => key !== 'scanCode')) throw new Error('物流查询仅接收 scanCode');
    return logisticsOptions(data.scanCode);
  }
  if (method === 'POST' && path === `${prefix}/logistics/tasks`) {
    const input = data as unknown as CreateLogisticsRequest;
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error('请求标识无效');
    const previous = logisticsHistory.find((entry) => entry.input.requestId === input.requestId);
    if (previous) {
      const saved = previous.input;
      if (saved.object.containerCode !== input.object?.containerCode || saved.object.containerType !== input.object?.containerType ||
        ['version', 'vendor', 'taskType', 'originLocationCode', 'destinationLocationCode', 'shippingNo'].some((key) => saved[key as keyof CreateLogisticsRequest] !== input[key as keyof CreateLogisticsRequest])) throw new Error('相同请求标识不能用于不同任务内容');
      return previous.result;
    }
    const target = requireContainer(input.object);
    const current = logisticsOptions(target.containerCode);
    if (!current.eligibility.allowed) throw new Error(current.eligibility.reason);
    if (target.version !== input.version || current.origin.locationCode !== input.originLocationCode) throw new Error('容器版本或起始位置已变化，请重新扫描');
    if (current.vendor !== input.vendor || current.taskType !== input.taskType) throw new Error('起始位置任务配置已变化，请重新扫描');
    const selected = current.destinations.find((item) => item.location.locationCode === input.destinationLocationCode);
    if (!selected) throw new Error('目标位置不在当前允许范围内');
    if (input.shippingNo && !shippingHistory.some((entry) => entry.receipt.shippingNo === input.shippingNo && entry.receipt.object.containerCode === target.containerCode &&
      entry.receipt.object.containerType === target.containerType && entry.receipt.canCreateLogisticsTask)) throw new Error('发货单与当前运输对象不匹配');
    if (current.origin.locationCode === 'KW-LOG-FAIL') throw new Error('物流任务创建失败：目标位置暂不可用');
    const result: TaskCreationResponse = { requestId: input.requestId, task: { taskId: String(nextId++), taskNo: `WL-MOCK-${nextId++}`, version: 1,
      vendor: current.vendor, taskType: current.taskType, container: current.object, origin: current.origin, destination: selected.location,
      status: 'CREATED', statusName: '已创建', triggerMode: 'MANUAL', createdTime: new Date().toISOString() } };
    logisticsHistory.push({ input: JSON.parse(JSON.stringify(input)), result });
    return result;
  }
  if (method === 'GET' && path === `${prefix}/receiving/pending-tasks`) {
    const page = Number(data.page ?? 1);
    const size = Number(data.size ?? 20);
    if (!Number.isInteger(page) || page < 1 || page > 2147483647 || !Number.isInteger(size) || size < 1 || size > 200) throw new Error('分页参数无效');
    for (const field of ['vehicleCode', 'locationCode']) {
      if (data[field] !== undefined && (typeof data[field] !== 'string' || !(data[field] as string).trim() || (data[field] as string).length > 128)) throw new Error('查询条件无效');
    }
    if (data.vehicleCode === 'CAR-QUERY-FAIL') throw new Error('待接收物料清单查询失败，请稍后重试');
    const tasks = receivingEntries.map((entry) => entry.task).filter((task) => task.status === 'PENDING');
    const matches = tasks.filter((task) => (!data.vehicleCode || task.object.containerType === 'VEHICLE' && task.object.containerCode === data.vehicleCode) &&
      (!data.locationCode || task.location?.locationCode === data.locationCode))
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime) || b.taskId.localeCompare(a.taskId));
    return { records: matches.slice((page - 1) * size, page * size), total: matches.length, size, current: page, pages: Math.ceil(matches.length / size) };
  }
  if (method === 'GET' && /^\/api\/v1\/system\/users\/\d+$/.test(path)) return { department: { deptName: '系统管理部' } };
  // No remote version or file: mock mode never downloads or installs a WGT.
  if (method === 'GET' && path.startsWith('/api/v1/system/configs/value/')) return '';
  if (method === 'GET' && path === `${prefix}/warehouse-applications/objects`) {
    if ('scanType' in data) throw new Error('缴库对象查询仅接收 scanCode');
    return applicationObject(data.scanCode);
  }
  if (method === 'GET' && path === `${prefix}/boxes/materials`) {
    if (data.context === 'RECEIVING') {
      const entry = receivingEntries.find((entry) => entry.boxes.some((box) => box.boxCode === data.boxCode));
      if (!entry) throw new MockHttpError('箱子不属于接收任务', 404);
      if (entry.task.object.containerCode === 'CAR-RECEIVE-DETAIL-FAIL') throw new Error('箱内物料查询失败，请重试');
      const contents = entry.boxes.find((box) => box.boxCode === data.boxCode)!;
      return { box: { containerType: 'BOX', containerCode: contents.boxCode, version: contents.version }, sourceSystem: 'WMS',
        materials: contents.materials, totalQuantity: contents.materialQuantity };
    }
    if (data.context === 'SHIPPING') {
      const { box } = requireBox(data.boxCode);
      if (data.boxCode === 'BOX-SHIP-DETAIL-FAIL') throw new Error('箱内物料查询失败，请重试');
      const materials = shippingWms[box.containerCode] || [];
      return { box, sourceSystem: 'WMS', materials, totalQuantity: materials.reduce((sum, line) => sum + line.quantity, 0) };
    }
    if (data.context !== 'WAREHOUSE_APPLICATION' && data.context !== 'WAREHOUSE_LOGISTICS') throw new Error('此业务用途尚未配置 Mock');
    if (data.boxCode === 'BOX-APPLY-DETAIL-FAIL' || data.context === 'WAREHOUSE_LOGISTICS' && data.boxCode === 'BOX-WH-DETAIL-FAIL-001') throw new Error('箱内物料查询失败，请重试');
    const { box } = requireBox(data.boxCode);
    const contents = boxContents(box.containerCode);
    return { box, sourceSystem: 'LES', materials: contents.materials, totalQuantity: contents.materialQuantity };
  }
  if (method === 'GET' && path === `${prefix}/receiving/tasks`) {
    if (Object.keys(data).some((key) => key !== 'scanCode')) throw new Error('接收查询仅接收 scanCode');
    return receivingResult(data.scanCode);
  }
  if (method === 'POST' && (path === `${prefix}/receiving/confirm` || path === `${prefix}/receiving/clear-wms-bindings`)) {
    const cleanup = path.endsWith('/clear-wms-bindings');
    const input = data as unknown as ClearWmsRequest;
    if (Object.keys(data).some((key) => !['requestId', 'taskId', 'version', ...(cleanup ? ['object'] : [])].includes(key)) ||
      typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId) ||
      typeof input.taskId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input.taskId) || !Number.isInteger(input.version) || input.version < 1) throw new Error('接收操作参数无效');
    const previous = receivingHistory.get(input.requestId);
    if (previous) {
      if (previous.action !== path || previous.input.taskId !== input.taskId || previous.input.version !== input.version ||
        (cleanup && JSON.stringify((previous.input as ClearWmsRequest).object) !== JSON.stringify(input.object))) throw new Error('相同请求标识不能用于不同接收操作');
      return previous.receipt;
    }
    const entry = receivingEntries.find((entry) => entry.task.taskId === input.taskId);
    if (!entry) throw new MockHttpError('接收任务不存在', 404);
    const task = entry.task;
    if (task.version !== input.version || task.status !== 'PENDING') throw new MockHttpError('接收任务已变化或已完成，请重新扫描', 409);
    if (cleanup && (input.object?.containerType !== task.object.containerType || input.object.containerCode !== task.object.containerCode)) throw new Error('清理对象与接收任务不匹配');
    if (!cleanup && !task.eligibility.allowed) throw new Error(task.eligibility.reason);
    receivingResult(task.object.containerCode);
    if (task.object.containerCode === (cleanup ? 'CAR-RECEIVE-CLEAR-FAIL' : 'CAR-RECEIVE-FAIL')) throw new Error(cleanup ? 'WMS 历史清理失败，请稍后重试' : '接收失败，请稍后重试');
    const before: BoxContents[] = JSON.parse(JSON.stringify(cleanup ? entry.wmsBindings : entry.boxes));
    const receipt: ReceivingReceipt = { requestId: input.requestId, operationNo: `RCV-OP-${nextId++}`,
      affectedCount: cleanup ? entry.wmsBindings.reduce((sum, box) => sum + box.materials.length, 0) : 1, processedTime: new Date().toISOString() };
    if (cleanup) entry.wmsBindings = [];
    else { task.status = 'RECEIVED'; task.statusName = '已接收'; task.eligibility = { allowed: false, reason: '任务已接收' }; }
    task.version++;
    receivingHistory.set(input.requestId, { action: path, input: JSON.parse(JSON.stringify(input)), receipt, before });
    return receipt;
  }
  if (method === 'POST' && path === `${prefix}/warehouse-applications/submit`) {
    const target = requireContainer(data.object as ContainerRef);
    if (target.version !== data.version) throw new Error('对象信息已变化，请清空页面后重新扫描');
    const current = applicationObject(target.containerCode);
    if (!current.eligibility.allowed) throw new Error(current.eligibility.reason);
    if (!current.totalMaterialQuantity) throw new Error('当前对象无可处理物料');
    // Mock the ordered backend orchestration; no MES/SAP/WMS network calls or rollback guarantees.
    if (target.containerCode === 'BOX-APPLY-MES-FAIL') throw new Error('MES 物料校验失败：物料未完工');
    if (target.containerCode === 'BOX-APPLY-SAP-FAIL') throw new Error('SAP 缴库单申请失败');
    const sapDocumentNos = [`SAP-MOCK-${nextId++}`];
    if (target.containerCode === 'BOX-APPLY-WMS-FAIL') throw new Error('SAP 单据已申请，WMS 待上架新增失败，请核实后重试');
    return { requestId: data.requestId, applicationNo: `JK-MOCK-${nextId++}`, sapDocumentNos,
      wmsPendingCreated: true, processedTime: new Date().toISOString() };
  }
  if (method === 'GET' && path === `${prefix}/shipping/objects`) {
    if ('scanType' in data || 'page' in data || 'size' in data) throw new Error('发货对象查询仅接收 scanCode');
    return shippingObject(data.scanCode);
  }
  if (method === 'POST' && path === `${prefix}/shipping/submit`) {
    const input = data as unknown as ShippingRequest;
    if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) throw new Error('请求标识无效');
    const previous = shippingHistory.find((entry) => entry.receipt.requestId === input.requestId);
    if (previous) {
      const saved = previous.request;
      if (saved.scanType !== input.scanType || saved.scanCode !== input.scanCode || saved.version !== input.version ||
        saved.object.containerType !== input.object?.containerType || saved.object.containerCode !== input.object?.containerCode) throw new Error('相同请求标识不能用于不同发货内容');
      return previous.receipt;
    }
    const current = shippingObject(input.scanCode);
    if (current.scanType !== input.scanType || current.object.containerType !== input.object?.containerType || current.object.containerCode !== input.object.containerCode) throw new Error('扫描位置或容器关系已变化，请重新扫描');
    const target = requireContainer(input.object);
    if (target.version !== input.version) throw new Error('对象信息已变化，请重新扫描');
    if (!current.eligibility.allowed) throw new Error(current.eligibility.reason);
    if (!current.totalMaterialQuantity) throw new Error('当前对象无可处理物料');
    if (target.containerCode === 'BOX-SHIP-FAIL') throw new Error('成品发货失败：WMS 数据校验未通过');
    // Mock chooses WMS for SHIPPING; real source mapping and cross-system recovery belong to the backend.
    const before = current.boxes.map((box) => boxContents(box.boxCode));
    const snapshot: BoxContents[] = JSON.parse(JSON.stringify(current.boxes));
    for (const content of snapshot) requireBox(content.boxCode).bindings = [];
    const changedVehicles = new Set<Vehicle>();
    for (const content of snapshot) {
      const box = requireBox(content.boxCode);
      box.bindings = content.materials.map(({ lineType, ...line }) => ({ ...line, bindingMode: lineType === 'PANEL' ? 'BY_CODE' : 'BY_ORDER', id: String(nextId++), version: 1 }));
      box.totalQuantity = content.materialQuantity; box.empty = !content.materialQuantity; box.box.version++;
      const parent = loadedSlot(content.boxCode);
      if (parent) changedVehicles.add(parent.vehicle);
    }
    changedVehicles.forEach((vehicle) => vehicle.version++);
    for (const content of snapshot) shippingWms[content.boxCode] = [];
    const receipt: ShippingReceipt = { requestId: input.requestId, shippingNo: `SHIP-MOCK-${nextId++}`,
      object: { ...target, location: containerLocation(target)?.location }, canCreateLogisticsTask: target.containerType === 'VEHICLE' && target.containerCode !== 'CAR-SHIP-NO-TASK', processedTime: new Date().toISOString() };
    shippingHistory.push({ request: JSON.parse(JSON.stringify(input)), receipt, before, shipped: snapshot });
    return receipt;
  }
  if (method === 'GET' && path === `${prefix}/locations/containers`) {
    const state = requireLocation(data.locationCode);
    return { ...state, occupied: !!state.container,
      container: state.container ? { ...requireContainer(state.container), location: state.location } : undefined };
  }
  if (method === 'GET' && path === `${prefix}/locations/container-candidates`) {
    if ('locationCode' in data || 'scanType' in data) throw new Error('容器识别仅接收 scanCode');
    const code = data.scanCode;
    const candidates: LocationContainer[] = vehicles.filter((item) => item.containerCode === code);
    if (typeof code === 'string' && boxes[code]) candidates.push(boxes[code].box);
    if (!candidates.length) throw new Error('载具或箱子编码不存在');
    if (candidates.length !== 1) throw new Error('该编码匹配多个容器，无法唯一识别');
    const container = candidates[0];
    const reason = containerReason(container);
    return { container: { ...container, location: containerLocation(container)?.location }, eligibility: { allowed: !reason, reason } };
  }
  if (method === 'POST' && [`${prefix}/locations/bind-container`, `${prefix}/locations/unbind-container`].includes(path)) {
    const input = data as unknown as LocationOperation;
    const state = requireLocation(input.locationCode);
    const target = requireContainer(input.container);
    if (state.version !== input.version || target.version !== input.containerVersion) throw new Error('库位或容器信息已变化，请清空页面后重新扫描');
    if (!state.eligibility.allowed) throw new Error(state.eligibility.reason);
    const unbind = path.endsWith('/unbind-container');
    if (unbind) {
      if (state.container?.containerType !== target.containerType || state.container.containerCode !== target.containerCode) throw new Error('当前库位绑定关系已变化，请重新扫描');
      if (input.locationCode === 'KW-UNBIND-FAIL') throw new Error('容器正在执行物流任务，暂不允许解绑');
    } else {
      if (state.container) throw new Error('该库位已绑定容器，请先解绑');
      const reason = containerReason(target);
      if (reason) throw new Error(reason);
      if (input.locationCode === 'KW-SUBMIT-FAIL') throw new Error('该库位与当前容器不符合绑定规则');
    }
    // Change only the location relation after all checks; box contents and vehicle loads remain intact.
    if (unbind) delete state.container;
    else state.container = { containerType: target.containerType, containerCode: target.containerCode };
    state.version++;
    target.version++;
    const parent = target.containerType === 'BOX' ? loadedSlot(target.containerCode) : undefined;
    if (parent) parent.vehicle.version++;
    return { requestId: data.requestId, operationNo: `MOCK-${nextId++}`, affectedCount: 1, processedTime: new Date().toISOString() };
  }
  if (method === 'GET' && path === `${prefix}/vehicle-slots`) {
    const slot = requireSlot(data.slotCode);
    return { ...slot, eligibility: slot.box ? { allowed: false, reason: `该载具库位已装载箱子 ${slot.box.containerCode}` } : slot.eligibility };
  }
  if (method === 'GET' && path === `${prefix}/loading/boxes`) return loadingBox(data.boxCode);
  if (method === 'GET' && path === `${prefix}/vehicles/loads`) return vehicleLoads(data.vehicleCode);
  if (method === 'POST' && [`${prefix}/loading/unload-selected`, `${prefix}/loading/unload-all`].includes(path)) {
    const vehicle = requireVehicle(data.vehicleCode);
    if (vehicle.version !== data.version) throw new Error('载具装载信息已变化，请清空页面后重新扫描');
    if (vehicle.containerCode === 'CAR-UNLOAD-FAIL') throw new Error('载具正在执行物流任务，暂不允许卸载');
    const loaded = Object.values(slots).filter((slot) => slot.vehicle === vehicle && slot.box);
    let changes = loaded;
    if (path.endsWith('/unload-selected')) {
      const items = data.items as Pick<LoadedBox, 'id' | 'version'>[];
      if (!Array.isArray(items) || !items.length || items.length > 1000 || items.some((item) => !item || typeof item.id !== 'string') ||
        new Set(items.map((item) => item.id)).size !== items.length) throw new Error('请选择有效的装载记录（最多1000条）');
      changes = items.map((item) => {
        const slot = loaded.find((row) => loadRelations[row.slotCode]?.id === item.id);
        if (!slot || loadRelations[slot.slotCode].version !== item.version) throw new Error('装载关系已变化，请清空页面后重新扫描');
        return slot;
      });
    }
    if (!changes.length) throw new Error('该载具暂无已装载箱子');
    // Validate all relationships first; unloading never changes box contents.
    for (const slot of changes) {
      slot.box!.version++;
      slot.version++;
      delete slot.box;
      delete loadRelations[slot.slotCode];
    }
    vehicle.version++;
    return { requestId: data.requestId, operationNo: `MOCK-${nextId++}`, affectedCount: changes.length, processedTime: new Date().toISOString() };
  }
  if (method === 'POST' && path === `${prefix}/loading/batch-load`) {
    const items = data.items as LoadPair[];
    if (!Array.isArray(items) || !items.length || items.length > 1000 || items.some((item) => !item || typeof item.slotCode !== 'string' || typeof item.boxCode !== 'string')) throw new Error('装载配对无效（1～1000条）');
    if (new Set(items.map((item) => item.slotCode)).size !== items.length || new Set(items.map((item) => item.boxCode)).size !== items.length) throw new Error('存在重复的箱子或载具库位');
    // Validate the entire batch before writing any relationship.
    const changes = items.map((item) => {
      const slot = requireSlot(item.slotCode);
      const result = loadingBox(item.boxCode);
      if (slot.version !== item.slotVersion || result.box.version !== item.boxVersion) throw new Error('箱子或载具库位信息已变化，请清空页面后重新扫描');
      if (!slot.eligibility.allowed) throw new Error(slot.eligibility.reason || '载具库位不允许装载');
      if (slot.box) throw new Error(`载具库位 ${slot.slotCode} 已被占用`);
      if (!result.eligibility.allowed) throw new Error(result.eligibility.reason);
      if (slot.slotCode === 'SLOT-SUBMIT-FAIL') throw new Error('提交时载具状态已变化，当前不允许装载');
      return { slot, box: result.box };
    });
    const changedVehicles = new Set<Vehicle>();
    for (const { slot, box } of changes) {
      slot.box = box;
      loadRelations[slot.slotCode] = { id: String(nextId++), version: 1 };
      slot.version++;
      box.version++;
      changedVehicles.add(slot.vehicle);
    }
    changedVehicles.forEach((vehicle) => vehicle.version++);
    return { requestId: data.requestId, operationNo: `MOCK-${nextId++}`, affectedCount: changes.length, processedTime: new Date().toISOString() };
  }
  if (method === 'GET' && path === `${prefix}/boxes/bindings`) return requireBox(data.boxCode);
  if (method === 'GET' && path === `${prefix}/panels`) {
    if ('boxCode' in data) throw new Error('板件查询不接收箱码');
    const panel = requirePanel(data.panelCode);
    const currentBoxCode = boundBox(panel.panelCode);
    return { ...panel, currentBoxCode, eligibility: { allowed: !currentBoxCode, reason: currentBoxCode ? `物料已绑定至箱 ${currentBoxCode}` : undefined } };
  }
  if (method === 'POST' && path === `${prefix}/panels/joint-candidates/query`) {
    if ('boxCode' in data) throw new Error('拼板查询不接收箱码');
    const pendingCodes = data.pendingPanelCodes;
    if (!Array.isArray(pendingCodes) || pendingCodes.length > 1000 || pendingCodes.some((code) => typeof code !== 'string' || !code.trim() || code.length > 128) ||
      new Set(pendingCodes).size !== pendingCodes.length) throw new Error('待绑定板件集合无效');
    pendingCodes.forEach(requirePanel);
    const seeds = new Set(pendingCodes);
    const candidateCodes = new Set(jointGroups.filter((group) => group.some((code) => seeds.has(code))).flat());
    return { candidates: panels.filter((panel) => candidateCodes.has(panel.panelCode) && !seeds.has(panel.panelCode) &&
      !boundBox(panel.panelCode) && panel.eligibility.allowed).sort((a, b) => a.panelCode.localeCompare(b.panelCode)) };
  }
  if (method === 'POST' && [ `${prefix}/boxes/bindings/bind-by-codes`, `${prefix}/boxes/bindings/bind-by-order`, `${prefix}/boxes/bindings/unbind-all`, `${prefix}/boxes/bindings/unbind-selected` ].includes(path)) {
    const box = requireBox(data.boxCode);
    if (data.version !== box.box.version) throw new Error('箱内绑定已变化，请清空页面后重新扫描');
    let affectedCount = box.bindings.length;
    if (path.endsWith('/bind-by-codes')) {
      const codes = data.panelCodes;
      if (!Array.isArray(codes) || !codes.length || codes.length > 1000 || new Set(codes).size !== codes.length) throw new Error('待绑定物料列表无效');
      const additions = codes.map((code) => {
        const panel = requirePanel(code);
        if (boundBox(panel.panelCode)) throw new Error(`物料 ${panel.panelCode} 已绑定其他箱`);
        return panel;
      });
      affectedCount = additions.length;
      box.bindings.push(...additions.map(toBinding));
    } else if (path.endsWith('/bind-by-order')) {
      if (!box.empty) throw new Error('当前箱子已有物料，请先一键解绑');
      const quantity = data.quantity;
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) throw new Error('数量必须为有效的正整数');
      const panel = panels.find((item) => item.orderNo === data.orderNo);
      if (!panel) throw new Error('订单不存在或无法唯一解析物料');
      box.bindings = [{ id: String(nextId++), version: 1, bindingMode: 'BY_ORDER', materialCode: panel.materialCode,
        materialName: panel.materialName, orderNo: panel.orderNo, quantity, unit: '件' }];
      affectedCount = quantity;
    } else if (path.endsWith('/unbind-selected')) {
      const items = data.items as Pick<Binding, 'id' | 'version'>[];
      if (!Array.isArray(items) || !items.length || items.length > 1000 || items.some((item) => !item || typeof item.id !== 'string') || new Set(items.map((item) => item.id)).size !== items.length) throw new Error('请选择有效的绑定记录（最多1000条）');
      const ids = new Set(items.map((item) => {
        const binding = box.bindings.find((row) => row.id === item.id);
        if (!binding || binding.version !== item.version) throw new Error('绑定记录已变化，请清空页面后重新扫描');
        return binding.id;
      }));
      affectedCount = ids.size;
      box.bindings = box.bindings.filter((item) => !ids.has(item.id));
    } else box.bindings = [];
    box.empty = box.bindings.length === 0;
    box.totalQuantity = box.bindings.reduce((total, item) => total + item.quantity, 0);
    box.box.version++;
    const parentSlot = loadedSlot(box.box.containerCode);
    if (parentSlot) parentSlot.vehicle.version++;
    return { requestId: data.requestId, operationNo: `MOCK-${nextId++}`, affectedCount, processedTime: new Date().toISOString(),
      box: { boxCode: box.box.containerCode, version: box.box.version, materialQuantity: box.totalQuantity } };
  }
  // Never fall through to the network for an endpoint not yet implemented.
  throw new Error('此接口尚未配置 Mock 数据');
}

export function resolveMockRequest(options: UniNamespace.RequestOptions): UniNamespace.RequestSuccessCallbackResult {
  const path = options.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  let statusCode = 200;
  let code = 0;
  let message = '操作成功';
  let data: unknown = null;
  try {
    data = mockData(path, options.method || 'GET', (options.data || {}) as Record<string, unknown>);
  } catch (error) {
    statusCode = error instanceof MockHttpError ? error.statusCode : 400;
    code = statusCode * 100;
    message = error instanceof Error ? error.message : 'Mock 请求失败';
  }
  return { statusCode, header: {}, cookies: [], data: JSON.parse(JSON.stringify({ code, message, data, timestamp: new Date().toISOString(), traceId: 'mock-local' })) };
}

resetMockData();
