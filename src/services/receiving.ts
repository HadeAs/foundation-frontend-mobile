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
export interface ReceivingRequest { requestId: string; taskId: string; version: number }
export interface ClearWmsRequest extends ReceivingRequest { object: ContainerRef }
export interface ReceivingReceipt { requestId: string; operationNo: string; affectedCount: number; processedTime: string }
export const receivingApi = {
  query: (scanCode: string) => request<ReceivingResult>('/receiving/tasks', 'GET', { scanCode }),
  getMaterials: (boxCode: string) => request<BoxMaterials>('/boxes/materials', 'GET', { boxCode, context: 'RECEIVING' }),
  confirm: (input: ReceivingRequest) => request<ReceivingReceipt>('/receiving/confirm', 'POST', { ...input }),
  clearWms: (input: ClearWmsRequest) => request<ReceivingReceipt>('/receiving/clear-wms-bindings', 'POST', { ...input })
};
