import { request } from './nariRequest';
import type { LogisticsTask } from './logistics';

export interface LogisticsTaskPage {
  records: LogisticsTask[]; total: number; size: number; current: number; pages: number;
}
export interface CancelTaskRequest { requestId: string; version: number; reason?: string }
export interface CancellationResult {
  requestId: string; taskId: string; taskNo: string;
  cancelStatus: 'ACCEPTED' | 'CANCELLED' | 'FAILED' | 'UNKNOWN';
  processedTime: string; reason?: string;
}
export const logisticsCancellationApi = {
  query: (keyword: string, page: number) => request<LogisticsTaskPage>('/logistics/cancellable-tasks', 'GET', { ...(keyword ? { keyword } : {}), page, size: 20 }),
  cancel: (taskId: string, input: CancelTaskRequest) => request<CancellationResult>(`/logistics/tasks/${encodeURIComponent(taskId)}/cancel`, 'POST', { ...input }),
  result: (taskId: string, requestId: string) => request<CancellationResult>(`/logistics/tasks/${encodeURIComponent(taskId)}/cancellation`, 'GET', { requestId })
};

export function triggerModeName(mode: string): string {
  return mode === 'MANUAL' ? '人工发起' : mode;
}
