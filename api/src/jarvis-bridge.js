import express from 'express';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.jarvis.bridge.installed');
const originalListen = express.application.listen;
let hubServiceClient;

function jarvisConfig() {
  const baseUrl = String(process.env.JARVIS_WORKSHOP_URL || '').replace(/\/$/, '');
  const apiKey = String(process.env.JARVIS_API_KEY || '');
  return { baseUrl, apiKey, configured: Boolean(baseUrl && apiKey) };
}

function hubService() {
  if (hubServiceClient !== undefined) return hubServiceClient;
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  hubServiceClient = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
  return hubServiceClient;
}

async function requireHubSession(req, res, next) {
  try {
    const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!supabaseUrl || !publishableKey) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED' });
    if (!token) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: publishableKey },
        signal: controller.signal
      });
      if (!response.ok) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
      req.jarvisUser = await response.json().catch(() => null);
      req.jarvisToken = token;
      return next();
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return next(error);
  }
}

async function resolveActor(req) {
  const db = hubService();
  if (!db) {
    const error = new Error('DATABASE_NOT_CONFIGURED');
    error.status = 503;
    throw error;
  }
  const authUserId = String(req.jarvisUser?.id || '').trim();
  if (!authUserId) {
    const error = new Error('INVALID_SESSION');
    error.status = 401;
    throw error;
  }

  const { data: actor, error: actorError } = await db
    .from('users')
    .select('id,full_name,email,is_active,organization_unit_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (actorError) throw actorError;
  if (!actor || actor.is_active === false) {
    const error = new Error('STAFF_PROFILE_REQUIRED');
    error.status = 403;
    throw error;
  }

  let organizationId = null;
  if (actor.organization_unit_id) {
    const { data: unit, error: unitError } = await db
      .from('organization_units')
      .select('organization_id')
      .eq('id', actor.organization_unit_id)
      .maybeSingle();
    if (unitError) throw unitError;
    organizationId = unit?.organization_id || null;
  }
  if (!organizationId) {
    const { data: org, error: orgError } = await db
      .from('organizations')
      .select('id')
      .eq('code', 'A4PRINT')
      .maybeSingle();
    if (orgError) throw orgError;
    organizationId = org?.id || null;
  }
  if (!organizationId) {
    const error = new Error('ORGANIZATION_NOT_FOUND');
    error.status = 500;
    throw error;
  }
  return { db, actor, organizationId };
}

function stripJarvisPrefix(text) {
  return String(text || '')
    .trim()
    .replace(/^джарвис[\s,:-]*/i, '')
    .trim();
}

function moscowDate(offsetDays = 0) {
  const shifted = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(shifted);
  const get = type => parts.find(x => x.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseTaskText(raw) {
  let title = String(raw || '').trim().replace(/[.?!]+$/, '').trim();
  let offset = null;
  if (/\bпослезавтра\b/i.test(title)) offset = 2;
  else if (/\bзавтра\b/i.test(title)) offset = 1;
  else if (/\bсегодня\b/i.test(title)) offset = 0;

  const timeMatch = title.match(/(?:\bв|\bк)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i);
  const hours = timeMatch ? Number(timeMatch[1]) : 18;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  let dueAt = null;
  if (offset !== null || timeMatch) {
    if (offset === null) offset = 0;
    dueAt = new Date(`${moscowDate(offset)}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+03:00`).toISOString();
  }

  let priority = 'NORMAL';
  if (/\b(срочно|критично|немедленно)\b/i.test(title)) priority = 'URGENT';
  else if (/\b(важно|важная|высокий приоритет)\b/i.test(title)) priority = 'HIGH';

  title = title
    .replace(/\bпослезавтра\b/gi, '')
    .replace(/\bзавтра\b/gi, '')
    .replace(/\bсегодня\b/gi, '')
    .replace(/(?:\bв|\bк)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/gi, '')
    .replace(/\b(срочно|критично|немедленно|важно|важная|высокий приоритет)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, '')
    .trim();

  return { title, priority, dueAt };
}

function taskDueText(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value)) + ' МСК';
  } catch {
    return '';
  }
}

async function createTask(req, rawTitle) {
  const { db, actor, organizationId } = await resolveActor(req);
  const parsed = parseTaskText(rawTitle);
  if (!parsed.title) {
    return { success: true, handled: true, kind: 'task_help', text: 'Скажите, что записать. Например: Джарвис, создай задачу позвонить клиенту завтра в 15:00.' };
  }
  const payload = {
    organization_id: organizationId,
    title: parsed.title.slice(0, 500),
    status: 'TODO',
    priority: parsed.priority,
    due_at: parsed.dueAt,
    created_by: actor.id,
    assigned_to: actor.id,
    source: 'JARVIS',
    metadata: { created_via: 'voice_command' }
  };
  const { data, error } = await db.from('jarvis_tasks').insert(payload).select('id,title,status,priority,due_at,created_at').single();
  if (error) throw error;
  const due = taskDueText(data.due_at);
  return {
    success: true,
    handled: true,
    kind: 'task_created',
    text: `Задача создана: ${data.title}.${due ? ` Срок — ${due}.` : ''}`,
    task: data
  };
}

