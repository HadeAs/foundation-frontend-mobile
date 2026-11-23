import { request } from './nariRequest';

export interface InboundLocation {
  locationCode: string;
  locationName?: string;
  locationVersion: number;
  factoryId?: string;
  lineSideCode?: string;
}
export interface DraftBox {
  boxCode: string;
  boxVersion?: number | null;
  shippingOperationId?: string | null;
  shippingNo?: string | null;
  contentHash?: string | null;
  expectedId?: string | null;
  expectedVersion?: number | null;
  registeredLocationCode?: string | null;
  deliveryMode?: string | null;
  totalQuantity?: number | null;
  allowed: boolean;
  reason?: string | null;
}
interface Preview {
  location: InboundLocation | null;
  allowed: boolean;
  boxes: DraftBox[];
  reason?: string | null;
}
interface ScanResult extends Preview {
  scanType: 'BOX' | 'VEHICLE';
  scanCode: string;
  factoryId: string;
  locationRequired: boolean;
}
export interface BatchItem {
  boxCode: string;
  boxVersion: number;
  shippingOperationId: string;
  contentHash: string;
  expectedId?: string;
  expectedVersion?: number;
}
export interface InboundBatch {
  requestId: string;
  locationCode: string;
  locationVersion: number;
  items: BatchItem[];
}
interface BatchReceipt {
  requestId: string;
  locationCode: string;
  groupKey: string;
  affectedBoxCount: number;
  processedTime: string;
  records: { id: string; groupKey: string; boxCode: string; locationCode: string }[];
}
const base = '/line-side/inbounds';
export const lineSideInboundApi = {
  locations(query: { locationCode?: string; keyword?: string; factoryId?: string }, page = 1) {
    return request<{ records: InboundLocation[]; current: number; pages: number }>(base + '/locations', 'GET', { ...query, page, size: 20 });
  },
  scan(scanCode: string, locationCode?: string) {
    return request<ScanResult>(base + '/scan', 'POST', { scanCode, ...(locationCode && { locationCode }) });
  },
  preview(locationCode: string, boxCodes: string[]) {
    return request<Preview>(base + '/batch-preview', 'POST', { locationCode, boxCodes });
  },
  submit(input: InboundBatch) {
    return request<BatchReceipt>(base + '/batch', 'POST', { ...input });
  }
};

const validVersion = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const validId = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]*$/.test(v);
export function validCode(v: unknown): v is string {
  return typeof v === 'string' && !!v.trim() && v.length <= 128;
}
export function validLocation(value: InboundLocation | null): value is InboundLocation {
  return !!value && validCode(value.locationCode) && validVersion(value.locationVersion);
}
function validItem(value: Partial<DraftBox> | null): value is BatchItem & Partial<DraftBox> {
  return !!value && validCode(value.boxCode) && validVersion(value.boxVersion) && validId(value.shippingOperationId) &&
    typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/.test(value.contentHash) &&
    ((value.expectedId == null && value.expectedVersion == null) || (validId(value.expectedId) && validVersion(value.expectedVersion)));
}
export function readyBox(box: DraftBox): boolean { return box.allowed === true && validItem(box); }
export function batchItem(box: DraftBox): BatchItem {
  if (!box.allowed || !validItem(box)) throw new Error('料箱预检信息不完整，请重新扫描');
  return { boxCode: box.boxCode, boxVersion: box.boxVersion, shippingOperationId: box.shippingOperationId, contentHash: box.contentHash,
    ...(box.expectedId != null && { expectedId: box.expectedId, expectedVersion: box.expectedVersion! }) };
}
export function validBatch(value: unknown): value is InboundBatch {
  const batch = value as InboundBatch | null;
  return !!batch && Object.keys(batch).every(key => ['requestId', 'locationCode', 'locationVersion', 'items'].includes(key)) &&
    typeof batch.requestId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(batch.requestId) &&
    validCode(batch.locationCode) && validVersion(batch.locationVersion) && Array.isArray(batch.items) &&
    batch.items.length > 0 && batch.items.length <= 100 && batch.items.every(item => validItem(item) &&
      Object.keys(item).every(key => ['boxCode', 'boxVersion', 'shippingOperationId', 'contentHash', 'expectedId', 'expectedVersion'].includes(key))) &&
    new Set(batch.items.map(item => item.boxCode)).size === batch.items.length;
}
export function matchesBatch(receipt: BatchReceipt, input: InboundBatch) {
  const remaining = new Set(input.items.map(item => item.boxCode));
  return receipt?.requestId === input.requestId && receipt.locationCode === input.locationCode &&
    typeof receipt.groupKey === 'string' && !!receipt.groupKey.trim() && Number.isFinite(Date.parse(receipt.processedTime)) &&
    receipt.affectedBoxCount === remaining.size && Array.isArray(receipt.records) && receipt.records.length === remaining.size &&
    receipt.records.every(row => row && validId(row.id) && row.locationCode === input.locationCode &&
      row.groupKey === receipt.groupKey && remaining.delete(row.boxCode)) && new Set(receipt.records.map(row => row.id)).size === receipt.records.length;
}
