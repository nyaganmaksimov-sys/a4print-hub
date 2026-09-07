import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const MS_BASE = 'https://api.moysklad.ru/api/remap/1.2';
const token = process.env.MOYSKLAD_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const internalPort = Number(process.env.MOBILE_INTERNAL_API_PORT || 3001);
const currentPort = Number(process.env.PORT || 3000);
const isInternalApiProcess = currentPort === internalPort;
const supabase = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let running = false;

function msHeaders() {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json;charset=utf-8',
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip'
  };
}

async function msGet(pathOrUrl, attempt = 1) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : MS_BASE + pathOrUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers: msHeaders(), signal: controller.signal });
    if (response.status === 429 && attempt < 5) {
      const retryAfter = Math.max(1, Number(response.headers.get('retry-after') || 1));
      await sleep(retryAfter * 1000);
      return msGet(pathOrUrl, attempt + 1);
    }
    if (!response.ok) throw new Error(`MoySklad HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  } catch (error) {
    if (attempt < 3 && /AbortError|fetch|socket|network/i.test(`${error?.name || ''} ${error?.message || ''}`)) {
      await sleep(700 * attempt);
      return msGet(pathOrUrl, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function entityId(entity) {
  return entity?.id || entity?.meta?.href?.split('/').pop() || null;
}

function msMomentToIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString();
  if (/Z$|[+-]\d\d:?\d\d$/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T'));
    return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return new Date().toISOString();
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function paymentMethod(sale) {
  const cash = Number(sale?.cashSum || 0);
  const card = Number(sale?.noCashSum || 0);
  const qr = Number(sale?.qrSum || 0);
  const active = [cash > 0, card > 0, qr > 0].filter(Boolean).length;
  if (active > 1) return 'Смешанная';
  if (qr > 0) return 'СБП';
  if (card > 0) return 'Карта';
  if (cash > 0) return 'Наличные';
  return 'Не указано';
}

function operatorNameFromDescription(description) {
  const match = String(description || '').match(/Оператор:\s*([^·\n]+)/i);
  return match ? match[1].trim() : '';
}

function positionRows(sale) {
  if (Array.isArray(sale?.positions)) return sale.positions;
  if (Array.isArray(sale?.positions?.rows)) return sale.positions.rows;
  return [];
}

async function loadPositionRows(sale) {
  const embedded = positionRows(sale);
  if (embedded.length) return embedded;
  const saleId = entityId(sale);
  if (!saleId) return [];
  const data = await msGet(`/entity/retaildemand/${encodeURIComponent(saleId)}/positions?limit=1000`);
  return Array.isArray(data?.rows) ? data.rows : [];
}

async function fetchSales({ maxSales = 5000, days = 1095 } = {}) {
  const cutoff = Date.now() - Math.max(1, Number(days || 1095)) * 86400000;
  const rows = [];
  let url = `${MS_BASE}/entity/retaildemand?limit=100&order=moment,desc&expand=positions`;
  let expandSupported = true;
  while (url && rows.length < maxSales) {
    let data;
    try {
      data = await msGet(url);
    } catch (error) {
      if (expandSupported && /HTTP 400/.test(String(error?.message || ''))) {
        expandSupported = false;
        url = `${MS_BASE}/entity/retaildemand?limit=100&order=moment,desc`;
        continue;
      }
      throw error;
    }
    const page = Array.isArray(data?.rows) ? data.rows : [];
    if (!page.length) break;
    for (const sale of page) {
      const ts = new Date(msMomentToIso(sale.moment || sale.created)).getTime();
      if (Number.isFinite(ts) && ts < cutoff) return rows;
      rows.push(sale);
      if (rows.length >= maxSales) return rows;
    }
    url = data?.meta?.nextHref || null;
  }
  return rows;
}

async function inChunks(values, size, fn) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size);
    const part = await fn(chunk);
    if (Array.isArray(part)) out.push(...part);
  }
  return out;
}

async function mapExistingSaleIds(orgId, ids) {
  const rows = await inChunks(ids, 400, async chunk => {
    if (!chunk.length) return [];
    const { data, error } = await supabase
      .from('pos_sales')
      .select('moysklad_sale_id')
      .eq('organization_id', orgId)
      .in('moysklad_sale_id', chunk);
    if (error) throw error;
    return data || [];
  });
  return new Set(rows.map(row => row.moysklad_sale_id));
}

async function catalogMap(orgId) {
  const { data, error } = await supabase
    .from('catalog_items')
    .select('id,name,external_id,external_href,article,sku')
    .eq('organization_id', orgId)
    .eq('external_source', 'MOYSKLAD');
  if (error) throw error;
  const byExternal = new Map();
  const byHref = new Map();
  for (const row of data || []) {
    if (row.external_id) byExternal.set(String(row.external_id), row);
    if (row.external_href) byHref.set(String(row.external_href), row);
  }
  return { byExternal, byHref };
}

async function shiftMap(orgId, shiftIds) {
  const ids = [...new Set(shiftIds.filter(Boolean))];
  const rows = await inChunks(ids, 400, async chunk => {
    if (!chunk.length) return [];
    const { data, error } = await supabase
      .from('pos_shift_sessions')
      .select('id,moysklad_shift_id')
      .eq('organization_id', orgId)
      .in('moysklad_shift_id', chunk);
    if (error) throw error;
    return data || [];
  });
  return new Map(rows.map(row => [String(row.moysklad_shift_id), row.id]));
}

async function operatorMap() {
  const { data, error } = await supabase.from('users').select('id,full_name').eq('is_active', true);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    const key = String(row.full_name || '').trim().toLowerCase();
    if (key) map.set(key, row.id);
  }
  return map;
}

async function importMissingSale({ sale, orgId, catalog, shifts, operators }) {
  const positions = await loadPositionRows(sale);
  const items = positions.map((position, index) => {
    const href = position?.assortment?.meta?.href || '';
    const externalId = entityId(position?.assortment);
    const catalogRow = (externalId && catalog.byExternal.get(String(externalId))) || (href && catalog.byHref.get(String(href))) || null;
    const qty = Math.max(0, Number(position?.quantity || 0));
    const price = Math.max(0, Number(position?.price || 0) / 100);
    const discount = Math.max(0, Number(position?.discount || 0));
    return {
      key: position?.id || `${entityId(sale) || 'sale'}:${index}`,
      id: catalogRow?.id || null,
      external_id: externalId || null,
      name: catalogRow?.name || position?.assortment?.name || 'Позиция МойСклад',
      article: catalogRow?.article || catalogRow?.sku || '',
      qty,
      price,
      discount
    };
  });
  const shiftId = entityId(sale?.retailShift);
  const operatorName = operatorNameFromDescription(sale?.description);
  const operatorId = operatorName ? operators.get(operatorName.toLowerCase()) || null : null;
  const payload = {
    organization_id: orgId,
    shift_session_id: shiftId ? shifts.get(String(shiftId)) || null : null,
    moysklad_shift_id: shiftId || null,
    moysklad_sale_id: entityId(sale),
    moysklad_sale_name: sale?.name || entityId(sale),
    operator_id: operatorId,
    customer_id: null,
    cash_account_id: null,
    payment_method: paymentMethod(sale),
    total: Math.max(0, Number(sale?.sum || sale?.payedSum || 0) / 100),
    item_count: items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    items,
    sold_at: msMomentToIso(sale?.moment || sale?.created),
    sync_status: 'IMPORTED_MS',
    sync_error: null,
    updated_at: new Date().toISOString()
  };
  if (!payload.moysklad_sale_id) return false;
  const { error } = await supabase.from('pos_sales').insert(payload);
  if (error) {
    if (/duplicate|unique/i.test(String(error.message || ''))) return false;
    throw error;
  }
  return true;
}

export async function syncMoySkladReceipts(options = {}) {
  if (running) return { skipped: true, reason: 'already_running' };
  if (!token || !supabase) return { skipped: true, reason: 'not_configured' };
  running = true;
  const startedAt = Date.now();
  try {
    const { data: org, error: orgError } = await supabase.from('organizations').select('id').eq('code', 'A4PRINT').single();
    if (orgError) throw orgError;
    const sales = await fetchSales(options);
    const ids = sales.map(entityId).filter(Boolean);
    const existing = await mapExistingSaleIds(org.id, ids);
    const missing = sales.filter(sale => {
      const id = entityId(sale);
      return id && !existing.has(id);
    });
    if (!missing.length) {
      return { scanned: sales.length, imported: 0, existing: sales.length, duration_ms: Date.now() - startedAt };
    }
    const [catalog, shifts, operators] = await Promise.all([
      catalogMap(org.id),
      shiftMap(org.id, missing.map(sale => entityId(sale?.retailShift))),
      operatorMap()
    ]);
    let imported = 0;
    let failed = 0;
    const errors = [];
    const queue = [...missing];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const sale = queue.shift();
        try {
          if (await importMissingSale({ sale, orgId: org.id, catalog, shifts, operators })) imported++;
        } catch (error) {
          failed++;
          errors.push({ id: entityId(sale), name: sale?.name || null, error: String(error?.message || error).slice(0, 400) });
        }
        await sleep(60);
      }
    });
    await Promise.all(workers);
    return {
      scanned: sales.length,
      existing: sales.length - missing.length,
      missing: missing.length,
      imported,
      failed,
      errors: errors.slice(0, 10),
      duration_ms: Date.now() - startedAt
    };
  } finally {
    running = false;
  }
}

async function runSync(label, options) {
  try {
    const result = await syncMoySkladReceipts(options);
    console.log(`[MoySklad receipt sync:${label}]`, JSON.stringify(result));
  } catch (error) {
    console.error(`[MoySklad receipt sync:${label}]`, error?.message || error);
  }
}

if (isInternalApiProcess && token && supabase) {
  setTimeout(() => runSync('initial', { days: 1095, maxSales: 5000 }), 7000);
  const timer = setInterval(() => runSync('recent', { days: 3, maxSales: 500 }), 2 * 60 * 1000);
  timer.unref?.();
}
