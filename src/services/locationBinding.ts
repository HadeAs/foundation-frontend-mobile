import { request, requestId } from './nariRequest';
import type { Eligibility, PackingBox } from './panelPacking';

export interface LocationSummary {
  locationCode: string;
  locationName: string;
  locationType?: string;
  floorCode?: string;
  floorName?: string;
  areaCode?: string;
  areaName?: string;
}
export interface LocationContainer extends Omit<PackingBox, 'containerType'> {
  containerType: 'BOX' | 'VEHICLE';
  location?: LocationSummary;
}
export type ContainerRef = Pick<LocationContainer, 'containerType' | 'containerCode'>;
export interface LocationContainers {
  location: LocationSummary;
  version: number;
  occupied: boolean;
  container?: LocationContainer;
  eligibility: Eligibility;
}
export interface ContainerCandidate { container: LocationContainer; eligibility: Eligibility }
export interface LocationOperation {
  locationCode: string;
  version: number;
  container: ContainerRef;
  containerVersion: number;
}
interface OperationReceipt { requestId: string; operationNo: string; affectedCount: number; processedTime: string }
export const locationBindingApi = {
  getLocation: (locationCode: string) => request<LocationContainers>('/locations/containers', 'GET', { locationCode }),
  getContainer: (scanCode: string) => request<ContainerCandidate>('/locations/container-candidates', 'GET', { scanCode }),
  bind: (data: LocationOperation) => request<OperationReceipt>('/locations/bind-container', 'POST', { ...data, requestId: requestId() }),
  unbind: (data: LocationOperation) => request<OperationReceipt>('/locations/unbind-container', 'POST', { ...data, requestId: requestId() })
};
