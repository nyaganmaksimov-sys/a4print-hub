import express from 'express';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.jarvis.learning.bridge.installed');
const workerInstalled = Symbol.for('a4print.jarvis.learning.worker.installed');
const originalListen = express.application.listen;
let serviceClient;
let workerBusy = false;

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

async function requireSession(req, res, next) {
  try {
    const c = cfg();
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' });
    if (!c.supabaseUrl || !c.publishableKey) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED' });
    const response = await fetch(`${c.supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: c.publishableKey }
    });
    if (!response.ok) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
    req.jarvisUser = await response.json();
    req.jarvisToken = token;
    return next();
  } catch (error) {
    return next(error);
  }
}

async function actor(req) {
  const db = serviceDb();
  if (!db) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
  const { data: user, error } = await db
    .from('users')
    .select('id,full_name,email,is_active,organization_unit_id')
    .eq('auth_user_id', req.jarvisUser?.id)
    .maybeSingle();
  if (error) throw error;
  if (!user || user.is_active === false) throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'), { status: 403 });

  let organizationId = null;
  if (user.organization_unit_id) {
    const { data: unit, error: unitError } = await db
      .from('organization_units')
      .select('organization_id')
      .eq('id', user.organization_unit_id)
      .maybeSingle();
    if (unitError) throw unitError;
    organizationId = unit?.organization_id || null;
  }
  if (!organizationId) {
    const { data: org, error: orgError } = await db.from('organizations').select('id').eq('code', 'A4PRINT').maybeSingle();
    if (orgError) throw orgError;
    organizationId = org?.id || null;
  }
  if (!organizationId) throw Object.assign(new Error('ORGANIZATION_NOT_FOUND'), { status: 500 });
  return { db, user, organizationId };
}

const DEFAULT_PREFS = {
  humor_level: 1,
  learning_enabled: true,
  wake_word_enabled: true,
  bot_mode: 'off',
  bot_cursor_at: null,
  style_note: null
};

async function preferencesFor(userId, organizationId, create = false) {
  const db = serviceDb();
  const { data, error } = await db.from('jarvis_user_preferences').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const value = { ...DEFAULT_PREFS, user_id: userId, organization_id: organizationId };
  if (!create) return value;
  const { data: inserted, error: insertError } = await db.from('jarvis_user_preferences').insert(value).select('*').single();
  if (insertError) throw insertError;
  return inserted;
}

function memoryKey(text) {
  return createHash('sha256').update(String(text || '').trim().toLocaleLowerCase('ru-RU')).digest('hex').slice(0, 40);
}

async function remember(a, text, kind = 'preference', source = 'explicit', confidence = 0.9) {
  const value = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!value) return null;
  const row = {
    organization_id: a.organizationId,
    user_id: a.user.id,
    kind: ['preference', 'correction', 'fact', 'workflow'].includes(kind) ? kind : 'preference',
    memory_key: memoryKey(value),
    memory_text: value,
    confidence,
    source,
    active: true,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await a.db.from('jarvis_memory_items').upsert(row, { onConflict: 'user_id,memory_key' }).select('*').single();
  if (error) throw error;
  return data;
}

async function memoriesFor(userId, limit = 16) {
  const db = serviceDb();
  const { data, error } = await db
    .from('jarvis_memory_items')
    .select('id,kind,memory_text,confidence,source,use_count,updated_at')
    .eq('user_id', userId)
    .eq('active', true)
    .order('confidence', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function usageFor(userId, limit = 8) {
  const db = serviceDb();
  const { data, error } = await db
    .from('jarvis_usage_stats')
    .select('intent_key,use_count,success_count,last_used_at')
    .eq('user_id', userId)
    .order('use_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function recordUsage(a, intentKey, success = true) {
  const key = String(intentKey || 'unknown').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80) || 'unknown';
  const { data: existing } = await a.db.from('jarvis_usage_stats').select('use_count,success_count').eq('user_id', a.user.id).eq('intent_key', key).maybeSingle();
  await a.db.from('jarvis_usage_stats').upsert({
    user_id: a.user.id,
    organization_id: a.organizationId,
    intent_key: key,
    use_count: Number(existing?.use_count || 0) + 1,
    success_count: Number(existing?.success_count || 0) + (success ? 1 : 0),
    last_used_at: new Date().toISOString()
  }, { onConflict: 'user_id,intent_key' });
}

function seriousRequest(text) {
  return /(касс|деньг|оплат|выручк|возврат|ошиб|авари|тревог|критич|безопасн|парол|доступ|удал)/i.test(String(text || ''));
}

async function modelContext(a, text, extra = {}) {
  const [prefs, memories, usage] = await Promise.all([
    preferencesFor(a.user.id, a.organizationId),
    memoriesFor(a.user.id),
    usageFor(a.user.id)
  ]);
  return {
    jarvis_personality: {
      humor_level: Number(prefs.humor_level || 0),
      serious_mode: seriousRequest(text),
      style_note: prefs.style_note || null
    },
    jarvis_memories: memories.map(item => ({ kind: item.kind, text: item.memory_text, confidence: Number(item.confidence || 0) })),
    jarvis_usage: usage,
    current_user: { name: a.user.full_name || '', role: 'HUB user' },
    ...extra
  };
}

function simpleDraft(raw) {
  let value = String(raw || '').trim().replace(/^[,:;\s-]+/, '').trim();
  if (!value) value = 'Спасибо за сообщение. Принял информацию, вернусь с ответом в ближайшее время.';
  value = value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1);
  if (!/[.!?]$/.test(value)) value += '.';
  return value.slice(0, 4000);
}

function modelUnavailable(text) {
  return /языковая модель.*недоступ|локальная языковая модель.*недоступ|системные команды.*работ/i.test(String(text || ''));
}

async function callJarvisModel(a, text, extraContext = {}) {
  const c = cfg();
  if (!c.jarvisUrl || !c.jarvisKey) return { text: '', generated: false, reason: 'JARVIS_NOT_CONFIGURED' };
  try {
    const context = await modelContext(a, text, extraContext);
    const response = await fetch(`${c.jarvisUrl}/api/v1/assistant/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.jarvisKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text: String(text || '').slice(0, 4000), context })
    });
    if (!response.ok) throw new Error(`JARVIS_HTTP_${response.status}`);
    const body = await response.json();
    const value = String(body.text || '').trim();
    if (!value || modelUnavailable(value)) return { text: value, generated: false, reason: 'LLM_UNAVAILABLE' };
    return { text: value.slice(0, 4000), generated: true, data: body };
  } catch (error) {
    return { text: '', generated: false, reason: String(error.message || error) };
  }
}

