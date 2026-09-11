import './voice-engine.js?v=20260911-voice3';
import { supabase } from './guard.js?v=20260905-netfix1';

const cfg = window.A4PRINT_CONFIG || {};
const STORAGE_SEEN = 'a4_jarvis_sentinel_seen_v1';
const STORAGE_VOICE = 'a4_jarvis_voice_enabled_v2';
const state = { initialized: false, busy: false, items: [], timer: null };

function apiBase() { return String(cfg.apiBaseUrl || '').replace(/\/$/, ''); }
async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ''; }
async function api(path, options = {}) {
  const access = await token();
  if (!access) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function seenSet() {
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_SEEN) || '[]'); return new Set(Array.isArray(parsed) ? parsed : []); }
  catch { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(STORAGE_SEEN, JSON.stringify([...set].slice(-400))); } catch {}
}
function incidentKey(item) { return String(item?.fingerprint || item?.id || ''); }
function voiceEnabled() { return localStorage.getItem(STORAGE_VOICE) !== '0'; }

function ensureStyle() {
  if (document.getElementById('jarvisSentinelStyle')) return;
  const style = document.createElement('style');
  style.id = 'jarvisSentinelStyle';
  style.textContent = `
    #jarvisSentinelBadge{min-width:34px!important;height:34px!important;padding:0 8px!important;border-radius:9px!important;font-size:11px!important;font-weight:900!important}
    #jarvisSentinelBadge[data-level="critical"]{background:#7f1d1d!important;color:#fff!important}
    #jarvisSentinelBadge[data-level="warning"]{background:#92400e!important;color:#fff!important}
    #jarvisSentinelBadge[data-level="ok"]{background:rgba(22,163,74,.28)!important;color:#dcfce7!important}
    .jarvis-sentinel-card{border-left:4px solid #f59e0b!important}
    .jarvis-sentinel-card[data-level="critical"]{border-left-color:#dc2626!important;background:#fff7f7!important}
    .jarvis-sentinel-card .sentinel-meta{display:block;margin-top:5px;color:#64748b;font-size:10px;font-weight:700}
    .jarvis-sentinel-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
    .jarvis-sentinel-actions button{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:6px 8px;font-size:10px;font-weight:800;cursor:pointer;color:#334155}
    .jarvis-sentinel-actions button.primary{border-color:#93c5fd;background:#eff6ff;color:#1d4ed8}
    #jarvisSentinelToast{position:fixed;right:22px;bottom:164px;z-index:12060;width:min(380px,calc(100vw - 28px));padding:12px 14px;border-radius:14px;background:#7f1d1d;color:#fff;box-shadow:0 18px 50px rgba(15,23,42,.3);font:600 12px/1.45 system-ui;display:none}
    #jarvisSentinelToast.show{display:block}#jarvisSentinelToast b{display:block;margin-bottom:3px;font-size:13px}
  `;
  document.head.appendChild(style);
}

function ensureBadge() {
  ensureStyle();
  let badge = document.getElementById('jarvisSentinelBadge');
  if (badge) return badge;
  const host = document.querySelector('.jarvis-head-actions');
  if (!host) return null;
  badge = document.createElement('button');
  badge.id = 'jarvisSentinelBadge';
  badge.type = 'button';
  badge.title = 'Sentinel: состояние HUB';
  badge.onclick = () => showOverview();
  host.prepend(badge);
  return badge;
}

function ensureToast() {
  let toast = document.getElementById('jarvisSentinelToast');
  if (toast) return toast;
  toast = document.createElement('div');
  toast.id = 'jarvisSentinelToast';
  toast.addEventListener('click', () => {
    document.getElementById('jarvisLauncher')?.click();
    toast.classList.remove('show');
  });
  document.body.appendChild(toast);
  return toast;
}

function setBadge(summary = {}) {
  const badge = ensureBadge();
  if (!badge) return;
  const critical = Number(summary.critical || 0), warning = Number(summary.warning || 0), total = Number(summary.total || 0);
  badge.dataset.level = critical ? 'critical' : warning ? 'warning' : 'ok';
  badge.textContent = total ? `⚠ ${total}` : '✓';
  badge.title = total ? `Sentinel: ${critical} крит., ${warning} предупрежд.` : 'Sentinel: активных проблем нет';
}

function openRoute(route) {
  try {
    const url = new URL(String(route || ''), location.origin);
    if (url.origin !== location.origin || !/^\/(?:admin|kassa)(?:\/|$)/.test(url.pathname)) return false;
    location.href = url.href;
    return true;
  } catch { return false; }
}

async function acknowledge(item) {
  try { await api(`/api/v1/jarvis/incidents/${encodeURIComponent(item.id)}/ack`, { method: 'POST', body: '{}' }); await poll(true); }
  catch (error) { console.warn('Jarvis Sentinel ack:', error); }
}

