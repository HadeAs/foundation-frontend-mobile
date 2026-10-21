import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import App from '../../App.vue';

const lifecycle = vi.hoisted(() => ({
  launch: undefined as (() => void) | undefined,
  show: undefined as (() => void) | undefined,
  start: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@dcloudio/uni-app', () => ({
  onLaunch: (callback: () => void) => { lifecycle.launch = callback; },
  onShow: (callback: () => void) => { lifecycle.show = callback; }
}));
vi.mock('../appUpdate', () => ({ startAppUpdatePolling: lifecycle.start }));

describe('App update lifecycle', () => {
  it('starts checks on launch and resumes them on foreground return', () => {
    const wrapper = mount(App);
    expect(lifecycle.launch).toBeTypeOf('function');
    expect(lifecycle.show).toBeTypeOf('function');
    lifecycle.launch?.();
    lifecycle.show?.();
    expect(lifecycle.start).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
