import { describe, expect, it } from 'vitest';
import { fetchInventoryPage, fetchLatestInventoryItems } from '../inventory';

describe('inventory service', () => {
  it('returns paginated inventory items with total state', async () => {
    const page = await fetchInventoryPage({ page: 1, pageSize: 10 });

    expect(page.items).toHaveLength(10);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(10);
    expect(page.total).toBe(50);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toMatchObject({
      id: 'INV-001',
      barcodeNo: 'BC202607070001',
      batchNo: expect.any(String),
      productionDate: expect.any(String),
      materialCode: expect.any(String),
      materialName: expect.any(String),
      unit: expect.any(String),
      quantity: expect.any(Number),
      containerCode: expect.any(String),
      locationCode: expect.any(String),
      status: expect.stringMatching(/正常|锁定|过期/)
    });
  });

  it('returns different inventory ids for the second page', async () => {
    const firstPage = await fetchInventoryPage({ page: 1, pageSize: 10 });
    const secondPage = await fetchInventoryPage({ page: 2, pageSize: 10 });

    expect(secondPage.items).toHaveLength(10);
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
    expect(secondPage.items[0].id).toBe('INV-011');
  });

  it('filters inventory by barcode, material, container, or location keyword', async () => {
    const byBarcode = await fetchInventoryPage({ page: 1, pageSize: 10, keyword: '0007' });
    const byMaterial = await fetchInventoryPage({ page: 1, pageSize: 10, keyword: 'MAT-1002' });
    const byContainer = await fetchInventoryPage({ page: 1, pageSize: 10, keyword: 'BOX-A03' });
    const byLocation = await fetchInventoryPage({ page: 1, pageSize: 10, keyword: 'KW-02' });

    expect(byBarcode.items.every((item) => item.barcodeNo.includes('0007'))).toBe(true);
    expect(byMaterial.items.every((item) => item.materialCode.includes('MAT-1002'))).toBe(true);
    expect(byContainer.items.every((item) => item.containerCode.includes('BOX-A03'))).toBe(true);
    expect(byLocation.items.every((item) => item.locationCode.includes('KW-02'))).toBe(true);
  });

  it('returns latest inventory items before the first page for pull refresh', async () => {
    const latest = await fetchLatestInventoryItems(3);

    expect(latest).toHaveLength(3);
    expect(latest[0].id).toBe('INV-LATEST-001');
  });
});
