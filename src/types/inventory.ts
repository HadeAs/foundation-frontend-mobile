export type InventoryStatus = '正常' | '锁定' | '过期';

export interface InventoryItem {
  id: string;
  barcodeNo: string;
  batchNo: string;
  productionDate: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  containerCode: string;
  locationCode: string;
  status: InventoryStatus;
}

export interface InventoryPage {
  items: InventoryItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}
