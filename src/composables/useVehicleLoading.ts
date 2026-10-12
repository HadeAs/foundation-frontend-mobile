import { computed, ref } from 'vue';
import { vehicleLoadingApi as api, type VehicleSlot, type LoadingBox, type LoadPair } from '../services/vehicleLoading';
import type { Eligibility, PackingBox } from '../services/panelPacking';
import { ApiRequestError, requestId } from '../services/nariRequest';

const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const integer = (value: unknown, min = 1) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2147483647;
const optionalText = (value: unknown) => value === undefined || text(value);
function validContainer(value: Omit<PackingBox, 'containerType'> & { containerType: 'BOX' | 'VEHICLE' }, type: 'BOX' | 'VEHICLE') {
  return value && value.containerType === type && text(value.containerCode) && integer(value.version) && optionalText(value.containerName) &&
    (value.contentState === undefined || ['UNKNOWN', 'EMPTY', 'LOADED'].includes(value.contentState)) &&
    (value.runtimeUsage === undefined || ['MATERIAL', 'FIXTURE'].includes(value.runtimeUsage));
}
const validEligibility = (value: Eligibility) => value && typeof value.allowed === 'boolean' && (value.allowed || text(value.reason, 500));

interface Pair { slot: VehicleSlot; box: LoadingBox | null }
export function useVehicleLoading() {
  const pairs = ref<Pair[]>([]);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const pending = computed(() => pairs.value.find((pair) => !pair.box));
  const completeCount = computed(() => pairs.value.filter((pair) => pair.box).length);
  const canSubmit = computed(() => !!pairs.value.length && pairs.value.length <= 1000 && !pending.value && !busy.value);
  let generation = 0;
  let active = true;
  let attempt: { items: LoadPair[]; id: string; fingerprint: string } | null = null;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() { generation++; pairs.value = []; busy.value = false; notice.value = null; attempt = null; }
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
  async function scan(raw: string) {
    if (busy.value || !active) return;
    const code = raw.trim();
    if (!code || code.length > 128) { notify('请输入有效编码（最多128个字符）', true); return; }
    const target = pending.value;
    await run(async (current) => {
      if (target) {
        if (pairs.value.some((pair) => pair.box?.box.containerCode === code)) throw new Error('该箱子已在待装载列表中，请勿重复扫描');
        const result = await api.getBox(code);
        if (!current()) return;
        if (!result || !validContainer(result.box, 'BOX') || result.box.containerCode !== code || !validEligibility(result.eligibility) ||
          !optionalText(result.loadedVehicleCode) || !optionalText(result.loadedSlotCode)) throw new Error('箱信息不完整或与扫描编码不一致');
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前箱子不允许装车');
        if (result.loadedVehicleCode || result.loadedSlotCode) throw new Error('该箱子已装车，请先卸车');
        target.box = result;
      } else {
        if (pairs.value.some((pair) => pair.slot.slotCode === code)) throw new Error('该载具库位已在待装载列表中，请勿重复扫描');
        if (pairs.value.length >= 1000) throw new Error('本次配对已达1000条接口上限，请先确认装载');
        const result = await api.getSlot(code);
        if (!current()) return;
        if (!result || result.slotCode !== code || !integer(result.version) || !validContainer(result.vehicle, 'VEHICLE') ||
          !validEligibility(result.eligibility) || (result.box !== undefined && !validContainer(result.box, 'BOX'))) throw new Error('载具库位信息不完整或与扫描编码不一致');
        if (!result.eligibility?.allowed) throw new Error(result.eligibility?.reason || '当前载具库位不允许装载');
        if (result.box) throw new Error(`该载具库位已装载箱子 ${result.box.containerCode}`);
        pairs.value.push({ slot: result, box: null });
      }
    });
  }
  function remove(slotCode: string) {
    if (!busy.value && active) pairs.value = pairs.value.filter((pair) => pair.slot.slotCode !== slotCode);
  }
  async function submit() {
    if (busy.value || !active) return;
    if (!canSubmit.value) { notify('请完成载具库位与箱子的配对后再确认装载', true); return; }
    const items: LoadPair[] = pairs.value.map(({ slot, box }) => ({
      slotCode: slot.slotCode, slotVersion: slot.version, boxCode: box!.box.containerCode, boxVersion: box!.box.version
    }));
    const fingerprint = JSON.stringify(items);
    const input = attempt?.fingerprint === fingerprint ? attempt : { items, id: requestId(), fingerprint };
    attempt = input;
    await run(async (current) => {
      let result;
      try { result = await api.load(input.items, input.id); }
      catch (error) {
        // Manual replay keeps the original UUID unless the backend explicitly rejected the operation.
        if (attempt === input && error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) attempt = null;
        throw error;
      }
      if (!current()) return;
      if (!result || 'resultType' in result || result.requestId !== input.id || !text(result.operationNo) ||
        !integer(result.affectedCount, 0) || result.affectedCount !== input.items.length || typeof result.processedTime !== 'string' || !Number.isFinite(Date.parse(result.processedTime))) {
        throw new Error('装载回执不完整或与本次配对不一致，请核实后重试原请求');
      }
      clear();
      notify('装载成功');
    });
  }
  return { pairs, pending, completeCount, canSubmit, busy, notice, notify, clear, pause, resume, scan, remove, submit };
}