async function handleLearningCommand(a, text) {
  const normalized = String(text || '').trim();

  if (/(?:что\s+ты\s+(?:запомнил|помнишь)|покажи\s+(?:свою\s+)?память|что\s+ты\s+знаешь\s+обо\s+мне)/i.test(normalized)) {
    const items = await memoriesFor(a.user.id, 20);
    if (!items.length) return { success: true, handled: true, kind: 'memory_list', text: 'Пока долговременных правил о вас не сохранил.', memories: [] };
    return {
      success: true, handled: true, kind: 'memory_list', memories: items,
      text: `Помню ${items.length}: ${items.map((x, i) => `${i + 1}) ${x.memory_text}`).join('; ')}.`
    };
  }

  const forget = normalized.match(/^(?:забудь|не\s+учитывай)\s+(?:что\s+)?(.+)/i);
  if (forget) {
    const needle = forget[1].trim().replace(/[,%]/g, '').slice(0, 200);
    const { data, error } = await a.db.from('jarvis_memory_items').select('id,memory_text').eq('user_id', a.user.id).eq('active', true).ilike('memory_text', `%${needle}%`).limit(10);
    if (error) throw error;
    const ids = (data || []).map(x => x.id);
    if (!ids.length) return { success: true, handled: true, kind: 'memory_forget', text: `Не нашёл в памяти правило про «${needle}».` };
    const { error: updateError } = await a.db.from('jarvis_memory_items').update({ active: false, updated_at: new Date().toISOString() }).in('id', ids).eq('user_id', a.user.id);
    if (updateError) throw updateError;
    return { success: true, handled: true, kind: 'memory_forget', text: `Хорошо. Больше не буду учитывать это правило. Убрано записей: ${ids.length}.` };
  }

  const rememberMatch = normalized.match(/^(?:запомни|помни|учти)(?:\s*,)?\s*(?:что\s+)?(.+)/i);
  if (rememberMatch) {
    const value = rememberMatch[1].trim();
    await remember(a, value, /(?:не\s+делай|никогда|исправ|не\s+называй)/i.test(value) ? 'correction' : 'preference', 'explicit', 0.98);
    return { success: true, handled: true, kind: 'memory_saved', text: `Запомнил: ${value}.` };
  }

  if (/(?:самообучени|обучени|запоминани)/i.test(normalized)) {
    const prefs = await preferencesFor(a.user.id, a.organizationId, true);
    const enabled = !/(?:выключ|отключ|не\s+запоминай)/i.test(normalized);
    const { data, error } = await a.db.from('jarvis_user_preferences').update({ learning_enabled: enabled, updated_at: new Date().toISOString() }).eq('user_id', a.user.id).select('*').single();
    if (error) throw error;
    return { success: true, handled: true, kind: 'learning_setting', preferences: data || prefs, text: enabled ? 'Обучаемая память включена. Буду учитывать ваши явные предпочтения и исправления.' : 'Обучаемая память выключена. Новые предпочтения автоматически сохранять не буду.' };
  }

  if (/(?:юмор|шути|шуток|повеселее)/i.test(normalized)) {
    let level = 1;
    if (/(?:без\s+(?:юмора|шуток)|не\s+шути|юмор\s+выкл)/i.test(normalized)) level = 0;
    else if (/(?:максим|побольше|больше\s+юмора|повеселее)/i.test(normalized)) level = 2;
    else if (/(?:очень\s+много|на\s+максимум|уровень\s*3)/i.test(normalized)) level = 3;
    else if (/(?:поменьше|меньше\s+юмора)/i.test(normalized)) level = 1;
    const prefs = await preferencesFor(a.user.id, a.organizationId, true);
    const { data, error } = await a.db.from('jarvis_user_preferences').update({ humor_level: level, updated_at: new Date().toISOString() }).eq('user_id', a.user.id).select('*').single();
    if (error) throw error;
    const phrases = ['Юмор отключён. Работаем строго по делу.', 'Лёгкий юмор включён. Без стендапа у кассы, обещаю.', 'Юмора будет больше. Но бухгалтерию всё равно не развеселю.', 'Режим максимального обаяния включён. Здравый смысл оставил включённым тоже.'];
    return { success: true, handled: true, kind: 'humor_setting', preferences: data || prefs, text: phrases[level] };
  }

  return null;
}

