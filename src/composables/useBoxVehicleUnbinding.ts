import { computed, ref, shallowRef } from 'vue';
import { boxVehicleBindingApi as api, type DirectVehicleBindings, type DirectUnbindAllRequest,
  type DirectUnbindSelectedRequest } from '../services/boxVehicleBinding';
import { ApiRequestError, requestId } from '../services/nariRequest';

const validText = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 128;
const validVersion = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
function validBindings(value: DirectVehicleBindings) {
  return value && validText(value.vehicle?.vehicleCode) && validText(value.vehicle.displayName) && validVersion(value.vehicle.version) &&
    Array.isArray(value.bindings) && value.bindingCount === value.bindings.length && value.bindings.every((line) => line &&
      validText(line.bindingId) && validVersion(line.bindingVersion) && validText(line.box?.boxCode) &&
      validText(line.box.displayName) && validVersion(line.box.version)) &&
    new Set(value.bindings.map((line) => line.box.boxCode)).size === value.bindings.length &&
    new Set(value.bindings.map((line) => line.bindingId)).size === value.bindings.length;
}

export function useBoxVehicleUnbinding() {
  const vehicle = shallowRef<DirectVehicleBindings | null>(null);
  const selected = ref<string[]>([]);
  const confirmation = ref<'all' | 'selected' | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const bindings = computed(() => vehicle.value?.bindings || []);
  const disabled = computed(() => busy.value || !!confirmation.value);
  const canUnbindAll = computed(() => bindings.value.length > 0 && !disabled.value);
  const canUnbindSelected = computed(() => canUnbindAll.value && selected.value.length > 0 && selected.value.length <= 1000);
  const confirmCount = computed(() => confirmation.value === 'all' ? bindings.value.length : selected.value.length);
  let generation = 0;
  let active = true;
  let attempt: { mode: 'all' | 'selected'; input: DirectUnbindAllRequest | DirectUnbindSelectedRequest; fingerprint: string } | null = null;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++; vehicle.value = null; selected.value = []; confirmation.value = null;
    busy.value = false; notice.value = null; attempt = null;
  }
  function pause() { active = false; clear(); }
  function resume() { active = true; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => active && id === generation); }
    catch (error) { if (active && id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  function toggle(id: string) {
    if (disabled.value || !active || !bindings.value.some((line) => line.bindingId === id)) return;
    if (selected.value.includes(id)) selected.value = selected.value.filter((value) => value !== id);
    else if (selected.value.length >= 1000) notify('一次最多解绑1000箱，请减少本次勾选；整车解绑请使用一键解绑', true);
    else selected.value.push(id);
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    const code = raw.trim();
    if (!validText(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    if (vehicle.value) {
      const line = bindings.value.find((item) => item.box.boxCode === code);
      if (!line) notify('该料箱未在当前料车的直接绑定列表中', true);
      else if (selected.value.includes(line.bindingId)) notify('该料箱已勾选，请勿重复扫描', true);
      else { notice.value = null; toggle(line.bindingId); }
      return;
    }
    await run(async (current) => {
      const result = await api.getVehicle(code);
      if (!current()) return;
      if (!validBindings(result) || result.vehicle.vehicleCode !== code) throw new Error('料车直接绑定信息不完整或与扫描编码不一致，请重新扫描');
      vehicle.value = result;
    });
  }
  function requestUnbind(mode: 'all' | 'selected') {
    if (!active || (mode === 'all' ? !canUnbindAll.value : !canUnbindSelected.value)) return;
    confirmation.value = mode;
  }
  function cancel() { if (!busy.value) confirmation.value = null; }
  async function submit() {
    if (!active || !confirmation.value || !vehicle.value || busy.value) return;
    const mode = confirmation.value;
    const snapshot = vehicle.value;
    const chosen = mode === 'all' ? snapshot.bindings : snapshot.bindings.filter((line) => selected.value.includes(line.bindingId));
    if (!chosen.length || (mode === 'selected' && (chosen.length > 1000 || chosen.length !== selected.value.length))) return;
    const data = { vehicleCode: snapshot.vehicle.vehicleCode, vehicleVersion: snapshot.vehicle.version,
      ...(mode === 'selected' ? { items: chosen.map((line) => ({ bindingId: line.bindingId, bindingVersion: line.bindingVersion,
        boxCode: line.box.boxCode, boxVersion: line.box.version })) } : {}) };
    const fingerprint = JSON.stringify(data);
    const input = attempt?.mode === mode && attempt.fingerprint === fingerprint ? attempt.input : { ...data, requestId: requestId() };
    attempt = { mode, input, fingerprint };
    await run(async (current) => {
      let result;
      try { result = mode === 'all' ? await api.unbindAll(input) : await api.unbindSelected(input as DirectUnbindSelectedRequest); }
      catch (error) {
        // Unknown outcomes reuse the original ID and content on manual retry; explicit rejections start a new request.
        if (attempt?.input.requestId === input.requestId && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      if (!validBindings(result) || 'resultType' in result || result.requestId !== input.requestId || result.vehicle.vehicleCode !== input.vehicleCode ||
        result.vehicle.version <= input.vehicleVersion) throw new Error('解绑回执不完整，请核实后重试原请求');
      const remaining = mode === 'all' ? [] : snapshot.bindings.filter((line) => !chosen.some((item) => item.bindingId === line.bindingId));
      if (result.bindingCount !== remaining.length || remaining.some((line) => !result.bindings.some((item) =>
        item.bindingId === line.bindingId && item.bindingVersion === line.bindingVersion && item.box.boxCode === line.box.boxCode && item.box.version === line.box.version))) {
        throw new Error('解绑回执与本次关系不一致，请核实后重试原请求');
      }
      clear(); notify('料箱解绑成功');
    });
  }
  return { vehicle, bindings, selected, confirmation, busy, disabled, notice, canUnbindAll, canUnbindSelected, confirmCount,
    notify, clear, pause, resume, scan, toggle, requestUnbind, cancel, submit };
}
