import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OperationNotice from '../../components/OperationNotice.vue';

describe('shared operation notice', () => {
  it('renders success/error semantics and preserves the full backend reason as text', async () => {
    const wrapper = mount(OperationNotice);
    expect(wrapper.find('.notice').exists()).toBe(false);
    await wrapper.setProps({ text: '操作成功' });
    expect(wrapper.get('.notice').attributes('role')).toBe('status');
    expect(wrapper.get('.notice').classes()).not.toContain('notice--error');
    const reason = '<script>不可执行</script>' + '错误原因'.repeat(120);
    await wrapper.setProps({ text: reason, error: true });
    expect(wrapper.get('.notice').text()).toBe(reason);
    expect(wrapper.get('.notice').attributes('role')).toBe('alert');
    expect(wrapper.get('.notice').classes()).toContain('notice--error');
    expect(wrapper.find('script').exists()).toBe(false);
    await wrapper.setProps({ text: '' });
    expect(wrapper.find('.notice').exists()).toBe(false);
    wrapper.unmount();
  });
});
