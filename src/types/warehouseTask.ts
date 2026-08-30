export type WarehouseTaskStatus = '已创建' | '进行中' | '已完成';

export interface WarehouseTask {
  id: string;
  orderNo: string;
  creator: string;
  createdAt: string;
  location: string;
  status: WarehouseTaskStatus;
}

export interface WarehouseTaskPage {
  items: WarehouseTask[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}
