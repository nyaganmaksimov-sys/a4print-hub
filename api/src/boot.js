const preloads = [
  '--import=./src/pos-operator-patch.js',
  '--import=./src/pos-shift-live-patch.js'
];
const current = String(process.env.NODE_OPTIONS || '').trim();
const missing = preloads.filter(preload => !current.includes(preload));
if (missing.length) process.env.NODE_OPTIONS = [current, ...missing].filter(Boolean).join(' ');
await import('./mobile-proxy.js');
