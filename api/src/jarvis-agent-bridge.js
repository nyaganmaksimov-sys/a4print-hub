import express from 'express';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.jarvis.agent.bridge.installed');
const originalListen = express.application.listen;
let serviceClient;

const NAV_ROUTES = [
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?(?:главн(?:ую|ая)|дашборд)/i, url: './index.html', label: 'главную' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?касс[ау]/i, url: '../kassa/', label: 'кассу' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?(?:список\s+)?заказ/i, url: './orders.html', label: 'заказы' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?(?:список\s+)?клиент/i, url: './customers.html', label: 'клиентов' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?производств/i, url: './production.html', label: 'производство' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?склад/i, url: './warehouse.html', label: 'склад' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?оборудован/i, url: './equipment.html', label: 'оборудование' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?сообщени/i, url: './messages.html', label: 'сообщения' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?сотрудник/i, url: './employees.html', label: 'сотрудников' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?документ/i, url: './documents.html', label: 'документы' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?оплат/i, url: './payments.html', label: 'оплаты' },
  { re: /(?:открой|перейди|покажи)\s+(?:мне\s+)?отч[её]т/i, url: './reports.html', label: 'отчёты' }
];

function cfg() {
  return {
    supabaseUrl: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    publishableKey: String(process.env.SUPABASE_PUBLISHABLE_KEY || ''),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
    jarvisUrl: String(process.env.JARVIS_WORKSHOP_URL || '').replace(/\/$/, ''),
    jarvisKey: String(process.env.JARVIS_API_KEY || '')
  };
}

