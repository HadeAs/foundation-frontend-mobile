import { request, requestId } from './nariRequest';

export interface Eligibility { allowed: boolean; reason?: string }
export interface PackingBox {
  containerType: 'BOX';
  containerCode: string;
  containerName?: string;
  version: number;
}
export interface Panel {
  panelCode: string;
  materialCode: string;
  materialName: string;
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
  materialName: string;
  orderNo: string;
  quantity: number;
  unit: string;
}
export interface BoxBindings {
  box: PackingBox;
  empty: boolean;
  totalQuantity: number;
  bindings: Binding[];
  eligibility: Eligibility;
}
interface BoxReceipt {
  requestId: string;
  operationNo: string;
  affectedCount: number;
  processedTime: string;
  box: { boxCode: string; version: number; materialQuantity: number };
}

export const panelPackingApi = {
  getBox: (boxCode: string) => request<BoxBindings>('/boxes/bindings', 'GET', { boxCode }),
  getPanel: (panelCode: string) => request<Panel>('/panels', 'GET', { panelCode }),
  bindByOrder: (boxCode: string, version: number, orderNo: string, quantity: number) =>
    request<BoxReceipt>('/boxes/bindings/bind-by-order', 'POST', { requestId: requestId(), boxCode, version, orderNo, quantity }),
  getJoint: (pendingPanelCodes: string[]) =>
    request<{ candidates: Panel[] }>('/panels/joint-candidates/query', 'POST', { pendingPanelCodes }),
  unbindAll: (boxCode: string, version: number) =>
    request<BoxReceipt>('/boxes/bindings/unbind-all', 'POST', { requestId: requestId(), boxCode, version }),
  unbindSelected: (boxCode: string, version: number, items: Pick<Binding, 'id' | 'version'>[]) =>
    request<BoxReceipt>('/boxes/bindings/unbind-selected', 'POST', { requestId: requestId(), boxCode, version, items }),
  bind: (boxCode: string, version: number, panelCodes: string[]) =>
    request<BoxReceipt>('/boxes/bindings/bind-by-codes', 'POST', { requestId: requestId(), boxCode, version, panelCodes })
};