async function maybeLearnPreference(a, text) {
  const prefs = await preferencesFor(a.user.id, a.organizationId);
  if (!prefs.learning_enabled) return;
  const value = String(text || '').trim();
  if (value.length < 8 || value.length > 600) return;
  if (/(?:я\s+предпочитаю|мне\s+нравится,?\s+когда|всегда\s+(?:пиши|делай|говори)|никогда\s+не|не\s+называй\s+меня|пиши\s+мне\s+|обращайся\s+ко\s+мне)/i.test(value)) {
    await remember(a, value, /(?:никогда\s+не|не\s+называй)/i.test(value) ? 'correction' : 'preference', 'inferred_high_confidence', 0.9);
  }
}

function actionIntent(text) {
  const value = String(text || '');
  if (/(?:задач)/i.test(value)) return 'tasks';
  if (/(?:напиши|отправь|ответь).+(?:сотруд|общ|сообщ|:|,)/i.test(value)) return 'messaging';
  if (/(?:найд|поищ|покаж|открой|перейд|клиент|заказ|оплат|оборудован|сотрудник|производств|склад|касс|отч[её]т)/i.test(value)) return 'system_or_search';
  return '';
}

async function composeWithMemory(a, text) {
  const match = String(text || '').match(/(?:сформулируй|переформулируй|подготовь|напиши\s+черновик)\s+(?:мне\s+)?(?:сообщени(?:е|я)\s*)?(.*)/i);
  if (!match) return null;
  const sense = (match[1] || text).trim();
  const model = await callJarvisModel(a, `Сформулируй только готовый текст сообщения на русском языке без пояснений. Смысл: ${sense}`, { task: 'message_draft' });
  const draft = model.generated ? model.text : simpleDraft(sense);
  return { success: true, handled: true, kind: 'message_draft', text: draft, draft, generated_by_model: model.generated };
}

