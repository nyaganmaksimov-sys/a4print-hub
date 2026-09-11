import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.jarvis.sentinel.installed');
const workerInstalled = Symbol.for('a4print.jarvis.sentinel.worker.installed');
const originalListen = express.application.listen;

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const service = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const SENTINEL_VERSION = '1.0.0';
const SCAN_INTERVAL_MS = Math.max(30_000, Number(process.env.JARVIS_SENTINEL_INTERVAL_MS || 60_000));
const MANAGED_BY = 'jarvis_sentinel_v1';
const state = {
  running: false,
  last_run_at: null,
  last_duration_ms: null,
  last_error: null,
  last_detected: 0,
  last_open: 0,
  scans: 0
};

const CLOSED_ORDER = new Set(['COMPLETED', 'CANCELLED', 'CANCELED']);
const CLOSED_PRODUCTION = new Set(['DONE', 'COMPLETED', 'CANCELLED', 'CANCELED']);
const CLOSED_TASK = new Set(['DONE', 'COMPLETED', 'CANCELLED', 'CANCELED']);

function nowIso() { return new Date().toISOString(); }
function ms(value) { const n = new Date(value).getTime(); return Number.isFinite(n) ? n : null; }
function hours(value) { return Math.round(value / 3_600_000 * 10) / 10; }
function days(value) { return Math.round(value / 86_400_000 * 10) / 10; }
function upper(value) { return String(value || '').trim().toUpperCase(); }
function clampText(value, max = 1600) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function fingerprint(...parts) { return parts.map(x => String(x ?? '').trim()).join(':').slice(0, 500); }
function routeAction(label, url, note = '') { return { type: 'navigate', label, url, note }; }
function advice(label, note) { return { type: 'advice', label, note }; }

async function safeRows(name, table, configure = q => q) {
  if (!service) return { name, rows: [], error: 'DATABASE_NOT_CONFIGURED' };
  try {
    const { data, error } = await configure(service.from(table).select('*'));
    if (error) throw error;
    return { name, rows: Array.isArray(data) ? data : [], error: null };
  } catch (error) {
    return { name, rows: [], error: String(error?.message || error) };
  }
}

function addDesired(map, incident) {
  if (!incident?.organization_id || !incident?.fingerprint) return;
  const key = `${incident.organization_id}:${incident.fingerprint}`;
  const severityRank = { info: 1, warning: 2, critical: 3 };
  const previous = map.get(key);
  if (!previous || severityRank[incident.severity] > severityRank[previous.severity]) map.set(key, incident);
}

async function resolveOrganizations() {
  const { data, error } = await service.from('organizations').select('id,code,name');
  if (error) throw error;
  const byCode = new Map((data || []).map(x => [upper(x.code), x]));
  return {
    list: data || [],
    byCode,
    a4: byCode.get('A4PRINT')?.id || data?.[0]?.id || null,
    art3d: byCode.get('3DARTPRINT')?.id || byCode.get('3D_ARTPRINT')?.id || null
  };
}

function orderOrg(order, orgs) {
  const unit = upper(order?.business_unit);
  if (unit === '3D_ARTPRINT' && orgs.art3d) return orgs.art3d;
  return orgs.a4;
}

