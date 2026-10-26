import { chromium } from 'file:///D:/GitHub/spatial-sql-explorer/node_modules/playwright-core/index.mjs';
import { start, stats } from './server.mjs';
const files = process.argv.slice(2);
const { srv, port } = await start(0, true);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const f of files) {
  for (const k of Object.keys(stats.bytes)) delete stats.bytes[k];
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } }); const page = await ctx.newPage();
  const errs = []; page.on('console', m => { if (['error','warning'].includes(m.type())) errs.push(m.text().slice(0, 200)); }); page.on('pageerror', e => errs.push('PAGEERR ' + e.message.slice(0, 200)));
  const t = Date.now();
  const isLocal = f.startsWith('local:'); const fn = isLocal ? f.slice(6) : f;
  await page.goto(`http://127.0.0.1:${port}/?file=${isLocal ? 'LOCAL' : f}`);
  if (isLocal) await page.setInputFiles('#f', 'data/' + fn);
  await page.waitForFunction(() => window.__r && window.__r.done, null, { timeout: 120000 }).catch(() => {});
  const r = await page.evaluate(() => window.__r);
  const dataBytes = stats.bytes['/data/' + (f.startsWith('local:')?f.slice(6):f)] || 0, size = (await import('fs')).statSync('data/' + (f.startsWith('local:')?f.slice(6):f)).size;
  console.log(`\n== ${f} (${(size/1e6).toFixed(1)} MB)`, JSON.stringify(r), `\n   bytes read ${(dataBytes/1e6).toFixed(2)} MB = ${(100*dataBytes/size).toFixed(2)}% in ${stats.reqs['/data/' + (f.startsWith('local:')?f.slice(6):f)]} requests; wall ${Date.now()-t}ms`, errs.length ? '\n   console: ' + errs.slice(0,4).join(' || ') : '');
  await page.screenshot({ path: `shot_${f.replace(':','_')}.png` }); await ctx.close();
}
await browser.close(); srv.close();
