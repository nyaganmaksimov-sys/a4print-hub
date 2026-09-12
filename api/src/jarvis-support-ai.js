import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.jarvis.support_ai.installed');
const workerInstalled = Symbol.for('a4print.jarvis.support_ai.worker.installed');
const originalListen = express.application.listen;

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const workshopUrl = String(process.env.JARVIS_WORKSHOP_URL || '').replace(/\/$/, '');
const jarvisApiKey = String(process.env.JARVIS_API_KEY || '');
const service = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const AI_INTERVAL_MS = Math.max(90_000, Number(process.env.JARVIS_INCIDENT_AI_INTERVAL_MS || 120_000));
const AI_MAX_PER_RUN = Math.max(1, Math.min(5, Number(process.env.JARVIS_INCIDENT_AI_BATCH || 2)));
const AI_RETRY_MS = Math.max(AI_INTERVAL_MS, Number(process.env.JARVIS_INCIDENT_AI_RETRY_MS || 1_800_000));
const workerState = { running: false, scans: 0, analyzed: 0, last_run_at: null, last_error: null };

function nowIso() { return new Date().toISOString(); }
function upper(v) { return String(v || '').trim().toUpperCase(); }
function compact(v, max = 6000) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function normalize(v) { return String(v || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim(); }
function words(v) { return new Set(normalize(v).split(' ').filter(x => x.length > 2)); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

function scopedDb(token) {
  if (!supabaseUrl || !publishableKey) return null;
  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

async function requireSession(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' });
    if (!supabaseUrl || !publishableKey) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED' });
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { Authorization: `Bearer ${token}`, apikey: publishableKey }, signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
        if (!response.ok) throw new Error(`AUTH_HTTP_${response.status}`);
        req.jarvisSupportAuth = await response.json();
        req.jarvisSupportToken = token;
        req.jarvisSupportDb = scopedDb(token);
        return next();
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
      } finally { clearTimeout(timer); }
    }
    throw lastError || new Error('AUTH_UNAVAILABLE');
  } catch (error) { return next(error); }
}

async function actorContext(req) {
  const db = req.jarvisSupportDb;
  if (!db) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
  const authId = String(req.jarvisSupportAuth?.id || '');
  const { data: actor, error } = await db.from('users').select('id,full_name,email,is_active,organization_unit_id').eq('auth_user_id', authId).maybeSingle();
  if (error) throw error;
  if (!actor || actor.is_active === false) throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'), { status: 403 });
  const { data: roleRows, error: roleError } = await db.rpc('get_my_roles');
  if (roleError) throw roleError;
  const roles = (Array.isArray(roleRows) ? roleRows : []).map(x => upper(typeof x === 'string' ? x : (x?.role || x?.name || x))).filter(Boolean);
  return { db, actor, roles, isOperator: roles.includes('ADMIN') || roles.includes('SUPPORT') };
}

function faqScore(item, query) {
  const q = normalize(query); if (!q) return 0;
  const hay = normalize([item.question, item.answer, ...(item.keywords || [])].join(' '));
  let score = hay.includes(q) ? 14 : 0;
  for (const word of words(q)) if (hay.includes(word)) score += 2;
  for (const keyword of item.keywords || []) { const k = normalize(keyword); if (k && q.includes(k)) score += 5; }
  if (normalize(item.question).includes(q)) score += 8;
  return score;
}

async function relevantFaq(db, query, limit = 6) {
  const { data, error } = await db.from('support_faq').select('id,category,question,answer,keywords,sort_order').eq('is_active', true).order('sort_order').limit(200);
  if (error) throw error;
  return (data || []).map(item => ({ ...item, _score: faqScore(item, query) })).sort((a, b) => b._score - a._score).slice(0, limit).map(({ _score, ...item }) => item);
}

function redactExternal(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/(?:\+?7|8)[\s()\-]*\d{3}[\s()\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g, '[телефон]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[ключ]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}\b/gi, 'Bearer [скрыто]')
    .replace(/\b\d{10,}\b/g, '[номер]')
    .slice(0, 6000);
}

function technicalQuestion(text) {
  const value = normalize(text);
  return /(ошибк|код\s+ошиб|драйвер|прошивк|принтер|плоттер|оборудован|windows|chrome|браузер|api|интеграц|модель|синхронизац|сет|подключен|сервер|касс.*связ)/i.test(value);
}

async function callWorkshop(text, context = {}) {
  if (!workshopUrl || !jarvisApiKey) throw Object.assign(new Error('JARVIS_WORKSHOP_NOT_CONFIGURED'), { status: 503 });
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const response = await fetch(`${workshopUrl}/api/v1/assistant/query`, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${jarvisApiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text, context })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body?.detail || body?.error || `JARVIS_HTTP_${response.status}`);
        error.status = response.status;
        if (![502, 503, 504].includes(response.status) || attempt > 0) throw error;
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 700));
        continue;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && (error?.name === 'AbortError' || /fetch|502|503|504/i.test(String(error?.message || '')))) {
        await new Promise(resolve => setTimeout(resolve, 700));
        continue;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error('JARVIS_UNAVAILABLE');
}

