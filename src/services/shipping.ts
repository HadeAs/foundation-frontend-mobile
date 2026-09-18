import { request, requestId } from './nariRequest';
import type { ApplicationObject, BoxMaterials } from './warehouseApplication';
import type { ContainerRef, LocationContainer } from './locationBinding';

export interface ShippingObject extends Omit<ApplicationObject, 'scanType'> { scanType: 'VEHICLE' | 'BOX' | 'LOCATION' }
export interface ShippingRequest {
  requestId: string;
  scanType: ShippingObject['scanType'];
  scanCode: string;
  object: ContainerRef;
  version: number;
}
export interface ShippingReceipt {
  requestId: string;
  shippingNo: string;
  object: LocationContainer;
  canCreateLogisticsTask: boolean;
  processedTime: string;
}
export const shippingApi = {
  getObject: (scanCode: string) => request<ShippingObject>('/shipping/objects', 'GET', { scanCode }),
  getMaterials: (boxCode: string) => request<BoxMaterials>('/boxes/materials', 'GET', { boxCode, context: 'SHIPPING' }),
  submit: (data: ShippingRequest) => request<ShippingReceipt>('/shipping/submit', 'POST', { ...data })
};
export function shippingRequest(target: ShippingObject): ShippingRequest {
  return { requestId: requestId(), scanType: target.scanType, scanCode: target.scanCode,
    object: { containerType: target.object.containerType, containerCode: target.object.containerCode }, version: target.object.version };
}
