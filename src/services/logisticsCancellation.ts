import { ApiRequestError, request } from './nariRequest';
import type { LogisticsTask } from './logistics';
import type { LocationOperation } from './locationBinding';

export interface LogisticsTaskPage {
  records: LogisticsTask[]; total: number; size: number; current: number; pages: number;
}
export interface CancelTaskRequest { requestId: string; version: number; reason?: string; unbindContext?: LocationOperation }
export interface CancellationResult {
  requestId: string; taskId: string; taskNo: string;
  // ACCEPTED also covers internal SENDING; it does not prove vendor acceptance.
  cancelStatus: 'ACCEPTED' | 'CANCELLED' | 'FAILED' | 'UNKNOWN';
  processedTime: string; reason?: string;
}
export const cancellationPendingMessage = '取消请求处理中，最终结果待确认，不代表调度已受理';
export function cancellationQueryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '取消结果查询失败，请刷新结果';
  return error instanceof ApiRequestError && error.statusCode === 404
    ? `${message}；未查到可信取消结果，不代表未发送或已过期，请保留原请求核实，勿重复取消`
    : message;
}
export const logisticsCancellationApi = {
  query: (keyword: string, page: number) => request<LogisticsTaskPage>('/logistics/cancellable-tasks', 'GET', { ...(keyword ? { keyword } : {}), page, size: 20 }),
  cancel: (taskId: string, input: CancelTaskRequest) => request<CancellationResult>(`/logistics/tasks/${encodeURIComponent(taskId)}/cancel`, 'POST', { ...input }),
  result: (taskId: string, requestId: string) => request<CancellationResult>(`/logistics/tasks/${encodeURIComponent(taskId)}/cancellation`, 'GET', { requestId })
};

export function triggerModeName(mode: string): string {
  return mode === 'MANUAL' ? '人工发起' : mode;
}
