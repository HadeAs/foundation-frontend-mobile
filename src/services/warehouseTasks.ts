import type { WarehouseTask, WarehouseTaskPage, WarehouseTaskStatus } from '../types/warehouseTask';

interface FetchWarehouseTasksOptions {
  page: number;
  pageSize: number;
  keyword?: string;
}

const creators = ['张三', '李四', '王五', '赵六'];
const locations = ['一号仓库 A 区', '一号仓库 B 区', '二号仓库收货口', '原料暂存区'];
const statuses: WarehouseTaskStatus[] = ['已创建', '进行中', '已完成'];

const taskPool: WarehouseTask[] = Array.from({ length: 35 }, (_, index) => {
  const sequence = index + 1;
  return {
    id: `IN-20260707-${String(sequence).padStart(3, '0')}`,
    orderNo: `IN-20260707-${String(sequence).padStart(3, '0')}`,
    creator: creators[index % creators.length],
    createdAt: `2026-07-07 ${String(9 + Math.floor(index / 6)).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
    location: locations[index % locations.length],
    status: statuses[index % statuses.length]
  };
});

const latestTasks: WarehouseTask[] = Array.from({ length: 6 }, (_, index) => {
  const sequence = index + 1;
  return {
    id: `IN-20260707-LATEST-${String(sequence).padStart(3, '0')}`,
    orderNo: `IN-20260707-LATEST-${String(sequence).padStart(3, '0')}`,
    creator: creators[(index + 1) % creators.length],
    createdAt: `2026-07-07 16:${String(55 - index * 3).padStart(2, '0')}`,
    location: locations[(index + 2) % locations.length],
    status: statuses[index % statuses.length]
  };
});

function delay<T>(value: T, ms = 650): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

export async function fetchWarehouseTasksPage({
  page,
  pageSize,
  keyword = ''
}: FetchWarehouseTasksOptions): Promise<WarehouseTaskPage> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const matchedTasks = normalizedKeyword
    ? taskPool.filter((task) => task.orderNo.toLowerCase().includes(normalizedKeyword))
    : taskPool;
  const start = (safePage - 1) * safePageSize;
  const items = matchedTasks.slice(start, start + safePageSize);

  return delay({
    items,
    page: safePage,
    pageSize: safePageSize,
    total: matchedTasks.length,
    hasMore: start + items.length < matchedTasks.length
  });
}

export async function fetchLatestWarehouseTasks(count = 4): Promise<WarehouseTask[]> {
  return delay(latestTasks.slice(0, Math.max(0, count)));
}

export async function fetchWarehouseTaskById(id: string): Promise<WarehouseTask | null> {
  return delay([...latestTasks, ...taskPool].find((task) => task.id === id) ?? null);
}
