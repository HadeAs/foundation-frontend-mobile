import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prototype = readFileSync(resolve('docs/workbench-prototype.html'), 'utf8');

describe('离线物流原型工作台', () => {
  let frame: HTMLIFrameElement;
  let doc: Document;

  beforeEach(() => {
    frame = document.createElement('iframe');
    document.body.appendChild(frame);
    doc = frame.contentDocument!;
    doc.open();
    doc.write(prototype);
    doc.close();
  });

  afterEach(() => frame.remove());

  function element<T extends HTMLElement>(selector: string): T {
    const match = doc.querySelector<T>(selector);
    if (!match) throw new Error('原型中缺少 ' + selector);
    return match;
  }

  function open(route: string) {
    const select = element<HTMLSelectElement>('[data-screen-picker]');
    if (route === 'line-side-inbound-records') {
      expect(select.querySelector('[value="line-side-inbound-records"]')).toBeNull();
      const win = frame.contentWindow!;
      win.location.hash = route;
      win.dispatchEvent(new Event('hashchange'));
      return;
    }
    select.value = route;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function scan(code: string) {
    const input = element<HTMLInputElement>('[data-sequence-input]');
    input.value = code;
    element('[data-action="scan-input"]').click();
  }

  it('三类菜单均可进入，并展示对应的操作说明', () => {
    const entries = Array.from(doc.querySelectorAll<HTMLElement>('.nari-menu-entry'), menu => ({
      name: menu.textContent?.trim(),
      route: menu.dataset.go!,
    }));
    expect(entries).toHaveLength(20);
    expect(new Set(entries.map(menu => menu.route)).size).toBe(20);
    for (const menu of entries) {
      open(menu.route);
      expect(element('.nari-appbar-title').textContent).toBe(menu.name);
      expect(element('[data-guide] li').textContent).toBeTruthy();
    }
    expect(doc.querySelector('iframe, script[src], link[rel="stylesheet"]')).toBeNull();
  });

  it.each([
    ['AGV-20260904-0015', 0, '调度正在处理中'],
    ['AGV-20260904-0018', 1, '当前运输单未挂起'],
    ['AGV-20260904-0017', 1, '任务已继续'],
  ] as const)('运输单 %s 两种操作均可确认，提交后显示处理结果', async (id, index, result) => {
    open('logistics-cancel');
    const actions = element(`[data-cancel-task="${id}"] .transport-actions`);
    const buttons = actions.querySelectorAll('button');
    expect(actions.textContent).toBe('取消任务继续任务');
    expect(buttons[0].className).toBe(buttons[1].className);
    expect(Array.from(buttons).every(b => !b.disabled)).toBe(true);
    const request = vi.fn();
    doc.addEventListener('nari-mock-request', request, true);
    buttons[index].click();
    expect(request).not.toHaveBeenCalled();
    element('[data-modal-primary]').click();
    await vi.waitFor(() => expect(doc.querySelector('.nari-toast')?.textContent).toContain(result));
    expect(request).toHaveBeenCalledOnce();
  });

  it('地标查询按范围和楼层筛选并分页', () => {
    open('landmark-query');
    expect(doc.querySelectorAll('[data-list-scroll] .wb-card')).toHaveLength(20);
    element('[data-wb="more-landmarks"]').click();
    expect(doc.querySelectorAll('[data-list-scroll] .wb-card')).toHaveLength(32);
    for (const [key, value] of [['floor', '4'], ['scope', 'STANDARD']]) {
      const select = element<HTMLSelectElement>(`[data-landmark="${key}"]`);
      select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const rows = Array.from(doc.querySelectorAll('[data-list-scroll] .wb-card'));
    expect(rows).toHaveLength(4); expect(rows.every(r => r.textContent?.includes('LM-4F-'))).toBe(true);
  });

  it('混扫去重后只将最终确认的箱写入历史，冲突保留整批', () => {
    open('line-side-inbound');
    scan('BOX-4F-EAST');
    scan('BOX-4F-01');
    scan('CAR-4F-01');
    scan('CAR-4F-EMPTY');
    expect(doc.querySelectorAll('[data-wb="remove-box"]')).toHaveLength(3);
    element('[data-wb="remove-box"][data-value="BOX-4F-01"]').click();
    element('[data-wb="scenario"][data-value="conflict"]').click();
    element('[data-wb="inbound-submit"]').click();
    expect(element<HTMLButtonElement>('[data-wb="inbound-submit"]').disabled).toBe(true);
    open('line-side-inbound-records');
    scan('BOX-4F-EAST');
    expect(doc.querySelector('[data-wb="record-detail"]')).toBeNull();
    open('line-side-inbound');
    element('[data-wb="recheck"]').click();
    element('[data-wb="inbound-submit"]').click();
    open('line-side-inbound-records');
    scan('BOX-4F-EAST');
    element('[data-wb="record-detail"]').click();
    expect(element('[role="dialog"]').textContent).toContain('00031');
    element('[data-modal-close]').click();
    scan('BOX-4F-01');
    expect(doc.querySelector('[data-wb="record-detail"]')).toBeNull();
  });

  it('单箱接收后的剩余范围可不予上架，必须填写原因', () => {
    open('receive-box');
    scan('BOX-AP-01');
    element('[data-wb="receive-application"]').click();
    expect(element('[role="dialog"]').textContent).toContain('是否解绑车与位置关系');
    element('[data-modal-primary="confirm-release"]').click();
    expect(element('[role="dialog"]').textContent).toContain('等待料箱处理');
    element('[data-modal-close]').click();
    open('pending-tasks');
    element('[data-wb="app-details"][data-value="JK-DEMO-01"]').click();
    expect(element('[role="dialog"]').textContent).toContain('SO-20260901-018 · 3 件');
    expect(element<HTMLInputElement>('[data-application="JK-DEMO-01"]').checked).toBe(false);
    element('[data-modal-close]').click();
    const first = element<HTMLInputElement>('[data-application="JK-DEMO-01"]');
    expect(first.closest('.wb-card')?.textContent).toContain('实收 1 / 2');
    first.click();
    element('[data-application="JK-DEMO-02"]').click();
    element('[data-wb="reject"]').click();
    const confirm = element<HTMLButtonElement>('[data-modal-primary="reject-confirm"]');
    expect(confirm.disabled).toBe(true);
    const reason = element<HTMLTextAreaElement>('[data-reject-reason]');
    reason.value = '取消本次剩余范围';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    confirm.click();
    expect(doc.querySelector('[data-application="JK-DEMO-01"], [data-application="JK-DEMO-02"]')).toBeNull();
    open('receive-box');
    scan('CAR-AP-01');
    expect(doc.querySelector('[data-wb="receive-application"]')).toBeNull();
  });
});