function serviceDb() {
  if (serviceClient !== undefined) return serviceClient;
  const c = cfg();
  serviceClient = c.supabaseUrl && c.serviceRoleKey
    ? createClient(c.supabaseUrl, c.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
  return serviceClient;
}

function userDb(token) {
  const c = cfg();
  if (!c.supabaseUrl || !c.publishableKey || !token) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
  return createClient(c.supabaseUrl, c.publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}

async function requireSession(req, res, next) {
  try {
    const c = cfg();
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' });
    if (!c.supabaseUrl || !c.publishableKey) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED' });
    const r = await fetch(`${c.supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: c.publishableKey } });
    if (!r.ok) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
    req.jarvisUser = await r.json();
    req.jarvisToken = token;
    next();
  } catch (error) { next(error); }
}

async function actor(req) {
  const db = serviceDb();
  if (!db) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
  const { data, error } = await db.from('users').select('id,full_name,email,is_active,organization_unit_id').eq('auth_user_id', req.jarvisUser.id).maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false) throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'), { status: 403 });
  let organizationId = null;
  if (data.organization_unit_id) {
    const { data: unit } = await db.from('organization_units').select('organization_id').eq('id', data.organization_unit_id).maybeSingle();
    organizationId = unit?.organization_id || null;
  }
  if (!organizationId) {
    const { data: org } = await db.from('organizations').select('id').eq('code', 'A4PRINT').maybeSingle();
    organizationId = org?.id || null;
  }
  return { db, user: data, organizationId };
}

function clean(text) {
  return String(text || '').trim().replace(/^джарвис[\s,:-]*/i, '').trim();
}
function escSpeech(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function money(v) { return `${Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} рублей`; }
function entityLabel(type) {
  return ({ customer: 'клиент', order: 'заказ', production: 'задание', payment: 'оплата', employee: 'сотрудник', equipment: 'оборудование', document: 'документ', message: 'сообщение' })[type] || 'результат';
}

async function semanticSearch(req, query, limit = 8) {
  const db = userDb(req.jarvisToken);
  const { data, error } = await db.rpc('jarvis_semantic_search', { p_query: String(query || '').slice(0, 500), p_limit: limit });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function renderEntity(item) {
  const p = item?.payload || {};
  switch (item?.entity_type) {
    case 'customer': return `${item.title}. ${[p.company_name, p.phone, p.email, p.inn ? `ИНН ${p.inn}` : ''].filter(Boolean).join(', ')}`.trim();
    case 'order': return `Заказ №${p.order_number || ''}. Статус ${p.status || 'не указан'}. Сумма ${money(p.total)}${p.customer_name ? `. Клиент ${p.customer_name}` : ''}${p.due_at ? `. Срок ${new Date(p.due_at).toLocaleString('ru-RU')}` : ''}.`;
    case 'production': return `${p.title || item.title}. Статус ${p.status || 'не указан'}${p.order_number ? `. Заказ №${p.order_number}` : ''}${p.customer_name ? `. Клиент ${p.customer_name}` : ''}.`;
    case 'payment': return `${item.title}. ${money(p.amount)}. Статус ${p.status || 'не указан'}${p.customer_name ? `. Клиент ${p.customer_name}` : ''}.`;
    case 'employee': return `${p.full_name || item.title}${p.position ? `, ${p.position}` : ''}${p.phone ? `. Телефон ${p.phone}` : ''}${p.email ? `. Email ${p.email}` : ''}.`;
    case 'equipment': return `${p.name || item.title}. ${[p.brand, p.model, p.status, p.location].filter(Boolean).join(', ')}.`;
    case 'document': return `${p.title || item.title}${p.document_number ? `, ${p.document_number}` : ''}. Статус ${p.status || 'не указан'}${p.order_number ? `. Заказ №${p.order_number}` : ''}.`;
    case 'message': return `Сообщение от ${p.sender_name || 'сотрудника'}: ${escSpeech(p.body || item.subtitle || '')}`;
    default: return `${item?.title || 'Найдено'}${item?.subtitle ? `. ${item.subtitle}` : ''}`;
  }
}

function searchNeedle(text) {
  return text
    .replace(/\b(?:найди|найти|поищи|покажи|открой|перейди|расскажи|скажи|дай|информаци(?:ю|я)|данные|статус|что\s+по|что\s+с)\b/gi, ' ')
    .replace(/\b(?:клиента?|заказа?|заказы|сообщения?|оплату?|документы?|оборудование|сотрудника?)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function handleSemantic(req, text) {
  const intentLike = /(найд|поищ|покаж|открой|перейд|информац|данн|статус|что\s+по|что\s+с|клиент|заказ|оплат|документ|оборудован|сотрудник)/i.test(text);
  if (!intentLike) return null;
  const needle = searchNeedle(text) || text;
  let rows = await semanticSearch(req, needle, 10);
  const typeHint = /клиент/i.test(text) ? 'customer' : /заказ/i.test(text) ? 'order' : /сотрудник/i.test(text) ? 'employee' : /оборудован/i.test(text) ? 'equipment' : /документ/i.test(text) ? 'document' : /оплат/i.test(text) ? 'payment' : /сообщен/i.test(text) ? 'message' : null;
  if (typeHint) {
    const typed = rows.filter(x => x.entity_type === typeHint);
    if (typed.length) rows = typed;
  }
  if (!rows.length) return { success: true, handled: true, kind: 'search', text: `По запросу «${needle}» ничего доступного вам не найдено.`, results: [] };
  const top = rows[0];
  const wantsOpen = /(открой|перейди)/i.test(text);
  const close = rows.filter(x => Number(x.score || 0) >= Math.max(0.18, Number(top.score || 0) - 0.14)).slice(0, 5);
  if (close.length === 1 || Number(top.score || 0) >= 0.72) {
    return {
      success: true, handled: true, kind: 'entity', text: renderEntity(top),
      results: [top],
      system_action: wantsOpen && top.route ? { type: 'navigate', url: top.route, requires_confirmation: false } : null,
      navigation: top.route ? { url: top.route, label: `Открыть ${entityLabel(top.entity_type)}` } : null
    };
  }
  return {
    success: true, handled: true, kind: 'search_results',
    text: `Нашёл ${close.length} подходящих вариантов: ${close.map((x, i) => `${i + 1}) ${x.title}${x.subtitle ? ` — ${x.subtitle}` : ''}`).join('; ')}.`,
    results: close
  };
}

async function resolveEmployee(req, name) {
  const db = userDb(req.jarvisToken);
  const q = String(name || '').trim();
  if (!q) return [];
  const { data, error } = await db.from('users').select('id,full_name,email,position,is_active').eq('is_active', true).or(`full_name.ilike.%${q.replace(/[,%]/g, '')}%,email.ilike.%${q.replace(/[,%]/g, '')}%`).limit(8);
  if (error) throw error;
  return data || [];
}

async function directRoom(req, otherUserId) {
  const db = userDb(req.jarvisToken);
  const { data, error } = await db.rpc('open_direct_chat', { p_other_user_id: otherUserId });
  if (error) throw error;
  return data;
}

async function sendInternal(req, target, body) {
  const text = String(body || '').trim();
  if (!text) return { success: true, handled: true, kind: 'message_help', text: 'Что именно отправить?' };
  const db = userDb(req.jarvisToken);
  const a = await actor(req);
  let roomId;
  let targetName = 'общий чат';
  if (/^(?:в\s+)?общ(?:ий|ий\s+чат)$/i.test(String(target || '').trim())) {
    const { data, error } = await db.from('chat_rooms').select('id,name').eq('name', 'Общий чат').limit(1).maybeSingle();
    if (error) throw error;
    roomId = data?.id;
  } else {
    const people = await resolveEmployee(req, target);
    if (!people.length) return { success: true, handled: true, kind: 'message_target_not_found', text: `Не нашёл сотрудника «${target}».` };
    if (people.length > 1) return { success: true, handled: true, kind: 'message_target_choices', text: `Нашёл несколько сотрудников: ${people.map((x, i) => `${i + 1}) ${x.full_name || x.email}${x.position ? ` — ${x.position}` : ''}`).join('; ')}. Уточните, кому отправить.`, people };
    roomId = await directRoom(req, people[0].id);
    targetName = people[0].full_name || people[0].email;
  }
  if (!roomId) throw new Error('CHAT_ROOM_NOT_FOUND');
  const { data: msg, error } = await db.from('messages').insert({ room_id: roomId, sender_id: a.user.id, body: text.slice(0, 4000) }).select('id,room_id,body,created_at').single();
  if (error) throw error;
  return { success: true, handled: true, kind: 'message_sent', text: `Сообщение отправлено: ${targetName}.`, message: msg, navigation: { url: './messages.html', label: 'Открыть сообщения' } };
}

async function latestIncoming(req) {
  const db = userDb(req.jarvisToken);
  const a = await actor(req);
  const { data, error } = await db.from('messages').select('id,room_id,sender_id,body,created_at,users:sender_id(full_name,email)').neq('sender_id', a.user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

function simpleDraft(raw, target = '') {
  let body = String(raw || '').trim().replace(/^[,:;\s-]+/, '').trim();
  if (!body) body = 'Спасибо за сообщение. Принял информацию, вернусь с ответом в ближайшее время.';
  body = body.charAt(0).toLocaleUpperCase('ru-RU') + body.slice(1);
  if (!/[.!?]$/.test(body)) body += '.';
  if (/^(привет|здравствуй)/i.test(body) === false && target && body.length > 80) body = `Здравствуйте! ${body}`;
  return body;
}

async function modelDraft(prompt, context = '') {
  const c = cfg();
  if (!c.jarvisUrl || !c.jarvisKey) return { text: simpleDraft(prompt), generated: false };
  try {
    const r = await fetch(`${c.jarvisUrl}/api/v1/assistant/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${c.jarvisKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text: `Сформулируй только готовый текст сообщения на русском языке, без пояснений. Контекст: ${context || 'деловая переписка A4PRINT HUB'}. Черновик или смысл: ${prompt}` })
    });
    if (!r.ok) throw new Error(`JARVIS_HTTP_${r.status}`);
    const d = await r.json();
    const value = String(d.text || '').trim();
    if (!value || /локальная языковая модель.*недоступ/i.test(value) || /команда принята/i.test(value)) throw new Error('LLM_UNAVAILABLE');
    return { text: value.slice(0, 4000), generated: true };
  } catch {
    return { text: simpleDraft(prompt), generated: false };
  }
}