function aiData(result) {
  const data = result?.data && typeof result.data === 'object' ? result.data : {};
  return {
    text: compact(result?.text || '', 12000),
    provider: data.provider || null,
    model: data.model || null,
    web_search: data.web_search_requested === true,
    sources: Array.isArray(data.web_sources) ? data.web_sources.slice(0, 12) : []
  };
}

async function supportAsk(req, res) {
  try {
    const { db, actor } = await actorContext(req);
    const question = compact(req.body?.question || '', 4000);
    if (!question) return res.status(400).json({ success: false, error: 'QUESTION_REQUIRED' });
    const faq = await relevantFaq(db, question, 6);
    const bestScore = faq.length ? faqScore(faq[0], question) : 0;
    const explicitWeb = req.body?.web === true;
    const useWeb = explicitWeb || (bestScore < 8 && technicalQuestion(question));
    const publicQuestion = useWeb ? redactExternal(question) : question;
    const result = await callWorkshop(
      'Ответь пользователю службы поддержки на вопрос из переданного контекста. Сначала используй базу знаний HUB. Если включён веб-поиск, используй только публичные технические сведения. Дай конкретные безопасные шаги и не утверждай, что действие уже выполнено.',
      {
        task: 'support_self_service',
        web_search: useWeb,
        jarvis_personality: { serious_mode: true, humor_level: 0 },
        support: { question: publicQuestion, faq, requester: { kind: 'staff', id: actor.id } },
        response_requirements: { language: 'ru', concise: true, no_automatic_actions: true }
      }
    );
    const ai = aiData(result);
    return res.json({ success: true, answer: ai.text, ...ai, faq_used: faq.map(x => ({ id: x.id, question: x.question, category: x.category })) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: String(error?.message || error) });
  }
}

async function supportDraft(req, res) {
  try {
    const { db, isOperator } = await actorContext(req);
    if (!isOperator) return res.status(403).json({ success: false, error: 'SUPPORT_ROLE_REQUIRED' });
    const ticketId = String(req.body?.ticket_id || '').trim();
    if (!ticketId) return res.status(400).json({ success: false, error: 'TICKET_ID_REQUIRED' });
    const mode = req.body?.mode === 'research' ? 'research' : 'draft';
    const { data: ticket, error: ticketError } = await db.from('support_tickets').select('id,subject,status,priority,source,created_at,updated_at').eq('id', ticketId).maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) return res.status(404).json({ success: false, error: 'TICKET_NOT_FOUND' });
    const { data: messages, error: messageError } = await db.from('support_messages').select('id,sender_kind,body,created_at').eq('ticket_id', ticketId).order('created_at').limit(80);
    if (messageError) throw messageError;
    const history = (messages || []).slice(-20);
    const lastUser = [...history].reverse().find(x => upper(x.sender_kind) !== 'OPERATOR')?.body || ticket.subject || '';
    const faq = await relevantFaq(db, `${ticket.subject || ''} ${lastUser}`, 8);
    const useWeb = mode === 'research';
    const safeHistory = history.map(x => ({
      sender_kind: x.sender_kind,
      body: useWeb ? redactExternal(x.body) : compact(x.body, 4000),
      created_at: x.created_at
    }));
    const safeSubject = useWeb ? redactExternal(ticket.subject) : compact(ticket.subject, 1000);
    const prompt = mode === 'research'
      ? 'Проведи технический разбор обращения службы поддержки из контекста. Отдели подтверждённые факты от вероятных причин. При необходимости используй веб-поиск только по обезличенной технической проблеме. Дай оператору безопасный план проверки и в конце предложи короткий вариант ответа пользователю. Ничего не выполняй автоматически.'
      : 'Сформулируй готовый ответ пользователю службы поддержки на основе обращения, истории переписки и базы знаний из контекста. Верни только текст ответа пользователю без служебных комментариев. Не обещай выполненные действия, если подтверждения нет.';
    const result = await callWorkshop(prompt, {
      task: mode === 'research' ? 'support_research' : 'support_reply',
      web_search: useWeb,
      jarvis_personality: { serious_mode: true, humor_level: 0 },
      support: {
        ticket: { subject: safeSubject, status: ticket.status, priority: ticket.priority, source: ticket.source },
        messages: safeHistory,
        faq
      },
      response_requirements: { language: 'ru', operator_approval_required: true, no_automatic_send: true }
    });
    const ai = aiData(result);
    return res.json({ success: true, kind: mode, ...ai });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: String(error?.message || error) });
  }
}