function appendIncident(item, { force = false } = {}) {
  const log = document.getElementById('jarvisLog');
  if (!log) return false;
  const domId = `sentinel-${String(item.id || '').replace(/[^a-z0-9_-]/gi, '')}`;
  if (!force && document.getElementById(domId)) return false;
  const card = document.createElement('div');
  card.className = 'jarvis-msg assistant jarvis-sentinel-card';
  card.id = domId;
  card.dataset.level = item.severity || 'warning';
  const label = item.severity === 'critical' ? 'КРИТИЧНО' : item.severity === 'warning' ? 'ВНИМАНИЕ' : 'ИНФО';
  const title = document.createElement('span'); title.textContent = `Джарвис · ${label}`;
  const p = document.createElement('p'); p.textContent = `${item.title}. ${item.detail || ''}`.trim();
  const meta = document.createElement('small'); meta.className = 'sentinel-meta'; meta.textContent = `Источник: ${item.source || 'HUB'} · наблюдений: ${item.occurrence_count || 1}`;
  card.append(title, p, meta);

  const actions = document.createElement('div'); actions.className = 'jarvis-sentinel-actions';
  const suggestions = Array.isArray(item.suggested_actions) ? item.suggested_actions : [];
  for (const suggestion of suggestions.slice(0, 3)) {
    if (suggestion?.type !== 'navigate' || !suggestion.url) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'primary'; button.textContent = suggestion.label || 'Открыть'; button.onclick = () => openRoute(suggestion.url); actions.appendChild(button);
  }
  if (item.status === 'OPEN') {
    const ack = document.createElement('button'); ack.type = 'button'; ack.textContent = 'Принял'; ack.onclick = () => acknowledge(item); actions.appendChild(ack);
  }
  if (actions.childElementCount) card.appendChild(actions);
  log.appendChild(card); log.scrollTop = log.scrollHeight;
  return true;
}

async function speak(text, urgent = false) {
  if (!voiceEnabled() || !text || !window.A4VoiceEngine) return false;
  try {
    return await window.A4VoiceEngine.speak(text, { profile: 'male', apiBaseUrl: apiBase(), tokenProvider: token, interrupt: urgent, priority: urgent ? 'high' : 'normal' });
  } catch { return false; }
}

function showToast(item) {
  if (item?.severity !== 'critical') return;
  const toast = ensureToast();
  toast.innerHTML = '';
  const b = document.createElement('b'); b.textContent = 'Джарвис обнаружил проблему';
  const text = document.createElement('div'); text.textContent = item.title || 'Критическое событие HUB';
  toast.append(b, text); toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 12000);
}

function showOverview() {
  const launcher = document.getElementById('jarvisLauncher');
  const panel = document.getElementById('jarvisPanel');
  if (launcher && !panel?.classList.contains('open')) launcher.click();
  const critical = state.items.filter(x => x.severity === 'critical').length;
  const warning = state.items.filter(x => x.severity === 'warning').length;
  if (!state.items.length) {
    const log = document.getElementById('jarvisLog');
    if (log) {
      const div = document.createElement('div'); div.className = 'jarvis-msg assistant'; div.innerHTML = '<span>Джарвис</span><p>Sentinel: активных проблем не обнаружено.</p>'; log.appendChild(div); log.scrollTop = log.scrollHeight;
    }
    return;
  }
  const log = document.getElementById('jarvisLog');
  if (log) {
    const div = document.createElement('div'); div.className = 'jarvis-msg assistant';
    const span = document.createElement('span'); span.textContent = 'Джарвис';
    const p = document.createElement('p'); p.textContent = `Sentinel: активных событий ${state.items.length}. Критических ${critical}, предупреждений ${warning}. Ниже — наиболее важные.`;
    div.append(span, p); log.appendChild(div);
    for (const item of state.items.slice(0, 6)) appendIncident(item, { force: true });
    log.scrollTop = log.scrollHeight;
  }
}

async function poll(force = false) {
  if (state.busy || document.hidden) return;
  state.busy = true;
  try {
    const data = await api('/api/v1/jarvis/incidents?status=ACTIVE&limit=50');
    const items = Array.isArray(data.items) ? data.items : [];
    state.items = items;
    setBadge(data.summary || {});

    const seen = seenSet();
    const active = new Set(items.map(incidentKey).filter(Boolean));
    for (const key of [...seen]) if (!active.has(key)) seen.delete(key);

    const fresh = items.filter(item => {
      const key = incidentKey(item);
      return key && !seen.has(key) && item.status === 'OPEN';
    });

    if (!state.initialized) {
      state.initialized = true;
      if (fresh.length) {
        const critical = fresh.filter(x => x.severity === 'critical');
        const top = critical[0] || fresh[0];
        document.getElementById('jarvisLauncher') && appendIncident(top);
        showToast(top);
        const phrase = critical.length
          ? `Внимание. Sentinel обнаружил ${fresh.length} активных проблем. Критических: ${critical.length}. Самая важная: ${top.title}.`
          : `Sentinel обнаружил ${fresh.length} предупреждений. Самое важное: ${top.title}.`;
        speak(phrase, critical.length > 0);
      }
    } else {
      for (const item of fresh.slice(0, 3)) {
        appendIncident(item); showToast(item);
        speak(`${item.severity === 'critical' ? 'Внимание. ' : ''}${item.title}. ${item.detail || ''}`, item.severity === 'critical');
      }
    }

    for (const item of items) { const key = incidentKey(item); if (key) seen.add(key); }
    saveSeen(seen);
    window.dispatchEvent(new CustomEvent('a4:jarvis-sentinel', { detail: { items, summary: data.summary || {} } }));
  } catch (error) {
    if (force) console.warn('Jarvis Sentinel UI:', error);
  } finally { state.busy = false; }
}

function init() {
  ensureStyle();
  let attempts = 0;
  const wait = setInterval(() => {
    attempts += 1;
    if (document.getElementById('jarvisPanel') || attempts > 50) {
      clearInterval(wait); ensureBadge(); poll(true);
      state.timer = setInterval(() => poll(false), 45_000);
      state.timer.unref?.();
    }
  }, 120);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(false); });
window.addEventListener('beforeunload', () => { if (state.timer) clearInterval(state.timer); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();

window.A4JarvisSentinel = { poll: () => poll(true), show: showOverview, items: () => [...state.items] };
