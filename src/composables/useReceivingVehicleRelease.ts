import { computed, ref } from 'vue';
import { requestId } from '../services/nariRequest';
import { receivingApi, type ReleaseInput, type ReleaseVehicle } from '../services/receiving';
import { usePendingSubmission } from './usePendingSubmission';

export const releaseStatusNames = { RELEASED: '已解绑', WAITING_BOXES: '等待料箱处理', RETAINED: '保留绑定' };
interface ReleaseAttempt extends ReleaseInput { phase: 'offer' | 'submitted' }
const question = '是否解绑车与位置关系？';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validInput(value: unknown): value is ReleaseAttempt {
  const input = value as ReleaseAttempt | null;
  return !!input && uuid.test(input.requestId) && uuid.test(input.receivingRequestId) && ['offer', 'submitted'].includes(input.phase);
}

export function useReceivingVehicleRelease(flow: 'receiving' | 'inbound', notify: (message: string) => void) {
  const saved = usePendingSubmission<ReleaseAttempt>(flow + '-vehicle-release', validInput);
  const { pending, storageError } = saved;
  const writing = ref(false);
  const vehicles = ref<ReleaseVehicle[]>([]);
  const asking = computed(() => pending.value?.input.phase === 'offer');
  const visible = computed(() => !!pending.value || !!vehicles.value.length || !!storageError.value);
  let unsaved: ReleaseAttempt | undefined;
  function offer(receivingRequestId: string) {
    // The storage key belongs to the operator who submitted the successful receipt.
    unsaved = { requestId: requestId(), receivingRequestId, phase: 'offer' };
    try { saved.save(unsaved, question); unsaved = undefined; }
    catch { /* The original receipt remains successful; display the separate storage error. */ }
  }
  function close() {
    if (writing.value) return;
    if (pending.value) {
      if (!asking.value) return;
      try { saved.finish(pending.value.input.requestId); } catch { return; }
    }
    vehicles.value = [];
  }
  async function confirm() {
    const input = pending.value?.input;
    if (!input || writing.value || storageError.value || !saved.sameScope()) return;
    writing.value = true;
    try {
      saved.save({ ...input, phase: 'submitted' }, '车位解绑结果待核实');
      const r = await receivingApi.releaseVehicles({ requestId: input.requestId, receivingRequestId: input.receivingRequestId });
      if (!r || r.requestId !== input.requestId || r.receivingRequestId !== input.receivingRequestId ||
          !Array.isArray(r.vehicles) || !r.vehicles.every(v => v && typeof v.vehicleCode === 'string' && v.vehicleCode.trim() &&
            typeof v.locationCode === 'string' && v.locationCode.trim() && Object.prototype.hasOwnProperty.call(releaseStatusNames, v.status))) {
        throw new Error('解绑回执与本次接收不一致，请核实原请求');
      }
      saved.finish(input.requestId);
      if (!saved.sameScope()) return;
      if (r.vehicles.some(v => v.status !== 'RELEASED')) vehicles.value = r.vehicles;
      else notify(r.vehicles.length ? '车与位置关系已解绑' : '本次无车位关系需要解绑');
    } catch (error) { saved.failed(error); }
    finally { writing.value = false; }
  }
  function restore() {
    if (writing.value) return;
    saved.restore();
    if (!unsaved || !saved.sameScope() || storageError.value) return;
    try { saved.save(unsaved, question); unsaved = undefined; } catch { /* Show the storage error for retry. */ }
  }
  return { pending, storageError, vehicles, asking, visible, writing, offer, close, confirm, restore };
}
