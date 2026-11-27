import { request } from './nariRequest';

export type LandmarkScope = 'ALL' | 'STANDARD';
export type LandmarkStatus = 'FREE' | 'OCCUPIED' | 'RESERVED' | 'UNKNOWN';

export interface Landmark {
  locationId: string;
  locationCode: string;
  locationName?: string;
  floorNumber: number;
  status: LandmarkStatus;
}

interface LandmarkPage {
  records: Landmark[];
  current: number;
  size: number;
  total: number;
  pages: number;
}

export const landmarkPageSize = 20;
export const landmarkQueryApi = {
  list: (scope: LandmarkScope, floorNumber: number | undefined, page: number) =>
    request<LandmarkPage>('/locations/status', 'GET', {
      scope, ...(floorNumber !== undefined && { floorNumber }), page: String(page), size: String(landmarkPageSize)
    })
};
