// End-to-end browser check: level 1 -> hint -> Place it -> 4x -> cleared banner; records toasts. Usage: npm run build && node scripts/e2e-browser.mjs
import { chromium } from 'playwright';
import { createServer } from 'http'; import { readFileSync, existsSync } from 'fs'; import { join, extname } from 'path';
const root = new URL('../dist', import.meta.url).pathname; const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv = createServer((q,s)=>{ const p = join(root, q.url==='/'?'/index.html':q.url.split('?')[0]); if(!existsSync(p)) {s.statusCode=404; return s.end();} s.setHeader('content-type', types[extname(p)]||''); s.end(readFileSync(p)); }).listen(4177);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args:['--use-gl=swiftshader'] });
const pg = await b.newPage({ viewport:{width:1280,height:720} }); const errs=[];
pg.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); }); pg.on('pageerror', e=>errs.push(String(e)));
await pg.goto('http://localhost:4177/'); await pg.waitForTimeout(600);
await pg.click('.level-card[data-id="1"]'); await pg.waitForTimeout(400);
await pg.evaluate(() => { window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.textContent && window.__toasts.push(n.textContent.trim().slice(0,50))))).observe(document.getElementById('h-toasts') || document.body, { childList: true, subtree: true }); });
const st = await pg.$('#h-start'); if (st && await st.isVisible()) await st.click();
const top = async () => (await pg.textContent('#h-top-layer')).replace(/\s+/g,' ').slice(0,140);
console.log('start:', await top());
await pg.click('#h-hint'); await pg.waitForTimeout(800);
console.log('after hint:', await top(), '| hint btn:', await pg.textContent('#h-hint'));
const place = await pg.$('button:has-text("Place it")'); console.log('place-it button:', !!place);
if (place) await place.click(); await pg.waitForTimeout(300);
console.log('after place:', await top());
await pg.click('#h-speed'); await pg.click('#h-speed'); // 4x
const t0 = Date.now(); let cleared = false;
while (Date.now() - t0 < 60000) { cleared = await pg.$eval('#h-cleared', e => !e.hidden).catch(()=>false); if (cleared) break; await pg.waitForTimeout(500); }
console.log('cleared:', cleared, 'after', Math.round((Date.now()-t0)/1000), 's wall');
if (cleared) console.log('banner:', (await pg.textContent('#h-cleared')).replace(/\s+/g,' '));
await pg.waitForTimeout(25000); console.log('toast log:', JSON.stringify(await pg.evaluate(() => window.__toasts))); console.log('25s later (grid keeps going):', await top());
await pg.screenshot({ path: 'docs/screenshots/cleared.png' });
console.log('toasts now:', await pg.$$eval('#h-toasts .toast', t => t.map(x => x.textContent.trim().slice(0,60))));
console.log('errors:', errs); await b.close(); srv.close();
