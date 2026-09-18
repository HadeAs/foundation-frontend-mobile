import { computed, ref, shallowRef } from 'vue';
import { panelPackingApi as api, type BoxBindings } from '../services/panelPacking';

export function usePanelUnbinding() {
  const box = shallowRef<BoxBindings | null>(null);
  const selected = ref<string[]>([]);
  const confirmation = ref<'all' | 'selected' | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!confirmation.value);
  const confirmCount = computed(() => confirmation.value === 'all' ? box.value?.bindings.length || 0 : selected.value.length);
  let generation = 0;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    box.value = null;
    selected.value = [];
    confirmation.value = null;
    busy.value = false;
    notice.value = null;
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
  function toggle(id: string) {
    if (disabled.value || !box.value?.bindings.some((item) => item.id === id)) return;
    if (selected.value.includes(id)) selected.value = selected.value.filter((value) => value !== id);
    else selected.value.push(id);
  }
  async function scan(raw: string) {
    if (disabled.value) return;
    const code = raw.trim();
    if (!code || code.length > 128) { notify('请输入有效编码（最多128个字符）', true); return; }
    if (box.value) {
      const item = box.value.bindings.find((row) => row.bindingMode === 'BY_CODE' && row.panelCode === code);
      if (!item) notify('该板件未在当前箱的已绑定列表中', true);
      else if (selected.value.includes(item.id)) notify('该板件已勾选，请勿重复扫描', true);
      else { notice.value = null; toggle(item.id); }
      return;
    }
    await run(async (current) => {
      const result = await api.getBox(code);
      if (!current()) return;
      const rows = result.bindings;
      if (result.box?.containerType !== 'BOX' || result.box.containerCode !== code || !Number.isInteger(result.box.version) || result.box.version < 1 ||
        !Array.isArray(rows) || rows.some((item) => !item.id || !Number.isInteger(item.version) || item.version < 1 || !Number.isInteger(item.quantity) || item.quantity < 1 ||
          !['BY_CODE', 'BY_ORDER'].includes(item.bindingMode) || (item.bindingMode === 'BY_CODE' && !item.panelCode)) ||
        new Set(rows.map((item) => item.id)).size !== rows.length || result.empty !== (rows.length === 0) || result.totalQuantity !== rows.reduce((sum, item) => sum + item.quantity, 0)) {
        throw new Error('箱内绑定信息不完整，请重新扫描');
      }
      box.value = result;
      if (!result.eligibility?.allowed) notify(result.eligibility?.reason || '当前箱子不允许解绑', true);
    });
  }
  function requestUnbind(mode: 'all' | 'selected') {
    if (disabled.value || !box.value?.bindings.length || (mode === 'selected' && !selected.value.length)) return;
    if (!box.value.eligibility?.allowed) { notify(box.value.eligibility?.reason || '当前箱子不允许解绑', true); return; }
    if (mode === 'selected' && selected.value.length > 1000) { notify('每次最多解绑1000条所选记录；整箱解绑请使用全部解绑', true); return; }
    confirmation.value = mode;
  }
  function cancel() { if (!busy.value) confirmation.value = null; }
  async function submit() {
    if (!confirmation.value || !box.value || busy.value) return;
    const mode = confirmation.value;
    const target = box.value;
    const items = target.bindings.filter((item) => selected.value.includes(item.id)).map(({ id, version }) => ({ id, version }));
    await run(async (current) => {
      if (mode === 'all') await api.unbindAll(target.box.containerCode, target.box.version);
      else await api.unbindSelected(target.box.containerCode, target.box.version, items);
      if (!current()) return;
      clear();
      notify('解绑成功');
    });
  }
  return { box, selected, confirmation, busy, disabled, notice, confirmCount, notify, clear, scan, toggle, requestUnbind, cancel, submit };
}
