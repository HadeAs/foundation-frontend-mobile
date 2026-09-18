import { onUnmounted, watch, type Ref } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';

// Keyboard-wedge devices send Enter; focused inputs keep their own submit behavior.
export function useKeyboardScanner(onScan: (value: string) => void | Promise<void>, disabled: Readonly<Ref<boolean>>) {
  let buffer = '';
  let lastKeyAt = 0;
  const reset = () => { buffer = ''; lastKeyAt = 0; };
  function onKey(event: KeyboardEvent) {
    const target = event.target;
    if (disabled.value || target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) { reset(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) { reset(); return; }
    if (Date.now() - lastKeyAt > 300) buffer = '';
    lastKeyAt = Date.now();
    if (event.key === 'Enter') {
      const value = buffer;
      reset();
      if (value) { event.preventDefault(); void onScan(value); }
    } else if (event.key.length === 1) buffer += event.key;
  }
  function stop() {
    reset();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
  }
  watch(disabled, reset, { flush: 'sync' });
  onShow(() => {
    reset();
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
  });
  onHide(stop);
  onUnmounted(stop);
  return { reset };
}
