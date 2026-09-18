import { request, requestId } from './nariRequest';
import type { Binding, Eligibility, PackingBox } from './panelPacking';

export interface Vehicle extends Omit<PackingBox, 'containerType'> { containerType: 'VEHICLE' }
export interface VehicleSlot {
  slotCode: string;
  version: number;
  vehicle: Vehicle;
  box?: PackingBox;
  eligibility: Eligibility;
}
export interface LoadingBox {
  box: PackingBox;
  loadedVehicleCode?: string;
  loadedSlotCode?: string;
  eligibility: Eligibility;
}
export interface LoadPair {
  boxCode: string;
  boxVersion: number;
  slotCode: string;
  slotVersion: number;
}
export interface MaterialLine extends Omit<Binding, 'id' | 'version' | 'bindingMode'> {
  lineType: 'PANEL' | 'QUANTITY';
  orderLineNo?: string;
}
export interface LoadLine {
  slotCode: string;
  slotVersion: number;
  id?: string;
  version?: number;
  box?: PackingBox;
  materials: MaterialLine[];
}
export interface LoadedBox extends LoadLine { id: string; version: number; box: PackingBox }
export interface VehicleLoads {
  vehicle: Vehicle;
  loadedBoxCount: number;
  loads: LoadLine[];
  totalMaterialQuantity: number;
}
interface OperationReceipt { requestId: string; operationNo: string; affectedCount: number; processedTime: string }
export const vehicleLoadingApi = {
  getSlot: (slotCode: string) => request<VehicleSlot>('/vehicle-slots', 'GET', { slotCode }),
  getBox: (boxCode: string) => request<LoadingBox>('/loading/boxes', 'GET', { boxCode }),
  load: (items: LoadPair[]) => request<OperationReceipt>(
    '/loading/batch-load', 'POST', { requestId: requestId(), items }),
  getLoads: (vehicleCode: string) => request<VehicleLoads>('/vehicles/loads', 'GET', { vehicleCode }),
  unloadSelected: (vehicleCode: string, version: number, items: Pick<LoadedBox, 'id' | 'version'>[]) =>
    request<OperationReceipt>('/loading/unload-selected', 'POST', { requestId: requestId(), vehicleCode, version, items }),
  unloadAll: (vehicleCode: string, version: number) =>
    request<OperationReceipt>('/loading/unload-all', 'POST', { requestId: requestId(), vehicleCode, version })
};