async function buildSignals(orgs) {
  const desired = new Map();
  const started = Date.now();
  const now = Date.now();

  const sources = await Promise.all([
    safeRows('orders', 'orders', q => q.select('id,order_number,business_unit,status,due_at,deadline_remind_before_hours,updated_at,customer_id').limit(3000)),
    safeRows('production', 'production_jobs', q => q.select('id,order_id,title,status,priority,planned_end,updated_at').limit(3000)),
    safeRows('integrations', 'integration_sync_log', q => q.select('id,organization_id,integration,entity_type,status,error_message,started_at,finished_at').order('started_at', { ascending: false }).limit(500)),
    safeRows('self_test', 'system_self_test_runs', q => q.select('id,started_at,finished_at,status,details').order('started_at', { ascending: false }).limit(1)),
    safeRows('support', 'support_tickets', q => q.select('id,requester_id,subject,status,priority,assigned_to,source,created_at,updated_at').order('updated_at', { ascending: false }).limit(1000)),
    safeRows('users', 'users', q => q.select('id,organization_unit_id,is_active').limit(3000)),
    safeRows('units', 'organization_units', q => q.select('id,organization_id,code,is_active').limit(1000)),
    safeRows('equipment', 'equipment_assets', q => q.select('id,organization_id,name,status,next_service_date,updated_at').limit(3000)),
    safeRows('consumables', 'equipment_consumable_balances', q => q.select('consumable_id,organization_id,name,unit,min_stock,current_stock,low_stock').eq('low_stock', true).limit(3000)),
    safeRows('tasks', 'jarvis_tasks', q => q.select('id,organization_id,title,status,priority,due_at,assigned_to,updated_at').limit(3000))
  ]);

  const byName = Object.fromEntries(sources.map(x => [x.name, x]));

  for (const source of sources) {
    if (!source.error || !orgs.a4) continue;
    addDesired(desired, {
      organization_id: orgs.a4,
      fingerprint: fingerprint('sentinel', 'source', source.name),
      kind: 'monitoring_error', severity: 'warning', source: source.name,
      title: `Джарвис не смог проверить: ${source.name}`,
      detail: `Во время фоновой диагностики источник ${source.name} вернул ошибку: ${clampText(source.error, 700)}.`,
      suggested_actions: [advice('Повторить проверку', 'Джарвис повторит её автоматически на следующем цикле.'), advice('Проверить схему/доступ', 'Если ошибка повторяется, проверить таблицу, представление и доступ service_role.')],
      evidence: { managed_by: MANAGED_BY, source: source.name, error: clampText(source.error, 900) }
    });
  }

  const orders = byName.orders.rows;
  const orderMap = new Map(orders.map(x => [x.id, x]));
  for (const order of orders) {
    const due = ms(order.due_at);
    if (!due || CLOSED_ORDER.has(upper(order.status))) continue;
    const delta = due - now;
    const remindHours = Math.max(1, Number(order.deadline_remind_before_hours || 48));
    if (delta > remindHours * 3_600_000) continue;
    const overdue = delta < 0;
    const overdueHours = overdue ? Math.abs(delta) / 3_600_000 : 0;
    const orgId = orderOrg(order, orgs);
    addDesired(desired, {
      organization_id: orgId,
      fingerprint: fingerprint('order', order.id, 'deadline'),
      kind: 'order_deadline',
      severity: overdueHours >= 12 ? 'critical' : 'warning',
      source: 'orders',
      title: overdue ? `Просрочен заказ №${order.order_number}` : `Приближается срок заказа №${order.order_number}`,
      detail: overdue
        ? `Срок заказа прошёл ${hours(Math.abs(delta))} ч назад. Текущий статус: ${order.status}.`
        : `До срока заказа осталось ${hours(delta)} ч. Текущий статус: ${order.status}.`,
      suggested_actions: [routeAction('Открыть заказ', `/admin/order.html?id=${order.id}`), advice('Проверить производство', 'Уточнить готовность, исполнителя и реальный срок выдачи.'), advice('Предупредить клиента', 'Если срок сдвигается, заранее согласовать новый срок.')],
      evidence: { managed_by: MANAGED_BY, route: `/admin/order.html?id=${order.id}`, entity_type: 'order', entity_id: order.id, order_number: order.order_number, due_at: order.due_at, status: order.status }
    });
  }

  for (const job of byName.production.rows) {
    const due = ms(job.planned_end);
    if (!due || CLOSED_PRODUCTION.has(upper(job.status)) || due >= now) continue;
    const order = orderMap.get(job.order_id);
    const orgId = order ? orderOrg(order, orgs) : orgs.a4;
    const lag = now - due;
    addDesired(desired, {
      organization_id: orgId,
      fingerprint: fingerprint('production', job.id, 'planned_end'),
      kind: 'production_delay', severity: lag > 6 * 3_600_000 ? 'critical' : 'warning', source: 'production_jobs',
      title: `Производственное задание выбилось из плана`,
      detail: `${job.title || 'Задание'} просрочено по плану на ${hours(lag)} ч. Статус: ${job.status}${order?.order_number ? `. Заказ №${order.order_number}` : ''}.`,
      suggested_actions: [routeAction('Открыть производство', `/admin/production.html?job=${job.id}`), advice('Проверить блокировку', 'Уточнить материал, оборудование, исполнителя и зависимые операции.'), advice('Перепланировать', 'Если задержка подтверждается, обновить план и срок заказа.')],
      evidence: { managed_by: MANAGED_BY, route: `/admin/production.html?job=${job.id}`, entity_type: 'production_job', entity_id: job.id, planned_end: job.planned_end, status: job.status, order_id: job.order_id }
    });
  }

  const latestSync = new Map();
  for (const row of byName.integrations.rows) {
    const key = `${row.organization_id || orgs.a4}:${row.integration || 'unknown'}:${row.entity_type || 'all'}`;
    if (!latestSync.has(key)) latestSync.set(key, row);
  }
  for (const row of latestSync.values()) {
    const status = upper(row.status);
    const failed = ['ERROR', 'FAILED', 'FAIL', 'TIMEOUT'].includes(status) || Boolean(row.error_message);
    const partial = status === 'PARTIAL' || status === 'WARNING';
    if (!failed && !partial) continue;
    const orgId = row.organization_id || orgs.a4;
    addDesired(desired, {
      organization_id: orgId,
      fingerprint: fingerprint('integration', row.integration, row.entity_type || 'all'),
      kind: 'integration_error', severity: failed ? 'critical' : 'warning', source: 'integration_sync_log',
      title: `Проблема синхронизации: ${row.integration || 'интеграция'}`,
      detail: `${row.entity_type || 'Данные'}: статус ${row.status || 'неизвестен'}${row.error_message ? `. ${clampText(row.error_message, 900)}` : ''}`,
      suggested_actions: [advice('Проверить доступность сервиса', 'Проверить сеть, API внешнего сервиса и срок действия токена.'), advice('Повторить синхронизацию', 'Повторять только после проверки, что операция идемпотентна.'), routeAction('Открыть настройки', '/admin/settings.html')],
      evidence: { managed_by: MANAGED_BY, route: '/admin/settings.html', integration: row.integration, entity_type: row.entity_type, status: row.status, error_message: row.error_message, started_at: row.started_at, finished_at: row.finished_at }
    });
  }

  const selfTest = byName.self_test.rows[0];
  if (orgs.a4) {
    if (!selfTest) {
      addDesired(desired, {
        organization_id: orgs.a4, fingerprint: 'system:self_test:missing', kind: 'system_health', severity: 'critical', source: 'system_self_test_runs',
        title: 'Нет результатов системного self-test', detail: 'Джарвис не нашёл ни одного результата сквозной проверки HUB.',
        suggested_actions: [advice('Запустить self-test', 'Проверить расписание pg_cron и функцию run_system_e2e_self_test().')], evidence: { managed_by: MANAGED_BY }
      });
    } else {
      const finished = ms(selfTest.finished_at || selfTest.started_at);
      const age = finished ? now - finished : Infinity;
      if (upper(selfTest.status) !== 'PASS' || age > 36 * 3_600_000) {
        addDesired(desired, {
          organization_id: orgs.a4, fingerprint: 'system:self_test:health', kind: 'system_health', severity: upper(selfTest.status) === 'FAIL' ? 'critical' : 'warning', source: 'system_self_test_runs',
          title: upper(selfTest.status) === 'FAIL' ? 'Системный self-test HUB завершился ошибкой' : 'Системный self-test HUB устарел',
          detail: upper(selfTest.status) === 'FAIL' ? 'Последняя сквозная проверка HUB имеет статус FAIL.' : `Последняя сквозная проверка выполнялась ${hours(age)} ч назад.`,
          suggested_actions: [advice('Открыть детали проверки', 'Проверить details последнего system_self_test_runs и устранить первый упавший этап.'), advice('Повторить после исправления', 'После устранения причины повторно выполнить self-test.')],
          evidence: { managed_by: MANAGED_BY, status: selfTest.status, started_at: selfTest.started_at, finished_at: selfTest.finished_at, details: selfTest.details || {} }
        });
      }
    }
  }

  const unitOrg = new Map(byName.units.rows.map(x => [x.id, x.organization_id]));
  const userOrg = new Map(byName.users.rows.map(x => [x.id, unitOrg.get(x.organization_unit_id) || orgs.a4]));
  for (const ticket of byName.support.rows) {
    if (!['NEW', 'OPEN'].includes(upper(ticket.status))) continue;
    const created = ms(ticket.created_at);
    if (!created) continue;
    const age = now - created;
    const isNewUnassigned = upper(ticket.status) === 'NEW' && !ticket.assigned_to;
    if (!isNewUnassigned || age < 30 * 60_000) continue;
    const orgId = userOrg.get(ticket.requester_id) || orgs.a4;
    addDesired(desired, {
      organization_id: orgId,
      fingerprint: fingerprint('support', ticket.id, 'unanswered'),
      kind: 'support_wait', severity: age > 4 * 3_600_000 ? 'critical' : 'warning', source: 'support_tickets',
      title: 'Обращение поддержки ждёт ответа',
      detail: `Обращение «${clampText(ticket.subject || 'Без темы', 180)}» остаётся новым без назначенного оператора ${hours(age)} ч.`,
      suggested_actions: [routeAction('Открыть поддержку', '/admin/support.html'), advice('Назначить оператора', 'Взять обращение в работу и дать пользователю первый ответ.'), advice('Использовать Джарвиса', 'Сначала подобрать ответ по базе знаний и диагностике, затем при необходимости передать оператору.')],
      evidence: { managed_by: MANAGED_BY, route: '/admin/support.html', entity_type: 'support_ticket', entity_id: ticket.id, status: ticket.status, priority: ticket.priority, created_at: ticket.created_at }
    });
  }

  for (const asset of byName.equipment.rows) {
    const due = ms(asset.next_service_date);
    if (!due || !asset.organization_id) continue;
    const delta = due - now;
    if (delta > 7 * 86_400_000) continue;
    const overdue = delta < 0;
    addDesired(desired, {
      organization_id: asset.organization_id,
      fingerprint: fingerprint('equipment', asset.id, 'service'),
      kind: 'equipment_maintenance', severity: overdue && Math.abs(delta) > 7 * 86_400_000 ? 'critical' : 'warning', source: 'equipment_assets',
      title: overdue ? `Просрочено обслуживание: ${asset.name}` : `Скоро обслуживание: ${asset.name}`,
      detail: overdue ? `Плановая дата обслуживания прошла ${days(Math.abs(delta))} дн. назад.` : `До планового обслуживания осталось ${days(delta)} дн.`,
      suggested_actions: [routeAction('Открыть оборудование', `/admin/equipment.html?asset=${asset.id}`), advice('Запланировать обслуживание', 'Назначить дату, исполнителя и необходимые расходники.')],
      evidence: { managed_by: MANAGED_BY, route: `/admin/equipment.html?asset=${asset.id}`, entity_type: 'equipment', entity_id: asset.id, next_service_date: asset.next_service_date, status: asset.status }
    });
  }

  for (const item of byName.consumables.rows) {
    if (!item.organization_id || item.low_stock !== true) continue;
    const current = Number(item.current_stock || 0);
    const minimum = Number(item.min_stock || 0);
    addDesired(desired, {
      organization_id: item.organization_id,
      fingerprint: fingerprint('consumable', item.consumable_id, 'low_stock'),
      kind: 'low_stock', severity: current <= 0 && minimum > 0 ? 'critical' : 'warning', source: 'equipment_consumable_balances',
      title: current <= 0 ? `Закончился расходник: ${item.name}` : `Мало расходника: ${item.name}`,
      detail: `Остаток ${current} ${item.unit || ''}; минимальный запас ${minimum} ${item.unit || ''}.`,
      suggested_actions: [routeAction('Открыть склад', '/admin/warehouse.html'), advice('Пополнить запас', 'Проверить фактический остаток и создать закупку/перемещение.')],
      evidence: { managed_by: MANAGED_BY, route: '/admin/warehouse.html', entity_type: 'consumable', entity_id: item.consumable_id, current_stock: current, min_stock: minimum }
    });
  }

  for (const task of byName.tasks.rows) {
    const due = ms(task.due_at);
    if (!due || due >= now || CLOSED_TASK.has(upper(task.status)) || !task.organization_id) continue;
    const lag = now - due;
    addDesired(desired, {
      organization_id: task.organization_id,
      fingerprint: fingerprint('jarvis_task', task.id, 'overdue'),
      kind: 'task_overdue', severity: lag > 24 * 3_600_000 || upper(task.priority) === 'URGENT' ? 'critical' : 'warning', source: 'jarvis_tasks',
      title: `Просрочена задача: ${clampText(task.title, 160)}`,
      detail: `Срок задачи прошёл ${hours(lag)} ч назад. Статус: ${task.status}.`,
      suggested_actions: [advice('Завершить или перенести', 'Уточнить актуальность задачи, исполнителя и новый срок.')],
      evidence: { managed_by: MANAGED_BY, entity_type: 'jarvis_task', entity_id: task.id, due_at: task.due_at, status: task.status, priority: task.priority }
    });
  }

  const network = globalThis.__A4_JARVIS_NETWORK_STATS__ || {};
  if (orgs.a4 && network.last_jarvis_error) {
    const errorAt = ms(network.last_jarvis_error_at);
    const okAt = ms(network.last_jarvis_ok_at);
    if (errorAt && (!okAt || errorAt > okAt)) {
      addDesired(desired, {
        organization_id: orgs.a4, fingerprint: 'jarvis:upstream:unavailable', kind: 'jarvis_runtime', severity: 'critical', source: 'jarvis_network',
        title: 'Связь HUB с Джарвисом нарушена', detail: `Последняя ошибка связи: ${clampText(network.last_jarvis_error, 700)}.`,
        suggested_actions: [advice('Проверить Jarvis health', 'Проверить состояние jarvis-workshop и дождаться окончания холодного запуска Render.'), advice('Проверить bridge', 'Проверить JARVIS_WORKSHOP_URL, JARVIS_API_KEY и сетевую доступность.')],
        evidence: { managed_by: MANAGED_BY, last_error: network.last_jarvis_error, last_error_at: network.last_jarvis_error_at, last_ok_at: network.last_jarvis_ok_at }
      });
    }
  }

  return { desired, sourceErrors: sources.filter(x => x.error).length, buildDurationMs: Date.now() - started };
}