async function handleMessaging(req, text) {
  const general = text.match(/(?:напиши|отправь|скажи)\s+(?:в\s+)?общ(?:ий|ем)\s+(?:чат(?:е|у)?\s*)?(?:что\s+)?(.+)/i);
  if (general) return sendInternal(req, 'общий', general[1]);
  const send = text.match(/(?:напиши|отправь|ответь)\s+([^,:]+?)(?:\s+(?:что|сообщение|:)\s+|[:,]\s*)(.+)/i);
  if (send && !/сформулируй/i.test(text)) return sendInternal(req, send[1].trim(), send[2].trim());
  const last = text.match(/(?:ответь|напиши)\s+(?:на\s+)?последн(?:ее|ий)\s+сообщени(?:е|ю)\s*(?:что|:)?\s*(.+)/i);
  if (last) {
    const incoming = await latestIncoming(req);
    if (!incoming) return { success: true, handled: true, kind: 'message_none', text: 'Доступных входящих сообщений не нашёл.' };
    const name = incoming.users?.full_name || incoming.users?.email || '';
    if (!name) return { success: true, handled: true, kind: 'message_target_not_found', text: 'Не удалось определить отправителя последнего сообщения.' };
    return sendInternal(req, name, last[1]);
  }
  const compose = text.match(/(?:сформулируй|переформулируй|подготовь|напиши\s+черновик)\s+(?:мне\s+)?(?:сообщени(?:е|я)\s*)?(.*)/i);
  if (compose) {
    const draft = await modelDraft(compose[1] || text);
    return { success: true, handled: true, kind: 'message_draft', text: draft.text, draft: draft.text, generated_by_model: draft.generated };
  }
  return null;
}

