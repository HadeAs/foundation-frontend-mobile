import { computed, ref, shallowRef } from 'vue';
import { panelPackingApi, type BoxBindings, type Panel } from '../services/panelPacking';

export function usePanelPacking() {
  const box = shallowRef<BoxBindings | null>(null);
  const review = shallowRef<BoxBindings | null>(null);
  const pending = ref<Panel[]>([]);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const canJoint = computed(() => !!box.value && pending.value.length > 0 && !busy.value && !review.value);
  let generation = 0;

  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    box.value = null;
    review.value = null;
    pending.value = [];
    notice.value = null;
    busy.value = false;
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    notice.value = null;
    const id = generation;
    try {
      await action(() => id === generation);
    } catch (error) {
      if (id === generation) notify(error instanceof Error ? error.message : '操作失败，请重试', true);
    } finally {
      if (id === generation) busy.value = false;
    }
  }
  function ensurePanel(panel: Panel) {
    if (!panel.panelCode || !panel.materialCode || !panel.materialName || !panel.orderNo) throw new Error('板件信息不完整，请联系管理员');
    if (!panel.eligibility?.allowed) throw new Error(panel.eligibility?.reason || '当前板件不可绑定');
    if (panel.currentBoxCode) throw new Error(`板件已绑定至箱 ${panel.currentBoxCode}`);
  }
  function knownCodes() {
    return new Set([...box.value!.bindings.map((item) => item.panelCode), ...pending.value.map((item) => item.panelCode)]);
  }
  async function scan(raw: string) {
    if (busy.value || review.value) return;
    const code = raw.trim();
    if (!code) return;
    if (code.length > 128) { notify('编码长度不能超过 128 个字符', true); return; }
    await run(async (current) => {
      if (!box.value) {
        const result = await panelPackingApi.getBox(code);
        if (!current()) return;
        if (result.box?.containerType !== 'BOX' || result.box.containerCode !== code || !Number.isInteger(result.box.version)
          || !Array.isArray(result.bindings) || result.bindings.some((item) => item.bindingMode === 'BY_CODE' && !item.panelCode)) {
          throw new Error('箱信息不完整或与扫描编码不一致，请联系管理员');
        }
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前箱不可装箱');
        if (result.bindings.length) review.value = result;
        else box.value = result;
      } else {
        if (knownCodes().has(code)) throw new Error('该板件已在列表中，请勿重复扫描');
        if (pending.value.length >= 1000) throw new Error('本次待绑定已达 1000 条接口上限，请先确认装箱');
        const panel = await panelPackingApi.getPanel(code);
        if (!current()) return;
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
  }
  async function unbindAll() {
    if (!review.value) return;
    const selected = review.value;
    await run(async (current) => {
      const result = await panelPackingApi.unbindAll(selected.box.containerCode, selected.box.version);
      if (!current()) return;
      if (result.box?.boxCode !== selected.box.containerCode || !Number.isInteger(result.box.version) || result.box.materialQuantity !== 0) {
        throw new Error('解绑回执异常，请清空后重新扫描核实');
      }
      box.value = { ...selected, box: { ...selected.box, version: result.box.version }, bindings: [], empty: true, totalQuantity: 0 };
      review.value = null;
      notify('一键解绑成功，可继续扫描板件');
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
    if (!busy.value) pending.value = pending.value.filter((item) => item.panelCode !== panelCode);
  }
  async function submit() {
    if (!box.value || !pending.value.length || review.value) return;
    const selected = box.value;
    await run(async (current) => {
      await panelPackingApi.bind(selected.box.containerCode, selected.box.version, pending.value.map((item) => item.panelCode));
      if (!current()) return;
      clear();
      notify('装箱成功');
    });
  }
  return { box, review, pending, busy, notice, canJoint, notify, clear, scan, keepBindings, unbindAll, getJoint, remove, submit };
}
