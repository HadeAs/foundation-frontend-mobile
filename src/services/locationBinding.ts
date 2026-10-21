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
export interface RelatedTransportTask {
  taskId: string;
  taskNo: string;
  version: number;
  status: 'QUEUED' | 'DISPATCHING' | 'ACCEPTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  settled: boolean;
  cancellationEligibility: Eligibility;
}
export interface LocationContainers {
  location: LocationSummary;
  version: number;
  occupied: boolean;
  container?: LocationContainer;
  eligibility: Eligibility;
  relatedTasks: RelatedTransportTask[];
  unbindEligibility: Eligibility;
}
export interface ContainerCandidate { container: LocationContainer; eligibility: Eligibility }
export interface LocationOperation {
  locationCode: string;
  version: number;
  container: ContainerRef;
  containerVersion: number;
}
interface OperationReceipt { requestId: string; affectedCount: number; processedTime: string }
export const locationBindingApi = {
  getLocation: (locationCode: string) => request<LocationContainers>('/locations/containers', 'GET', { locationCode }),
  getContainer: (scanCode: string) => request<ContainerCandidate>('/locations/container-candidates', 'GET', { scanCode }),
  bind: (data: LocationOperation, id = requestId()) => request<OperationReceipt>('/locations/bind-container', 'POST', { ...data, requestId: id }),
  unbind: (data: LocationOperation, id = requestId()) => request<OperationReceipt>('/locations/unbind-container', 'POST', { ...data, requestId: id })
};
