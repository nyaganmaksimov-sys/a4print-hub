const preloads = [
  '--import=./src/jarvis-network-resilience.js',
  '--import=./src/jarvis-warmkeeper.js',
  '--import=./src/jarvis-runtime-health.js',
  '--import=./src/jarvis-sentinel.js',
  '--import=./src/jarvis-cloud-response-guard.js',
  '--import=./src/jarvis-support-ai.js',
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
  '--import=./src/warehouse-stock.js',
  '--import=./src/pos-catalog-create.js',
  '--import=./src/pos-customer-directory.js',
  '--import=./src/saas-billing-preload.js',
  '--import=./src/supabase-storage-proxy.js',
  '--import=./src/jarvis-bridge.js',
  '--import=./src/jarvis-agent-bridge.js',
  '--import=./src/jarvis-control-bridge.js',
  '--import=./src/jarvis-hub-status.js',
  '--import=./src/jarvis-learning-bridge.js',
  '--import=./src/jarvis-route-normalizer.js'
];
const current = String(process.env.NODE_OPTIONS || '').trim();
const missing = preloads.filter(preload => !current.includes(preload));
if (missing.length) process.env.NODE_OPTIONS = [current, ...missing].filter(Boolean).join(' ');
await import('./internal-api-readiness.js');
await import('./supabase-storage-proxy.js');
await import('./mobile-proxy.js');