async function sentinelViewer(req) {
  if (!service) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
  const authId = String(req.jarvisSupportAuth?.id || '');
  const { data: user, error } = await service.from('users').select('id,is_active,organization_unit_id').eq('auth_user_id', authId).maybeSingle();
  if (error) throw error;
  if (!user || user.is_active === false) throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'), { status: 403 });
  let organizationId = null;
  if (user.organization_unit_id) {
    const { data: unit, error: unitError } = await service.from('organization_units').select('organization_id').eq('id', user.organization_unit_id).maybeSingle();
    if (unitError) throw unitError;
    organizationId = unit?.organization_id || null;
  }
  const { data: ur, error: urError } = await service.from('user_roles').select('role_id').eq('user_id', user.id);
  if (urError) throw urError;
  const roleIds = (ur || []).map(x => x.role_id).filter(Boolean);
  let isAdmin = false;
  if (roleIds.length) {
    const { data: roles, error: rolesError } = await service.from('roles').select('id,name').in('id', roleIds);
    if (rolesError) throw rolesError;
    isAdmin = (roles || []).some(x => upper(x.name) === 'ADMIN');
  }
  return { user, organizationId, isAdmin };
}

function incidentSignature(incident) {
  return hash(JSON.stringify({ kind: incident.kind, severity: incident.severity, source: incident.source, title: incident.title, detail: incident.detail, evidence: incident.evidence || {} }));
}

function incidentNeedsAnalysis(incident, cached, at = Date.now(), retryMs = AI_RETRY_MS) {
  if (!cached || cached.incident_signature !== incidentSignature(incident)) return true;
  if (cached.analysis) return false;
  if (!cached.last_error) return true;
  const lastAttemptAt = Date.parse(cached.updated_at || '');
  return !Number.isFinite(lastAttemptAt) || at - lastAttemptAt >= retryMs;
}

function technicalIncident(incident) {
  return new Set(['integration_error', 'equipment_maintenance', 'monitoring_error', 'jarvis_runtime', 'system_health']).has(String(incident?.kind || ''));
}

function sanitizedEvidence(evidence) {
  const allowed = ['integration','entity_type','status','error_message','started_at','finished_at','current_stock','min_stock','next_service_date','priority','due_at','details','last_error','last_error_at','last_ok_at','planned_end'];
  const out = {};
  for (const key of allowed) if (evidence && evidence[key] !== undefined) out[key] = typeof evidence[key] === 'string' ? redactExternal(evidence[key]) : evidence[key];
  return out;
}

async function analyzeIncidentRecord(incident, { force = false } = {}) {
  if (!service) throw new Error('DATABASE_NOT_CONFIGURED');
  const signature = incidentSignature(incident);
  const { data: cached, error: cacheError } = await service.from('jarvis_incident_ai').select('*').eq('incident_id', incident.id).maybeSingle();
  if (cacheError) throw cacheError;
  if (!force && cached?.incident_signature === signature && cached.analysis) return cached;

  const useWeb = technicalIncident(incident);
  try {
    const result = await callWorkshop(
      'Проведи диагностику события Sentinel из переданного контекста. Структура ответа: «Что подтверждено», «Вероятная причина», «Что сделать безопасно», «Как проверить результат». Не выдавай гипотезу за факт и не выполняй никаких действий. Если доступен веб-поиск, используй только публичную техническую информацию.',
      {
        task: 'incident_analysis',
        web_search: useWeb,
        jarvis_personality: { serious_mode: true, humor_level: 0 },
        incident: {
          kind: incident.kind, severity: incident.severity, source: incident.source,
          title: redactExternal(incident.title), detail: redactExternal(incident.detail), evidence: sanitizedEvidence(incident.evidence)
        },
        response_requirements: { language: 'ru', no_automatic_actions: true, mark_uncertainty: true }
      }
    );
    const ai = aiData(result);
    const payload = {
      incident_id: incident.id, incident_signature: signature, analysis: ai.text,
      sources: ai.sources, provider: ai.provider, model: ai.model, web_search: ai.web_search,
      generated_at: nowIso(), updated_at: nowIso(), last_error: null
    };
    const { data, error } = await service.from('jarvis_incident_ai').upsert(payload, { onConflict: 'incident_id' }).select('*').single();
    if (error) throw error;
    workerState.analyzed += 1;
    return data;
  } catch (error) {
    const payload = {
      incident_id: incident.id, incident_signature: signature, analysis: cached?.analysis || '',
      sources: cached?.sources || [], provider: cached?.provider || null, model: cached?.model || null,
      web_search: useWeb, generated_at: cached?.generated_at || nowIso(), updated_at: nowIso(), last_error: compact(error?.message || error, 1000)
    };
    await service.from('jarvis_incident_ai').upsert(payload, { onConflict: 'incident_id' });
    throw error;
  }
}

