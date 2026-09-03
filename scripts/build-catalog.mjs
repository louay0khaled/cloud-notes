import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';

const ORIGIN='https://mob4g.com', MAX=205, PAGE_CONC=10, DETAIL_CONC=20;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const abs=v=>{try{return new URL(v,ORIGIN).toString()}catch{return ''}};
const year=v=>{const m=clean(v).match(/\b(20\d{2})\b/);return m?Number(m[1]):0};
const num=v=>{const m=clean(v).replace(/,/g,'').match(/(\d+(?:\.\d+)?)/);return m?Number(m[1]):0};
async function get(url){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Mob4g static catalog builder)'}});if(!r.ok)throw Error(`${r.status} ${url}`);return r.text()}
async function mapLimit(items,limit,fn){const out=[];let n=0;async function w(){while(true){const i=n++;if(i>=items.length)return;try{const x=await fn(items[i],i);if(x)out.push(x)}catch(e){}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},w));return out}
function parsePage(html){const $=cheerio.load(html),m=new Map();$('a[href*="/specs/"]').each((_,a)=>{const url=abs($(a).attr('href'));if(!url)return;const slug=url.match(/\/specs\/([^/]+)\/?$/i)?.[1]||url;const im=$(a).find('img').first();const name=clean(im.attr('alt')||$(a).clone().children('img').remove().end().text()).replace(/عرض\s+المواصفات|عرض\s+الموصفات|←/gi,'').trim();let card=$(a);for(let i=0;i<8;i++){const p=card.parent();if(!p.length)break;const links=p.find('a[href*="/specs/"]');if(links.length===1){card=p;break}card=p}const raw=clean(card.text());const cimg=$(a).find('img').first();const price=num(raw.match(/(\d[\d,]*(?:\.\d+)?)\s*\$/)?.[1]);m.set(url,{id:slug,name:name||slug.replace(/-/g,' '),url,image:abs(cimg.attr('src')||cimg.attr('data-src')||cimg.attr('data-lazy-src')),price,releaseYear:year(raw)})});return [...m.values()]}
async function verify(item){const html=await get(item.url),$=cheerio.load(html),rows=[];let cur=null;$('h2,h3,table').each((_,el)=>{const tag=String(el.tagName||'').toLowerCase();if(tag==='h2'||tag==='h3'){const t=clean($(el).text());cur=t&&!/صور|مميزات|عيوب|السعر|مراجعة|الخلاصة/i.test(t)?{title:t,rows:[]}:null;if(cur)rows.push(cur);return}if(!cur)return;$(el).find('tr').each((__,tr)=>{const c=$(tr).find('th,td').map((___,x)=>clean($(x).text())).get().filter(Boolean);if(c.length>=2)cur.rows.push([c[0],c.slice(1).join(' | ')])})});const text=clean($.text()),release=rows.flatMap(g=>g.rows).find(r=>/^تاريخ صدور الجهاز|^تاريخ الإصدار$/.test(r[0]))?.[1]||'',ann=rows.flatMap(g=>g.rows).find(r=>/^تاريخ اعلان عن الجهاز|^تاريخ الإعلان$/.test(r[0]))?.[1]||'',y=year(release)||year(ann);if(y<2022)return null;const title=clean($('h1').first().text())||item.name;let img='';for(const sel of ['.entry-content img','article img','main img','figure img']){const s=abs($(sel).first().attr('src')||$(sel).first().attr('data-src')||'');if(s&&!/logo|icon|avatar/i.test(s)){img=s;break}}return {...item,name:title,image:img||item.image,releaseYear:y,verified:true}}
const pages=await mapLimit(Array.from({length:MAX},(_,i)=>i+1),PAGE_CONC,async p=>{const html=await get(p===1?ORIGIN+'/':`${ORIGIN}/page/${p}/`);return parsePage(html)});
const all=[...new Map(pages.flat().map(x=>[x.url,x])).values()];
const verified=await mapLimit(all,DETAIL_CONC,verify);
verified.sort((a,b)=>(b.releaseYear-a.releaseYear)||a.name.localeCompare(b.name));
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/catalog.json',JSON.stringify({generatedAt:new Date().toISOString(),count:verified.length,items:verified},null,2));
console.log(`Catalog generated: ${verified.length} verified devices from ${all.length} unique specs URLs`);