// Browser check of dist/: board fill at 4 viewports, move/remove, arrows screenshot, procedural previews, console errors.
// Usage: npm run build && node scripts/verify-browser.mjs
import { chromium } from 'playwright';
import { createServer } from 'http'; import { readFileSync, existsSync } from 'fs'; import { join, extname } from 'path';
const root = new URL('../dist', import.meta.url).pathname;
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv = createServer((q,s)=>{ const p = join(root, q.url==='/'?'/index.html':q.url.split('?')[0]); if(!existsSync(p)) {s.statusCode=404; return s.end();} s.setHeader('content-type', types[extname(p)]||'application/octet-stream'); s.end(readFileSync(p)); }).listen(4175);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args:['--use-gl=swiftshader'] });
const out = [];
for (const [W,H] of [[360,740],[900,500],[1280,720],[1920,1080]]) {
  const pg = await b.newPage({ viewport:{width:W,height:H} }); const errs=[];
  pg.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); }); pg.on('pageerror', e=>errs.push(String(e)));
  await pg.goto('http://localhost:4175/'); await pg.waitForTimeout(700);
  await pg.click('.level-card:not(.locked)'); await pg.waitForTimeout(400);
  const st = await pg.$('#h-start'); if (st && await st.isVisible()) await st.click(); await pg.waitForTimeout(400);
  const m = await pg.evaluate(() => {
    const top = document.querySelector('#h-top-layer .topbar')?.getBoundingClientRect();
    const bot = document.querySelector('#h-bottombar')?.getBoundingClientRect();
    return { top: top && [top.top, top.bottom], bot: bot && [bot.top, bot.bottom], vw: innerWidth, vh: innerHeight };
  });
  // board extents: scan the scene canvas for non-transparent pixels isn't reliable; read letterbox via drawn border from page state is internal,
  // so measure the particle spread instead: sample canvas alpha on a coarse grid
  const cover = await pg.evaluate(({topB, botT}) => {
    const c = document.getElementById('scene'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0,0,c.width,c.height).data;
    const sx = c.width / c.clientWidth; let minX=1e9,maxX=-1,minY=1e9,maxY=-1;
    for (let y=0;y<c.height;y+=2) for (let x=0;x<c.width;x+=2){ if (d[(y*c.width+x)*4+3]>0){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
    const bw=(maxX-minX)/sx, bh=(maxY-minY)/sx; const availH = botT - topB;
    return { boardCss:[Math.round(minX/sx),Math.round(minY/sx),Math.round(bw),Math.round(bh)], coverage: Math.round(100*bw*Math.min(bh,availH)/(c.clientWidth*availH)), overlapTop: minY/sx < topB-1, overlapBot: maxY/sx > botT+1 };
  }, { topB: m.top?.[1] ?? 0, botT: m.bot?.[0] ?? m.vh });
  out.push({ vp:`${W}x${H}`, hud:m, ...cover });
  await pg.screenshot({ path: `docs/screenshots/fill-${W}x${H}.png` });
  if (W===1280) {
    // move/remove still works
    const e = async () => Number((await pg.textContent('#h-top-layer')).match(/⚡\s*(\d+)/)?.[1]);
    const e0 = await e();
    const chip = await pg.$('#h-bottombar [data-tool="repulsor"], #h-bottombar button:has-text("Repulsor")'); await chip.click();
    const cx = Math.round(m.vw/2), cy = Math.round((m.top[1]+m.bot[0])/2);
    await pg.mouse.click(cx, cy); await pg.waitForTimeout(150); const e1 = await e();
    await pg.mouse.move(cx,cy); await pg.mouse.down(); await pg.mouse.move(cx+80,cy+30,{steps:6}); await pg.mouse.up(); await pg.waitForTimeout(150); const e2 = await e();
    await pg.mouse.click(cx+80, cy+30); await pg.waitForTimeout(150); const pop = !!(await pg.$('.popover'));
    await pg.click('#pop-yes'); await pg.waitForTimeout(150); const e3 = await e();
    out.push({ moveRemove: { e0, afterPlace:e1, afterDrag:e2, popover:pop, afterRemove:e3 } });
    // place again then run a round at 2x for arrows
    await pg.mouse.click(cx+80, cy+30); await pg.waitForTimeout(100);
    await pg.click('#h-run');
    await pg.click('#h-menu-toggle'); await pg.click('#h-speed'); await pg.mouse.click(5, 300);
    await pg.waitForFunction(() => !document.querySelector('#h-run') || document.body.innerText.includes('Continue') || document.body.innerText.includes('won') || document.body.innerText.includes('Next'), null, { timeout: 30000 }).catch(()=>{});
    await pg.waitForTimeout(9000);
    await pg.screenshot({ path: 'docs/screenshots/arrows.png' });
    // unlock 5 and check previews
    await pg.evaluate(() => { try { localStorage.setItem('gravity-game:unlocked', '4'); } catch {} });
    await pg.goto('http://localhost:4175/'); await pg.waitForTimeout(700);
    const t0 = await pg.$$eval('.level-card', els => els.map(e => (e.classList.contains('locked')?'L:':'U:') + e.innerText.replace(/\s+/g,' ').slice(0,50)));
    await pg.waitForTimeout(15000);
    const t1 = await pg.$$eval('.level-card', els => els.map(e => (e.classList.contains('locked')?'L:':'U:') + e.innerText.replace(/\s+/g,' ').slice(0,60)));
    await pg.screenshot({ path: 'docs/screenshots/level-select.png' });
    out.push({ levelSelectInitial: t0, levelSelectAfter15s: t1 });
    // start level 4 (procedural)
    await pg.click('.level-card[data-id="4"]'); await pg.waitForTimeout(6000);
    out.push({ level4: (await pg.textContent('body')).replace(/\s+/g,' ').slice(0,160) });
  }
  out.push({ vp:`${W}x${H}`, errors: errs });
  await pg.close();
}
console.log(out.map(o=>JSON.stringify(o)).join('\n')); await b.close(); srv.close();
