import { request } from './nariRequest';
import type { ContainerRef, LocationContainer, LocationSummary } from './locationBinding';
import type { ReceivingProgress } from './pendingReceiving';
import type { Eligibility } from './panelPacking';
import type { BoxContents, BoxMaterials } from './warehouseApplication';

export type ReceivingIdentity = { applicationId: string; taskId?: never } | { taskId: string; applicationId?: never };
export interface ReceivingTask extends ReceivingProgress {
  applicationId?: string;
  applicationNo?: string;
  taskId?: string;
  taskNo?: string;
  location?: LocationSummary;
  eligibility: Eligibility;
}
export function isReceivingId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
}
export function receivingIdentity(value: { applicationId?: string; taskId?: string }): ReceivingIdentity | null {
  if (isReceivingId(value.applicationId) && value.taskId == null) return { applicationId: value.applicationId };
  if (isReceivingId(value.taskId) && value.applicationId == null) return { taskId: value.taskId };
  return null;
}
export interface ReceivingResult {
  object: LocationContainer;
  task?: ReceivingTask;
  boxes: BoxContents[];
  totalMaterialQuantity: number;
}
export type ReceivingRequest = ReceivingIdentity & { requestId: string; version: number; object: ContainerRef; remark?: string };
export interface ClearWmsRequest { requestId: string; taskId: string; version: number; object: ContainerRef }
export interface ReceivingReceipt { requestId: string; affectedCount: number; processedTime: string }
export type ReceivingOperationReceipt = ReceivingReceipt & ReceivingIdentity & { object: ContainerRef; version: number };
export const receivingApi = {
  query: (scanCode: string, source?: string | ReceivingIdentity) => request<ReceivingResult>('/receiving/tasks', 'GET', {
    scanCode, ...(typeof source === 'string' ? { taskId: source } : source)
  }),
  getMaterials: (boxCode: string) => request<BoxMaterials>('/boxes/materials', 'GET', { boxCode, context: 'RECEIVING' }),
  confirm: (input: ReceivingRequest) => request<ReceivingOperationReceipt>('/receiving/confirm', 'POST', { ...input }),
  clearWms: (input: ClearWmsRequest) => request<ReceivingReceipt>('/receiving/clear-wms-bindings', 'POST', { ...input })
};
