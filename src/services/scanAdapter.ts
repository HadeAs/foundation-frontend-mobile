import type { ScanResult, ScanSource } from '../types/scan';

interface UniLike {
  scanCode(options: {
    success: (res: UniApp.ScanCodeSuccessRes) => void;
    fail: (error: unknown) => void;
  }): void;
}

export function createScanResult(
  value: string,
  source: ScanSource,
  scannedAt = Date.now(),
  raw?: unknown
): ScanResult {
  const result: ScanResult = {
    value: value.trim(),
    source,
    scannedAt
  };

  if (raw !== undefined) {
    result.raw = raw;
  }

  return result;
}

export function normalizeKeyboardBuffer(keys: string[], scannedAt = Date.now()): ScanResult | null {
  if (keys[keys.length - 1] !== 'Enter') {
    return null;
  }

  const value = keys.slice(0, -1).join('').trim();
  return value ? createScanResult(value, 'keyboard', scannedAt) : null;
}

export function scanWithCamera(uniApi: UniLike = uni, scannedAt = Date.now()): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    uniApi.scanCode({
      success: (res) => {
        const value = res.result ?? '';
        resolve(createScanResult(value, 'camera', scannedAt, res));
      },
      fail: reject
    });
  });
}

export function createPdaBroadcastResult(value: string, raw?: unknown, scannedAt = Date.now()): ScanResult {
  return createScanResult(value, 'pda-broadcast', scannedAt, raw);
}

const dataWedgeResultKeys = [
  'com.symbol.datawedge.data_string',
  'com.motorolasolutions.emdk.datawedge.data_string',
  'com.symbol.datawedge.decode_data',
  'barcode_string',
  'data'
];

function getIntentExtraKeys(intent: unknown): string[] {
  const getExtras = (intent as { getExtras?: () => unknown })?.getExtras;
  if (typeof getExtras !== 'function') {
    return Object.keys(intent as Record<string, unknown>);
  }

  const extras = getExtras.call(intent) as {
    keySet?: () => { iterator?: () => { hasNext?: () => boolean; next?: () => unknown } };
  } | null;
  const iterator = extras?.keySet?.().iterator?.();
  const keys: string[] = [];

  while (iterator?.hasNext?.() && keys.length < 20) {
    const key = iterator.next?.();
    if (typeof key === 'string') {
      keys.push(key);
    }
  }

  return keys;
}

export function getDataWedgeIntentValue(intent: unknown): string {
  const getStringExtra = (intent as { getStringExtra?: (key: string) => string | null })?.getStringExtra;
  if (typeof getStringExtra === 'function') {
    const keys = [...dataWedgeResultKeys, ...getIntentExtraKeys(intent)];
    for (const key of keys) {
      const value = getStringExtra.call(intent, key);
      if (value?.trim()) {
        return value;
      }
    }
  }

  const extras = intent as Record<string, unknown>;
  for (const key of dataWedgeResultKeys) {
    const value = extras?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return '';
}

export function getDataWedgeIntentKeys(intent: unknown): string[] {
  return getIntentExtraKeys(intent);
}
