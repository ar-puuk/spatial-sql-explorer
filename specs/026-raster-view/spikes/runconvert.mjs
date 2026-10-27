import { chromium } from 'file:///D:/GitHub/spatial-sql-explorer/node_modules/playwright-core/index.mjs';
import { start } from './server.mjs';
const { srv, port } = await start(0, false);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--js-flags=--max-old-space-size=8192'] });
for (const f of process.argv.slice(2)) {
  const page = await browser.newPage(); page.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,200)));
  const t = Date.now(); await page.goto(`http://127.0.0.1:${port}/convert.html`); await page.setInputFiles('#f', 'data/' + f);
  await page.waitForFunction(() => window.__r && window.__r.done, null, { timeout: 300000 }).catch(() => {});
  console.log(f, JSON.stringify(await page.evaluate(() => window.__r)), 'wall', Date.now() - t, 'ms');
  const b64 = await page.evaluate(() => { let s=''; const a=window.__cog; if(!a) return null; for(let i=0;i<a.length;i+=0x8000) s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000)); return btoa(s); });
  if (b64) (await import('fs')).writeFileSync('data/conv_' + f, Buffer.from(b64,'base64'));
  await page.close();
}
await browser.close(); srv.close();
