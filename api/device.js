import * as cheerio from 'cheerio';

const ORIGIN = 'https://mob4g.com';
const TIMEOUT = 15000;
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const abs = (v) => { try { return new URL(v, ORIGIN).toString(); } catch { return ''; } };
const num = (v) => { const m = clean(v).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };
const year = (v) => { const m = clean(v).match(/\b(20\d{2})\b/); return m ? Number(m[1]) : 0; };

async function request(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Mob4gCatalog/2.0)' } });
    if (!r.ok) throw new Error(`mob4g HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

function valueNear(text, label) {
  const m = text.match(new RegExp(label + '\\s*[:|]?\\s*([^|\\n]{2,100})', 'i'));
  return clean(m?.[1] || '');
}

export default async function handler(req, res) {
  try {
    const raw = String(req.query.url || '');
    const u = new URL(raw, ORIGIN);
    if (u.origin !== ORIGIN || !u.pathname.startsWith('/specs/')) {
      return res.status(400).json({ ok: false, error: 'Only mob4g.com/specs URLs are allowed' });
    }
    const $ = cheerio.load(await request(u.toString()));
    const text = clean($.text());
    const release = valueNear(text, 'تاريخ صدور الجهاز') || valueNear(text, 'تاريخ الإصدار');
    const announced = valueNear(text, 'تاريخ اعلان عن الجهاز') || valueNear(text, 'تاريخ الإعلان');
    const releaseYear = year(release) || year(announced);
    const images = [];
    $('img').each((_, img) => {
      const src = abs($(img).attr('src') || $(img).attr('data-src') || $(img).attr('data-lazy-src') || '');
      if (src && !images.includes(src) && !/logo|icon|avatar/i.test(src)) images.push(src);
    });

    const groups = [];
    let current = null;
    $('h2,h3,table').each((_, el) => {
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'h2' || tag === 'h3') {
        const title = clean($(el).text());
        current = title && !/صور|مميزات|عيوب|السعر|مراجعة|الخلاصة/i.test(title) ? { title, rows: [] } : null;
        if (current) groups.push(current);
        return;
      }
      if (!current) return;
      $(el).find('tr').each((__, tr) => {
        const cells = $(tr).find('th,td').map((___, x) => clean($(x).text())).get().filter(Boolean);
        if (cells.length >= 2) current.rows.push([cells[0], cells.slice(1).join(' | ')]);
      });
    });

    const title = clean($('h1').first().text()) || clean($('meta[property="og:title"]').attr('content')) || clean($('title').first().text());
    const priceMatch = text.match(/(?:السعر|Price)[^$\d]{0,40}(\d[\d,]*(?:\.\d+)?)\s*\$/i);
    const price = priceMatch ? num(priceMatch[1]) : 0;
    const brand = valueNear(text, 'الماركة');
    const category = valueNear(text, 'الفئة');
    const rating = num(text.match(/التقييم[^\d]{0,40}(\d+(?:\.\d+)?)/i)?.[1]);

    if (releaseYear && releaseYear < 2022) {
      return res.status(200).json({ ok: true, eligible: false, releaseYear, title, url: u.toString() });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({ ok: true, eligible: releaseYear >= 2022, url: u.toString(), title, brand, category, price, rating, release, releaseYear, images: images.slice(0, 30), groups: groups.filter(g => g.rows.length) });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
