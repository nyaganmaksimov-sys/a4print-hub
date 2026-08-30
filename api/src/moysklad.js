// Server-side only. MOYSKLAD_TOKEN must never be exposed to admin/*.html or committed to git.
const BASE = 'https://api.moysklad.ru/api/remap/1.2';

function salePrice(row) {
  const p = Array.isArray(row.salePrices) ? row.salePrices[0] : null;
  return p ? Number(p.value || 0) / 100 : 0;
}
function itemType(type) {
  return type === 'service' ? 'SERVICE' : 'PRODUCT';
}
function sku(row) {
  return row.article || row.code || `MS-${row.id}`;
}

export async function fetchAssortment(token) {
  if (!token) throw new Error('MOYSKLAD_TOKEN is not configured');
  const rows = [];
  let url = `${BASE}/entity/assortment?limit=1000`;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json;charset=utf-8' } });
    if (!r.ok) throw new Error(`MoySklad HTTP ${r.status}: ${await r.text()}`);
    const data = await r.json();
    rows.push(...(data.rows || []));
    url = data.meta?.nextHref || null;
  }
  return rows;
}

export async function syncMoySkladCatalog({ supabase, token, organizationId }) {
  const sourceRows = await fetchAssortment(token);
  let created = 0, updated = 0;
  for (const row of sourceRows) {
    const type = row.meta?.type;
    if (!['product','variant','service','bundle'].includes(type)) continue;
    const payload = {
      organization_id: organizationId,
      external_source: 'MOYSKLAD',
      external_id: row.id,
      external_href: row.meta?.href || null,
      sku: sku(row),
      name: row.name || sku(row),
      item_type: itemType(type),
      article: row.article || null,
      barcode: row.barcodes?.[0]?.ean13 || row.barcodes?.[0]?.ean8 || row.barcodes?.[0]?.code128 || null,
      unit: row.uom?.name || 'шт',
      description: row.description || null,
      sale_price: salePrice(row),
      external_updated_at: row.updated || null,
      last_synced_at: new Date().toISOString(),
      is_active: row.archived !== true
    };
    const { data: existing, error: findError } = await supabase.from('catalog_items').select('id').eq('external_source','MOYSKLAD').eq('external_id',row.id).maybeSingle();
    if (findError) throw findError;
    if (existing) {
      const { error } = await supabase.from('catalog_items').update(payload).eq('id', existing.id);
      if (error) throw error;
      updated++;
    } else {
      const { error } = await supabase.from('catalog_items').insert(payload);
      if (error) throw error;
      created++;
    }
  }
  return { received: sourceRows.length, created, updated };
}
