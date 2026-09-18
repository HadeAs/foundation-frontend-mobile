import { computed, ref, shallowRef } from 'vue';
import { locationBindingApi as api, type LocationContainers, type LocationContainer } from '../services/locationBinding';
import type { Eligibility } from '../services/panelPacking';

export function useLocationBinding() {
  const location = shallowRef<LocationContainers | null>(null);
  const pending = shallowRef<LocationContainer | null>(null);
  const container = computed(() => location.value?.container || pending.value);
  const confirmation = ref(false);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const disabled = computed(() => busy.value || confirmation.value);
  const scanDisabled = computed(() => disabled.value || !!container.value || location.value?.eligibility.allowed === false);
  const canBind = computed(() => !disabled.value && !!pending.value && location.value?.occupied === false && location.value.eligibility.allowed);
  const canUnbind = computed(() => !disabled.value && !!location.value?.container && location.value.occupied && location.value.eligibility.allowed);
  let generation = 0;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function clear() {
    generation++;
    location.value = null;
    pending.value = null;
    confirmation.value = false;
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
  function validText(value: unknown) { return typeof value === 'string' && !!value.trim() && value.length <= 128; }
  function validVersion(value: unknown) { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647; }
  function validContainer(value: LocationContainer | undefined) {
    return !!value && ['BOX', 'VEHICLE'].includes(value.containerType) && validText(value.containerCode) && validVersion(value.version);
  }
  function validEligibility(value: Eligibility | undefined) {
    return !!value && typeof value.allowed === 'boolean' && (value.allowed || (typeof value.reason === 'string' && !!value.reason.trim()));
  }
  async function scan(raw: string) {
    if (scanDisabled.value) return;
    const code = raw.trim();
    if (!validText(code)) { notify('请输入有效编码（最多128个字符）', true); return; }
    await run(async (current) => {
      if (!location.value) {
        const result = await api.getLocation(code);
        if (!current()) return;
        if (!result || result.location?.locationCode !== code || !validText(result.location.locationName) || !validVersion(result.version) ||
          typeof result.occupied !== 'boolean' || !validEligibility(result.eligibility) ||
          (result.occupied ? !validContainer(result.container) : result.container != null)) throw new Error('库位信息不完整，请重新扫描');
        location.value = result;
        if (!result.eligibility.allowed) notify(result.eligibility.reason!, true);
      } else {
        const selected = location.value;
        const result = await api.getContainer(code);
        if (!current() || location.value !== selected) return;
        if (!result || !validContainer(result.container) || !validEligibility(result.eligibility)) throw new Error('容器信息不完整，请重新扫描');
        if (!result.eligibility.allowed) throw new Error(result.eligibility.reason!);
        // Type and canonical code are supplied by the backend, not inferred from scan prefixes.
        pending.value = result.container;
      }
    });
  }
  function requestUnbind() { if (canUnbind.value) confirmation.value = true; }
  function cancel() { if (!busy.value) confirmation.value = false; }
  async function submit() {
    const unbinding = confirmation.value;
    if (busy.value || !location.value || !container.value || (unbinding ? !location.value.occupied || !location.value.eligibility.allowed : !canBind.value)) return;
    const target = container.value;
    const data = { locationCode: location.value.location.locationCode, version: location.value.version,
      container: { containerType: target.containerType, containerCode: target.containerCode }, containerVersion: target.version };
    await run(async (current) => {
      if (unbinding) await api.unbind(data);
      else await api.bind(data);
      if (!current()) return;
      clear();
      notify(unbinding ? '解绑成功' : '位置绑定成功');
    });
  }
  return { location, pending, container, confirmation, busy, disabled, scanDisabled, canBind, canUnbind, notice, notify, clear, scan, requestUnbind, cancel, submit };
}
