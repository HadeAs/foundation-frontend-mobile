import { computed, ref, shallowRef } from 'vue';
import { materialCallApi as api, type MaterialCallLocation, type MaterialCallBoxes, type MaterialCallRequest, type MaterialCallReceipt } from '../services/materialCall';
import { ApiRequestError, requestId } from '../services/nariRequest';
import { getCurrentApiBaseUrl, getCurrentUser } from '../services/auth';
import type { Eligibility } from '../services/panelPacking';

interface Attempt { input: MaterialCallRequest; location: MaterialCallLocation; reason: string }
const validText = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 128;
const validVersion = (value: number) => Number.isInteger(value) && value > 0 && value <= 2147483647;
const validEligibility = (value: Eligibility) => typeof value?.allowed === 'boolean' &&
  (value.allowed || typeof value.reason === 'string' && !!value.reason.trim() && value.reason.length <= 500);
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
  const receipt = shallowRef<MaterialCallReceipt | null>(null);
  const boxes = computed(() => result.value?.boxes || []);
  const disabled = computed(() => busy.value || !!attempt.value);
  const canQuery = computed(() => !disabled.value && !!location.value && validText(order.value.trim()));
  const canSubmit = computed(() => canQuery.value && !!result.value?.eligibility.allowed && result.value.orderNo === order.value.trim() &&
    result.value.destination.locationCode === location.value?.location.locationCode && selected.value.length > 0 && selected.value.length <= 1000 &&
    selected.value.every((code) => boxes.value.some((box) => box.boxCode === code && box.eligibility.allowed)));
  // Persist before submitting. Leaving the page must not turn an uncertain request into a new batch.
  const storageKey = `foundation.material-calls.real.${getCurrentApiBaseUrl()}.${getCurrentUser()?.account || ''}`;
  const stored: unknown = uni.getStorageSync(storageKey);
  const record = stored && typeof stored === 'object' ? stored : null;
  const restored = record as Attempt | null;
  if (restored?.input && uuid.test(restored.input.requestId) && validText(restored.input.orderNo) && validVersion(restored.input.destinationVersion) &&
    validText(restored.input.destinationLocationCode) && restored.location?.location?.locationCode === restored.input.destinationLocationCode &&
    Array.isArray(restored.input.boxes) && restored.input.boxes.length > 0 && restored.input.boxes.length <= 1000 &&
    restored.input.boxes.every((box: MaterialCallRequest['boxes'][number]) => box && validText(box.boxCode) && validVersion(box.version)) &&
    new Set(restored.input.boxes.map((box: MaterialCallRequest['boxes'][number]) => box.boxCode)).size === restored.input.boxes.length) {
    attempt.value = restored;
    location.value = restored.location; order.value = restored.input.orderNo;
  }
  let generation = 0;
  let active = true;
  function notify(text: string, error = false) { notice.value = { text, error }; }
  function save() { uni.setStorageSync(storageKey, JSON.parse(JSON.stringify(attempt.value))); }
  function saveResult() {
    try { save(); } catch { if (active) notify('结果记录保存失败，请保留请求标识并核实叫料结果', true); }
  }
  function resetView() {
    generation++; location.value = null; order.value = ''; result.value = null; selected.value = [];
    busy.value = false; notice.value = null; receipt.value = null;
  }
  function clear() { if (!attempt.value) resetView(); }
  function pause() { active = false; resetView(); }
  async function resume() {
    active = true;
    if (attempt.value) {
      location.value = attempt.value.location; order.value = attempt.value.input.orderNo;
      await check();
    }
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy.value || !active) return;
    const id = generation;
    busy.value = true; notice.value = null;
    try { await action(() => active && id === generation); }
    catch (error) { if (active && id === generation) notify(reason(error), true); }
    finally { if (id === generation) busy.value = false; }
  }
  async function scan(raw: string) {
    if (disabled.value) return;
    clear();
    const code = raw.trim();
    if (!validText(code)) { notify('请输入有效位置编码（最多128个字符）', true); return; }
    await run(async (current) => {
      const value = await api.getLocation(code);
      if (!current()) return;
      if (!value || value.location?.locationCode !== code || !validText(value.location.locationName) || !validVersion(value.version) || typeof value.occupied !== 'boolean') {
        throw new Error('位置信息不完整，请重新扫描');
      }
      if (value.occupied || value.container) throw new Error('当前库位已绑定容器，本次扫描无效，请扫描空闲库位');
      location.value = value;
    });
  }
  async function loadBoxes(code: string, orderNo: string, current: () => boolean) {
    const value = await api.getBoxes(code, orderNo);
    if (!current() || order.value.trim() !== orderNo || location.value?.location.locationCode !== code) return;
    if (!value || value.destination?.locationCode !== code || value.orderNo !== orderNo || !validVersion(value.destinationVersion) ||
      ![value.destination.locationName, value.destination.floorCode, value.destination.floorName, value.destination.areaCode, value.destination.areaName].every(validText) ||
      !validEligibility(value.eligibility) || !Array.isArray(value.boxes) || value.boxes.some((box) => !box || !validText(box.boxCode) || !validVersion(box.version) ||
        box.orderNo !== orderNo || !validText(box.origin?.locationCode) || !validText(box.origin.locationName) || !validEligibility(box.eligibility) ||
        !Number.isInteger(box.materialQuantity) || box.materialQuantity < 0 || box.materialQuantity > 2147483647) ||
      new Set(value.boxes.map((box) => box.boxCode)).size !== value.boxes.length) throw new Error('箱子信息不完整或重复，请重新查询');
    result.value = value; selected.value = [];
    return value;
  }
  async function query() {
    if (!canQuery.value || !location.value) return;
    const code = location.value.location.locationCode;
    const orderNo = order.value.trim();
    await run(async (current) => {
      const value = await loadBoxes(code, orderNo, current);
      if (value && !value.eligibility.allowed) notify(value.eligibility.reason!, true);
      else if (value && !value.boxes.length) notify('该生产订单暂无可叫料箱子');
    });
  }
  function toggle(code: string) {
    if (disabled.value || !result.value?.eligibility.allowed || !boxes.value.some((box) => box.boxCode === code && box.eligibility.allowed)) return;
    if (selected.value.includes(code)) selected.value = selected.value.filter((item) => item !== code);
    else if (selected.value.length >= 1000) notify('一次最多选择1000箱，请减少本次选择', true);
    else selected.value.push(code);
  }
  function applyReceipt(current: Attempt, value: MaterialCallReceipt, show: boolean) {
    const input = current.input;
    if (!value || value.requestId !== input.requestId || value.orderNo !== input.orderNo || !validText(value.callNo) ||
      value.destination?.locationCode !== input.destinationLocationCode || !validText(value.destination.locationName) ||
      typeof value.createdTime !== 'string' || !Number.isFinite(Date.parse(value.createdTime)) || !Array.isArray(value.tasks) || value.tasks.length !== input.boxes.length ||
      value.tasks.some((task) => !task || !input.boxes.some((box) => box.boxCode === task.boxCode) || typeof task.taskId !== 'string' ||
        !/^[1-9][0-9]{0,18}$/.test(task.taskId) || !validText(task.taskNo) || !['QUEUED', 'DISPATCHED', 'FAILED', 'UNKNOWN', 'COMPLETED'].includes(task.dispatchState) ||
        ['FAILED', 'UNKNOWN'].includes(task.dispatchState) && !validText(task.reason)) ||
      new Set(value.tasks.map((task) => task.boxCode)).size !== value.tasks.length || new Set(value.tasks.map((task) => task.taskId)).size !== value.tasks.length) {
      throw new Error('叫料回执不完整，暂无法确认结果');
    }
    if (attempt.value?.input.requestId !== input.requestId) return;
    const exceptions = value.tasks.filter((task) => ['FAILED', 'UNKNOWN'].includes(task.dispatchState));
    if (value.tasks.some((task) => task.dispatchState === 'UNKNOWN')) {
      attempt.value = { ...current, reason: exceptions.map((task) => `${task.boxCode}：${task.reason}`).join('；') };
      if (show) { receipt.value = value; notify(attempt.value.reason, true); }
    } else {
      attempt.value = null;
      if (show) {
        resetView();
        notify(exceptions.length ? `叫料任务已创建（${value.callNo}），派送失败：${exceptions.map((task) => `${task.boxCode}：${task.reason}`).join('；')}`
          : `叫料成功，已提交 ${value.tasks.length} 箱（${value.callNo}），等待后台派送`, !!exceptions.length);
      }
    }
    saveResult();
  }
  async function checkAttempt(current: Attempt, visible: () => boolean) {
    try { applyReceipt(current, await api.getResult(current.input.requestId), visible()); }
    catch (error) {
      if (attempt.value?.input.requestId !== current.input.requestId) return;
      attempt.value = { ...current, reason: `叫料结果尚未确认：${reason(error)}；请查询原请求结果，勿重复提交` };
      saveResult(); if (visible()) notify(attempt.value.reason, true);
    }
  }
  async function check() {
    const current = attempt.value;
    if (current) await run((visible) => checkAttempt(current, visible));
  }
  async function submit() {
    if (!canSubmit.value || !location.value || !result.value) return;
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
          attempt.value = null; saveResult();
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
          if (visible()) { notify(attempt.value.reason, true); await checkAttempt(attempt.value, visible); }
        }
      }
    });
  }
  return { location, order, result, boxes, selected, busy, disabled, notice, attempt, receipt, canQuery, canSubmit,
    notify, clear, pause, resume, scan, query, toggle, submit, check };
}
