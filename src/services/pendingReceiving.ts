import { request } from './nariRequest';
import type { LocationContainer, LocationSummary } from './locationBinding';
import type { Eligibility } from './panelPacking';

export interface ReceivingTask {
  taskId: string;
  taskNo: string;
  version: number;
  object: LocationContainer;
  location?: LocationSummary;
  status: string;
  statusName: string;
  createdTime: string;
  eligibility: Eligibility;
}
export interface ReceivingTaskPage {
  records: ReceivingTask[];
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
