import { ref, shallowRef } from 'vue';
import { getCurrentApiBaseUrl, getCurrentUser } from '../services/auth';
import type { ContainerRef } from '../services/locationBinding';

export interface SubmissionInput { requestId: string; object: ContainerRef; version: number }
export function validSubmission(value: unknown, extraKeys: string[] = []): value is SubmissionInput {
  const input = value as SubmissionInput | null;
  return !!input && typeof input === 'object' && typeof input.requestId === 'string' &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.requestId) &&
    Number.isInteger(input.version) && input.version > 0 && input.version <= 2147483647 &&
    !!input.object && ['BOX', 'VEHICLE'].includes(input.object.containerType) &&
    typeof input.object.containerCode === 'string' && !!input.object.containerCode.trim() && input.object.containerCode.length <= 128 &&
    Object.keys(input.object).every(key => ['containerType', 'containerCode'].includes(key)) &&
    Object.keys(input).every(key => ['requestId', 'object', 'version', ...extraKeys].includes(key));
}

// These external operations may already have committed work when a request fails.
// Keep only the original submission, never credentials or a reconstructed snapshot.
export function usePendingSubmission<T extends SubmissionInput>(name: string, validate: (value: unknown) => value is T) {
  const environment = getCurrentApiBaseUrl();
  const account = getCurrentUser()?.account || '';
  const key = `foundation.${name}.real.${environment}.${account}`;
  const pending = shallowRef<{ input: T; reason: string } | null>(null);
  const storageError = ref('');
  const sameScope = () => environment === getCurrentApiBaseUrl() && account === (getCurrentUser()?.account || '');
  function restore() {
    if (!sameScope()) { storageError.value = '账号或环境已变化，请重新进入页面'; return; }
    try {
      const stored = uni.getStorageSync(key);
      if (stored === '' || stored === null || stored === undefined) pending.value = null;
      else {
        if (!validate(stored.input) || typeof stored.reason !== 'string' || !stored.reason.trim()) throw new Error();
        pending.value = stored;
      }
      storageError.value = '';
    } catch { storageError.value = '无法读取有效的本地操作记录，请保留记录并核实，勿重复提交'; }
  }
  function save(input: T, reason: string) {
    const next = { input: JSON.parse(JSON.stringify(input)) as T, reason };
    try { uni.setStorageSync(key, next); }
    catch { storageError.value = '本地操作记录保存失败，请核实后重新读取记录'; throw new Error(storageError.value); }
    pending.value = next; storageError.value = '';
  }
  function finish(id: string) {
    if (pending.value?.input.requestId !== id) return;
    try {
      const stored = uni.getStorageSync(key);
      if (stored?.input?.requestId === id) uni.setStorageSync(key, null);
    }
    catch { storageError.value = '结果已返回，但本地记录更新失败，请保留原请求并核实'; throw new Error(storageError.value); }
    pending.value = null; storageError.value = '';
  }
  function failed(error: unknown) {
    if (!pending.value) return;
    const reason = error instanceof Error ? error.message : '请求失败，请核实结果';
    pending.value = { ...pending.value, reason };
    if (storageError.value) return;
    try {
      // A late response from an old page must not overwrite a newer operation's record.
      const stored = uni.getStorageSync(key);
      if (stored?.input?.requestId === pending.value.input.requestId) save(pending.value.input, reason);
    } catch { storageError.value = '本地操作记录更新失败，请保留原请求并核实'; }
  }
  restore();
  return { pending, storageError, sameScope, restore, save, finish, failed };
}
