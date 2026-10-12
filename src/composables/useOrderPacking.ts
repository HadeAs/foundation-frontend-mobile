import { computed, ref, shallowRef } from 'vue';
import { panelPackingApi as api, type BoxBindings, type Panel, type BoxBindingConfirmation, type BoxBindOptions, type BoxReceipt } from '../services/panelPacking';
import { ApiRequestError, requestId } from '../services/nariRequest';

const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const integer = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
const optionalText = (value: unknown) => value === undefined || text(value);
function validBox(value: BoxBindings, code: string) {
  return value && value.box?.containerType === 'BOX' && value.box.containerCode === code && integer(value.box.version) &&
    ['EMPTY', 'LOADED', 'UNKNOWN'].includes(value.contentState) && value.empty === (value.contentState === 'EMPTY') &&
    (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) && integer(value.totalQuantity, 0) &&
    typeof value.eligibility?.allowed === 'boolean' && (value.eligibility.allowed || text(value.eligibility.reason, 500)) &&
    Array.isArray(value.bindings) && value.bindings.every(item => item && text(item.id) && integer(item.version) &&
      text(item.materialCode) && text(item.materialBatch) && optionalText(item.materialName) && optionalText(item.unit) && text(item.orderNo) &&
      (item.bindingMode === 'BY_CODE' ? text(item.panelCode) && item.quantity === 1 : item.bindingMode === 'BY_ORDER' && item.panelCode === undefined && integer(item.quantity))) &&
    new Set(value.bindings.map(item => item.id)).size === value.bindings.length &&
    value.totalQuantity === value.bindings.reduce((sum, item) => sum + item.quantity, 0) &&
    (value.contentState !== 'EMPTY' || value.bindings.length === 0);
}
interface OrderInput { boxCode: string; version: number; orderNo: string; quantity: number; panelCode: string; options: BoxBindOptions & { requestId: string } }

