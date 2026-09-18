import { computed, ref } from 'vue';
import { vehicleLoadingApi as api, type VehicleSlot, type LoadingBox, type LoadPair } from '../services/vehicleLoading';

interface Pair { slot: VehicleSlot; box: LoadingBox | null }
export function useVehicleLoading() {
  const pairs = ref<Pair[]>([]);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const pending = computed(() => pairs.value.find((pair) => !pair.box));
  const completeCount = computed(() => pairs.value.filter((pair) => pair.box).length);
  const canSubmit = computed(() => !!pairs.value.length && !pending.value && !busy.value);
  let generation = 0;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() { generation++; pairs.value = []; busy.value = false; notice.value = null; }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = generation;
    busy.value = true;
    notice.value = null;
    try { await action(() => id === generation); }
    catch (error) { if (id === generation) notify(error instanceof Error ? error.message : '请求失败，请重试', true); }
    finally { if (id === generation) busy.value = false; }
  }
  function validVersion(value: number) { return Number.isInteger(value) && value > 0 && value <= 2147483647; }
  async function scan(raw: string) {
    if (busy.value) return;
    const code = raw.trim();
    if (!code || code.length > 128) { notify('请输入有效编码（最多128个字符）', true); return; }
    const target = pending.value;
    await run(async (current) => {
      if (target) {
        if (pairs.value.some((pair) => pair.box?.box.containerCode === code)) throw new Error('该箱子已在待装载列表中，请勿重复扫描');
        const result = await api.getBox(code);
        if (!current()) return;
        if (result.box?.containerType !== 'BOX' || result.box.containerCode !== code || !validVersion(result.box.version)) throw new Error('箱信息不完整或与扫描编码不一致');
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前箱子不允许装车');
        if (result.loadedVehicleCode || result.loadedSlotCode) throw new Error('该箱子已装车，请先卸车');
        target.box = result;
      } else {
        if (pairs.value.some((pair) => pair.slot.slotCode === code)) throw new Error('该载具库位已在待装载列表中，请勿重复扫描');
        if (pairs.value.length >= 1000) throw new Error('本次配对已达1000条接口上限，请先确认装载');
        const result = await api.getSlot(code);
        if (!current()) return;
        if (result.slotCode !== code || !validVersion(result.version) || result.vehicle?.containerType !== 'VEHICLE' || !result.vehicle.containerCode || !validVersion(result.vehicle.version)) throw new Error('载具库位信息不完整或与扫描编码不一致');
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前载具库位不允许装载');
        if (result.box) throw new Error(`该载具库位已装载箱子 ${result.box.containerCode}`);
        pairs.value.push({ slot: result, box: null });
      }
    });
  }
  function remove(slotCode: string) {
    if (!busy.value) pairs.value = pairs.value.filter((pair) => pair.slot.slotCode !== slotCode);
  }
  async function submit() {
    if (busy.value) return;
    if (!canSubmit.value) { notify('请完成载具库位与箱子的配对后再确认装载', true); return; }
    const items: LoadPair[] = pairs.value.map(({ slot, box }) => ({
      slotCode: slot.slotCode, slotVersion: slot.version, boxCode: box!.box.containerCode, boxVersion: box!.box.version
    }));
    await run(async (current) => {
      await api.load(items);
      if (!current()) return;
      clear();
      notify('装载成功');
    });
  }
  return { pairs, pending, completeCount, canSubmit, busy, notice, notify, clear, scan, remove, submit };
}
