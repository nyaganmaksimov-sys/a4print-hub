const jarvisEnabled = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_ENABLED || '').trim());

const jarvisPreloads = [
  '--import=./src/jarvis-network-resilience.js',
  '--import=./src/jarvis-warmkeeper.js',
  '--import=./src/jarvis-runtime-health.js',
  '--import=./src/jarvis-sentinel.js',
  '--import=./src/jarvis-cloud-response-guard.js',
  '--import=./src/jarvis-support-ai.js',
  '--import=./src/jarvis-incident-ops.js',
  '--import=./src/jarvis-bridge.js',
  '--import=./src/jarvis-agent-bridge.js',
  '--import=./src/jarvis-control-bridge.js',
  '--import=./src/jarvis-hub-status.js',
  '--import=./src/jarvis-learning-bridge.js',
  '--import=./src/jarvis-route-normalizer.js'
];

const corePreloads = [
  '--import=./src/manager-workspace.js',
  '--import=./src/pos-operator-patch.js',
  '--import=./src/pos-sale-idempotency.js',
  '--import=./src/pos-return-idempotency.js',
  '--import=./src/pos-cash-operation-idempotency.js',
  '--import=./src/pos-build-marker.js',
  '--import=./src/moysklad-shift-sanity.js',
  '--import=./src/pos-shift-live-patch.js',
  '--import=./src/pos-shift-fresh-open.js',
  '--import=./src/moysklad-receipt-sync.js',
  '--import=./src/pos-cash-operations.js',
  '--import=./src/pos-cash-balance.js',
  '--import=./src/cbr-rates.js',
  '--import=./src/partner-invites.js',
  '--import=./src/partners-compat-api.js',
  '--import=./src/partner-admin.js',
  '--import=./src/pos-shift-control.js',
  '--import=./src/warehouse-stock.js',
  '--import=./src/pos-catalog-create.js',
  '--import=./src/pos-customer-directory.js',
  '--import=./src/saas-billing-preload.js',
  '--import=./src/supabase-storage-proxy.js'
];

const preloads = jarvisEnabled ? [...jarvisPreloads, ...corePreloads] : corePreloads;
let current = String(process.env.NODE_OPTIONS || '').trim();

// JARVIS stays completely off until A4PRINT HUB moves to owned infrastructure.
// Strip stale runtime flags too, so an old NODE_OPTIONS value cannot resurrect it.
if (!jarvisEnabled && current) {
  const disabled = new Set(jarvisPreloads);
  current = current.split(/\s+/).filter(option => !disabled.has(option)).join(' ');
  process.env.NODE_OPTIONS = current;
}

const missing = preloads.filter(preload => !current.includes(preload));
if (missing.length) process.env.NODE_OPTIONS = [current, ...missing].filter(Boolean).join(' ');
console.log(`[A4 JARVIS] ${jarvisEnabled ? 'enabled' : 'disabled'}`);
await import('./internal-api-readiness.js');
await import('./supabase-storage-proxy.js');
await import('./mobile-proxy.js');
