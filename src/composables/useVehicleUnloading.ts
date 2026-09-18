import { computed, ref, shallowRef } from 'vue';
import { vehicleLoadingApi as api, type VehicleLoads, type LoadedBox } from '../services/vehicleLoading';

export function useVehicleUnloading() {
  const vehicle = shallowRef<VehicleLoads | null>(null);
  const loaded = computed(() => (vehicle.value?.loads || []).filter((row): row is LoadedBox => !!row.box));
  const selected = ref<string[]>([]);
  const confirmation = ref<'all' | 'selected' | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!confirmation.value);
  const confirmCount = computed(() => confirmation.value === 'all' ? loaded.value.length : selected.value.length);
  let generation = 0;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    vehicle.value = null;
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
    if (disabled.value || !loaded.value.some((item) => item.id === id)) return;
    if (selected.value.includes(id)) selected.value = selected.value.filter((value) => value !== id);
    else selected.value.push(id);
  }
  function validVersion(value: number | undefined) { return Number.isInteger(value) && value! > 0 && value! <= 2147483647; }
  async function scan(raw: string) {
    if (disabled.value) return;
    const code = raw.trim();
    if (!code || code.length > 128) { notify('请输入有效编码（最多128个字符）', true); return; }
    if (vehicle.value) {
      const item = loaded.value.find((row) => row.box.containerCode === code);
      if (!item) notify('该箱子未在当前载具的装载列表中', true);
      else if (selected.value.includes(item.id)) notify('该箱子已勾选，请勿重复扫描', true);
      else { notice.value = null; toggle(item.id); }
      return;
    }
    await run(async (current) => {
      const result = await api.getLoads(code);
      if (!current()) return;
      const rows = result.loads;
      if (result.vehicle?.containerType !== 'VEHICLE' || result.vehicle.containerCode !== code || !validVersion(result.vehicle.version) ||
        !Array.isArray(rows) || rows.some((row) => !row || !row.slotCode || !validVersion(row.slotVersion) || !Array.isArray(row.materials) ||
          (row.box ? row.box.containerType !== 'BOX' || !row.box.containerCode || !validVersion(row.box.version) || !row.id || !validVersion(row.version) :
            row.id !== undefined || row.version !== undefined || row.materials.length !== 0) ||
          row.materials.some((item) => !item || !item.materialCode || !item.materialName || !item.orderNo || !item.unit || !validVersion(item.quantity) ||
            !['PANEL', 'QUANTITY'].includes(item.lineType) || (item.lineType === 'PANEL' ? !item.panelCode : item.panelCode !== undefined))) ||
        new Set(rows.map((row) => row.slotCode)).size !== rows.length) throw new Error('载具装载信息不完整，请重新扫描');
      const boxes = rows.filter((row) => row.box);
      if (new Set(boxes.map((row) => row.id)).size !== boxes.length || new Set(boxes.map((row) => row.box!.containerCode)).size !== boxes.length ||
        result.loadedBoxCount !== boxes.length || result.totalMaterialQuantity !== rows.reduce((sum, row) => sum + row.materials.reduce((n, item) => n + item.quantity, 0), 0)) {
        throw new Error('载具装载汇总与明细不一致，请重新扫描');
      }
      vehicle.value = result;
    });
  }
  function requestUnload(mode: 'all' | 'selected') {
    if (disabled.value || !loaded.value.length || (mode === 'selected' && !selected.value.length)) return;
    if (mode === 'selected' && selected.value.length > 1000) { notify('每次最多卸载1000条所选记录；整车卸载请使用全部卸载', true); return; }
    confirmation.value = mode;
  }
  function cancel() { if (!busy.value) confirmation.value = null; }
  async function submit() {
    if (!confirmation.value || !vehicle.value || busy.value) return;
    const mode = confirmation.value;
    const target = vehicle.value.vehicle;
    const items = loaded.value.filter((item) => selected.value.includes(item.id)).map(({ id, version }) => ({ id, version }));
    await run(async (current) => {
      if (mode === 'all') await api.unloadAll(target.containerCode, target.version);
      else await api.unloadSelected(target.containerCode, target.version, items);
      if (!current()) return;
      clear();
      notify('卸载成功');
    });
  }
  return { vehicle, loaded, selected, confirmation, busy, disabled, notice, confirmCount, notify, clear, scan, toggle, requestUnload, cancel, submit };
}