export function useOrderPacking() {
  const box = shallowRef<BoxBindings | null>(null);
  const review = shallowRef<BoxBindings | null>(null);
  const representative = shallowRef<Panel | null>(null);
  const order = computed(() => representative.value?.orderNo || '');
  const quantity = ref('');
  const mixed = shallowRef<{ confirmation: BoxBindingConfirmation; input: OrderInput } | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  let generation = 0;
  let active = true;
  let attempt: OrderInput | null = null;
  const disabled = computed(() => busy.value || !!review.value || !!mixed.value);
  const validQuantity = computed(() => /^\d+$/.test(quantity.value) && Number(quantity.value) >= 1 && Number(quantity.value) <= 2147483647);
  const canSubmit = computed(() => !!box.value?.eligibility.allowed && !!representative.value && validQuantity.value && !disabled.value);
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    box.value = review.value = null;
    representative.value = null; quantity.value = ''; mixed.value = null; attempt = null;
    notice.value = null;
    busy.value = false;
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
  function acceptBox(result: BoxBindings) {
    if (result.bindings.some(item => item.bindingMode === 'BY_CODE')) { review.value = result; box.value = null; }
    else box.value = result;
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    const code = raw.trim();
    if (!code || code.length > 128) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      if (!box.value) {
        const result = await api.getBox(code);
        if (!current()) return;
        if (!validBox(result, code)) throw new Error('箱信息不完整，请重新扫描');
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前箱子不允许装箱');
        acceptBox(result);
      } else {
        if (!box.value.eligibility.allowed) throw new Error(box.value.eligibility.reason || '当前箱子不允许装箱');
        if (code.length < 33) throw new Error('代表板件唯一码长度须为33～128个字符，请扫描实际板件码');
        const panel = await api.getPanel(code);
        if (!current()) return;
        if (!panel || panel.panelCode !== code || !text(panel.orderNo) || !text(panel.materialCode) || !optionalText(panel.materialName) ||
          !optionalText(panel.materialBatch)) throw new Error('代表板件信息不完整，请重新扫描');
        // A representative identifies quantity content; it is not added as a per-piece binding.
        representative.value = panel;
      }
    });
  }
  async function unbindAll() {
    const target = review.value;
    if (!target) return;
    await run(async (current) => {
      const receipt = await api.unbindAll(target.box.containerCode, target.box.version);
      if (!current()) return;
      if (!validReceipt(receipt, target.box.containerCode, target.box.version) || receipt.box.materialQuantity !== 0) throw new Error('解绑回执异常，请重新扫描核实');
      review.value = null;
      box.value = { ...target, box: { ...target.box, version: receipt.box.version }, empty: false, contentState: 'UNKNOWN', totalQuantity: 0, bindings: [],
        eligibility: { allowed: false, reason: '解绑已完成，但箱状态未确认，请清空后重新扫描' } };
      let refreshed;
      try { refreshed = await api.getBox(target.box.containerCode); }
      catch (error) { throw new Error(`一键解绑已完成，但最新箱状态查询失败：${error instanceof Error ? error.message : '请重新扫描'}`); }
      if (!current()) return;
      if (!validBox(refreshed, target.box.containerCode) || refreshed.box.version < receipt.box.version) throw new Error('解绑已完成，但最新箱状态不完整，请清空后重新扫描');
      acceptBox(refreshed);
      if (!refreshed.eligibility.allowed) notify(refreshed.eligibility.reason!, true);
    });
  }
  function validReceipt(value: BoxReceipt, code: string, version: number, id?: string) {
    return value && !('resultType' in value) && (id === undefined || value.requestId === id) && text(value.operationNo) &&
      integer(value.affectedCount, 0) && Number.isFinite(Date.parse(value.processedTime)) && value.box?.boxCode === code &&
      integer(value.box.version) && value.box.version > version && integer(value.box.materialQuantity, 0);
  }
  function cancelMixed() { if (!busy.value) { mixed.value = null; attempt = null; } }
  async function send(input: OrderInput) {
    attempt = input;
    await run(async (current) => {
      let result;
      try { result = await api.bindByOrder(input.boxCode, input.version, input.orderNo, input.quantity, input.panelCode, input.options); }
      catch (error) {
        if (attempt === input && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) {
          attempt = null;
          if (current() && error.statusCode === 409) {
            mixed.value = null;
            if (box.value) box.value = { ...box.value, eligibility: { allowed: false, reason: '关系或确认已失效，请清空后重新扫描箱子' } };
            throw new Error(`${error.message}；请清空后重新扫描箱子`);
          }
        }
        throw error;
      }
      if (!current()) return;
      if (result && 'resultType' in result) {
        if (result.resultType !== 'CONFIRMATION_REQUIRED' || result.confirmationType !== 'MIXED_CONTENT' || result.requestId !== input.options.requestId ||
          result.box?.containerType !== 'BOX' || result.box.containerCode !== input.boxCode || result.box.version !== input.version ||
          !text(result.message, 500) || !text(result.confirmationToken, 2048) || 'operationNo' in result || 'affectedCount' in result) {
          throw new Error('混料确认信息不完整，请清空后重新扫描核实');
        }
        mixed.value = { confirmation: result, input }; attempt = null; return;
      }
      if (!validReceipt(result, input.boxCode, input.version, input.options.requestId)) throw new Error('绑定回执不完整，请核实后重试原请求');
      clear();
      notify('装箱成功');
    });
  }
  async function submit() {
    if (disabled.value || !active) return;
    if (!canSubmit.value || !box.value || !representative.value) { notify('请先扫描代表板件码并填写有效数量（1～2147483647的整数）', true); return; }
    const data = { boxCode: box.value.box.containerCode, version: box.value.box.version, orderNo: order.value,
      panelCode: representative.value.panelCode, quantity: Number(quantity.value) };
    const same = attempt && !attempt.options.confirmMixed && attempt.boxCode === data.boxCode && attempt.version === data.version &&
      attempt.orderNo === data.orderNo && attempt.panelCode === data.panelCode && attempt.quantity === data.quantity;
    await send(same ? attempt! : { ...data, options: { requestId: requestId() } });
  }
  async function continueMixed() {
    if (busy.value || !active || !mixed.value) return;
    const { confirmation, input } = mixed.value;
    const same = attempt?.options.confirmMixed === true && attempt.options.confirmationToken === confirmation.confirmationToken;
    await send(same ? attempt! : { ...input, options: { requestId: requestId(), confirmMixed: true, confirmationToken: confirmation.confirmationToken } });
  }
  return { box, review, representative, order, quantity, mixed, busy, disabled, notice, canSubmit,
    notify, clear, pause, resume, scan, unbindAll, submit, cancelMixed, continueMixed };
}
