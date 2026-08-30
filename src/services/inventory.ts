import type { InventoryItem, InventoryPage, InventoryStatus } from '../types/inventory';

interface FetchInventoryOptions {
  page: number;
  pageSize: number;
  keyword?: string;
}

const materialNames = ['冷轧钢板', '轴承组件', '密封垫圈', '电机外壳', '控制模块'];
const units = ['件', '箱', '托', '卷'];
const statuses: InventoryStatus[] = ['正常', '锁定', '过期'];

const inventoryPool: InventoryItem[] = Array.from({ length: 50 }, (_, index) => {
  const sequence = index + 1;
  const materialIndex = index % materialNames.length;
  const dateDay = 1 + (index % 28);

  return {
    id: `INV-${String(sequence).padStart(3, '0')}`,
    barcodeNo: `BC20260707${String(sequence).padStart(4, '0')}`,
    batchNo: `BT-202607-${String(1 + (index % 8)).padStart(2, '0')}`,
    productionDate: `2026-06-${String(dateDay).padStart(2, '0')}`,
    materialCode: `MAT-${String(1001 + materialIndex)}`,
    materialName: materialNames[materialIndex],
    unit: units[index % units.length],
    quantity: 12 + index * 3,
    containerCode: `BOX-${String.fromCharCode(65 + (index % 4))}${String(1 + (index % 6)).padStart(2, '0')}`,
    locationCode: `KW-${String(1 + (index % 5)).padStart(2, '0')}-${String(1 + (index % 12)).padStart(2, '0')}`,
    status: statuses[index % statuses.length]
  };
});

const latestInventoryItems: InventoryItem[] = Array.from({ length: 5 }, (_, index) => {
  const sequence = index + 1;

  return {
    ...inventoryPool[index],
    id: `INV-LATEST-${String(sequence).padStart(3, '0')}`,
    barcodeNo: `BC20260708${String(sequence).padStart(4, '0')}`,
    batchNo: `BT-202607-L${String(sequence).padStart(2, '0')}`,
    productionDate: `2026-07-${String(sequence).padStart(2, '0')}`,
    quantity: 80 + index * 5,
    containerCode: `BOX-N${String(sequence).padStart(2, '0')}`,
    locationCode: `KW-NEW-${String(sequence).padStart(2, '0')}`,
    status: statuses[index % statuses.length]
  };
});

function delay<T>(value: T, ms = 650): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

function matchesKeyword(item: InventoryItem, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }

  return [
    item.barcodeNo,
    item.materialCode,
    item.containerCode,
    item.locationCode
  ].some((value) => value.toLowerCase().includes(normalizedKeyword));
}

export async function fetchInventoryPage({
  page,
  pageSize,
  keyword = ''
}: FetchInventoryOptions): Promise<InventoryPage> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const matchedItems = inventoryPool.filter((item) => matchesKeyword(item, keyword));
  const start = (safePage - 1) * safePageSize;
  const items = matchedItems.slice(start, start + safePageSize);

  return delay({
    items,
    page: safePage,
    pageSize: safePageSize,
    total: matchedItems.length,
    hasMore: start + items.length < matchedItems.length
  });
}

export async function fetchLatestInventoryItems(count = 4): Promise<InventoryItem[]> {
  return delay(latestInventoryItems.slice(0, Math.max(0, count)));
}
