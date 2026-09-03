import * as cheerio from 'cheerio';

const ORIGIN = 'https://mob4g.com';
const MAX_PAGES = 205;
const TIMEOUT = 15000;
const CONCURRENCY = 6;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const abs = (v) => { try { return new URL(v, ORIGIN).toString(); } catch { return ''; } };
const num = (v) => { const m = clean(v).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };
const year = (v) => { const m = clean(v).match(/\b(20\d{2})\b/); return m ? Number(m[1]) : 0; };

const request = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Mob4gCatalog/2.0)' } });
    if (!r.ok) throw new Error(`mob4g HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
};

function parseCard($, a) {
  const url = abs($(a).attr('href'));
  if (!url || !url.includes('/specs/')) return null;
  let card = $(a);
  for (let i = 0; i < 7; i++) {
    const p = card.parent();
    if (!p.length) break;
    const t = clean(p.text());
    if (t.length > 70 && /الشاشة|المعالج|البطارية|الرام|الذاكرة/i.test(t)) { card = p; break; }
    card = p;
  }
  const raw = clean(card.text());
  const img = card.find('img').first();
  return {
    id: url.match(/\/specs\/([^/]+)\/?$/i)?.[1] || url,
    name: clean($(a).text().replace(/عرض الموصفات|عرض المواصفات|←/gi, '')),
    url,
    image: abs(img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src')),
    price: num(raw.match(/(\d[\d,]*(?:\.\d+)?)\s*\$/)?.[1]),
    releaseYear: year(raw)
  };
}

async function verifyYear(item) {
  if (item.releaseYear >= 2022) return { ...item, verified: true };
  try {
    const html = await request(item.url);
    const $ = cheerio.load(html);
    const text = clean($.text());
    const releaseText = text.match(/تاريخ صدور الجهاز\s*[:|]?\s*([^|\n]{2,100})/i)?.[1] || '';
    const announceText = text.match(/تاريخ اعلان عن الجهاز\s*[:|]?\s*([^|\n]{2,100})/i)?.[1] || '';
    const verifiedYear = year(releaseText) || year(announceText) || year($('h1').first().text());
    if (verifiedYear >= 2022) return { ...item, releaseYear: verifiedYear, verified: true };
  } catch {}
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const value = await fn(items[i], i);
      if (value) out.push(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export default async function handler(req, res) {
  try {
    const page = Math.max(1, Math.min(MAX_PAGES, Number(req.query.page || 1)));
    const verify = String(req.query.verify ?? '1') !== '0';
    const url = page === 1 ? ORIGIN + '/' : `${ORIGIN}/page/${page}/`;
    const html = await request(url);
    const $ = cheerio.load(html);
    const map = new Map();
    $('a[href*="/specs/"]').each((_, a) => { const x = parseCard($, a); if (x?.name) map.set(x.url, x); });
    let items = [...map.values()];
    if (verify) items = await mapLimit(items, CONCURRENCY, verifyYear);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({ ok: true, page, totalOnPage: map.size, totalVerified: items.length, items });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