async function listTasks(req) {
  const { db, actor, organizationId } = await resolveActor(req);
  const { data, error } = await db
    .from('jarvis_tasks')
    .select('id,title,status,priority,due_at,created_at')
    .eq('organization_id', organizationId)
    .eq('assigned_to', actor.id)
    .in('status', ['TODO', 'IN_PROGRESS'])
    .order('priority', { ascending: false })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  const tasks = data || [];
  if (!tasks.length) {
    return { success: true, handled: true, kind: 'tasks', text: 'У вас нет активных задач.', tasks: [] };
  }
  const lines = tasks.map((task, index) => {
    const due = taskDueText(task.due_at);
    return `${index + 1}. ${task.title}${due ? ` — до ${due}` : ''}`;
  });
  return {
    success: true,
    handled: true,
    kind: 'tasks',
    text: `Активных задач: ${tasks.length}. ${lines.join(' ')}`,
    tasks
  };
}

async function completeTask(req, rawNeedle) {
  const { db, actor, organizationId } = await resolveActor(req);
  const needle = String(rawNeedle || '').trim().replace(/[.?!]+$/, '').trim();
  if (!needle) {
    return { success: true, handled: true, kind: 'task_help', text: 'Назовите задачу, которую нужно завершить.' };
  }
  const { data, error } = await db
    .from('jarvis_tasks')
    .select('id,title,status,priority,due_at,created_at')
    .eq('organization_id', organizationId)
    .eq('assigned_to', actor.id)
    .in('status', ['TODO', 'IN_PROGRESS'])
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const tasks = data || [];
  const normalizedNeedle = needle.toLocaleLowerCase('ru-RU');
  let task = null;
  if (/^\d+$/.test(needle)) {
    const index = Number(needle) - 1;
    task = tasks[index] || null;
  }
  if (!task) {
    task = tasks.find(x => x.title.toLocaleLowerCase('ru-RU') === normalizedNeedle)
      || tasks.find(x => x.title.toLocaleLowerCase('ru-RU').includes(normalizedNeedle))
      || tasks.find(x => normalizedNeedle.includes(x.title.toLocaleLowerCase('ru-RU')));
  }
  if (!task) {
    return { success: true, handled: true, kind: 'task_not_found', text: `Не нашёл активную задачу «${needle}». Скажите «покажи мои задачи», чтобы увидеть список.` };
  }
  const completedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await db
    .from('jarvis_tasks')
    .update({ status: 'DONE', completed_at: completedAt, updated_at: completedAt })
    .eq('id', task.id)
    .eq('assigned_to', actor.id)
    .select('id,title,status,completed_at')
    .single();
  if (updateError) throw updateError;
  return { success: true, handled: true, kind: 'task_completed', text: `Готово. Задача «${updated.title}» завершена.`, task: updated };
}

function navigationAction(text) {
  const routes = [
    { re: /(?:открой|покажи)\s+(?:мне\s+)?касс[ау]/i, url: '../kassa/', label: 'кассу' },
    { re: /(?:открой|покажи)\s+(?:мне\s+)?заказ[ыа]/i, url: './orders.html', label: 'заказы' },
    { re: /(?:открой|покажи)\s+(?:мне\s+)?производств[оа]/i, url: './production.html', label: 'производство' },
    { re: /(?:открой|покажи)\s+(?:мне\s+)?склад/i, url: './warehouse.html', label: 'склад' },
    { re: /(?:открой|покажи)\s+(?:мне\s+)?сообщени[яе]/i, url: './messages.html', label: 'сообщения' },
    { re: /(?:открой|покажи)\s+(?:мне\s+)?отч[её]т/i, url: './reports.html', label: 'отчёты' }
  ];
  return routes.find(item => item.re.test(text)) || null;
}

