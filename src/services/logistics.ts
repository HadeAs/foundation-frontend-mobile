import { request } from './nariRequest';
import type { ContainerRef, LocationContainer, LocationSummary } from './locationBinding';
import type { Eligibility } from './panelPacking';

export interface LocationCandidate extends LocationSummary { floorCode: string; floorName: string; areaCode: string; areaName: string }
export interface LogisticsOptions {
  object: LocationContainer;
  origin: LocationSummary;
  vendor: 'STANDARD' | 'HIKVISION';
  taskType: 'GENERAL' | 'PROCESS_ROUTE';
  destinations: { location: LocationCandidate; recommended: boolean }[];
  recommendedDestination?: LocationCandidate;
  eligibility: Eligibility;
}
export interface CreateLogisticsRequest {
  requestId: string;
  object: ContainerRef;
  version: number;
  vendor: LogisticsOptions['vendor'];
  taskType: LogisticsOptions['taskType'];
  originLocationCode: string;
  destinationMode?: 'SPECIFIED';
  destinationLocationCode: string;
  shippingNo?: string;
}
export interface ReturnLogisticsRequest extends Omit<CreateLogisticsRequest, 'destinationMode' | 'destinationLocationCode'> {
  destinationMode: 'RETURN_LINE_SIDE';
  destinationLocationCode?: never;
}
export interface LogisticsTask {
  taskId: string; taskNo: string; version: number;
  vendor: LogisticsOptions['vendor']; taskType: LogisticsOptions['taskType'];
  container: LocationContainer; origin: LocationSummary; destination: LocationSummary;
  agvCode?: string; agvName?: string;
  status: string; statusName: string; triggerMode: string; createdTime: string;
}
export interface TaskCreationResponse { requestId: string; task: LogisticsTask }
export const logisticsApi = {
  getOptions: (scanCode: string) => request<LogisticsOptions>('/logistics/options', 'GET', { scanCode }),
  create: (data: CreateLogisticsRequest) => request<TaskCreationResponse>('/logistics/tasks', 'POST', { ...data }),
  returnToWarehouse: (data: ReturnLogisticsRequest) => request<TaskCreationResponse>('/logistics/tasks', 'POST', { ...data })
};
export function locationPath(location: LocationCandidate): string {
  return `${location.floorName} / ${location.areaName} / ${location.locationName}`;
}
