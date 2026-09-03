import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN='https://mob4g.com';
const PORT=process.env.PORT||3000;
const cache=new Map();
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const abs=v=>{try{return new URL(v,ORIGIN).toString()}catch{return ''}};
const num=v=>{const m=String(v||'').replace(/,/g,'').match(/(\d+(?:\.\d+)?)/);return m?Number(m[1]):0};
const year=v=>{const m=clean(v).match(/\b(20\d{2})\b/);return m?Number(m[1]):0};
async function get(url){if(cache.has(url))return cache.get(url);const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; Mob4gCatalogSync/1.0)','Accept':'text/html,application/xhtml+xml'}});if(!r.ok)throw Error(`mob4g HTTP ${r.status}`);const t=await r.text();cache.set(url,t);return t}
function parseCard($,a){const url=abs($(a).attr('href'));if(!url.includes('/specs/'))return null;let card=$(a);for(let i=0;i<6;i++){const p=card.parent();if(!p.length)break;const t=clean(p.text());if(t.length>80&&/الشاشة|المعالج|البطارية|الرام|الذاكرة/i.test(t)){card=p;break}card=p}const raw=clean(card.text());const im=card.find('img').first();return{url,id:url.match(/\/specs\/([^/]+)\/?$/i)?.[1]||url,name:clean($(a).text().replace(/عرض الموصفات|عرض المواصفات|←/gi,'')),image:abs(im.attr('src')||im.attr('data-src')||im.attr('data-lazy-src')),price:num(raw.match(/(\d[\d,]*(?:\.\d+)?)\s*\$/)?.[1]),releaseYear:year(raw)}}
async function catalog(page){page=Math.max(1,Math.min(205,Number(page)||1));const url=page===1?ORIGIN+'/':`${ORIGIN}/page/${page}/`;const $=cheerio.load(await get(url));const m=new Map();$('a[href*="/specs/"]').each((_,a)=>{const x=parseCard($,a);if(x?.name)m.set(x.url,x)});return{ok:true,page,totalOnPage:m.size,items:[...m.values()]}}
async function device(target){const u=new URL(target,ORIGIN);if(u.origin!==ORIGIN||!u.pathname.startsWith('/specs/'))throw Error('Only mob4g.com/specs URLs are allowed');const $=cheerio.load(await get(u.toString()));const groups=[];let current=null;$('h2,h3,table').each((_,el)=>{const tag=el.tagName?.toLowerCase();if(tag==='h2'||tag==='h3'){const title=clean($(el).text());current=title&&!/صور|مميزات|عيوب|السعر|مراجعة|الخلاصة/i.test(title)?{title,rows:[]}:null;if(current)groups.push(current)}else if(current)$(el).find('tr').each((__,tr)=>{const c=$(tr).find('th,td').map((___,x)=>clean($(x).text())).get().filter(Boolean);if(c.length>=2)current.rows.push([c[0],c.slice(1).join(' | ')])})});const images=[];$('img').each((_,img)=>{const s=abs($(img).attr('src')||$(img).attr('data-src')||$(img).attr('data-lazy-src'));if(s&&!images.includes(s))images.push(s)});const text=clean($.text());const title=clean($('h1').first().text())||clean($('title').first().text());const pm=text.match(/(?:السعر|Price)[^$\d]{0,40}(\d[\d,]*(?:\.\d+)?)\s*\$/i);const rm=text.match(/تاريخ صدور الجهاز\s*[:|]?\s*([^|]{2,80})/i);return{ok:true,url:u.toString(),title,price:pm?num(pm[1]):0,release:clean(rm?.[1]||''),releaseYear:year(rm?.[1]||text),images:images.slice(0,30),groups:groups.filter(g=>g.rows.length)}}
function send(res,status,type,body){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body)}
function json(res,status,obj){send(res,status,'application/json; charset=utf-8',JSON.stringify(obj))}
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/api/catalog')return json(res,200,await catalog(u.searchParams.get('page')));if(u.pathname==='/api/device')return json(res,200,await device(u.searchParams.get('url')||''));let p=u.pathname==='/'?'index.html':u.pathname.slice(1);if(p.includes('..'))return json(res,400,{ok:false,error:'bad path'});const file=path.join(__dirname,p);const data=await fs.readFile(file);const ext=path.extname(file);send(res,200,ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':'application/octet-stream',data)}catch(e){json(res,500,{ok:false,error:String(e?.message||e)})}});
server.listen(PORT,()=>console.log(`Mob4g server on :${PORT}`));
