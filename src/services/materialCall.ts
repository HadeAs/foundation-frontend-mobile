import { request } from './nariRequest';
import { locationBindingApi, type LocationContainers } from './locationBinding';
import type { LocationSummary } from './locationBinding';
import type { LocationCandidate } from './logistics';
import type { Eligibility } from './panelPacking';

export type MaterialCallLocation = LocationContainers;
export interface MaterialCallBox {
  boxCode: string; version: number; orderNo: string; origin: LocationSummary;
  materialQuantity: number; eligibility: Eligibility;
}
export interface MaterialCallBoxes {
  orderNo: string; destination: LocationCandidate; destinationVersion: number;
  boxes: MaterialCallBox[]; eligibility: Eligibility;
}
export interface MaterialCallRequest {
  requestId: string;
  destinationLocationCode: string;
  destinationVersion: number;
  orderNo: string;
  boxes: Pick<MaterialCallBox, 'boxCode' | 'version'>[];
}
export interface MaterialCallTask {
  boxCode: string; taskId: string; taskNo: string;
  dispatchState: 'QUEUED' | 'DISPATCHED' | 'FAILED' | 'UNKNOWN' | 'COMPLETED' | 'CANCELLED'; reason?: string;
}
export interface MaterialCallReceipt {
  requestId: string; callNo: string; orderNo: string; destination: LocationSummary;
  tasks: MaterialCallTask[]; createdTime: string;
}
export const materialCallApi = {
  getLocation: (locationCode: string) => locationBindingApi.getLocation(locationCode),
  getBoxes: (destinationLocationCode: string, orderNo: string) => request<MaterialCallBoxes>('/order-calls/candidates', 'GET', { destinationLocationCode, orderNo }),
  submit: (data: MaterialCallRequest) => request<MaterialCallReceipt>('/order-calls', 'POST', { ...data })
};
