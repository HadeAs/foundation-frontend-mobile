import { request } from './nariRequest';
import type { LocationCandidate, TaskCreationResponse } from './logistics';
import type { LocationSummary } from './locationBinding';
import type { Vehicle } from './vehicleLoading';

export interface EmptyVehicleOrigin { origin: LocationCandidate; vehicle: Vehicle }
export interface EmptyVehicleOptions { destination: LocationSummary; origins: EmptyVehicleOrigin[] }
export interface CallEmptyVehicleRequest {
  requestId: string; originLocationCode: string; destinationLocationCode: string; vehicleCode: string; version: number;
}
export const emptyVehicleApi = {
  getOrigins: (destinationLocationCode: string) => request<EmptyVehicleOptions>('/empty-vehicles/origins', 'GET', { destinationLocationCode }),
  call: (input: CallEmptyVehicleRequest) => request<TaskCreationResponse>('/empty-vehicles/call', 'POST', { ...input })
};