async function generalChat(a, text, pageContext) {
  const model = await callJarvisModel(a, text, { task: 'assistant_chat', page: pageContext || {} });
  if (!model.generated) {
    return { success: true, handled: true, kind: 'chat', generated_by_model: false, text: 'Я понял. Сейчас облачный мозг не подключён, поэтому могу выполнять системные команды, искать данные, ставить задачи и работать с сообщениями, но свободный диалог пока ограничен.' };
  }
  return { success: true, handled: true, kind: 'chat', generated_by_model: true, text: model.text };
}

async function ensureRoomMembership(db, userId, roomId) {
  const { data, error } = await db.from('chat_members').select('room_id').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function draftForMessage(a, messageId) {
  const { data: msg, error } = await a.db.from('messages').select('id,room_id,sender_id,body,created_at').eq('id', messageId).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!msg) throw Object.assign(new Error('MESSAGE_NOT_FOUND'), { status: 404 });
  if (!(await ensureRoomMembership(a.db, a.user.id, msg.room_id))) throw Object.assign(new Error('CHAT_ACCESS_DENIED'), { status: 403 });
  const { data: history, error: historyError } = await a.db.from('messages').select('sender_id,body,created_at').eq('room_id', msg.room_id).is('deleted_at', null).order('created_at', { ascending: false }).limit(8);
  if (historyError) throw historyError;
  const conversation = [...(history || [])].reverse().map(x => ({ role: x.sender_id === a.user.id ? 'user' : 'other', text: x.body }));
  const model = await callJarvisModel(a, `Ответь на последнее входящее сообщение: «${msg.body}». Дай только готовый текст ответа.`, { task: 'message_draft', conversation });
  const draft = model.generated ? model.text : simpleDraft('Спасибо за сообщение. Принял, уточню информацию и отвечу.');
  return { message: msg, draft, generated_by_model: model.generated, can_auto_send: model.generated };
}

