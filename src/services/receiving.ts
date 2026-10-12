import { request } from './nariRequest';
import type { ContainerRef, LocationContainer } from './locationBinding';
import type { ReceivingTask } from './pendingReceiving';
import type { BoxContents, BoxMaterials } from './warehouseApplication';

export interface ReceivingResult {
  object: LocationContainer;
  task?: ReceivingTask;
  boxes: BoxContents[];
  totalMaterialQuantity: number;
}
export interface ReceivingRequest { requestId: string; taskId: string; version: number; object: ContainerRef; remark?: string }
export type ClearWmsRequest = Omit<ReceivingRequest, 'remark'>;
export interface ReceivingReceipt { requestId: string; operationNo: string; affectedCount: number; processedTime: string }
export interface ReceivingOperationReceipt extends ReceivingReceipt { taskId: string; object: ContainerRef; version: number }
export const receivingApi = {
  query: (scanCode: string, taskId?: string) => request<ReceivingResult>('/receiving/tasks', 'GET', { scanCode, ...(taskId ? { taskId } : {}) }),
  getMaterials: (boxCode: string) => request<BoxMaterials>('/boxes/materials', 'GET', { boxCode, context: 'RECEIVING' }),
  confirm: (input: ReceivingRequest) => request<ReceivingOperationReceipt>('/receiving/confirm', 'POST', { ...input }),
  clearWms: (input: ClearWmsRequest) => request<ReceivingReceipt>('/receiving/clear-wms-bindings', 'POST', { ...input })
};