async function persistSignals(orgs, desired) {
  const orgIds = orgs.list.map(x => x.id).filter(Boolean);
  let existing = [];
  if (orgIds.length) {
    const { data, error } = await service.from('jarvis_incidents').select('*').in('organization_id', orgIds).limit(5000);
    if (error) throw error;
    existing = data || [];
  }
  const existingMap = new Map(existing.map(x => [`${x.organization_id}:${x.fingerprint}`, x]));
  const seen = new Set();
  const at = nowIso();

  for (const [key, item] of desired.entries()) {
    seen.add(key);
    const old = existingMap.get(key);
    if (!old) {
      const { error } = await service.from('jarvis_incidents').insert({
        organization_id: item.organization_id, fingerprint: item.fingerprint, kind: item.kind, severity: item.severity, source: item.source,
        title: item.title, detail: item.detail, suggested_actions: item.suggested_actions || [], evidence: item.evidence || {}, status: 'OPEN',
        first_seen_at: at, last_seen_at: at, occurrence_count: 1
      });
      if (error) throw error;
      continue;
    }
    const lastSeen = ms(old.last_seen_at) || 0;
    const repeated = Date.now() - lastSeen > 5 * 60_000;
    const reopening = old.status === 'RESOLVED';
    const patch = {
      kind: item.kind, severity: item.severity, source: item.source, title: item.title, detail: item.detail,
      suggested_actions: item.suggested_actions || [], evidence: item.evidence || {}, last_seen_at: at,
      occurrence_count: Number(old.occurrence_count || 0) + (repeated || reopening ? 1 : 0),
      status: reopening ? 'OPEN' : old.status,
      resolved_at: reopening ? null : old.resolved_at
    };
    if (reopening) Object.assign(patch, { acknowledged_by: null, acknowledged_at: null });
    const { error } = await service.from('jarvis_incidents').update(patch).eq('id', old.id);
    if (error) throw error;
  }

  for (const old of existing) {
    if (old.status === 'RESOLVED' || old.evidence?.managed_by !== MANAGED_BY) continue;
    const key = `${old.organization_id}:${old.fingerprint}`;
    if (seen.has(key)) continue;
    const { error } = await service.from('jarvis_incidents').update({ status: 'RESOLVED', resolved_at: at, last_seen_at: at }).eq('id', old.id);
    if (error) throw error;
  }

  const { count, error: countError } = await service.from('jarvis_incidents').select('id', { count: 'exact', head: true }).neq('status', 'RESOLVED');
  if (countError) throw countError;
  return Number(count || 0);
}

