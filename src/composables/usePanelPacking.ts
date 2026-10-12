import { computed, ref, shallowRef } from 'vue';
import { panelPackingApi, type BoxBindings, type Panel, type BoxBindingConfirmation, type BoxBindOptions, type BoxReceipt } from '../services/panelPacking';
import { ApiRequestError, requestId } from '../services/nariRequest';

const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const integer = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
const optionalText = (value: unknown) => value === undefined || text(value);
function validBox(value: BoxBindings, code: string) {
  return value && value.box?.containerType === 'BOX' && value.box.containerCode === code && integer(value.box.version) &&
    ['EMPTY', 'LOADED', 'UNKNOWN'].includes(value.contentState) && value.empty === (value.contentState === 'EMPTY') &&
    (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage)) && integer(value.totalQuantity, 0) &&
    typeof value.eligibility?.allowed === 'boolean' && (value.eligibility.allowed || text(value.eligibility.reason, 500)) &&
    Array.isArray(value.bindings) && value.bindings.every((item) => item && text(item.id) && integer(item.version) &&
      text(item.materialCode) && text(item.materialBatch) && optionalText(item.materialName) && optionalText(item.unit) && text(item.orderNo) &&
      (item.bindingMode === 'BY_CODE' ? text(item.panelCode) && item.quantity === 1 : item.bindingMode === 'BY_ORDER' && item.panelCode === undefined && integer(item.quantity))) &&
    new Set(value.bindings.map((item) => item.id)).size === value.bindings.length &&
    value.totalQuantity === value.bindings.reduce((sum, item) => sum + item.quantity, 0) &&
    (value.contentState !== 'EMPTY' || value.bindings.length === 0);
}
interface BindInput { boxCode: string; version: number; panelCodes: string[]; options: BoxBindOptions & { requestId: string } }

