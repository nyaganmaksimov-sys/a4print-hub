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

function paymentMethod(document) {
  const cash = Number(document?.cashSum || 0);
  const card = Number(document?.noCashSum || 0);
  const qr = Number(document?.qrSum || 0);
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

function reasonFromDescription(description) {
  const match = String(description || '').match(/Причина:\s*(.+)$/i);
  return match ? match[1].trim().slice(0, 1200) : null;
}

function positionRows(document) {
  if (Array.isArray(document?.positions)) return document.positions;
  if (Array.isArray(document?.positions?.rows)) return document.positions.rows;
  return [];
}

async function loadPositionRows(document, type = 'retaildemand') {
  const embedded = positionRows(document);
  if (embedded.length) return embedded;
  const documentId = entityId(document);
  if (!documentId) return [];
  const data = await msGet(`/entity/${type}/${encodeURIComponent(documentId)}/positions?limit=1000`);
  return Array.isArray(data?.rows) ? data.rows : [];
}

async function fetchDocuments(type, { maxRows = 5000, days = 1095 } = {}) {
  const cutoff = Date.now() - Math.max(1, Number(days || 1095)) * 86400000;
  const rows = [];
  let url = `${MS_BASE}/entity/${type}?limit=100&order=moment,desc&expand=positions`;
  let expandSupported = true;
  while (url && rows.length < maxRows) {
    let data;
    try {
      data = await msGet(url);
    } catch (error) {
      if (expandSupported && /HTTP 400/.test(String(error?.message || ''))) {
        expandSupported = false;
        url = `${MS_BASE}/entity/${type}?limit=100&order=moment,desc`;
        continue;
      }
      throw error;
    }
    const page = Array.isArray(data?.rows) ? data.rows : [];
    if (!page.length) break;
    for (const row of page) {
      const ts = new Date(msMomentToIso(row.moment || row.created)).getTime();
      if (Number.isFinite(ts) && ts < cutoff) return rows;
      rows.push(row);
      if (rows.length >= maxRows) return rows;
    }
    url = data?.meta?.nextHref || null;
  }
  return rows;
}

async function fetchSales({ maxSales = 5000, days = 1095 } = {}) {
  return fetchDocuments('retaildemand', { maxRows: maxSales, days });
}

async function fetchReturns({ maxReturns = 2000, days = 1095 } = {}) {
  return fetchDocuments('retailsalesreturn', { maxRows: maxReturns, days });
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

async function mapExistingReturnIds(orgId, ids) {
  const rows = await inChunks(ids, 400, async chunk => {
    if (!chunk.length) return [];
    const { data, error } = await supabase
      .from('pos_returns')
      .select('moysklad_return_id')
      .eq('organization_id', orgId)
      .in('moysklad_return_id', chunk);
    if (error) throw error;
    return data || [];
  });
  return new Set(rows.map(row => row.moysklad_return_id));
}

async function saleMapByMoySkladIds(orgId, ids) {
  const rows = await inChunks([...new Set(ids.filter(Boolean))], 400, async chunk => {
    if (!chunk.length) return [];
    const { data, error } = await supabase
      .from('pos_sales')
      .select('id,moysklad_sale_id,items')
      .eq('organization_id', orgId)
      .in('moysklad_sale_id', chunk);
    if (error) throw error;
    return data || [];
  });
  return new Map(rows.map(row => [String(row.moysklad_sale_id), row]));
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

function catalogRowForAssortment(assortment, catalog) {
  const href = assortment?.meta?.href || '';
  const externalId = entityId(assortment);
  return (externalId && catalog.byExternal.get(String(externalId))) || (href && catalog.byHref.get(String(href))) || null;
}

async function importMissingSale({ sale, orgId, catalog, shifts, operators }) {
  const positions = await loadPositionRows(sale, 'retaildemand');
  const items = positions.map((position, index) => {
    const catalogRow = catalogRowForAssortment(position?.assortment, catalog);
    const externalId = entityId(position?.assortment);
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

function normalizedSaleItemId(item, index) {
  return String(item?.key || `${item?.id || 'item'}:${index}`);
}

async function importMissingReturn({ ret, orgId, catalog, shifts, operators, salesByExternal }) {
  const returnId = entityId(ret);
  const demandId = entityId(ret?.demand);
  if (!returnId || !demandId) return false;
  const sale = salesByExternal.get(String(demandId));
  if (!sale) return false;

  const originalItems = Array.isArray(sale.items) ? sale.items : [];
  const usedOriginalIndexes = new Set();
  const positions = await loadPositionRows(ret, 'retailsalesreturn');
  const items = positions.map((position, index) => {
    const catalogRow = catalogRowForAssortment(position?.assortment, catalog);
    const catalogId = catalogRow?.id || null;
    let originalIndex = originalItems.findIndex((item, i) => !usedOriginalIndexes.has(i) && catalogId && String(item?.id || '') === String(catalogId));
    if (originalIndex < 0) {
      const positionName = String(position?.assortment?.name || catalogRow?.name || '').trim().toLowerCase();
      originalIndex = originalItems.findIndex((item, i) => !usedOriginalIndexes.has(i) && positionName && String(item?.name || '').trim().toLowerCase() === positionName);
    }
    if (originalIndex >= 0) usedOriginalIndexes.add(originalIndex);
    const original = originalIndex >= 0 ? originalItems[originalIndex] : null;
    return {
      position_id: original ? normalizedSaleItemId(original, originalIndex) : (position?.id || `${returnId}:${index}`),
      catalog_id: catalogId || original?.id || null,
      name: original?.name || catalogRow?.name || position?.assortment?.name || 'Позиция МойСклад',
      qty: Math.max(0, Number(position?.quantity || 0)),
      price: Math.max(0, Number(position?.price || 0) / 100)
    };
  });

  const shiftId = entityId(ret?.retailShift);
  const operatorName = operatorNameFromDescription(ret?.description);
  const operatorId = operatorName ? operators.get(operatorName.toLowerCase()) || null : null;
  const payload = {
    organization_id: orgId,
    shift_session_id: shiftId ? shifts.get(String(shiftId)) || null : null,
    pos_sale_id: sale.id,
    moysklad_return_id: returnId,
    moysklad_return_name: ret?.name || returnId,
    operator_id: operatorId,
    cash_account_id: null,
    payment_method: paymentMethod(ret),
    amount: Math.max(0, Number(ret?.sum || 0) / 100),
    items,
    reason: reasonFromDescription(ret?.description),
    returned_at: msMomentToIso(ret?.moment || ret?.created),
    sync_status: 'WARNING',
    sync_error: 'RECOVERED_FROM_MOYSKLAD_RETURN; CASH_ACCOUNT_UNKNOWN'
  };
  const { error } = await supabase.from('pos_returns').insert(payload);
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

    const [sales, returns] = await Promise.all([
      fetchSales(options),
      fetchReturns({ maxReturns: options.maxReturns || Math.min(Number(options.maxSales || 5000), 2000), days: options.days || 1095 })
    ]);

    const saleIds = sales.map(entityId).filter(Boolean);
    const returnIds = returns.map(entityId).filter(Boolean);
    const [existingSales, existingReturns] = await Promise.all([
      mapExistingSaleIds(org.id, saleIds),
      mapExistingReturnIds(org.id, returnIds)
    ]);
    const missingSales = sales.filter(sale => {
      const id = entityId(sale);
      return id && !existingSales.has(id);
    });
    const missingReturns = returns.filter(ret => {
      const id = entityId(ret);
      return id && !existingReturns.has(id);
    });

    const relevantShiftIds = [
      ...missingSales.map(sale => entityId(sale?.retailShift)),
      ...missingReturns.map(ret => entityId(ret?.retailShift))
    ];
    const [catalog, shifts, operators] = await Promise.all([
      catalogMap(org.id),
      shiftMap(org.id, relevantShiftIds),
      operatorMap()
    ]);

    let imported = 0;
    let failed = 0;
    const errors = [];
    const saleQueue = [...missingSales];
    const saleWorkers = Array.from({ length: Math.min(4, saleQueue.length) }, async () => {
      while (saleQueue.length) {
        const sale = saleQueue.shift();
        try {
          if (await importMissingSale({ sale, orgId: org.id, catalog, shifts, operators })) imported++;
        } catch (error) {
          failed++;
          errors.push({ type: 'sale', id: entityId(sale), name: sale?.name || null, error: String(error?.message || error).slice(0, 400) });
        }
        await sleep(60);
      }
    });
    await Promise.all(saleWorkers);

    const demandIds = missingReturns.map(ret => entityId(ret?.demand)).filter(Boolean);
    const salesByExternal = await saleMapByMoySkladIds(org.id, demandIds);
    let returnsImported = 0;
    let returnsFailed = 0;
    let returnsSkipped = 0;
    for (const ret of missingReturns) {
      try {
        if (await importMissingReturn({ ret, orgId: org.id, catalog, shifts, operators, salesByExternal })) returnsImported++;
        else returnsSkipped++;
      } catch (error) {
        returnsFailed++;
        errors.push({ type: 'return', id: entityId(ret), name: ret?.name || null, error: String(error?.message || error).slice(0, 400) });
      }
      await sleep(60);
    }

    return {
      scanned: sales.length,
      existing: sales.length - missingSales.length,
      missing: missingSales.length,
      imported,
      failed,
      returns_scanned: returns.length,
      returns_existing: returns.length - missingReturns.length,
      returns_missing: missingReturns.length,
      returns_imported: returnsImported,
      returns_failed: returnsFailed,
      returns_skipped: returnsSkipped,
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
  setTimeout(() => runSync('initial', { days: 1095, maxSales: 5000, maxReturns: 2000 }), 7000);
  const timer = setInterval(() => runSync('recent', { days: 3, maxSales: 500, maxReturns: 500 }), 2 * 60 * 1000);
  timer.unref?.();
}
