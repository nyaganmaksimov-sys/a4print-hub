const preload = '--import=./src/pos-operator-patch.js';
const current = String(process.env.NODE_OPTIONS || '').trim();
if (!current.includes(preload)) process.env.NODE_OPTIONS = [current, preload].filter(Boolean).join(' ');
await import('./mobile-proxy.js');
