import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useKeyboardScanner } from '../../composables/useKeyboardScanner';

const hooks = vi.hoisted(() => ({ show: [] as (() => void)[], hide: [] as (() => void)[] }));
vi.mock('@dcloudio/uni-app', () => ({
  onShow: (callback: () => void) => hooks.show.push(callback),
  onHide: (callback: () => void) => hooks.hide.push(callback)
}));
let wrapper: VueWrapper;
const disabled = ref(false);
const scan = vi.fn();
let reset: () => void;
function key(value: string, target: EventTarget = window, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
function barcode(value: string) { for (const char of value) key(char); return key('Enter'); }
beforeEach(() => {
  vi.useFakeTimers(); disabled.value = false; scan.mockReset(); hooks.show.length = 0; hooks.hide.length = 0;
  wrapper = mount(defineComponent({
    setup() { ({ reset } = useKeyboardScanner(scan, disabled)); },
    template: '<div><input /><textarea /><div contenteditable="true"><span>editable</span></div></div>'
  }), { attachTo: document.body });
});
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); });

describe('shared keyboard scanner', () => {
  it('submits one complete unfocused scan on Enter, with no duplicate listener on repeated show', () => {
    barcode('HIDDEN'); expect(scan).not.toHaveBeenCalled();
    hooks.show.forEach((show) => { show(); show(); });
    key('A'); key('B'); expect(scan).not.toHaveBeenCalled();
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(scan.mock.calls).toEqual([['AB']]);
    expect(key('Enter').defaultPrevented).toBe(false);
  });
  it('leaves focused manual fields alone and clears partially collected scans', () => {
    hooks.show.forEach((show) => show());
    for (const selector of ['input', 'textarea', '[contenteditable] span']) {
      key('A');
      const target = wrapper.get(selector).element;
      key('B', target);
      expect(key('Enter', target).defaultPrevented).toBe(false);
      key('Enter');
    }
    expect(scan).not.toHaveBeenCalled();
    barcode('VALID'); expect(scan.mock.calls).toEqual([['VALID']]);
  });
  it('discards the buffer on busy/modal transitions, modifiers and IME composition', () => {
    hooks.show.forEach((show) => show());
    key('A'); disabled.value = true; disabled.value = false; key('Enter');
    disabled.value = true; barcode('BUSY'); disabled.value = false;
    for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
      key('A'); key('B', window, options); key('Enter');
    }
    expect(scan).not.toHaveBeenCalled();
    barcode('NEXT'); expect(scan.mock.calls).toEqual([['NEXT']]);
  });
  it('resets after a 300ms gap or clearing the page and does not scan offscreen or after unmount', () => {
    hooks.show.forEach((show) => show());
    key('A'); vi.advanceTimersByTime(301); key('B'); key('Enter');
    expect(scan.mock.calls).toEqual([['B']]); scan.mockClear();
    key('A'); reset(); key('Enter');
    key('A'); hooks.hide.forEach((hide) => hide()); barcode('HIDDEN');
    hooks.show.forEach((show) => show()); key('Enter');
    expect(scan).not.toHaveBeenCalled();
    barcode('VISIBLE'); expect(scan.mock.calls).toEqual([['VISIBLE']]);
    wrapper.unmount(); barcode('REMOVED'); expect(scan).toHaveBeenCalledTimes(1);
  });
});
