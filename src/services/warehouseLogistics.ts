import { request } from './nariRequest';
import type { LogisticsOptions, LocationCandidate, TaskCreationResponse } from './logistics';
import type { BoxContents, BoxMaterials } from './warehouseApplication';
import type { ContainerRef } from './locationBinding';

export interface WarehouseLogisticsOptions extends LogisticsOptions {
  recommendedDestination: LocationCandidate;
  boxes: BoxContents[];
  totalMaterialQuantity: number;
}
export interface WarehouseLogisticsRequest {
  requestId: string; scanType: 'VEHICLE' | 'LOCATION'; scanCode: string;
  object: ContainerRef; version: number; destinationLocationCode: string;
}
export const warehouseLogisticsApi = {
  getOptions: (scanCode: string) => request<WarehouseLogisticsOptions>('/warehouse-logistics/options', 'GET', { scanCode }),
  getMaterials: (boxCode: string) => request<BoxMaterials>('/boxes/materials', 'GET', { boxCode, context: 'WAREHOUSE_LOGISTICS' }),
  create: (input: WarehouseLogisticsRequest) => request<TaskCreationResponse>('/warehouse-logistics/tasks', 'POST', { ...input })
};
