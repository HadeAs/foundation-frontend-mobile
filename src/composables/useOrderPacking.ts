import { computed, ref, shallowRef } from 'vue';
import { panelPackingApi as api, type BoxBindings } from '../services/panelPacking';

export function useOrderPacking() {
  const box = shallowRef<BoxBindings | null>(null);
  const review = shallowRef<BoxBindings | null>(null);
  const order = ref('');
  const quantity = ref('');
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  let generation = 0;
  const validQuantity = computed(() => /^\d+$/.test(quantity.value) && Number(quantity.value) >= 1 && Number(quantity.value) <= 2147483647);
  const canSubmit = computed(() => !!box.value && !!order.value.trim() && order.value.trim().length <= 128 && validQuantity.value && !busy.value && !review.value);
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    box.value = review.value = null;
    order.value = quantity.value = '';
    notice.value = null;
    busy.value = false;
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = generation;
    busy.value = true;
    notice.value = null;
    try { await action(() => id === generation); }
    catch (error) { if (id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  async function scan(raw: string) {
    if (busy.value || review.value) return;
    const code = raw.trim();
    if (!code || code.length > 128) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      if (!box.value) {
        const result = await api.getBox(code);
        if (!current()) return;
        if (result.box?.containerType !== 'BOX' || result.box.containerCode !== code || !Number.isInteger(result.box.version) || result.box.version < 1 || !Array.isArray(result.bindings)) throw new Error('箱信息不完整，请重新扫描');
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前箱子不允许装箱');
        if (!result.empty || result.totalQuantity > 0 || result.bindings.length) review.value = result;
        else box.value = result;
      } else {
        const panel = await api.getPanel(code);
        if (!current()) return;
        if (panel.panelCode !== code || !panel.orderNo?.trim() || panel.orderNo.length > 128) throw new Error('板件未返回有效订单号');
        order.value = panel.orderNo;
      }
    });
  }
  async function unbindAll() {
    const target = review.value;
    if (!target) return;
    await run(async (current) => {
      const receipt = await api.unbindAll(target.box.containerCode, target.box.version);
      if (!current()) return;
      if (receipt.box?.boxCode !== target.box.containerCode || !Number.isInteger(receipt.box.version) || receipt.box.version <= target.box.version || receipt.box.materialQuantity !== 0) throw new Error('解绑回执异常，请重新扫描核实');
      box.value = { ...target, box: { ...target.box, version: receipt.box.version }, empty: true, totalQuantity: 0, bindings: [] };
      review.value = null;
    });
  }
  async function submit() {
    if (busy.value || review.value) return;
    if (!canSubmit.value || !box.value) { notify('请填写订单号和有效数量（1～2147483647的整数）', true); return; }
    const target = box.value.box;
    await run(async (current) => {
      await api.bindByOrder(target.containerCode, target.version, order.value.trim(), Number(quantity.value));
      if (!current()) return;
      clear();
      notify('装箱成功');
    });
  }
  return { box, review, order, quantity, busy, notice, canSubmit, notify, clear, scan, unbindAll, submit };
}
