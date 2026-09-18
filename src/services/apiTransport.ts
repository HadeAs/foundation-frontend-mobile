import { resolveMockRequest } from './mockApi';

// Non-auth APIs default to mock. Login/logout always use uni.request directly.
// Set VITE_API_MODE=real and restart/rebuild to integrate the remaining APIs.
export function isMockApi(): boolean {
  return import.meta.env.VITE_API_MODE !== 'real';
}

export function apiRequest(options: UniNamespace.RequestOptions): UniNamespace.RequestTask {
  if (!isMockApi()) return uni.request({ ...options, success: options.success || (() => {}) });
  let completed = false;
  const timer = setTimeout(() => {
    if (completed) return;
    completed = true;
    const result = resolveMockRequest(options);
    options.success?.(result);
    options.complete?.({ ...result, errMsg: 'request:ok' });
  }, 180);
  return {
    abort() {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      const error = { errMsg: 'request:fail abort' };
      options.fail?.(error);
      options.complete?.(error);
    },
    onHeadersReceived() {},
    offHeadersReceived() {}
  };
}