export function usePanelPacking() {
  const box = shallowRef<BoxBindings | null>(null);
  const review = shallowRef<BoxBindings | null>(null);
  const pending = ref<Panel[]>([]);
  const mixed = shallowRef<{ confirmation: BoxBindingConfirmation; input: BindInput } | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!review.value || !!mixed.value);
  const canStage = computed(() => !!box.value?.eligibility.allowed && !box.value.bindings.some((item) => item.bindingMode === 'BY_ORDER'));
  const canJoint = computed(() => canStage.value && pending.value.length > 0 && !disabled.value);
  const canSubmit = computed(() => canJoint.value && pending.value.length <= 1000);
  let generation = 0;
  let active = true;
  let attempt: BindInput | null = null;

  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    box.value = null;
    review.value = null;
    pending.value = [];
    mixed.value = null;
    attempt = null;
    notice.value = null;
    busy.value = false;
  }
  function pause() { active = false; clear(); }
  function resume() { active = true; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    busy.value = true;
    notice.value = null;
    const id = generation;
    try {
      await action(() => active && id === generation);
    } catch (error) {
      if (active && id === generation) notify(error instanceof Error ? error.message : '操作失败，请重试', true);
    } finally {
      if (id === generation) busy.value = false;
    }
  }
  function ensurePanel(panel: Panel) {
    if (!panel || !text(panel.panelCode) || !text(panel.materialCode) || !text(panel.orderNo) ||
      !optionalText(panel.materialName) || !optionalText(panel.materialBatch)) throw new Error('板件信息不完整，请联系管理员');
    if (!panel.eligibility?.allowed) throw new Error(panel.eligibility?.reason || '当前板件不可绑定');
    if (panel.currentBoxCode) throw new Error(`板件已绑定至箱 ${panel.currentBoxCode}`);
  }
  function knownCodes() {
    return new Set([...box.value!.bindings.map((item) => item.panelCode), ...pending.value.map((item) => item.panelCode)]);
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
    const code = raw.trim();
    if (!code) return;
    if (code.length > 128) { notify('编码长度不能超过 128 个字符', true); return; }
    await run(async (current) => {
      if (!box.value) {
        const result = await panelPackingApi.getBox(code);
        if (!current()) return;
        if (!validBox(result, code)) {
          throw new Error('箱信息不完整或与扫描编码不一致，请联系管理员');
        }
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前箱不可装箱');
        if (result.bindings.length) review.value = result;
        else box.value = result;
      } else {
        if (!canStage.value) throw new Error(box.value.eligibility.reason || '当前箱使用数量绑箱，请先一键解绑后再扫码绑箱');
        if (knownCodes().has(code)) throw new Error('该板件已在列表中，请勿重复扫描');
        if (pending.value.length >= 1000) throw new Error('本次待绑定已达 1000 条接口上限，请先确认装箱');
        const panel = await panelPackingApi.getPanel(code);
        if (!current()) return;
        if (panel?.panelCode !== code) throw new Error('板件信息与扫描编码不一致，请重新扫描');
        if (knownCodes().has(panel.panelCode)) throw new Error('该板件已在列表中，请勿重复扫描');
        ensurePanel(panel);
        pending.value.push(panel);
      }
    });
  }
  function keepBindings() {
    if (busy.value || !review.value) return;
    box.value = review.value;
    review.value = null;
    if (!canStage.value) notify('当前箱使用数量绑箱，请先一键解绑后再扫码绑箱', true);
  }
  function validReceipt(value: BoxReceipt, code: string, version: number, id?: string) {
    return value && !('resultType' in value) && (id === undefined || value.requestId === id) && text(value.operationNo) &&
      integer(value.affectedCount, 0) && Number.isFinite(Date.parse(value.processedTime)) &&
      value.box?.boxCode === code && integer(value.box.version) && value.box.version > version && integer(value.box.materialQuantity, 0);
  }
  async function unbindAll() {
    if (!review.value) return;
    const selected = review.value;
    await run(async (current) => {
      const result = await panelPackingApi.unbindAll(selected.box.containerCode, selected.box.version);
      if (!current()) return;
      if (!validReceipt(result, selected.box.containerCode, selected.box.version) || result.box.materialQuantity !== 0) {
        throw new Error('解绑回执异常，请清空后重新扫描核实');
      }
      // No panel relationships is not proof of physical emptiness, especially for fixture boxes.
      review.value = null;
      box.value = { ...selected, box: { ...selected.box, version: result.box.version }, bindings: [], empty: false, contentState: 'UNKNOWN', totalQuantity: 0,
        eligibility: { allowed: false, reason: '解绑已完成，但箱状态未确认，请清空后重新扫描' } };
      let refreshed;
      try { refreshed = await panelPackingApi.getBox(selected.box.containerCode); }
      catch (error) { throw new Error(`一键解绑已完成，但最新箱状态查询失败：${error instanceof Error ? error.message : '请清空后重新扫描'}`); }
      if (!current()) return;
      if (!validBox(refreshed, selected.box.containerCode) || refreshed.box.version < result.box.version) throw new Error('解绑已完成，但最新箱状态不完整，请清空后重新扫描');
      box.value = refreshed;
      review.value = null;
      notify(refreshed.eligibility.allowed ? '一键解绑成功，可继续扫描板件' : refreshed.eligibility.reason!, !refreshed.eligibility.allowed);
    });
  }
  async function getJoint() {
    if (!canJoint.value || review.value) return;
    const selected = box.value!;
    const pendingCodes = pending.value.map((item) => item.panelCode);
    await run(async (current) => {
      const result = await panelPackingApi.getJoint(pendingCodes);
      if (!current() || box.value !== selected || pending.value.length !== pendingCodes.length ||
        pending.value.some((item, index) => item.panelCode !== pendingCodes[index])) return;
      if (!Array.isArray(result.candidates)) throw new Error('拼板结果不完整，请重试');
      const codes = knownCodes();
      const additions: Panel[] = [];
      for (const panel of result.candidates) {
        if (codes.has(panel.panelCode)) continue;
        ensurePanel(panel);
        codes.add(panel.panelCode);
        additions.push(panel);
      }
      if (pending.value.length + additions.length > 1000) throw new Error('拼板加入后超过 1000 条接口上限，本次未加入任何板件');
      pending.value.push(...additions);
      notify(additions.length ? `已加入 ${additions.length} 个拼板板件` : '没有新的可加入板件');
    });
  }
  function remove(panelCode: string) {
    if (!disabled.value) pending.value = pending.value.filter((item) => item.panelCode !== panelCode);
  }
  function cancelMixed() { if (!busy.value) { mixed.value = null; attempt = null; } }
  async function send(input: BindInput) {
    attempt = input;
    await run(async (current) => {
      let result;
      try { result = await panelPackingApi.bind(input.boxCode, input.version, input.panelCodes, input.options); }
      catch (error) {
        if (attempt === input && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) {
          attempt = null;
          if (current() && error.statusCode === 409) { mixed.value = null; throw new Error(`${error.message}；请清空后重新扫描箱子`); }
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
        mixed.value = { confirmation: result, input };
        attempt = null;
        return;
      }
      if (!validReceipt(result, input.boxCode, input.version, input.options.requestId)) throw new Error('绑定回执不完整，请核实后重试原请求');
      clear();
      notify('装箱成功');
    });
  }
  async function submit() {
    if (!canSubmit.value || !box.value || !active) return;
    const data = { boxCode: box.value.box.containerCode, version: box.value.box.version, panelCodes: pending.value.map((item) => item.panelCode) };
    const same = attempt && attempt.options.confirmMixed !== true && attempt.boxCode === data.boxCode && attempt.version === data.version &&
      JSON.stringify(attempt.panelCodes) === JSON.stringify(data.panelCodes);
    await send(same ? attempt! : { ...data, options: { requestId: requestId() } });
  }
  async function continueMixed() {
    if (busy.value || !active || !mixed.value) return;
    const { confirmation, input } = mixed.value;
    const same = attempt?.options.confirmMixed === true && attempt.options.confirmationToken === confirmation.confirmationToken;
    await send(same ? attempt! : { ...input, options: { requestId: requestId(), confirmMixed: true, confirmationToken: confirmation.confirmationToken } });
  }
  return { box, review, pending, mixed, busy, disabled, notice, canStage, canJoint, canSubmit, notify, clear, pause, resume,
    scan, keepBindings, unbindAll, getJoint, remove, submit, cancelMixed, continueMixed };
}
