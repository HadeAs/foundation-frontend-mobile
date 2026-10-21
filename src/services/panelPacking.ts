import { request, requestId } from './nariRequest';

export interface Eligibility { allowed: boolean; reason?: string }
export type ContentState = 'UNKNOWN' | 'EMPTY' | 'LOADED';
export interface PackingBox {
  containerType: 'BOX';
  containerCode: string;
  containerName?: string;
  version: number;
  contentState?: ContentState;
  runtimeUsage?: 'MATERIAL' | 'FIXTURE';
}
export interface Panel {
  panelCode: string;
  materialCode: string;
  materialName?: string;
  materialBatch?: string;
  orderNo: string;
  orderLineNo?: string;
  currentBoxCode?: string;
  eligibility: Eligibility;
}
export interface Binding {
  id: string;
  version: number;
  bindingMode: 'BY_CODE' | 'BY_ORDER';
  panelCode?: string;
  materialCode: string;
  materialName?: string;
  materialBatch: string;
  orderNo: string;
  quantity: number;
  unit?: string;
}
export interface BoxBindings {
  box: PackingBox;
  empty: boolean;
  contentState: ContentState;
  runtimeUsage?: 'MATERIAL' | 'FIXTURE';
  totalQuantity: number;
  bindings: Binding[];
  eligibility: Eligibility;
}
export interface BoxReceipt {
  requestId: string;
  affectedCount: number;
  processedTime: string;
  box: { boxCode: string; version: number; materialQuantity: number };
}
export interface BoxBindingConfirmation {
  resultType: 'CONFIRMATION_REQUIRED';
  requestId: string;
  confirmationType: 'MIXED_CONTENT';
  message: string;
  box: PackingBox;
  confirmationToken: string;
}
export interface BoxBindOptions { requestId?: string; confirmMixed?: boolean; confirmationToken?: string }
export type BoxBindingResult = BoxReceipt | BoxBindingConfirmation;

export const panelPackingApi = {
  getBox: (boxCode: string) => request<BoxBindings>('/boxes/bindings', 'GET', { boxCode }),
  getPanel: (panelCode: string) => request<Panel>('/panels', 'GET', { panelCode }),
  bindByOrder: (boxCode: string, version: number, orderNo: string, quantity: number, panelCode: string, options: BoxBindOptions = {}) =>
    request<BoxBindingResult>('/boxes/bindings/bind-by-order', 'POST', { requestId: requestId(), boxCode, version, orderNo, quantity, panelCode, ...options }),
  getJoint: (pendingPanelCodes: string[]) =>
    request<{ candidates: Panel[] }>('/panels/joint-candidates/query', 'POST', { pendingPanelCodes }),
  unbindAll: (boxCode: string, version: number, id = requestId()) =>
    request<BoxReceipt>('/boxes/bindings/unbind-all', 'POST', { requestId: id, boxCode, version }),
  unbindSelected: (boxCode: string, version: number, items: Pick<Binding, 'id' | 'version'>[], id = requestId()) =>
    request<BoxReceipt>('/boxes/bindings/unbind-selected', 'POST', { requestId: id, boxCode, version, items }),
  bind: (boxCode: string, version: number, panelCodes: string[], options: BoxBindOptions = {}) =>
    request<BoxBindingResult>('/boxes/bindings/bind-by-codes', 'POST', { requestId: requestId(), boxCode, version, panelCodes, ...options })
};