async function runSentinel() {
  if (state.running || !service) return { ...state, skipped: true };
  state.running = true;
  const started = Date.now();
  try {
    const orgs = await resolveOrganizations();
    const built = await buildSignals(orgs);
    const open = await persistSignals(orgs, built.desired);
    state.last_run_at = nowIso();
    state.last_duration_ms = Date.now() - started;
    state.last_error = null;
    state.last_detected = built.desired.size;
    state.last_open = open;
    state.scans += 1;
    return { ...state, source_errors: built.sourceErrors };
  } catch (error) {
    state.last_run_at = nowIso();
    state.last_duration_ms = Date.now() - started;
    state.last_error = String(error?.message || error);
    console.error('[Jarvis Sentinel]', error);
    return { ...state };
  } finally {
    state.running = false;
  }
}

async function requireSession(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' });
    if (!supabaseUrl || !publishableKey) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED' });
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: publishableKey } });
    if (!response.ok) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
    req.sentinelAuth = await response.json();
    req.sentinelToken = token;
    return next();
  } catch (error) { return next(error); }
}

async function viewer(req) {
  const { data: user, error } = await service.from('users').select('id,full_name,email,is_active,organization_unit_id').eq('auth_user_id', req.sentinelAuth.id).maybeSingle();
  if (error) throw error;
  if (!user || user.is_active === false) throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'), { status: 403 });
  let organizationId = null;
  if (user.organization_unit_id) {
    const { data: unit, error: unitError } = await service.from('organization_units').select('organization_id').eq('id', user.organization_unit_id).maybeSingle();
    if (unitError) throw unitError;
    organizationId = unit?.organization_id || null;
  }
  if (!organizationId) {
    const { data: org } = await service.from('organizations').select('id').eq('code', 'A4PRINT').maybeSingle();
    organizationId = org?.id || null;
  }
  const { data: ur, error: urError } = await service.from('user_roles').select('role_id').eq('user_id', user.id);
  if (urError) throw urError;
  let isAdmin = false;
  const roleIds = (ur || []).map(x => x.role_id).filter(Boolean);
  if (roleIds.length) {
    const { data: roles, error: rolesError } = await service.from('roles').select('id,name').in('id', roleIds);
    if (rolesError) throw rolesError;
    isAdmin = (roles || []).some(x => upper(x.name) === 'ADMIN');
  }
  return { user, organizationId, isAdmin };
}

