import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MaterialRows from '../../components/MaterialRows.vue';
import type { MaterialLine } from '../vehicleLoading';

const panel: MaterialLine = { lineType: 'PANEL', panelCode: 'PANEL-1', orderNo: 'SO-1', materialCode: 'MAT-1', quantity: 1, materialBatch: '000001' };
describe('material rows', () => {
  it('omits absent optional names and units without a trailing separator or fabricated text', () => {
    const wrapper = mount(MaterialRows, { props: { materials: [panel], showBatch: true } });
    expect(wrapper.get('.material-sub').text()).toBe('MAT-1'); expect(wrapper.get('.material-quantity').text()).toBe('1');
    expect(wrapper.text()).toContain('批次 000001'); expect(wrapper.text()).not.toMatch(/undefined|null|MAT-1 ·/); wrapper.unmount();
  });
  it('keeps existing consumers unchanged unless batch display is enabled', () => {
    const wrapper = mount(MaterialRows, { props: { materials: [{ ...panel, materialName: '板件', unit: '件' }] } });
    expect(wrapper.get('.material-sub').text()).toBe('MAT-1 · 板件'); expect(wrapper.get('.material-quantity').text()).toBe('1 件');
    expect(wrapper.text()).not.toContain('批次'); wrapper.unmount();
  });
  it('renders quantity summaries without fabricating a panel code, name, unit or missing batch', () => {
    const wrapper = mount(MaterialRows, { props: { materials: [{ lineType: 'QUANTITY', orderNo: 'SO-1', materialCode: 'MAT-1', quantity: 5 }], showBatch: true } });
    expect(wrapper.get('.material-code').text()).toBe('MAT-1'); expect(wrapper.text()).toContain('数量汇总');
    expect(wrapper.text()).not.toContain('批次'); expect(wrapper.findAll('.material-sub')).toHaveLength(2); wrapper.unmount();
  });
});
