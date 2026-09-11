import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.manager.workspace.installed');
const workerInstalled = Symbol.for('a4print.manager.workspace.worker.installed');
const originalListen = express.application.listen;

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const service = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const REMINDER_INTERVAL_MS = Math.max(30_000, Number(process.env.MANAGER_REMINDER_INTERVAL_MS || 60_000));
const CLOSED_ORDER = new Set(['COMPLETED', 'CANCELLED', 'CANCELED']);
const workerState = { running: false, runs: 0, notifications: 0, last_run_at: null, last_error: null };

const upper = value => String(value || '').trim().toUpperCase();
const text = (value, max = 4000) => String(value || '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: publishableKey }, signal: controller.signal
      });
      if (!response.ok) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
      req.managerAuth = await response.json();
      req.managerToken = token;
      req.managerDb = scopedDb(token);
      return next();
    } finally { clearTimeout(timer); }
  } catch (error) { return next(error); }
}

async function actorContext(req) {
  if (!service || !req.managerDb) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
  const authId = String(req.managerAuth?.id || '');
  const { data: actor, error } = await service.from('users').select('id,full_name,email,is_active,organization_unit_id').eq('auth_user_id', authId).maybeSingle();
  if (error) throw error;
  if (!actor || actor.is_active === false) throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'), { status: 403 });
  const { data: roleRows, error: roleError } = await req.managerDb.rpc('get_my_roles');
  if (roleError) throw roleError;
  const roles = (Array.isArray(roleRows) ? roleRows : []).map(x => upper(typeof x === 'string' ? x : x?.role || x?.name || x));
  let organizationId = null;
  if (actor.organization_unit_id) {
    const { data: unit } = await service.from('organization_units').select('organization_id').eq('id', actor.organization_unit_id).maybeSingle();
    organizationId = unit?.organization_id || null;
  }
  if (!organizationId) {
    const { data: org } = await service.from('organizations').select('id').eq('code', 'A4PRINT').maybeSingle();
    organizationId = org?.id || null;
  }
  return { actor, roles, organizationId, db: req.managerDb, isManager: roles.includes('MANAGER') || roles.includes('ADMIN'), isAdmin: roles.includes('ADMIN') };
}

function moscowDay(value) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  } catch { return ''; }
}

function firstName(fullName, email) {
  const name = String(fullName || '').trim();
  if (name) return name.split(/\s+/)[0];
  return String(email || '').split('@')[0] || 'коллега';
}

async function safeQuery(promise, fallback = []) {
  try {
    const { data, error } = await promise;
    if (error) throw error;
    return Array.isArray(data) ? data : (data || fallback);
  } catch { return fallback; }
}

