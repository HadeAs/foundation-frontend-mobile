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
export interface ReceivingTaskPage {
  records: PendingApplication[];
  total: number;
  size: number;
  current: number;
  pages: number;
}
export interface PendingFilters { vehicleCode?: string; locationCode?: string }
export const pendingReceivingApi = {
  query: (filters: PendingFilters, page: number) =>
    request<ReceivingTaskPage>('/receiving/pending-tasks', 'GET', { ...filters, page, size: 20 })
};

export function displayTaskTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
