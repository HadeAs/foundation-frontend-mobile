import type { ContainerChildNode, ContainerContentNode, ContainerDetail, ManagedContainer } from '../types/container';
import type { InventoryItem } from '../types/inventory';

const containers: ManagedContainer[] = [
  { id: 'container-ct-a001', code: 'CT-A001', type: '托盘' },
  { id: 'container-box-a001', code: 'BOX-A001', type: '周转箱' },
  { id: 'container-box-a002', code: 'BOX-A002', type: '周转箱' },
  { id: 'container-rack-b001', code: 'RACK-B001', type: '料架' }
];

const inventoryItems: InventoryItem[] = [
  {
    id: 'INV-001',
    barcodeNo: 'BC202607070001',
    batchNo: 'BT-202607-01',
    productionDate: '2026-06-01',
    materialCode: 'MAT-1001',
    materialName: '冷轧钢板',
    unit: '件',
    quantity: 12,
    containerCode: 'BOX-A001',
    locationCode: 'KW-01-01',
    status: '正常'
  },
  {
    id: 'INV-002',
    barcodeNo: 'BC202607070002',
    batchNo: 'BT-202607-02',
    productionDate: '2026-06-02',
    materialCode: 'MAT-1002',
    materialName: '轴承组件',
    unit: '箱',
    quantity: 15,
    containerCode: 'BOX-A001',
    locationCode: 'KW-01-02',
    status: '锁定'
  },
  {
    id: 'INV-003',
    barcodeNo: 'BC202607070003',
    batchNo: 'BT-202607-03',
    productionDate: '2026-06-03',
    materialCode: 'MAT-1003',
    materialName: '密封垫圈',
    unit: '托',
    quantity: 18,
    containerCode: 'BOX-A002',
    locationCode: 'KW-01-03',
    status: '正常'
  },
  {
    id: 'INV-004',
    barcodeNo: 'BC202607070004',
    batchNo: 'BT-202607-04',
    productionDate: '2026-06-04',
    materialCode: 'MAT-1004',
    materialName: '电机外壳',
    unit: '件',
    quantity: 21,
    containerCode: 'CT-A001',
    locationCode: 'KW-01-04',
    status: '过期'
  },
  {
    id: 'INV-005',
    barcodeNo: 'BC202607070005',
    batchNo: 'BT-202607-05',
    productionDate: '2026-06-05',
    materialCode: 'MAT-1005',
    materialName: '控制模块',
    unit: '箱',
    quantity: 24,
    containerCode: 'RACK-B001',
    locationCode: 'KW-02-01',
    status: '正常'
  }
];

const childMap: Record<string, string[]> = {
  'CT-A001': ['BOX-A001', 'BOX-A002'],
  'RACK-B001': ['BOX-A002']
};

const directInventoryMap: Record<string, string[]> = {
  'CT-A001': ['INV-004'],
  'BOX-A001': ['INV-001', 'INV-002'],
  'BOX-A002': ['INV-003'],
  'RACK-B001': ['INV-005']
};

function delay<T>(value: T, ms = 500): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

function findContainer(code: string) {
  const normalizedCode = code.trim().toLowerCase();
  return containers.find((container) => container.code.toLowerCase() === normalizedCode) ?? null;
}

function inventoryNode(inventory: InventoryItem): ContainerContentNode {
  return {
    kind: 'inventory',
    id: `inventory-node-${inventory.id}`,
    inventory
  };
}

function buildContainerNode(container: ManagedContainer): ContainerChildNode {
  return {
    kind: 'container',
    id: `container-node-${container.id}`,
    container,
    children: buildChildren(container.code)
  };
}

function buildChildren(containerCode: string): ContainerContentNode[] {
  const childContainers = (childMap[containerCode] ?? [])
    .map((code) => findContainer(code))
    .filter((container): container is ManagedContainer => Boolean(container))
    .map((container) => buildContainerNode(container));

  const directInventory = (directInventoryMap[containerCode] ?? [])
    .map((id) => inventoryItems.find((item) => item.id === id))
    .filter((item): item is InventoryItem => Boolean(item))
    .map((item) => inventoryNode(item));

  return [...childContainers, ...directInventory];
}

export async function fetchContainerDetail(code: string): Promise<ContainerDetail | null> {
  const container = findContainer(code);
  if (!container) {
    return delay(null);
  }

  return delay({
    container,
    children: buildChildren(container.code)
  });
}