function canSeeIncident(v, incident) { return v.isAdmin || incident.organization_id === v.organizationId; }

function installWorker() {
  if (globalThis[workerInstalled] || !service) return;
  globalThis[workerInstalled] = true;
  const first = setTimeout(() => runSentinel(), 8_000); first.unref?.();
  const timer = setInterval(() => runSentinel(), SCAN_INTERVAL_MS); timer.unref?.();
}

express.application.listen = function patchedJarvisSentinelListen(...args) {
  if (!this[installed]) {
    this[installed] = true;

    this.get('/api/v1/jarvis/sentinel/status', requireSession, async (req, res) => {
      try {
        const v = await viewer(req);
        let q = service.from('jarvis_incidents').select('id,severity,status', { count: 'exact' }).neq('status', 'RESOLVED');
        if (!v.isAdmin && v.organizationId) q = q.eq('organization_id', v.organizationId);
        const { data, error, count } = await q.limit(500);
        if (error) throw error;
        const rows = data || [];
        return res.json({ success: true, sentinel: { version: SENTINEL_VERSION, ...state, interval_ms: SCAN_INTERVAL_MS }, incidents: { open: Number(count || rows.length), critical: rows.filter(x => x.severity === 'critical').length, warning: rows.filter(x => x.severity === 'warning').length } });
      } catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });

    this.get('/api/v1/jarvis/incidents', requireSession, async (req, res) => {
      try {
        const v = await viewer(req);
        const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
        const status = upper(req.query.status || 'ACTIVE');
        let q = service.from('jarvis_incidents').select('id,organization_id,fingerprint,kind,severity,source,title,detail,suggested_actions,evidence,status,first_seen_at,last_seen_at,occurrence_count,acknowledged_at,resolved_at').order('last_seen_at', { ascending: false }).limit(limit);
        if (!v.isAdmin && v.organizationId) q = q.eq('organization_id', v.organizationId);
        if (status === 'ACTIVE') q = q.in('status', ['OPEN', 'ACK']);
        else if (['OPEN', 'ACK', 'RESOLVED'].includes(status)) q = q.eq('status', status);
        const { data, error } = await q;
        if (error) throw error;
        const rows = data || [];
        const rank = { critical: 0, warning: 1, info: 2 };
        rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || new Date(b.last_seen_at) - new Date(a.last_seen_at));
        return res.json({ success: true, items: rows, summary: { total: rows.length, critical: rows.filter(x => x.severity === 'critical').length, warning: rows.filter(x => x.severity === 'warning').length, info: rows.filter(x => x.severity === 'info').length } });
      } catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });

    this.post('/api/v1/jarvis/incidents/:id/ack', requireSession, async (req, res) => {
      try {
        const v = await viewer(req);
        const { data: incident, error: findError } = await service.from('jarvis_incidents').select('*').eq('id', req.params.id).maybeSingle();
        if (findError) throw findError;
        if (!incident) return res.status(404).json({ success: false, error: 'INCIDENT_NOT_FOUND' });
        if (!canSeeIncident(v, incident)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
        const { data, error } = await service.from('jarvis_incidents').update({ status: 'ACK', acknowledged_by: v.user.id, acknowledged_at: nowIso() }).eq('id', incident.id).select('*').single();
        if (error) throw error;
        return res.json({ success: true, incident: data });
      } catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });

    this.post('/api/v1/jarvis/incidents/:id/resolve', requireSession, async (req, res) => {
      try {
        const v = await viewer(req);
        const { data: incident, error: findError } = await service.from('jarvis_incidents').select('*').eq('id', req.params.id).maybeSingle();
        if (findError) throw findError;
        if (!incident) return res.status(404).json({ success: false, error: 'INCIDENT_NOT_FOUND' });
        if (!canSeeIncident(v, incident)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
        const { data, error } = await service.from('jarvis_incidents').update({ status: 'RESOLVED', resolved_at: nowIso() }).eq('id', incident.id).select('*').single();
        if (error) throw error;
        return res.json({ success: true, incident: data });
      } catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });

    this.post('/api/v1/jarvis/sentinel/run', requireSession, async (req, res) => {
      try {
        const v = await viewer(req);
        if (!v.isAdmin) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
        const result = await runSentinel();
        return res.json({ success: !result.last_error, sentinel: result });
      } catch (error) { return res.status(error.status || 500).json({ success: false, error: String(error.message || error) }); }
    });
  }
  installWorker();
  return originalListen.apply(this, args);
};

export { runSentinel };
