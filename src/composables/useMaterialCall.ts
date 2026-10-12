import { computed, ref, shallowRef } from 'vue';
import { materialCallApi as api, type MaterialCallLocation, type MaterialCallBoxes, type MaterialCallRequest, type MaterialCallReceipt } from '../services/materialCall';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { getCurrentApiBaseUrl, getCurrentUser } from '../services/auth';
import type { Eligibility } from '../services/panelPacking';
import type { LocationSummary } from '../services/locationBinding';

interface Attempt { input: MaterialCallRequest; location: MaterialCallLocation; reason: string }
const validText = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const optionalText = (value: unknown) => value === undefined || validText(value);
const validVersion = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
const validEligibility = (value: Eligibility) => typeof value?.allowed === 'boolean' &&
  (value.reason === undefined ? value.allowed : validText(value.reason, 500));
const validLocation = (value: LocationSummary) => value && validText(value.locationCode) && validText(value.locationName) &&
  [value.locationType, value.floorCode, value.floorName, value.areaCode, value.areaName].every(optionalText);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reason = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试';

export function useMaterialCall() {
  const location = shallowRef<MaterialCallLocation | null>(null);
  const order = ref('');
  const result = shallowRef<MaterialCallBoxes | null>(null);
  const selected = ref<string[]>([]);
  const busy = ref(false);
  const notice = ref<{ text: string; error: boolean } | null>(null);
  const attempt = shallowRef<Attempt | null>(null);
  const storageError = ref('');
  const active = ref(true);
  const environment = getCurrentApiBaseUrl();
  const account = getCurrentUser()?.account || '';
  const sameScope = () => environment === getCurrentApiBaseUrl() && account === (getCurrentUser()?.account || '');
  const available = () => active.value && sameScope();
  const boxes = computed(() => result.value?.boxes || []);
  const disabled = computed(() => !active.value || !sameScope() || busy.value || !!attempt.value || !!storageError.value);
  const canQuery = computed(() => !disabled.value && !!location.value && validText(order.value.trim()));
  const canSubmit = computed(() => canQuery.value && !!result.value?.eligibility.allowed && result.value.orderNo === order.value.trim() &&
    result.value.destination.locationCode === location.value?.location.locationCode && selected.value.length > 0 && selected.value.length <= 1000 &&
    new Set(selected.value).size === selected.value.length &&
    selected.value.every((code) => boxes.value.some((box) => box.boxCode === code && box.eligibility.allowed)));
  // Persist before submitting. Leaving the page must not turn an uncertain request into a new batch.
  const storageKey = `foundation.material-calls.real.${environment}.${account}`;
  let generation = 0;
  let running = false;
  function notify(text: string, error = false) { if (available()) notice.value = { text, error }; }
  function restore() {
    try {
      const stored: unknown = uni.getStorageSync(storageKey);
      if (stored === '' || stored === null || stored === undefined) { attempt.value = null; storageError.value = ''; return; }
      const value = stored as Attempt;
      if (!value || typeof value !== 'object' || !value.input || typeof value.input.requestId !== 'string' || !uuid.test(value.input.requestId) ||
        !validText(value.input.orderNo) || !validText(value.input.destinationLocationCode) || !validVersion(value.input.destinationVersion) ||
        !validLocation(value.location?.location) || value.location.location.locationCode !== value.input.destinationLocationCode ||
        !validVersion(value.location.version) || value.location.occupied !== false || value.location.container !== undefined ||
        typeof value.reason !== 'string' || !value.reason.trim() ||
        !Object.keys(value.input).every(key => ['requestId', 'orderNo', 'destinationLocationCode', 'destinationVersion', 'boxes'].includes(key)) ||
        !Array.isArray(value.input.boxes) || value.input.boxes.length < 1 || value.input.boxes.length > 1000 ||
        !value.input.boxes.every(box => box && validText(box.boxCode) && validVersion(box.version) && Object.keys(box).every(key => ['boxCode', 'version'].includes(key))) ||
        new Set(value.input.boxes.map(box => box.boxCode)).size !== value.input.boxes.length) throw new Error('本地叫料记录异常');
      attempt.value = value; storageError.value = '';
    } catch {
      storageError.value = '无法读取有效的本地叫料记录，请保留记录并核实原请求，勿重复叫料';
      notify(storageError.value, true);
    }
  }
  function save(next = attempt.value) {
    uni.setStorageSync(storageKey, JSON.parse(JSON.stringify(next)));
    attempt.value = next;
    if (sameScope()) storageError.value = '';
  }
  function saveResult() {
    try { save(); } catch { storageError.value = '叫料结果记录保存失败，请保留原请求标识并核实，勿重复叫料'; }
  }
  restore();
  if (attempt.value) { location.value = attempt.value.location; order.value = attempt.value.input.orderNo; }
  function resetView() {
    generation++; location.value = null; order.value = ''; result.value = null; selected.value = [];
    busy.value = false; notice.value = null;
  }
  function clear() { if (available() && !attempt.value && !storageError.value) resetView(); }
  function pause() { active.value = false; resetView(); }
  async function resume() {
    active.value = true;
    notice.value = null;
    if (!sameScope()) {
      resetView(); storageError.value = '账号或环境已变化，请重新进入手动叫料页面';
      notice.value = { text: storageError.value, error: true }; return;
    }
    if (!running) restore();
    busy.value = running;
    if (attempt.value) {
      location.value = attempt.value.location; order.value = attempt.value.input.orderNo;
      notify(storageError.value || attempt.value.reason, true);
    }
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (running || !available()) return;
    const id = generation;
    running = true; busy.value = true; notice.value = null;
    try { await action(() => available() && id === generation); }
    catch (error) { if (available() && id === generation) notify(reason(error), true); }
    finally { running = false; busy.value = false; }
  }
  async function scan(raw: string) {
    if (!available() || disabled.value) return;
    clear();
    const code = raw.trim();
    if (!validText(code)) { notify('请输入有效位置编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const value = await api.getLocation(code);
      if (!current()) return;
      if (!value || !validLocation(value.location) || value.location.locationCode !== code || !validVersion(value.version) ||
        typeof value.occupied !== 'boolean' || value.container === null || !validEligibility(value.eligibility)) {
        throw new Error('位置信息不完整，请重新扫描');
      }
      if (value.occupied || value.container) throw new Error('当前库位已绑定容器，本次扫描无效，请扫描空闲库位');
      location.value = value;
    });
  }
  async function loadBoxes(code: string, orderNo: string, current: () => boolean) {
    const value = await api.getBoxes(code, orderNo);
    if (!current() || order.value.trim() !== orderNo || location.value?.location.locationCode !== code) return;
    if (!value || !validLocation(value.destination) || value.destination.locationCode !== code || value.orderNo !== orderNo || !validVersion(value.destinationVersion) ||
      ![value.destination.floorCode, value.destination.floorName, value.destination.areaCode, value.destination.areaName].every(value => validText(value)) ||
      !validEligibility(value.eligibility) || !Array.isArray(value.boxes) || value.boxes.some((box) => !box || !validText(box.boxCode) || !validVersion(box.version) ||
        box.orderNo !== orderNo || !validLocation(box.origin) || !validEligibility(box.eligibility) ||
        !Number.isInteger(box.materialQuantity) || box.materialQuantity < 0 || box.materialQuantity > 2147483647) ||
      new Set(value.boxes.map((box) => box.boxCode)).size !== value.boxes.length) throw new Error('箱子信息不完整或重复，请重新查询');
    result.value = value; selected.value = [];
    return value;
  }
  async function query() {
    if (!available() || !canQuery.value || !location.value) return;
    const code = location.value.location.locationCode;
    const orderNo = order.value.trim();
    await run(async (current) => {
      const value = await loadBoxes(code, orderNo, current);
      if (value && !value.eligibility.allowed) notify(value.eligibility.reason!, true);
      else if (value && !value.boxes.length) notify('该生产订单暂无可叫料箱子');
    });
  }
  function toggle(code: string) {
    if (!available() || disabled.value || !result.value?.eligibility.allowed || !boxes.value.some((box) => box.boxCode === code && box.eligibility.allowed)) return;
    if (selected.value.includes(code)) selected.value = selected.value.filter((item) => item !== code);
    else if (selected.value.length >= 1000) notify('一次最多选择1000箱，请减少本次选择', true);
    else selected.value.push(code);
  }
  function applyReceipt(current: Attempt, value: MaterialCallReceipt, show: boolean) {
    const input = current.input;
    if (!value || value.requestId !== input.requestId || value.orderNo !== input.orderNo || !validText(value.callNo) ||
      !validLocation(value.destination) || value.destination.locationCode !== input.destinationLocationCode ||
      typeof value.createdTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.createdTime) ||
      !Number.isFinite(Date.parse(value.createdTime)) || !Array.isArray(value.tasks) || value.tasks.length !== input.boxes.length ||
      value.tasks.some((task) => !task || !input.boxes.some((box) => box.boxCode === task.boxCode) || typeof task.taskId !== 'string' ||
        !/^[1-9][0-9]{0,18}$/.test(task.taskId) || !validText(task.taskNo) || !['QUEUED', 'DISPATCHED', 'FAILED', 'UNKNOWN', 'COMPLETED', 'CANCELLED'].includes(task.dispatchState) ||
        !optionalText(task.reason) || ['FAILED', 'UNKNOWN'].includes(task.dispatchState) && !validText(task.reason)) ||
      new Set(value.tasks.map((task) => task.boxCode)).size !== value.tasks.length || new Set(value.tasks.map((task) => task.taskId)).size !== value.tasks.length) {
      throw new Error('叫料回执不完整，暂无法确认结果');
    }
    if (attempt.value?.input.requestId !== input.requestId) return;
    const exceptions = value.tasks.filter((task) => ['FAILED', 'UNKNOWN', 'CANCELLED'].includes(task.dispatchState));
    try { save(null); } catch { storageError.value = '叫料结果记录保存失败，请保留原请求标识并核实，勿重复叫料'; throw new Error(storageError.value); }
    if (available()) resetView();
    if (show) {
      const states = { QUEUED: '等待后台派送', DISPATCHED: '已派送，不代表到达', COMPLETED: '已完成', FAILED: '派送失败', UNKNOWN: '派送结果未知', CANCELLED: '已取消' };
      notify(exceptions.length ? `叫料任务已创建（${value.callNo}），派送状态：${exceptions.map((task) => `${task.boxCode}：${task.reason || states[task.dispatchState]}`).join('；')}`
        : `叫料成功，已提交 ${value.tasks.length} 箱（${value.callNo}），${[...new Set(value.tasks.map(task => states[task.dispatchState]))].join('；')}`, !!exceptions.length);
    }
  }
  async function checkAttempt(current: Attempt, visible: () => boolean) {
    try { applyReceipt(current, await api.submit(current.input), visible()); }
    catch (error) {
      if (attempt.value?.input.requestId !== current.input.requestId) return;
      attempt.value = { ...current, reason: `叫料结果尚未确认：${reason(error)}；请重试原请求，勿重新叫料` };
      saveResult(); if (visible()) notify(storageError.value || attempt.value.reason, true);
    }
  }
  async function check() {
    const current = attempt.value;
    if (available() && !storageError.value && current) await run((visible) => checkAttempt(current, visible));
  }
  async function submit() {
    if (!available() || !canSubmit.value || !location.value || !result.value) return;
    const input: MaterialCallRequest = { requestId: requestId(), destinationLocationCode: result.value.destination.locationCode,
      destinationVersion: result.value.destinationVersion, orderNo: result.value.orderNo,
      boxes: boxes.value.filter((box) => selected.value.includes(box.boxCode)).map(({ boxCode, version }) => ({ boxCode, version })) };
    const current: Attempt = { input, location: location.value, reason: '正在确认叫料结果，请勿重复提交' };
    await run(async (visible) => {
      attempt.value = current;
      try { save(); } catch {
        attempt.value = null; notify('无法保存请求标识，未提交叫料，请检查本地存储', true); return;
      }
      try { applyReceipt(current, await api.submit(input), visible()); }
      catch (error) {
        if (attempt.value?.input.requestId !== input.requestId) return;
        // Only an explicit rejection proves no batch was created. Timeout, 5xx and bad receipts are uncertain.
        if (error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) {
          try { save(null); } catch {
            storageError.value = '叫料结果记录保存失败，请保留原请求标识并核实，勿重复叫料';
            if (visible()) notify(storageError.value, true); return;
          }
          if (!visible() || order.value.trim() !== input.orderNo) return;
          const failure = reason(error);
          result.value = null; selected.value = []; notify(failure, true);
          try {
            const value = await loadBoxes(input.destinationLocationCode, input.orderNo, visible);
            if (value) notify(failure, true);
          } catch (refreshError) {
            if (visible()) notify(`${failure}；箱子清单刷新失败：${reason(refreshError)}`, true);
          }
        } else {
          attempt.value = { ...current, reason: `叫料结果尚未确认：${reason(error)}；请勿重复提交` };
          saveResult();
          if (visible()) notify(storageError.value || attempt.value.reason, true);
        }
      }
    });
  }
  return { location, order, result, boxes, selected, busy, disabled, notice, attempt, storageError, canQuery, canSubmit,
    notify, clear, pause, resume, scan, query, toggle, submit, check };
}
