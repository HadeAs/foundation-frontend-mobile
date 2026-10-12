import { computed, ref, shallowRef } from 'vue';
import { boxVehicleBindingApi as api, type DirectVehicleBindings, type DirectBoxCandidate, type DirectBindingReceipt,
  type DirectBindRequest, type DirectUnbindAllRequest } from '../services/boxVehicleBinding';
import { ApiRequestError, requestId } from '../services/nariRequest';

const validText = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const validVersion = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
function validBindings(value: DirectVehicleBindings) {
  return value && validText(value.vehicle?.vehicleCode) && validText(value.vehicle.displayName) && validVersion(value.vehicle.version) &&
    Array.isArray(value.bindings) && value.bindingCount === value.bindings.length && value.bindings.every((line) => line &&
      validText(line.bindingId) && validVersion(line.bindingVersion) && validText(line.box?.boxCode) &&
      validText(line.box.displayName) && validVersion(line.box.version)) &&
    new Set(value.bindings.map((line) => line.box.boxCode)).size === value.bindings.length &&
    new Set(value.bindings.map((line) => line.bindingId)).size === value.bindings.length;
}

export function useBoxVehicleBinding() {
  const vehicle = shallowRef<DirectVehicleBindings | null>(null);
  const review = shallowRef<DirectVehicleBindings | null>(null);
  const rebind = shallowRef<DirectBoxCandidate | null>(null);
  const pending = ref<DirectBoxCandidate[]>([]);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!review.value || !!rebind.value);
  const canSubmit = computed(() => !!vehicle.value && pending.value.length > 0 && pending.value.length <= 1000 && !disabled.value);
  let generation = 0;
  let active = true;
  // Retry an uncertain mutation with its original ID and unchanged content, never automatically.
  let attempt: { action: 'bind' | 'unbind'; data: DirectBindRequest | DirectUnbindAllRequest; fingerprint: string } | null = null;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++; vehicle.value = null; review.value = null; rebind.value = null;
    pending.value = []; notice.value = null; busy.value = false; attempt = null;
  }
  function pause() { active = false; clear(); }
  function resume() { active = true; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => active && id === generation); }
    catch (error) { if (active && id === generation) notify(error instanceof Error ? error.message : '操作失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  function known(code: string) {
    return vehicle.value?.bindings.some((line) => line.box.boxCode === code) || pending.value.some((item) => item.box.boxCode === code);
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    const code = raw.trim();
    if (!validText(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      if (!vehicle.value) {
        const result = await api.getVehicle(code);
        if (!current()) return;
        if (!validBindings(result) || result.vehicle.vehicleCode !== code) throw new Error('料车信息不完整或与扫描编码不一致，请重新扫描');
        if (result.bindingCount) review.value = result;
        else vehicle.value = result;
      } else {
        if (vehicle.value.bindings.some((line) => line.box.boxCode === code)) throw new Error('已绑定当前料车，本次扫描无效');
        if (known(code)) throw new Error('该料箱已在列表中，请勿重复扫描');
        if (pending.value.length >= 1000) throw new Error('本次待绑定已达1000箱接口上限，请先确认绑定');
        const target = vehicle.value.vehicle;
        const result = await api.getBox(target.vehicleCode, code);
        if (!current()) return;
        if (!result || result.vehicle?.vehicleCode !== target.vehicleCode || result.vehicle.version !== target.version ||
          !validText(result.vehicle.displayName) || result.box?.boxCode !== code || !validText(result.box.displayName) ||
          !validVersion(result.box.version) || typeof result.eligibility?.allowed !== 'boolean' || typeof result.requiresRebindConfirmation !== 'boolean') {
          throw new Error('料箱信息不完整或料车信息已变化，请清空后重新扫描');
        }
        if (!result.eligibility.allowed) {
          if (!validText(result.eligibility.reason, 500)) throw new Error('料箱不可绑定原因不完整，请重新扫描');
          throw new Error(result.eligibility.reason);
        }
        if (result.currentBinding === null && result.currentVehicle === null && !result.requiresRebindConfirmation) {
          pending.value.push(result);
        } else if (result.currentBinding && result.currentVehicle && result.requiresRebindConfirmation &&
          validText(result.currentBinding.bindingId) && validVersion(result.currentBinding.bindingVersion) &&
          result.currentBinding.vehicleCode === result.currentVehicle.vehicleCode && validText(result.currentVehicle.vehicleCode) &&
          validText(result.currentVehicle.displayName) && validVersion(result.currentVehicle.version) && result.currentVehicle.vehicleCode !== target.vehicleCode) {
          rebind.value = result;
        } else throw new Error('料箱所属关系不完整或与当前料车冲突，请重新扫描');
      }
    });
  }
  function keepBindings() { if (active && !busy.value && review.value) { vehicle.value = review.value; review.value = null; } }
  function chooseRebind(accept: boolean) {
    if (!active || busy.value || !rebind.value) return;
    if (accept) pending.value.push(rebind.value);
    rebind.value = null;
  }
  function remove(code: string) { if (active && !disabled.value) pending.value = pending.value.filter((item) => item.box.boxCode !== code); }
  function mutationInput<T extends DirectBindRequest | DirectUnbindAllRequest>(action: 'bind' | 'unbind', data: Omit<T, 'requestId'>): T {
    const fingerprint = JSON.stringify(data);
    if (attempt?.action === action && attempt.fingerprint === fingerprint) return attempt.data as T;
    const input = { ...data, requestId: requestId() } as T;
    attempt = { action, data: input, fingerprint };
    return input;
  }
  async function mutate(input: DirectBindRequest | DirectUnbindAllRequest, action: 'bind' | 'unbind') {
    try { return action === 'bind' ? await api.bind(input as DirectBindRequest) : await api.unbindAll(input); }
    catch (error) {
      if (attempt?.data.requestId === input.requestId && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
      throw error;
    }
  }
  function ensureReceipt(result: DirectBindingReceipt, input: DirectUnbindAllRequest) {
    if (!validBindings(result) || 'resultType' in result || result.requestId !== input.requestId || result.vehicle.vehicleCode !== input.vehicleCode ||
      result.vehicle.version <= input.vehicleVersion) throw new Error('操作回执异常，请核实后重试原请求');
  }
  async function unbindAll() {
    if (!active || busy.value || !review.value) return;
    const selected = review.value;
    await run(async (current) => {
      const input = mutationInput<DirectUnbindAllRequest>('unbind', { vehicleCode: selected.vehicle.vehicleCode, vehicleVersion: selected.vehicle.version });
      const result = await mutate(input, 'unbind');
      if (!current()) return;
      ensureReceipt(result, input);
      if (result.bindingCount !== 0) throw new Error('解绑回执未返回空列表，请核实后重试原请求');
      attempt = null; vehicle.value = result; review.value = null;
      notify('一键解绑成功，可继续扫描料箱');
    });
  }
  async function submit() {
    if (!active || !canSubmit.value) return;
    const snapshot = vehicle.value!;
    const target = snapshot.vehicle;
    await run(async (current) => {
      const input = mutationInput<DirectBindRequest>('bind', { vehicleCode: target.vehicleCode, vehicleVersion: target.version,
        items: pending.value.map((item) => ({ boxCode: item.box.boxCode, boxVersion: item.box.version,
          expectedBinding: item.currentBinding, confirmRebind: item.requiresRebindConfirmation })) });
      const result = await mutate(input, 'bind');
      if (!current()) return;
      ensureReceipt(result, input);
      if (result.bindingCount !== snapshot.bindingCount + input.items.length ||
        snapshot.bindings.some(item => !result.bindings.some(line => line.bindingId === item.bindingId && line.bindingVersion === item.bindingVersion &&
          line.box.boxCode === item.box.boxCode && line.box.version === item.box.version)) ||
        input.items.some(item => !result.bindings.some(line => line.box.boxCode === item.boxCode && line.box.version > item.boxVersion &&
          (!item.expectedBinding || line.bindingId !== item.expectedBinding.bindingId || line.bindingVersion > item.expectedBinding.bindingVersion)))) {
        throw new Error('绑定回执缺少本次料箱或关系不一致，请核实后重试原请求');
      }
      clear(); notify('料箱绑车成功');
    });
  }
  return { vehicle, review, rebind, pending, busy, disabled, notice, canSubmit, notify, clear, pause, resume,
    scan, keepBindings, chooseRebind, remove, unbindAll, submit };
}
