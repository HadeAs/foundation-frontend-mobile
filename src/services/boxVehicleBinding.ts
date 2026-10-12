import { request } from './nariRequest';
import type { Eligibility } from './panelPacking';

export interface DirectVehicle { vehicleCode: string; displayName: string; version: number }
export interface DirectBox { boxCode: string; displayName: string; version: number }
export interface DirectBindingSnapshot { bindingId: string; bindingVersion: number; vehicleCode: string }
export interface DirectBindingLine { bindingId: string; bindingVersion: number; box: DirectBox }
export interface DirectVehicleBindings { vehicle: DirectVehicle; bindings: DirectBindingLine[]; bindingCount: number }
export interface DirectBoxCandidate {
  vehicle: DirectVehicle;
  box: DirectBox;
  currentBinding: DirectBindingSnapshot | null;
  currentVehicle: DirectVehicle | null;
  requiresRebindConfirmation: boolean;
  eligibility: Eligibility;
}
export interface DirectBindItem {
  boxCode: string; boxVersion: number; expectedBinding: DirectBindingSnapshot | null; confirmRebind: boolean;
}
export interface DirectBindRequest { requestId: string; vehicleCode: string; vehicleVersion: number; items: DirectBindItem[] }
export interface DirectUnbindAllRequest { requestId: string; vehicleCode: string; vehicleVersion: number }
export interface DirectUnbindSelectedItem { bindingId: string; bindingVersion: number; boxCode: string; boxVersion: number }
export interface DirectUnbindSelectedRequest extends DirectUnbindAllRequest { items: DirectUnbindSelectedItem[] }
export interface DirectBindingReceipt extends DirectVehicleBindings { requestId: string }

const path = '/vehicles/direct-bindings';
export const boxVehicleBindingApi = {
  getVehicle: (scanCode: string) => request<DirectVehicleBindings>(path, 'GET', { scanCode }),
  getBox: (vehicleCode: string, scanCode: string) => request<DirectBoxCandidate>(`${path}/box-candidates`, 'GET', { vehicleCode, scanCode }),
  bind: (data: DirectBindRequest) => request<DirectBindingReceipt>(`${path}/bind`, 'POST', { ...data }),
  unbindAll: (data: DirectUnbindAllRequest) => request<DirectBindingReceipt>(`${path}/unbind-all`, 'POST', { ...data }),
  unbindSelected: (data: DirectUnbindSelectedRequest) => request<DirectBindingReceipt>(`${path}/unbind-selected`, 'POST', { ...data })
};
