const preloads = [
  '--import=./src/pos-operator-patch.js',
  '--import=./src/pos-sale-idempotency.js',
  '--import=./src/pos-build-marker.js',
  '--import=./src/moysklad-shift-sanity.js',
  '--import=./src/pos-shift-fresh-open.js',
  '--import=./src/moysklad-receipt-sync.js',
  '--import=./src/pos-cash-operations.js',
  '--import=./src/pos-cash-balance.js',
  '--import=./src/cbr-rates.js',
  '--import=./src/partner-invites.js',
  '--import=./src/partner-admin.js',
  '--import=./src/pos-shift-control.js',
  '--import=./src/pos-cash-chain-selftest-2.js'
];
const current = String(process.env.NODE_OPTIONS || '').trim();
const missing = preloads.filter(preload => !current.includes(preload));
if (missing.length) process.env.NODE_OPTIONS = [current, ...missing].filter(Boolean).join(' ');
await import('./mobile-proxy.js');
