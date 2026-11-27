import { request } from './nariRequest';
import type { LocationContainer } from './locationBinding';

export interface ReceivingProgress {
  version: number;
  object: LocationContainer;
  status: string;
  statusName: string;
  createdTime: string;
  totalBoxCount: number;
  receivedBoxCount: number;
}
export interface PendingApplication extends ReceivingProgress {
  applicationId: string;
  applicationNo: string;
}
export interface ReceivingTaskPage<T = PendingApplication> {
  records: T[];
  total: number;
  size: number;
  current: number;
  pages: number;
}
export interface PendingFilters { vehicleCode?: string; locationCode?: string }
export interface ApplicationMaterialSummary { materialCode: string; orderNo: string; quantity: number }
const detailPageSize = 100;
export type NotShelvingItem = Pick<PendingApplication, 'applicationId' | 'version'>;
export interface NotShelvingSubmission { requestId: string; items: NotShelvingItem[]; reason: string }
export interface NotShelvingReceipt {
  requestId?: string;
  affectedApplicationCount?: number;
  affectedBoxCount?: number;
  items?: { applicationId: string; affectedBoxCount?: number }[];
}
export const pendingReceivingApi = {
  query: (filters: PendingFilters, page: number) =>
    request<ReceivingTaskPage>('/receiving/pending-tasks', 'GET', { ...filters, page, size: 20 }),
  details: async (applicationId: string, page: number) => {
    const data = await request<ReceivingTaskPage<ApplicationMaterialSummary>>(
      '/api/v1/business/nari-warehouse-record-box', 'GET',
      { warehouseRecordId: applicationId, page, size: detailPageSize, sortBy: 'id', sortOrder: 'ASC' }
    );
    if (data.current !== page || data.size !== detailPageSize || !Number.isSafeInteger(data.total) || data.total < 0 ||
      data.pages !== Math.ceil(data.total / detailPageSize) || !Array.isArray(data.records) ||
      data.records.length !== Math.min(detailPageSize, Math.max(0, data.total - (page - 1) * detailPageSize))) {
      throw new Error('申请明细分页异常，请重新查询');
    }
    return data;
  },
  notShelve: ({ requestId, items, reason }: NotShelvingSubmission) => items.length === 1
    ? request<NotShelvingReceipt>('/receiving/not-shelving', 'POST', { requestId, ...items[0], reason })
    : request<NotShelvingReceipt>('/receiving/not-shelving/batch', 'POST', { requestId, items, reason })
};

export function displayTaskTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
