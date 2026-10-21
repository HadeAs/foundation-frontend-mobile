import { computed, ref, shallowRef } from 'vue';
import { panelPackingApi as api, type BoxBindings, type Binding } from '../services/panelPacking';
import { ApiRequestError, requestId } from '../services/nariRequest';

const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const integer = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
const optionalText = (value: unknown) => value === undefined || text(value);
function validBox(value: BoxBindings, code: string) {
  return value && value.box?.containerType === 'BOX' && value.box.containerCode === code && integer(value.box.version) &&
    ['EMPTY', 'LOADED', 'UNKNOWN'].includes(value.contentState) && value.empty === (value.contentState === 'EMPTY') &&
    (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) && integer(value.totalQuantity, 0) &&
    typeof value.eligibility?.allowed === 'boolean' && (value.eligibility.allowed || text(value.eligibility.reason, 500)) &&
    Array.isArray(value.bindings) && value.bindings.every(item => item && text(item.id, 20) && /^[1-9][0-9]{0,18}$/.test(item.id) && integer(item.version) &&
      text(item.materialCode) && text(item.materialBatch) && optionalText(item.materialName) && optionalText(item.unit) && text(item.orderNo) &&
      (item.bindingMode === 'BY_CODE' ? text(item.panelCode) && item.quantity === 1 : item.bindingMode === 'BY_ORDER' && item.panelCode === undefined && integer(item.quantity))) &&
    new Set(value.bindings.map(item => item.id)).size === value.bindings.length &&
    value.totalQuantity === value.bindings.reduce((sum, item) => sum + item.quantity, 0) &&
    (value.contentState !== 'EMPTY' || value.bindings.length === 0);
}
interface UnbindInput { mode: 'all' | 'selected'; boxCode: string; version: number; items: Pick<Binding, 'id' | 'version'>[]; requestId: string }

export function usePanelUnbinding() {
  const box = shallowRef<BoxBindings | null>(null);
  const selected = ref<string[]>([]);
  const confirmation = ref<'all' | 'selected' | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!confirmation.value);
  const canUnbindAll = computed(() => !!box.value?.eligibility.allowed && box.value.bindings.length > 0 && !disabled.value);
  const canUnbindSelected = computed(() => canUnbindAll.value && selected.value.length > 0 && selected.value.length <= 1000);
  const confirmCount = computed(() => confirmation.value === 'all' ? box.value?.bindings.length || 0 : selected.value.length);
  let generation = 0;
  let active = true;
  let attempt: { input: UnbindInput; fingerprint: string } | null = null;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    box.value = null;
    selected.value = [];
    confirmation.value = null;
    busy.value = false;
    notice.value = null;
    attempt = null;
  }
  function pause() { active = false; clear(); }
  function resume() { active = true; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    const id = generation;
    busy.value = true;
    notice.value = null;
    try { await action(() => active && id === generation); }
    catch (error) { if (active && id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  function toggle(id: string) {
    if (disabled.value || !active || !box.value?.eligibility.allowed || !box.value.bindings.some((item) => item.id === id)) return;
    if (selected.value.includes(id)) selected.value = selected.value.filter((value) => value !== id);
    else if (selected.value.length >= 1000) notify('每次最多解绑1000条所选记录；整箱解绑请使用全部解绑', true);
    else selected.value.push(id);
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    const code = raw.trim();
    if (!code || code.length > 128) { notify('请输入有效编码（最多128个字符）', true); return; }
    if (box.value) {
      if (!box.value.eligibility.allowed) { notify(box.value.eligibility.reason!, true); return; }
      const item = box.value.bindings.find((row) => row.bindingMode === 'BY_CODE' && row.panelCode === code);
      if (!item) notify('该板件未在当前箱的已绑定列表中', true);
      else if (selected.value.includes(item.id)) notify('该板件已勾选，请勿重复扫描', true);
      else { notice.value = null; toggle(item.id); }
      return;
    }
    await run(async (current) => {
      const result = await api.getBox(code);
      if (!current()) return;
      if (!validBox(result, code)) {
        throw new Error('箱内绑定信息不完整，请重新扫描');
      }
      box.value = result;
      if (!result.eligibility.allowed) notify(result.eligibility.reason!, true);
    });
  }
  function requestUnbind(mode: 'all' | 'selected') {
    if (!active || (mode === 'all' ? !canUnbindAll.value : !canUnbindSelected.value)) return;
    confirmation.value = mode;
  }
  function cancel() { if (!busy.value) confirmation.value = null; }
  async function submit() {
    if (!active || !confirmation.value || !box.value?.eligibility.allowed || busy.value) return;
    const mode = confirmation.value;
    const target = box.value;
    const chosen = mode === 'all' ? target.bindings : target.bindings.filter((item) => selected.value.includes(item.id));
    if (!chosen.length || (mode === 'selected' && (chosen.length > 1000 || chosen.length !== selected.value.length))) return;
    const data = { mode, boxCode: target.box.containerCode, version: target.box.version,
      items: mode === 'all' ? [] : chosen.map(({ id, version }) => ({ id, version })) };
    const fingerprint = JSON.stringify(data);
    const input = attempt?.fingerprint === fingerprint ? attempt.input : { ...data, requestId: requestId() };
    attempt = { input, fingerprint };
    const remainingQuantity = target.totalQuantity - chosen.reduce((sum, item) => sum + item.quantity, 0);
    await run(async (current) => {
      let result;
      try { result = mode === 'all' ? await api.unbindAll(input.boxCode, input.version, input.requestId) :
        await api.unbindSelected(input.boxCode, input.version, input.items, input.requestId); }
      catch (error) {
        // Only explicit rejections start a new manual request; an unknown outcome replays the original input.
        if (attempt?.input.requestId === input.requestId && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      if (!result || 'resultType' in result || result.requestId !== input.requestId ||
        !integer(result.affectedCount, 0) || result.affectedCount !== chosen.length || typeof result.processedTime !== 'string' || !Number.isFinite(Date.parse(result.processedTime)) ||
        result.box?.boxCode !== input.boxCode || !integer(result.box.version) || result.box.version <= input.version ||
        !integer(result.box.materialQuantity, 0) || result.box.materialQuantity !== remainingQuantity) {
        throw new Error('解绑回执与本次关系不一致，请核实后重试原请求');
      }
      clear();
      notify('解绑成功');
    });
  }
  return { box, selected, confirmation, busy, disabled, notice, canUnbindAll, canUnbindSelected, confirmCount,
    notify, clear, pause, resume, scan, toggle, requestUnbind, cancel, submit };
}
