import { request, requestId } from './nariRequest';
import type { LocationContainer, ContainerRef } from './locationBinding';
import type { Eligibility } from './panelPacking';
import type { MaterialLine } from './vehicleLoading';

export interface BoxContents { boxCode: string; version: number; materialQuantity: number; materials: MaterialLine[] }
export interface ApplicationObject {
  scanType: 'VEHICLE' | 'BOX';
  scanCode: string;
  object: LocationContainer;
  boxes: BoxContents[];
  totalMaterialQuantity: number;
  eligibility: Eligibility;
}
export interface BoxMaterials {
  box: LocationContainer;
  sourceSystem: 'LES' | 'WMS';
  materials: MaterialLine[];
  totalQuantity: number;
}
export interface ApplicationReceipt {
  requestId: string;
  applicationNo: string;
  sapDocumentNos: string[];
  wmsPendingCreated: boolean;
  processedTime: string;
}
export const warehouseApplicationApi = {
  getObject: (scanCode: string) => request<ApplicationObject>('/warehouse-applications/objects', 'GET', { scanCode }),
  getMaterials: (boxCode: string) => request<BoxMaterials>('/boxes/materials', 'GET', { boxCode, context: 'WAREHOUSE_APPLICATION' }),
  submit: (object: ContainerRef, version: number) =>
    request<ApplicationReceipt>('/warehouse-applications/submit', 'POST', { requestId: requestId(), object, version })
};