async function autoProcessUser(pref) {
  const db = serviceDb();
  if (!db || pref.bot_mode !== 'auto') return;
  const { data: user, error: userError } = await db.from('users').select('id,full_name,email,is_active,organization_unit_id').eq('id', pref.user_id).maybeSingle();
  if (userError || !user || user.is_active === false) return;
  const a = { db, user, organizationId: pref.organization_id };

  const { data: memberships, error: memberError } = await db.from('chat_members').select('room_id').eq('user_id', user.id);
  if (memberError || !memberships?.length) return;
  const roomIds = memberships.map(x => x.room_id);
  const { data: rooms, error: roomsError } = await db.from('chat_rooms').select('id,is_group').in('id', roomIds).eq('is_group', false);
  if (roomsError || !rooms?.length) return;
  const directIds = rooms.map(x => x.id);

  let cursor = pref.bot_cursor_at || new Date().toISOString();
  const { data: messages, error: messageError } = await db.from('messages')
    .select('id,room_id,sender_id,body,created_at')
    .in('room_id', directIds)
    .neq('sender_id', user.id)
    .is('deleted_at', null)
    .gt('created_at', cursor)
    .order('created_at', { ascending: true })
    .limit(30);
  if (messageError || !messages?.length) return;

  const latestByRoom = new Map();
  for (const msg of messages) latestByRoom.set(msg.room_id, msg);
  const selected = [...latestByRoom.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (const msg of selected) {
    const { data: history } = await db.from('messages').select('sender_id,body,created_at').eq('room_id', msg.room_id).is('deleted_at', null).order('created_at', { ascending: false }).limit(8);
    const conversation = [...(history || [])].reverse().map(x => ({ role: x.sender_id === user.id ? 'user' : 'other', text: x.body }));
    const model = await callJarvisModel(a, `Подготовь короткий полезный ответ на последнее сообщение: «${msg.body}». Верни только текст ответа.`, { task: 'message_draft', conversation, autonomous_bot: true });
    if (!model.generated) break;
    const { error: sendError } = await db.from('messages').insert({ room_id: msg.room_id, sender_id: user.id, body: model.text.slice(0, 4000) });
    if (sendError) break;
    cursor = new Date(new Date(msg.created_at).getTime() + 1).toISOString();
    await db.from('jarvis_user_preferences').update({ bot_cursor_at: cursor, updated_at: new Date().toISOString() }).eq('user_id', user.id);
  }
}

async function runBotWorker() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const db = serviceDb();
    if (!db) return;
    const { data: prefs, error } = await db.from('jarvis_user_preferences').select('user_id,organization_id,bot_mode,bot_cursor_at').eq('bot_mode', 'auto').limit(25);
    if (error) throw error;
    for (const pref of prefs || []) {
      try { await autoProcessUser(pref); } catch (error) { console.warn('[Jarvis bot worker]', error); }
    }
  } catch (error) {
    console.warn('[Jarvis bot worker]', error);
  } finally {
    workerBusy = false;
  }
}

