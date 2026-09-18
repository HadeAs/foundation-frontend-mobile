import { request } from './nariRequest';

export type TrafficStatus = 'FREE' | 'OCCUPIED';
export type TrafficAction = 'lock' | 'release';
export interface TrafficArea {
  areaCode: string; areaName: string; version: number; status: TrafficStatus;
  lastOperatorName?: string; lastOperationTime?: string;
}
export interface TrafficFilters { keyword?: string; status?: TrafficStatus }
export interface TrafficPage { records: TrafficArea[]; total: number; size: number; current: number; pages: number }
export interface TrafficActionRequest { requestId: string; version: number }

export const trafficApi = {
  query: (filters: TrafficFilters, page: number) => request<TrafficPage>('/traffic/areas', 'GET', { ...filters, page, size: 20 }),
  act: (areaCode: string, action: TrafficAction, input: TrafficActionRequest) =>
    request<TrafficArea>(`/traffic/areas/${encodeURIComponent(areaCode)}/${action}`, 'POST', { ...input })
};
