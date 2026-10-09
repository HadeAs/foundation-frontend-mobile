import { resolveMockRequest } from '../fixtures/nariBackend';

// Inject only at uni.request in tests, so every service exercises the real transport path.
export function testRequest(options: UniNamespace.RequestOptions): UniNamespace.RequestTask {
  let completed = false;
  const timer = setTimeout(() => {
    if (completed) return;
    completed = true;
    const response = resolveMockRequest(options);
    options.success?.(response);
    options.complete?.({ ...response, errMsg: 'request:ok' });
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
