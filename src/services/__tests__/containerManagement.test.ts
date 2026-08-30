import { describe, expect, it } from 'vitest';
import { fetchContainerDetail } from '../containerManagement';

describe('container management service', () => {
  it('returns container basic info and hierarchical children by code', async () => {
    const detail = await fetchContainerDetail('ct-a001');

    expect(detail).not.toBeNull();
    expect(detail?.container).toMatchObject({
      code: 'CT-A001',
      type: '托盘'
    });
    expect(detail?.children).toHaveLength(3);
    expect(detail?.children[0]).toMatchObject({
      kind: 'container',
      container: {
        code: 'BOX-A001',
        type: '周转箱'
      }
    });
  });

  it('includes inventory nodes under nested containers', async () => {
    const detail = await fetchContainerDetail('CT-A001');
    const firstChild = detail?.children[0];

    expect(firstChild?.kind).toBe('container');
    if (firstChild?.kind !== 'container') {
      throw new Error('expected first child to be a container node');
    }

    expect(firstChild.children[0]).toMatchObject({
      kind: 'inventory',
      inventory: {
        barcodeNo: 'BC202607070001',
        materialCode: 'MAT-1001'
      }
    });
  });

  it('returns direct inventory for a child container code', async () => {
    const detail = await fetchContainerDetail('BOX-A002');

    expect(detail?.container).toMatchObject({
      code: 'BOX-A002',
      type: '周转箱'
    });
    expect(detail?.children.every((child) => child.kind === 'inventory')).toBe(true);
  });

  it('returns null when the container does not exist', async () => {
    const detail = await fetchContainerDetail('UNKNOWN-001');

    expect(detail).toBeNull();
  });
});