async function briefing(req, res) {
  try {
    const ctx = await actorContext(req);
    const orders = await safeQuery(ctx.db.from('orders').select('id,order_number,status,total,due_at,assigned_to,updated_at,customers(full_name,company_name)').order('updated_at', { ascending: false }).limit(2000));
    const production = await safeQuery(ctx.db.from('production_jobs').select('id,order_id,title,status,planned_end').limit(2000));
    let incidents = [];
    if (ctx.organizationId) {
      incidents = await safeQuery(service.from('jarvis_incidents').select('id,severity,title,status,last_seen_at').eq('organization_id', ctx.organizationId).in('status', ['OPEN','ACK']).order('last_seen_at', { ascending: false }).limit(50));
    }

    const now = Date.now();
    const today = moscowDay(now);
    const openOrders = orders.filter(o => !CLOSED_ORDER.has(upper(o.status)));
    const overdue = openOrders.filter(o => o.due_at && new Date(o.due_at).getTime() < now);
    const dueToday = openOrders.filter(o => o.due_at && moscowDay(o.due_at) === today);
    const ready = openOrders.filter(o => upper(o.status) === 'READY');
    const inProgress = openOrders.filter(o => upper(o.status) === 'IN_PROGRESS');
    const mine = openOrders.filter(o => o.assigned_to === ctx.actor.id);
    const productionDelayed = production.filter(p => p.planned_end && !['DONE','COMPLETED','CANCELLED','CANCELED'].includes(upper(p.status)) && new Date(p.planned_end).getTime() < now);
    const activeValue = openOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const nearest = [...openOrders].filter(o => o.due_at).sort((a,b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 6).map(o => ({
      id: o.id, order_number: o.order_number, status: o.status, due_at: o.due_at, total: Number(o.total || 0),
      customer: o.customers?.full_name || o.customers?.company_name || ''
    }));
    const critical = incidents.filter(x => x.severity === 'critical').length;
    const warning = incidents.filter(x => x.severity === 'warning').length;

    return res.json({
      success: true,
      profile: { id: ctx.actor.id, full_name: ctx.actor.full_name, email: ctx.actor.email, first_name: firstName(ctx.actor.full_name, ctx.actor.email), roles: ctx.roles },
      orders_available: orders.length > 0 || ctx.isManager,
      summary: {
        active_orders: openOrders.length, in_progress: inProgress.length, ready: ready.length, overdue: overdue.length,
        due_today: dueToday.length, my_orders: mine.length, active_value: Math.round(activeValue * 100) / 100,
        production_delayed: productionDelayed.length, sentinel_critical: critical, sentinel_warning: warning
      },
      nearest_orders: nearest,
      generated_at: nowIso(), timezone: 'Europe/Moscow'
    });
  } catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
}

function ensureManager(ctx) {
  if (!ctx.isManager) throw Object.assign(new Error('MANAGER_ROLE_REQUIRED'), { status: 403 });
}

function parseRange(req) {
  const now = new Date();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw Object.assign(new Error('INVALID_RANGE'), { status: 400 });
  return { from: from.toISOString(), to: to.toISOString() };
}

async function calendarList(req, res) {
  try {
    const ctx = await actorContext(req); ensureManager(ctx);
    const { from, to } = parseRange(req);
    const { data: events, error } = await service.from('manager_calendar_events')
      .select('id,title,description,starts_at,ends_at,all_day,order_id,reminder_minutes,reminded_at,status,created_at,updated_at')
      .eq('user_id', ctx.actor.id).gte('starts_at', from).lt('starts_at', to).neq('status','CANCELLED').order('starts_at');
    if (error) throw error;
    const orders = await safeQuery(ctx.db.from('orders').select('id,order_number,status,total,due_at,customers(full_name,company_name)').gte('due_at', from).lt('due_at', to).order('due_at').limit(1000));
    return res.json({ success: true, events: events || [], orders: orders.map(o => ({ id:o.id, order_number:o.order_number, status:o.status, total:Number(o.total||0), due_at:o.due_at, customer:o.customers?.full_name||o.customers?.company_name||'' })) });
  } catch (error) { return res.status(error.status || 500).json({ success:false, error:String(error.message||error) }); }
}

function eventPayload(body, actorId) {
  const starts = new Date(String(body?.starts_at || ''));
  const endsRaw = body?.ends_at ? new Date(String(body.ends_at)) : null;
  if (!Number.isFinite(starts.getTime())) throw Object.assign(new Error('START_REQUIRED'), { status: 400 });
  if (endsRaw && (!Number.isFinite(endsRaw.getTime()) || endsRaw < starts)) throw Object.assign(new Error('INVALID_END'), { status: 400 });
  const title = text(body?.title, 300);
  if (!title) throw Object.assign(new Error('TITLE_REQUIRED'), { status: 400 });
  const reminder = body?.reminder_minutes === null || body?.reminder_minutes === '' || body?.reminder_minutes === undefined ? null : Number(body.reminder_minutes);
  if (reminder !== null && (!Number.isInteger(reminder) || reminder < 0 || reminder > 10080)) throw Object.assign(new Error('INVALID_REMINDER'), { status: 400 });
  const status = ['SCHEDULED','DONE','CANCELLED'].includes(upper(body?.status)) ? upper(body.status) : 'SCHEDULED';
  return { user_id: actorId, title, description: text(body?.description, 6000) || null, starts_at: starts.toISOString(), ends_at: endsRaw?.toISOString() || null, all_day: body?.all_day === true, order_id: body?.order_id || null, reminder_minutes: reminder, status };
}

async function validateOrder(ctx, orderId) {
  if (!orderId) return;
  const { data, error } = await ctx.db.from('orders').select('id').eq('id', orderId).maybeSingle();
  if (error || !data) throw Object.assign(new Error('ORDER_NOT_ACCESSIBLE'), { status: 403 });
}

async function calendarCreate(req, res) {
  try {
    const ctx = await actorContext(req); ensureManager(ctx);
    const payload = eventPayload(req.body, ctx.actor.id); await validateOrder(ctx, payload.order_id);
    const { data, error } = await service.from('manager_calendar_events').insert(payload).select('*').single();
    if (error) throw error;
    return res.status(201).json({ success:true, event:data });
  } catch (error) { return res.status(error.status || 500).json({ success:false, error:String(error.message||error) }); }
}

async function calendarUpdate(req, res) {
  try {
    const ctx = await actorContext(req); ensureManager(ctx);
    const { data: existing, error: findError } = await service.from('manager_calendar_events').select('*').eq('id',req.params.id).eq('user_id',ctx.actor.id).maybeSingle();
    if (findError) throw findError; if (!existing) return res.status(404).json({success:false,error:'EVENT_NOT_FOUND'});
    const payload = eventPayload({ ...existing, ...req.body }, ctx.actor.id); await validateOrder(ctx, payload.order_id);
    const { data, error } = await service.from('manager_calendar_events').update(payload).eq('id',existing.id).select('*').single();
    if (error) throw error; return res.json({success:true,event:data});
  } catch (error) { return res.status(error.status || 500).json({ success:false, error:String(error.message||error) }); }
}

async function calendarDelete(req, res) {
  try {
    const ctx = await actorContext(req); ensureManager(ctx);
    const { error } = await service.from('manager_calendar_events').delete().eq('id',req.params.id).eq('user_id',ctx.actor.id);
    if (error) throw error; return res.json({success:true});
  } catch (error) { return res.status(error.status || 500).json({ success:false, error:String(error.message||error) }); }
}

async function notificationsList(req, res) {
  try {
    const ctx = await actorContext(req);
    const rows = await safeQuery(ctx.db.from('notifications').select('id,title,body,type,entity_type,entity_id,is_read,created_at').order('created_at',{ascending:false}).limit(40));
    return res.json({success:true,items:rows});
  } catch (error) { return res.status(error.status || 500).json({success:false,error:String(error.message||error)}); }
}

async function notificationRead(req, res) {
  try {
    const ctx = await actorContext(req);
    const { error } = await ctx.db.from('notifications').update({is_read:true}).eq('id',req.params.id);
    if (error) throw error; return res.json({success:true});
  } catch (error) { return res.status(error.status || 500).json({success:false,error:String(error.message||error)}); }
}

async function insertNotification(userId, title, body, type, entityType, entityId) {
  if (!userId) return false;
  const { error } = await service.from('notifications').insert({ user_id:userId, title:text(title,300), body:text(body,2000)||null, type, entity_type:entityType||null, entity_id:entityId||null });
  if (error) throw error; workerState.notifications += 1; return true;
}

async function claimReminder(key, kind, entityId, userId) {
  const { error } = await service.from('manager_reminder_log').insert({ reminder_key:key, kind, entity_id:entityId||null, user_id:userId||null });
  if (!error) return true;
  if (String(error.code) === '23505') return false;
  throw error;
}

async function runReminders() {
  if (workerState.running || !service) return;
  workerState.running = true;
  try {
    const now = Date.now();
    const { data: events, error:eventError } = await service.from('manager_calendar_events').select('id,user_id,title,starts_at,order_id,reminder_minutes,reminded_at,status').eq('status','SCHEDULED').is('reminded_at',null).not('reminder_minutes','is',null).lte('starts_at',new Date(now + 7*86400000).toISOString()).limit(1000);
    if (eventError) throw eventError;
    for (const event of events || []) {
      const starts = new Date(event.starts_at).getTime();
      if (!Number.isFinite(starts)) continue;
      const fireAt = starts - Number(event.reminder_minutes||0)*60000;
      if (fireAt > now) continue;
      if (await claimReminder(`calendar:${event.id}:${event.starts_at}:${event.reminder_minutes}`, 'CALENDAR', event.id, event.user_id)) {
        await insertNotification(event.user_id, `Напоминание: ${event.title}`, `Событие запланировано на ${new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(event.starts_at))} МСК.`, 'CALENDAR_REMINDER', 'calendar_event', event.id);
      }
      await service.from('manager_calendar_events').update({reminded_at:nowIso()}).eq('id',event.id);
    }

    const { data: orders, error:orderError } = await service.from('orders').select('id,order_number,status,due_at,deadline_remind_before_hours,assigned_to').not('due_at','is',null).lte('due_at',new Date(now + 14*86400000).toISOString()).limit(3000);
    if (orderError) throw orderError;
    for (const order of orders || []) {
      if (CLOSED_ORDER.has(upper(order.status)) || !order.assigned_to) continue;
      const due = new Date(order.due_at).getTime(); const hours = Math.max(1,Number(order.deadline_remind_before_hours||48));
      if (due - hours*3600000 > now) continue;
      const key=`order:${order.id}:${order.due_at}:${hours}:${order.assigned_to}`;
      if (!await claimReminder(key,'ORDER_DEADLINE',order.id,order.assigned_to)) continue;
      const overdue = due < now;
      await insertNotification(order.assigned_to, overdue?`Просрочен заказ №${order.order_number}`:`Скоро срок заказа №${order.order_number}`, overdue?'Срок уже прошёл. Откройте заказ и проверьте готовность.':`До срока осталось около ${Math.max(0,Math.round((due-now)/3600000))} ч.`, 'ORDER_DEADLINE','order',order.id);
    }
    workerState.runs += 1; workerState.last_run_at=nowIso(); workerState.last_error=null;
  } catch (error) { workerState.last_run_at=nowIso(); workerState.last_error=String(error.message||error); console.error('[Manager reminders]',error); }
  finally { workerState.running=false; }
}

function installWorker() {
  if (globalThis[workerInstalled] || !service) return;
  globalThis[workerInstalled]=true;
  const first=setTimeout(runReminders,12_000); first.unref?.();
  const timer=setInterval(runReminders,REMINDER_INTERVAL_MS); timer.unref?.();
}

express.application.listen = function patchedManagerWorkspaceListen(...args) {
  if (!this[installed]) {
    this[installed]=true;
    this.get('/api/v1/jarvis/briefing', requireSession, briefing);
    this.get('/api/v1/manager/calendar', requireSession, calendarList);
    this.post('/api/v1/manager/calendar', requireSession, calendarCreate);
    this.patch('/api/v1/manager/calendar/:id', requireSession, calendarUpdate);
    this.delete('/api/v1/manager/calendar/:id', requireSession, calendarDelete);
    this.get('/api/v1/manager/notifications', requireSession, notificationsList);
    this.post('/api/v1/manager/notifications/:id/read', requireSession, notificationRead);
    this.get('/api/v1/manager/reminder-status', requireSession, async (req,res) => {
      try { const ctx=await actorContext(req); if(!ctx.isAdmin)return res.status(403).json({success:false,error:'ADMIN_REQUIRED'}); return res.json({success:true,worker:{...workerState,interval_ms:REMINDER_INTERVAL_MS}}); }
      catch(error){return res.status(error.status||500).json({success:false,error:String(error.message||error)});}
    });
  }
  installWorker();
  return originalListen.apply(this,args);
};

export { runReminders };
