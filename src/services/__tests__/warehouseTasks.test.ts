import { describe, expect, it } from 'vitest';
import { fetchLatestWarehouseTasks, fetchWarehouseTaskById, fetchWarehouseTasksPage } from '../warehouseTasks';

describe('warehouse task service', () => {
  it('returns paginated warehouse tasks with total state', async () => {
    const page = await fetchWarehouseTasksPage({ page: 1, pageSize: 10 });

    expect(page.items).toHaveLength(10);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(10);
    expect(page.total).toBe(35);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toMatchObject({
      id: 'IN-20260707-001',
      orderNo: 'IN-20260707-001',
      creator: expect.any(String),
      createdAt: expect.any(String),
      location: expect.any(String),
      status: expect.stringMatching(/已创建|进行中|已完成/)
    });
  });

  it('returns different task ids for the second page', async () => {
    const firstPage = await fetchWarehouseTasksPage({ page: 1, pageSize: 4 });
    const secondPage = await fetchWarehouseTasksPage({ page: 2, pageSize: 4 });

    expect(secondPage.items).toHaveLength(4);
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
  });

  it('finds a warehouse task by id', async () => {
    const task = await fetchWarehouseTaskById('IN-20260707-003');

    expect(task).toMatchObject({
      id: 'IN-20260707-003',
      orderNo: 'IN-20260707-003'
    });
  });

  it('filters warehouse tasks by scanned order number', async () => {
    const page = await fetchWarehouseTasksPage({ page: 1, pageSize: 10, keyword: '007' });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].orderNo).toBe('IN-20260707-007');
    expect(page.hasMore).toBe(false);
  });

  it('returns latest tasks before the first page for pull refresh', async () => {
    const latest = await fetchLatestWarehouseTasks(3);

    expect(latest).toHaveLength(3);
    expect(latest[0].id).toBe('IN-20260707-LATEST-001');
    expect(latest[1].createdAt >= latest[2].createdAt).toBe(true);
  });
});
