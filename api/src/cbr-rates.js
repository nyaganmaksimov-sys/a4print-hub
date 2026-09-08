import express from 'express';

const installed = Symbol.for('a4print.cbr.rates.installed');
const originalListen = express.application.listen;
const CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = null;
let cacheAt = 0;
let inflight = null;

function parseNumber(value) {
  const n = Number(String(value || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? String(match[1]).trim() : '';
}

function parseCbrXml(xml) {
  const dateMatch = String(xml).match(/<ValCurs[^>]*Date="([^"]+)"/i);
  const effectiveDate = dateMatch?.[1] || null;
  const wanted = new Set(['USD', 'EUR', 'CNY']);
  const rates = [];
  const blocks = String(xml).match(/<Valute\b[\s\S]*?<\/Valute>/gi) || [];

  for (const block of blocks) {
    const code = extractTag(block, 'CharCode').toUpperCase();
    if (!wanted.has(code)) continue;
    const nominal = parseNumber(extractTag(block, 'Nominal')) || 1;
    const value = parseNumber(extractTag(block, 'Value'));
    if (value == null) continue;
    const symbols = { USD: '$', EUR: '€', CNY: '¥' };
    const names = { USD: 'Доллар США', EUR: 'Евро', CNY: 'Китайский юань' };
    rates.push({
      code,
      symbol: symbols[code],
      name: names[code],
      nominal,
      value,
      per_unit: value / nominal
    });
  }

  if (rates.length !== 3) throw new Error('CBR_RATES_INCOMPLETE');
  rates.sort((a, b) => ['USD', 'EUR', 'CNY'].indexOf(a.code) - ['USD', 'EUR', 'CNY'].indexOf(b.code));
  return { effective_date: effectiveDate, rates };
}

async function fetchRates() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return { ...cache, cached: true };
  if (inflight) return inflight;

  inflight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(CBR_URL, {
        headers: {
          'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'A4PRINT-HUB/1.0 (+https://a4print-hub.ru)'
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`CBR_HTTP_${response.status}`);
      const xml = await response.text();
      const parsed = parseCbrXml(xml);
      cache = {
        success: true,
        source: 'Банк России',
        source_url: 'https://www.cbr.ru/currency_base/daily/',
        ...parsed,
        fetched_at: new Date().toISOString()
      };
      cacheAt = Date.now();
      return { ...cache, cached: false };
    } catch (error) {
      if (cache) return { ...cache, cached: true, stale: true, warning: String(error?.message || error) };
      throw error;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();

  return inflight;
}

express.application.listen = function patchedCbrRatesListen(...args) {
  if (!this[installed]) {
    this[installed] = true;
    this.get('/api/v1/cbr/rates', async (_req, res, next) => {
      try {
        const payload = await fetchRates();
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return res.json(payload);
      } catch (error) {
        return next(error);
      }
    });
  }
  return originalListen.apply(this, args);
};
