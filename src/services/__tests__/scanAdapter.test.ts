import { describe, expect, it, vi } from 'vitest';
import {
  createScanResult,
  getDataWedgeIntentKeys,
  getDataWedgeIntentValue,
  normalizeKeyboardBuffer,
  scanWithCamera
} from '../scanAdapter';

describe('scan adapter', () => {
  it('creates a normalized manual scan result', () => {
    const result = createScanResult(' EQP-001 ', 'manual', 1783400000000);

    expect(result).toEqual({
      value: 'EQP-001',
      source: 'manual',
      scannedAt: 1783400000000
    });
  });

  it('extracts keyboard wedge input when Enter terminates the scan', () => {
    const result = normalizeKeyboardBuffer(['E', 'Q', 'P', '-', '0', '0', '1', 'Enter'], 1783400000000);

    expect(result).toEqual({
      value: 'EQP-001',
      source: 'keyboard',
      scannedAt: 1783400000000
    });
  });

  it('returns null for incomplete keyboard input', () => {
    const result = normalizeKeyboardBuffer(['E', 'Q', 'P'], 1783400000000);

    expect(result).toBeNull();
  });

  it('wraps uni.scanCode results as camera source', async () => {
    const scanCode = vi.fn().mockImplementation(({ success }) => {
      success({ result: 'CAM-001' });
    });

    const result = await scanWithCamera({ scanCode }, 1783400000000);

    expect(result).toEqual({
      value: 'CAM-001',
      source: 'camera',
      raw: { result: 'CAM-001' },
      scannedAt: 1783400000000
    });
  });

  it('extracts Zebra DataWedge intent data', () => {
    const result = getDataWedgeIntentValue({
      getStringExtra: (key: string) => key === 'com.symbol.datawedge.data_string' ? 'DW-001' : null
    });

    expect(result).toBe('DW-001');
  });

  it('extracts Zebra DataWedge data from intent extras keys', () => {
    const keys = ['custom.scan.value'];
    const intent = {
      getExtras: () => ({
        keySet: () => ({
          iterator: () => {
            let index = 0;
            return {
              hasNext: () => index < keys.length,
              next: () => keys[index++]
            };
          }
        })
      }),
      getStringExtra: (key: string) => key === 'custom.scan.value' ? 'DW-002' : null
    };

    expect(getDataWedgeIntentKeys(intent)).toEqual(['custom.scan.value']);
    expect(getDataWedgeIntentValue(intent)).toBe('DW-002');
  });
});
