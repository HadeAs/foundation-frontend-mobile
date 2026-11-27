import { useReceivingVehicleRelease } from './useReceivingVehicleRelease';
import { computed, ref } from 'vue';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { batchItem, lineSideInboundApi as api, matchesBatch, readyBox, validBatch, validCode, validLocation,
  type DraftBox, type InboundBatch, type InboundLocation } from '../services/lineSideInbound';
import { usePendingSubmission } from './usePendingSubmission';

function checkRows(rows: DraftBox[]) {
  if (!Array.isArray(rows) || rows.some(row => !row || !validCode(row.boxCode)) ||
      new Set(rows.map(row => row.boxCode)).size !== rows.length) throw new Error('料箱清单返回不完整，请重新扫描');
}
function scanFailure(rows: DraftBox[], reason?: string | null) {
  const details = rows.filter(row => !row.allowed && row.reason).map(row =>
    row.boxCode + '：' + row.reason + (row.registeredLocationCode ? '（登记地标 ' + row.registeredLocationCode + '）' : ''));
  return details.join('；') || reason || '本次扫描未通过入库校验';
}
export function useLineSideInbound() {
  const saved = usePendingSubmission<InboundBatch>('line-side-inbound', validBatch);
  const { pending, storageError } = saved;
  const location = ref<InboundLocation | null>(null);
  const boxes = ref<DraftBox[]>([]);
  const factoryId = ref('');
  const blockReason = ref('');
  const scans = ref(0);
  const checking = ref(false);
  const writing = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const release = useReceivingVehicleRelease('inbound', text => notify(text));
  const locked = computed(() => release.visible.value || checking.value || writing.value || !!pending.value || !!storageError.value);
  const busy = computed(() => scans.value > 0 || locked.value);
  const canSubmit = computed(() => !busy.value && !!location.value && !blockReason.value &&
    boxes.value.length > 0 && boxes.value.every(readyBox));
  let generation = 0;
  let active = true;
  let queue = Promise.resolve();
  const notify = (text: string, error = false) => { notice.value = { text, error }; };
  const current = (id: number) => active && id === generation && saved.sameScope();
  const report = (e: unknown) => notify(e instanceof Error ? e.message : '请求失败，请重试', true);

  function reset() {
    boxes.value = []; location.value = null; factoryId.value = ''; blockReason.value = ''; notice.value = null;
  }
  function clear() { if (!busy.value) reset(); }
  function remove(code: string) {
    if (busy.value) return;
    boxes.value = boxes.value.filter(b => b.boxCode !== code);
    if (!boxes.value.length && !location.value) factoryId.value = '';
  }
  function pause() {
    active = false; generation++; scans.value = 0; checking.value = false; queue = Promise.resolve();
  }
  function resume() {
    release.restore();
    active = true;
    if (!writing.value) saved.restore();
    if (!saved.sameScope()) reset();
    if (pending.value && !boxes.value.length) {
      const input = pending.value.input;
      location.value = { locationCode: input.locationCode, locationVersion: input.locationVersion };
      boxes.value = input.items.map(item => ({ ...item, allowed: true }));
    }
  }

  // A changed landmark invalidates all credentials. Match the entire response before replacing the draft.
  async function preview(code: string, draft: DraftBox[], id: number, acceptConflicts: boolean) {
    const codes = draft.map(row => row.boxCode);
    const result = await api.preview(code, codes);
    if (!current(id)) return false;
    if (!validLocation(result?.location) || result.location.locationCode !== code) {
      throw new Error(result?.reason || '地标无效，请重新选择');
    }
    checkRows(result.boxes);
    const byCode = new Map(result.boxes.map(row => [row.boxCode, row]));
    if (byCode.size !== codes.length || codes.some(key => !byCode.has(key))) throw new Error('预检未返回本次完整箱清单，请重试');
    const rows = codes.map(key => {
      const row = byCode.get(key)!;
      return row.allowed && !readyBox(row) ? { ...row, allowed: false, reason: '缺少入库凭据，请重新扫描' } : row;
    });
    const rejected = result.allowed !== true || rows.some(row => !readyBox(row));
    if (rejected && (!acceptConflicts || !rows.length)) throw new Error(scanFailure(rows, result.reason));
    location.value = result.location;
    factoryId.value = result.location.factoryId || factoryId.value;
    boxes.value = rows;
    blockReason.value = result.allowed !== true && rows.every(row => row.allowed) ? result.reason || '整批预检未通过' : '';
    if (rejected) notify(scanFailure(rows, result.reason), true);
    else notice.value = null;
    return true;
  }
  async function chooseLocation(code: string) {
    if (!active || busy.value || !saved.sameScope() || !validCode(code)) return false;
    const id = generation;
    checking.value = true;
    try { return await preview(code, boxes.value, id, true); }
    catch (error) {
      if (current(id)) {
        if (code === location.value?.locationCode) blockReason.value = '请重新预检后提交';
        report(error);
      }
      return false;
    }
    finally { if (id === generation) checking.value = false; }
  }

  function scan(raw: string) {
    if (!active || locked.value || !saved.sameScope()) return Promise.resolve();
    const code = raw.trim();
    if (!validCode(code)) { notify('请输入有效的料箱或料车码', true); return Promise.resolve(); }
    const id = generation;
    scans.value++;
    queue = queue.then(async () => {
      if (!current(id)) return;
      const target = location.value;
      const result = await api.scan(code, target?.locationCode);
      if (!current(id)) return;
      if (!result || !['BOX', 'VEHICLE'].includes(result.scanType)) throw new Error('未能识别料箱或料车');
      checkRows(result.boxes);
      if (!result.boxes.length) throw new Error(result.reason || '当前没有可入库的料箱');
      const needsLocation = !target && result.locationRequired === true;
      if (!needsLocation && (result.allowed !== true || result.boxes.some(row => !readyBox(row)))) {
        throw new Error(scanFailure(result.boxes, result.reason));
      }
      const byCode = new Map(boxes.value.map(row => [row.boxCode, row]));
      for (const row of result.boxes) byCode.set(row.boxCode, row);
      if (byCode.size > 100) throw new Error('每批最多入库100个不同料箱，本次扫描未加入');
      const next = [...byCode.values()];
      if (needsLocation) {
        factoryId.value = boxes.value.length && factoryId.value !== result.factoryId ? '' : result.factoryId;
        boxes.value = next;
        notify('已暂存料箱，请扫描或选择入库地标');
        return;
      }
      if (!validLocation(result.location) || (target && result.location.locationCode !== target.locationCode)) {
        throw new Error('扫码返回的入库地标不一致，请重新选择');
      }
      if (!target || target.locationVersion !== result.location.locationVersion) {
        await preview(result.location.locationCode, next, id, false);
      } else {
        boxes.value = next;
        notice.value = null;
      }
    }).catch(error => { if (current(id)) report(error); }).finally(() => { if (id === generation) scans.value--; });
    return queue;
  }

  async function submit() {
    if (!active || writing.value || storageError.value || !saved.sameScope() || (!pending.value && !canSubmit.value)) return;
    const replay = !!pending.value;
    const input = pending.value?.input ?? { requestId: requestId(), locationCode: location.value!.locationCode,
      locationVersion: location.value!.locationVersion, items: boxes.value.map(batchItem) };
    writing.value = true;
    try {
      saved.save(input, '正在确认本次入库结果');
      const result = await api.submit(input);
      if (!matchesBatch(result, input)) throw new Error('入库回执不完整，请重试原请求核实结果');
      if (saved.finish(input.requestId)) release.offer(input.requestId);
      else release.restore();
      reset();
      if (active && saved.sameScope()) notify('线边入库成功，共 ' + result.affectedBoxCount + ' 箱');
    } catch (error) {
      const failures = error instanceof ApiRequestError && error.statusCode === 409
        ? (error.data as { failures?: { boxCode: string; registeredLocationCode?: string; reason: string }[] } | null)?.failures : undefined;
      const hasRows = Array.isArray(failures) && failures.length > 0;
      const definitive = hasRows || (!replay && error instanceof ApiRequestError && [400, 401, 403, 404, 409].includes(error.statusCode));
      if (definitive) {
        try { saved.finish(input.requestId); } catch (e) { report(e); return; }
        if (hasRows) {
          const conflicts = new Map(failures.map(row => [row.boxCode, row]));
          boxes.value = boxes.value.map(row => {
            const fail = conflicts.get(row.boxCode);
            return fail ? { ...row, allowed: false, reason: fail.reason, registeredLocationCode: fail.registeredLocationCode || row.registeredLocationCode } : row;
          });
        } else blockReason.value = '请重新预检后提交';
      } else saved.failed(error);
      if (active && saved.sameScope()) report(error);
    } finally { writing.value = false; }
  }
  return { release, location, boxes, factoryId, blockReason, pending, storageError, scans, checking, writing, locked, busy,
    canSubmit, notice, notify, scan, chooseLocation, submit, remove, clear, pause, resume };
}
