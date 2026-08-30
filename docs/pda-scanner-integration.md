# PDA Scanner Integration

The scan page consumes normalized scan events through `src/services/scanAdapter.ts`.

Supported scan sources:

- `manual`: user types a value in the scan input and confirms.
- `camera`: `uni.scanCode` returns a result.
- `keyboard`: a scanner sends characters followed by Enter.
- `pda-broadcast`: an Android native bridge receives a PDA broadcast and forwards it to the page.

For Zebra DataWedge, configure the profile to send barcode data through Intent Broadcast. The native Android layer should extract the scanned string and emit a JS event equivalent to:

```js
window.dispatchEvent(new CustomEvent('pda-scan', {
  detail: {
    value: 'EQP-20260707-001',
    raw: {}
  }
}));
```

The page intentionally displays only the scan result value. Source and raw event data remain available in the normalized `ScanResult` object for diagnostics and later expansion.
