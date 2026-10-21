import { computed, ref, shallowRef } from 'vue';
import { vehicleLoadingApi as api, type VehicleLoads, type LoadedBox, type Vehicle } from '../services/vehicleLoading';
import type { PackingBox } from '../services/panelPacking';
import { ApiRequestError, requestId } from '../services/nariRequest';

const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const integer = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
const optionalText = (value: unknown) => value === undefined || text(value);
function validContainer(value: Vehicle | PackingBox, type: 'VEHICLE' | 'BOX') {
  return value && value.containerType === type && text(value.containerCode) && integer(value.version) && optionalText(value.containerName) &&
    (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
    (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage));
}
function validLoads(value: VehicleLoads, code: string) {
  if (!value || !validContainer(value.vehicle, 'VEHICLE') || value.vehicle.containerCode !== code ||
    !integer(value.loadedBoxCount, 0) || !integer(value.totalMaterialQuantity, 0) || !Array.isArray(value.loads) ||
    value.loads.some(row => !row || !text(row.slotCode) || !integer(row.slotVersion) || !Array.isArray(row.materials) ||
      (row.box !== undefined ? !validContainer(row.box, 'BOX') || !text(row.id, 20) || !/^[1-9][0-9]{0,18}$/.test(row.id) || !integer(row.version) ||
        (row.box.contentState === 'EMPTY' && row.materials.length > 0) : row.id !== undefined || row.version !== undefined || row.materials.length !== 0) ||
      row.materials.some(item => !item || !text(item.materialCode) || !text(item.orderNo) || !optionalText(item.orderLineNo) ||
        !optionalText(item.materialName) || !optionalText(item.unit) || !optionalText(item.materialBatch) ||
        (item.lineType === 'PANEL' ? !text(item.panelCode) || item.quantity !== 1 : item.lineType !== 'QUANTITY' || item.panelCode !== undefined || !integer(item.quantity)))) ||
    new Set(value.loads.map(row => row.slotCode)).size !== value.loads.length) return false;
  const boxes = value.loads.filter(row => row.box);
  return new Set(boxes.map(row => row.id)).size === boxes.length && new Set(boxes.map(row => row.box!.containerCode)).size === boxes.length &&
    value.loadedBoxCount === boxes.length && value.totalMaterialQuantity === value.loads.reduce((sum, row) => sum + row.materials.reduce((n, item) => n + item.quantity, 0), 0);
}
interface UnloadInput { mode: 'all' | 'selected'; vehicleCode: string; version: number; items: Pick<LoadedBox, 'id' | 'version'>[]; requestId: string }

export function useVehicleUnloading() {
  const vehicle = shallowRef<VehicleLoads | null>(null);
  const loaded = computed(() => (vehicle.value?.loads || []).filter((row): row is LoadedBox => !!row.box));
  const selected = ref<string[]>([]);
  const confirmation = ref<'all' | 'selected' | null>(null);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || !!confirmation.value);
  const canUnloadAll = computed(() => loaded.value.length > 0 && !disabled.value);
  const canUnloadSelected = computed(() => canUnloadAll.value && selected.value.length > 0 && selected.value.length <= 1000);
  const confirmCount = computed(() => confirmation.value === 'all' ? loaded.value.length : selected.value.length);
  let generation = 0;
  let active = true;
  let attempt: { input: UnloadInput; fingerprint: string } | null = null;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    vehicle.value = null;
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
    if (disabled.value || !active || !loaded.value.some((item) => item.id === id)) return;
    if (selected.value.includes(id)) selected.value = selected.value.filter((value) => value !== id);
    else if (selected.value.length >= 1000) notify('每次最多卸载1000条所选记录；整车卸载请使用全部卸载', true);
    else selected.value.push(id);
  }
  async function scan(raw: string) {
    if (disabled.value || !active) return;
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
      if (!validLoads(result, code)) throw new Error('载具装载信息不完整或汇总不一致，请重新扫描');
      vehicle.value = result;
    });
  }
  function requestUnload(mode: 'all' | 'selected') {
    if (disabled.value || !active) return;
    if (mode === 'selected' && selected.value.length > 1000) { notify('每次最多卸载1000条所选记录；整车卸载请使用全部卸载', true); return; }
    if (mode === 'all' ? !canUnloadAll.value : !canUnloadSelected.value) return;
    confirmation.value = mode;
  }
  function cancel() { if (!busy.value) confirmation.value = null; }
  async function submit() {
    if (!active || !confirmation.value || !vehicle.value || busy.value) return;
    const mode = confirmation.value;
    const target = vehicle.value.vehicle;
    const chosen = mode === 'all' ? loaded.value : loaded.value.filter(item => selected.value.includes(item.id));
    if (!chosen.length || (mode === 'selected' && (chosen.length > 1000 || chosen.length !== selected.value.length))) return;
    const data = { mode, vehicleCode: target.containerCode, version: target.version,
      items: mode === 'all' ? [] : chosen.map(({ id, version }) => ({ id, version })) };
    const fingerprint = JSON.stringify(data);
    const input = attempt?.fingerprint === fingerprint ? attempt.input : { ...data, requestId: requestId() };
    attempt = { input, fingerprint };
    await run(async (current) => {
      let result;
      try { result = mode === 'all' ? await api.unloadAll(input.vehicleCode, input.version, input.requestId) :
        await api.unloadSelected(input.vehicleCode, input.version, input.items, input.requestId); }
      catch (error) {
        // An unknown outcome manually replays the original input; only explicit rejections start a new request.
        if (attempt?.input.requestId === input.requestId && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      if (!result || typeof result !== 'object' || 'resultType' in result || result.requestId !== input.requestId ||
        !integer(result.affectedCount, 0) || result.affectedCount !== chosen.length || typeof result.processedTime !== 'string' || !Number.isFinite(Date.parse(result.processedTime))) {
        throw new Error('卸载回执不完整或与本次关系不一致，请核实后重试原请求');
      }
      clear();
      notify('卸载成功');
    });
  }
  return { vehicle, loaded, selected, confirmation, busy, disabled, notice, canUnloadAll, canUnloadSelected, confirmCount,
    notify, clear, pause, resume, scan, toggle, requestUnload, cancel, submit };
}