async function runIncidentAi() {
  if (workerState.running || !service || !workshopUrl || !jarvisApiKey) return { ...workerState, skipped: true };
  workerState.running = true;
  try {
    const { data: incidents, error } = await service.from('jarvis_incidents').select('id,organization_id,kind,severity,source,title,detail,evidence,status,last_seen_at').in('status', ['OPEN','ACK']).order('last_seen_at', { ascending: false }).limit(30);
    if (error) throw error;
    const ids = (incidents || []).map(x => x.id);
    let cachedRows = [];
    if (ids.length) {
      const { data, error: aiError } = await service.from('jarvis_incident_ai').select('incident_id,incident_signature,analysis,last_error,updated_at').in('incident_id', ids);
      if (aiError) throw aiError;
      cachedRows = data || [];
    }
    const cache = new Map(cachedRows.map(x => [x.incident_id, x]));
    const pending = (incidents || [])
      .filter(item => incidentNeedsAnalysis(item, cache.get(item.id)))
      .slice(0, AI_MAX_PER_RUN);
    for (const incident of pending) {
      try { await analyzeIncidentRecord(incident); }
      catch (error) { console.warn('[Jarvis Sentinel AI]', incident.id, error?.message || error); }
    }
    workerState.scans += 1;
    workerState.last_run_at = nowIso();
    workerState.last_error = null;
    return { ...workerState, pending: pending.length };
  } catch (error) {
    workerState.last_run_at = nowIso(); workerState.last_error = String(error?.message || error);
    console.error('[Jarvis Sentinel AI]', error);
    return { ...workerState };
  } finally { workerState.running = false; }
}

async function incidentAnalysis(req, res, force = false) {
  try {
    const viewer = await sentinelViewer(req);
    const { data: incident, error } = await service.from('jarvis_incidents').select('id,organization_id,kind,severity,source,title,detail,evidence,status,last_seen_at').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!incident) return res.status(404).json({ success: false, error: 'INCIDENT_NOT_FOUND' });
    if (!viewer.isAdmin && incident.organization_id !== viewer.organizationId) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    let analysis = null;
    if (!force) {
      const { data, error: aiError } = await service.from('jarvis_incident_ai').select('*').eq('incident_id', incident.id).maybeSingle();
      if (aiError) throw aiError;
      if (data?.incident_signature === incidentSignature(incident) && data.analysis) analysis = data;
    }
    if (!analysis) analysis = await analyzeIncidentRecord(incident, { force: true });
    return res.json({ success: true, analysis: { text: analysis.analysis, sources: analysis.sources || [], provider: analysis.provider, model: analysis.model, web_search: analysis.web_search, generated_at: analysis.generated_at, last_error: analysis.last_error } });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: String(error?.message || error) });
  }
}

function installWorker() {
  if (globalThis[workerInstalled] || !service) return;
  globalThis[workerInstalled] = true;
  const first = setTimeout(() => runIncidentAi(), 18_000); first.unref?.();
  const timer = setInterval(() => runIncidentAi(), AI_INTERVAL_MS); timer.unref?.();
}

express.application.listen = function patchedJarvisSupportAiListen(...args) {
  if (!this[installed]) {
    this[installed] = true;
    this.post('/api/v1/jarvis/support/ask', requireSession, supportAsk);
    this.post('/api/v1/jarvis/support/draft', requireSession, supportDraft);
    this.get('/api/v1/jarvis/incidents/:id/analysis', requireSession, (req, res) => incidentAnalysis(req, res, false));
    this.post('/api/v1/jarvis/incidents/:id/analysis', requireSession, (req, res) => incidentAnalysis(req, res, true));
    this.get('/api/v1/jarvis/sentinel/ai-status', requireSession, async (req, res) => {
      try {
        const viewer = await sentinelViewer(req);
        if (!viewer.isAdmin) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
        return res.json({ success: true, ai: { ...workerState, interval_ms: AI_INTERVAL_MS, retry_ms: AI_RETRY_MS, batch: AI_MAX_PER_RUN } });
      } catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error?.message || error) }); }
    });
  }
  installWorker();
  return originalListen.apply(this, args);
};

export { incidentNeedsAnalysis, runIncidentAi };