async function handleCommand(req) {
  const text = stripJarvisPrefix(req.body?.text);
  if (!text) return { success: true, handled: false };

  const createMatch = text.match(/(?:создай|добавь|поставь|запиши)\s+(?:мне\s+)?задач(?:у|ку)\s+(.+)/i);
  if (createMatch) return createTask(req, createMatch[1]);

  if (/(?:покажи|назови|открой)?\s*(?:мои\s+)?(?:активные\s+)?задачи\b|что\s+(?:у\s+меня\s+)?по\s+задачам/i.test(text)) {
    return listTasks(req);
  }

  const completeMatch = text.match(/(?:закрой|заверши|выполни|отметь\s+выполненной)\s+задач(?:у|ку)?\s+(.+)/i);
  if (completeMatch) return completeTask(req, completeMatch[1]);

  if (/(?:открой|начни)\s+(?:кассовую\s+)?смену/i.test(text)) {
    return {
      success: true,
      handled: true,
      kind: 'system_action',
      text: 'Могу открыть кассовую смену. Нужно подтверждение.',
      system_action: {
        type: 'api', method: 'POST', path: '/api/v1/pos/shift/open', body: {}, requires_confirmation: true,
        confirm_text: 'Джарвис откроет кассовую смену. Продолжить?', success_text: 'Кассовая смена открыта.'
      }
    };
  }

  if (/(?:закрой|заверши)\s+(?:кассовую\s+)?смену/i.test(text)) {
    return {
      success: true,
      handled: true,
      kind: 'system_action',
      text: 'Могу закрыть кассовую смену. Нужно подтверждение.',
      system_action: {
        type: 'api', method: 'POST', path: '/api/v1/pos/shift/close', body: {}, requires_confirmation: true,
        confirm_text: 'Джарвис закроет текущую кассовую смену. Продолжить?', success_text: 'Кассовая смена закрыта.'
      }
    };
  }

  if (/(?:синхронизируй|обнови|обновить)\s+(?:каталог|мой\s*склад|мойсклад)/i.test(text)) {
    return {
      success: true,
      handled: true,
      kind: 'system_action',
      text: 'Готов запустить синхронизацию каталога с МойСклад.',
      system_action: {
        type: 'api', method: 'POST', path: '/api/v1/integrations/moysklad/sync', body: {}, requires_confirmation: true,
        confirm_text: 'Запустить синхронизацию каталога с МойСклад?', success_text: 'Синхронизация каталога запущена и завершена.'
      }
    };
  }

  const navigation = navigationAction(text);
  if (navigation) {
    return {
      success: true, handled: true, kind: 'navigation', text: `Открываю ${navigation.label}.`,
      system_action: { type: 'navigate', url: navigation.url, requires_confirmation: false }
    };
  }

  if (/(?:что\s+ты\s+умеешь|команды|помощь\s+джарвис)/i.test(text)) {
    return {
      success: true,
      handled: true,
      kind: 'help',
      text: 'Я умею создавать и закрывать задачи, показывать ваши активные задачи, открывать разделы HUB, проверять выручку, заказы, производство и сообщения. Кассовую смену и синхронизацию выполняю только после подтверждения.'
    };
  }

  return { success: true, handled: false };
}

async function jarvisFetch(path, options = {}) {
  const cfg = jarvisConfig();
  if (!cfg.configured) {
    const error = new Error('JARVIS_NOT_CONFIGURED');
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(`${cfg.baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(options.headers || {}) }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function proxy(path, options = {}) {
  const response = await jarvisFetch(path, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.detail || body.message || `JARVIS_HTTP_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

express.application.listen = function patchedJarvisBridgeListen(...args) {
  if (!this[installed]) {
    this[installed] = true;

    this.get('/api/v1/jarvis/health', requireHubSession, async (_req, res) => {
      const cfg = jarvisConfig();
      if (!cfg.configured) return res.status(503).json({ success: false, configured: false });
      try {
        const data = await proxy('/health');
        return res.json({ success: true, configured: true, jarvis: data });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, configured: true, error: String(error.message || error) });
      }
    });

    this.get('/api/v1/jarvis/workshop/status', requireHubSession, async (_req, res) => {
      try {
        const data = await proxy('/api/v1/workshop/status');
        return res.json({ success: true, ...data });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/command', requireHubSession, async (req, res) => {
      try {
        return res.json(await handleCommand(req));
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, handled: true, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/query', requireHubSession, async (req, res) => {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ success: false, error: 'TEXT_REQUIRED' });
      try {
        const data = await proxy('/api/v1/assistant/query', { method: 'POST', body: JSON.stringify({ text: text.slice(0, 4000) }) });
        return res.json({ success: true, ...data });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/tts', requireHubSession, async (req, res) => {
      const text = String(req.body?.text || '').trim();
      const voice = req.body?.voice === 'female' ? 'female' : 'male';
      if (!text) return res.status(400).json({ success: false, error: 'TEXT_REQUIRED' });
      try {
        const response = await jarvisFetch('/api/v1/tts', {
          method: 'POST', headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 2500), voice })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          return res.status(response.status).json({ success: false, error: body.detail || `TTS_HTTP_${response.status}` });
        }
        const audio = Buffer.from(await response.arrayBuffer());
        res.set('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
        res.set('Cache-Control', 'no-store');
        return res.send(audio);
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error) });
      }
    });

    this.get('/api/v1/jarvis/announcements', requireHubSession, async (_req, res) => {
      try {
        const data = await proxy('/api/v1/announcements');
        const announcements = Array.isArray(data) ? data : (data.items || data.announcements || []);
        return res.json({ success: true, announcements });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error), announcements: [] });
      }
    });

    this.post('/api/v1/jarvis/announcements/ack', requireHubSession, async (req, res) => {
      try {
        const data = await proxy('/api/v1/announcements/ack', { method: 'POST', body: JSON.stringify(req.body || {}) });
        return res.json({ success: true, ...data });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error) });
      }
    });
  }
  return originalListen.apply(this, args);
};
