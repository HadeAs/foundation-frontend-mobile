// Always use the platform transport. Tests replace uni.request, never this runtime path.
export function apiRequest(options: UniNamespace.RequestOptions): UniNamespace.RequestTask {
  return uni.request({ ...options, success: options.success || (() => {}) });
}
