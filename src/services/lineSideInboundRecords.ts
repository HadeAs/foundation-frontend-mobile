import { request } from './nariRequest';

export const inboundModes = { AGV: 'AGV 自动', MANUAL: '人工' } as const;
export const syncStatuses = {
  PENDING: '待同步', SENDING: '发送中', WAIT_CONFIRM: '待确认', SUCCEEDED: '已成功', FAILED: '失败', UNKNOWN: '未知'
} as const;

export interface InboundFilters {
  boxCode?: string;
  inboundMode?: keyof typeof inboundModes;
  syncStatus?: keyof typeof syncStatuses;
  inboundFrom?: string;
  inboundTo?: string;
}
export interface InboundSummary {
  id: string;
  boxCode?: string;
  shippingNo?: string;
  locationCode?: string;
  lineSideCode?: string;
  inboundMode?: keyof typeof inboundModes;
  inboundTime?: string;
  totalQuantity?: number;
  syncStatus?: keyof typeof syncStatuses;
  syncReason?: string;
  syncedTime?: string;
}
export interface InboundSnapshotLine {
  panelCode?: string;
  materialCode?: string;
  materialBatch?: string;
  orderNo?: string;
  quantity?: number;
}
export interface InboundDetail extends InboundSummary {
  materials: InboundSnapshotLine[];
  operatorIdentity?: string;
}
interface InboundPage { records: InboundSummary[]; current: number; size: number; total: number; pages: number }

export const inboundPageSize = 20;
export const lineSideInboundRecordsApi = {
  list: (filters: InboundFilters, page: number) =>
    request<InboundPage>('/line-side/inbounds', 'GET', { ...filters, page, size: inboundPageSize }),
  detail: (id: string) => request<InboundDetail>(`/line-side/inbounds/${encodeURIComponent(id)}`, 'GET', {})
};
