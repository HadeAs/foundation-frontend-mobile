export type ScanSource = 'manual' | 'camera' | 'pda-broadcast' | 'keyboard';

export interface ScanResult {
  value: string;
  source: ScanSource;
  raw?: unknown;
  scannedAt: number;
}