async function handleTasks(req, text) {
  const a = await actor(req);
  const db = a.db;
  const create = text.match(/(?:создай|добавь|поставь|запиши)\s+(?:мне\s+)?задач(?:у|ку)\s+(.+)/i);
  if (create) {
    const title = create[1].replace(/[.!?]+$/, '').trim();
    const { data, error } = await db.from('jarvis_tasks').insert({ organization_id: a.organizationId, title: title.slice(0, 500), status: 'TODO', priority: /сроч/i.test(title) ? 'URGENT' : 'NORMAL', created_by: a.user.id, assigned_to: a.user.id, source: 'JARVIS', metadata: { created_via: 'agent' } }).select('id,title,status,priority,created_at').single();
    if (error) throw error;
    return { success: true, handled: true, kind: 'task_created', text: `Задача создана: ${data.title}.`, task: data };
  }
  if (/(?:покажи|назови)?\s*(?:мои\s+)?(?:активные\s+)?задачи\b|что\s+(?:у\s+меня\s+)?по\s+задачам/i.test(text)) {
    const { data, error } = await db.from('jarvis_tasks').select('id,title,status,priority,due_at,created_at').eq('organization_id', a.organizationId).eq('assigned_to', a.user.id).in('status', ['TODO','IN_PROGRESS']).order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    const tasks = data || [];
    return { success: true, handled: true, kind: 'tasks', text: tasks.length ? `Активных задач: ${tasks.length}. ${tasks.map((x,i)=>`${i+1}) ${x.title}`).join('; ')}.` : 'У вас нет активных задач.', tasks };
  }
  return null;
}

async function answer(req) {
  const text = clean(req.body?.text);
  if (!text) return { success: false, error: 'TEXT_REQUIRED' };
  const messaging = await handleMessaging(req, text); if (messaging) return messaging;
  const tasks = await handleTasks(req, text); if (tasks) return tasks;
  const nav = NAV_ROUTES.find(x => x.re.test(text));
  if (nav && !/(\d|по имени|по номеру|клиент\s+\S+|заказ\s+№?\s*\d+)/i.test(text)) return { success: true, handled: true, kind: 'navigation', text: `Открываю ${nav.label}.`, system_action: { type: 'navigate', url: nav.url, requires_confirmation: false } };
  const semantic = await handleSemantic(req, text); if (semantic) return semantic;
  return null;
}

async function botInbox(req) {
  const db = userDb(req.jarvisToken);
  const a = await actor(req);
  let query = db.from('messages').select('id,room_id,sender_id,body,created_at,users:sender_id(full_name,email)').neq('sender_id', a.user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(10);
  const after = String(req.query.after || '').trim();
  if (after) query = query.gt('created_at', after);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function botDraft(req) {
  const id = String(req.body?.message_id || '').trim();
  if (!id) throw Object.assign(new Error('MESSAGE_ID_REQUIRED'), { status: 400 });
  const db = userDb(req.jarvisToken);
  const { data: msg, error } = await db.from('messages').select('id,room_id,sender_id,body,created_at,users:sender_id(full_name,email)').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!msg) throw Object.assign(new Error('MESSAGE_NOT_FOUND'), { status: 404 });
  const sender = msg.users?.full_name || msg.users?.email || 'сотрудник';
  const draft = await modelDraft(`Ответь на сообщение: «${msg.body}»`, `Переписка с ${sender}. Ответ должен быть кратким, деловым и полезным.`);
  return { success: true, message: msg, draft: draft.text, generated_by_model: draft.generated, can_auto_send: draft.generated };
}

async function botSend(req) {
  const draftResult = await botDraft(req);
  if (!draftResult.generated_by_model && req.body?.allow_fallback !== true) return { ...draftResult, success: true, sent: false, warning: 'MODEL_REQUIRED_FOR_AUTO_SEND' };
  const sender = draftResult.message.users?.full_name || draftResult.message.users?.email;
  if (!sender) throw new Error('SENDER_NOT_FOUND');
  const sent = await sendInternal(req, sender, draftResult.draft);
  return { ...sent, generated_by_model: draftResult.generated_by_model, source_message_id: draftResult.message.id };
}

express.application.listen = function patchedJarvisAgentListen(...args) {
  if (!this[installed]) {
    this[installed] = true;
    this.post('/api/v1/jarvis/query', requireSession, async (req, res, next) => {
      try {
        const result = await answer(req);
        if (!result) return next();
        return res.status(result.success === false ? 400 : 200).json(result);
      } catch (error) {
        console.error('[Jarvis agent]', error);
        return res.status(error.status || 500).json({ success: false, handled: true, error: String(error.message || error) });
      }
    });
    this.get('/api/v1/jarvis/bot/inbox', requireSession, async (req, res) => {
      try { return res.json({ success: true, messages: await botInbox(req) }); }
      catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });
    this.post('/api/v1/jarvis/bot/draft', requireSession, async (req, res) => {
      try { return res.json(await botDraft(req)); }
      catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });
    this.post('/api/v1/jarvis/bot/send', requireSession, async (req, res) => {
      try { return res.json(await botSend(req)); }
      catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });
  }
  return originalListen.apply(this, args);
};