express.application.listen = function patchedJarvisLearningListen(...args) {
  if (!this[installed]) {
    this[installed] = true;

    this.get('/api/v1/jarvis/preferences', requireSession, async (req, res) => {
      try {
        const a = await actor(req);
        return res.json({ success: true, preferences: await preferencesFor(a.user.id, a.organizationId, true) });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.patch('/api/v1/jarvis/preferences', requireSession, async (req, res) => {
      try {
        const a = await actor(req);
        await preferencesFor(a.user.id, a.organizationId, true);
        const patch = { updated_at: new Date().toISOString() };
        if (Number.isInteger(req.body?.humor_level)) patch.humor_level = Math.max(0, Math.min(3, req.body.humor_level));
        if (typeof req.body?.learning_enabled === 'boolean') patch.learning_enabled = req.body.learning_enabled;
        if (typeof req.body?.wake_word_enabled === 'boolean') patch.wake_word_enabled = req.body.wake_word_enabled;
        if (['off', 'draft', 'auto'].includes(req.body?.bot_mode)) {
          patch.bot_mode = req.body.bot_mode;
          patch.bot_cursor_at = new Date().toISOString();
        }
        if (typeof req.body?.style_note === 'string') patch.style_note = req.body.style_note.trim().slice(0, 1000) || null;
        const { data, error } = await a.db.from('jarvis_user_preferences').update(patch).eq('user_id', a.user.id).select('*').single();
        if (error) throw error;
        return res.json({ success: true, preferences: data });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.get('/api/v1/jarvis/memory', requireSession, async (req, res) => {
      try {
        const a = await actor(req);
        return res.json({ success: true, memories: await memoriesFor(a.user.id, 50) });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/memory', requireSession, async (req, res) => {
      try {
        const a = await actor(req);
        const item = await remember(a, req.body?.text, req.body?.kind || 'preference', 'manual', 0.98);
        if (!item) return res.status(400).json({ success: false, error: 'TEXT_REQUIRED' });
        return res.json({ success: true, memory: item });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.delete('/api/v1/jarvis/memory/:id', requireSession, async (req, res) => {
      try {
        const a = await actor(req);
        const { error } = await a.db.from('jarvis_memory_items').update({ active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', a.user.id);
        if (error) throw error;
        return res.json({ success: true });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.get('/api/v1/jarvis/bot/settings', requireSession, async (req, res) => {
      try {
        const a = await actor(req);
        const preferences = await preferencesFor(a.user.id, a.organizationId, true);
        return res.json({ success: true, mode: preferences.bot_mode, preferences });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.patch('/api/v1/jarvis/bot/settings', requireSession, async (req, res) => {
      try {
        const a = await actor(req);
        const mode = ['off', 'draft', 'auto'].includes(req.body?.mode) ? req.body.mode : 'off';
        await preferencesFor(a.user.id, a.organizationId, true);
        const { data, error } = await a.db.from('jarvis_user_preferences').update({ bot_mode: mode, bot_cursor_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', a.user.id).select('*').single();
        if (error) throw error;
        return res.json({ success: true, mode: data.bot_mode, preferences: data });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/bot/draft', requireSession, async (req, res) => {
      try {
        const id = String(req.body?.message_id || '').trim();
        if (!id) return res.status(400).json({ success: false, error: 'MESSAGE_ID_REQUIRED' });
        const a = await actor(req);
        const draft = await draftForMessage(a, id);
        return res.json({ success: true, ...draft });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/bot/send', requireSession, async (req, res) => {
      try {
        const id = String(req.body?.message_id || '').trim();
        if (!id) return res.status(400).json({ success: false, error: 'MESSAGE_ID_REQUIRED' });
        const a = await actor(req);
        const draft = await draftForMessage(a, id);
        if (!draft.generated_by_model && req.body?.allow_fallback !== true) return res.json({ success: true, sent: false, ...draft, warning: 'MODEL_REQUIRED_FOR_AUTO_SEND' });
        const { data: message, error } = await a.db.from('messages').insert({ room_id: draft.message.room_id, sender_id: a.user.id, body: draft.draft }).select('id,room_id,body,created_at').single();
        if (error) throw error;
        return res.json({ success: true, sent: true, message, generated_by_model: draft.generated_by_model, source_message_id: id });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/query', requireSession, async (req, res, next) => {
      try {
        const text = String(req.body?.text || '').trim().replace(/^джарвис[\s,:-]*/i, '').trim();
        if (!text) return res.status(400).json({ success: false, error: 'TEXT_REQUIRED' });
        const a = await actor(req);

        const learning = await handleLearningCommand(a, text);
        if (learning) {
          recordUsage(a, learning.kind || 'learning', true).catch(() => {});
          return res.json(learning);
        }

        await maybeLearnPreference(a, text).catch(error => console.warn('[Jarvis learning]', error));

        const composed = await composeWithMemory(a, text);
        if (composed) {
          recordUsage(a, 'message_draft', true).catch(() => {});
          return res.json(composed);
        }

        const intent = actionIntent(text);
        if (intent) {
          const originalJson = res.json.bind(res);
          let recorded = false;
          res.json = payload => {
            if (!recorded) {
              recorded = true;
              const key = payload?.kind || intent;
              recordUsage(a, key, payload?.success !== false).catch(() => {});
            }
            return originalJson(payload);
          };
          return next();
        }

        const chat = await generalChat(a, text, req.body?.context);
        recordUsage(a, 'chat', chat.generated_by_model !== false).catch(() => {});
        return res.json(chat);
      } catch (error) {
        console.error('[Jarvis learning bridge]', error);
        return res.status(error.status || 500).json({ success: false, handled: true, error: String(error.message || error) });
      }
    });
  }

  if (!globalThis[workerInstalled]) {
    globalThis[workerInstalled] = true;
    const timer = setInterval(runBotWorker, 15000);
    timer.unref?.();
    setTimeout(runBotWorker, 5000).unref?.();
  }

  return originalListen.apply(this, args);
};
