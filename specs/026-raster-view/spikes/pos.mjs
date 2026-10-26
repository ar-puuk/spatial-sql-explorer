import { openCog, init } from 'cog-tiler-wasm'; import fs from 'fs'; import { fileURLToPath } from 'url'; import { execFileSync } from 'child_process';
const of = globalThis.fetch; globalThis.fetch = (u, o) => { const s = String(u && u.url ? u.url : u); return s.startsWith('file:') ? Promise.resolve(new Response(fs.readFileSync(fileURLToPath(s)), { headers: { 'content-type': 'application/wasm' } })) : of(u, o); };
await init();
for (const c of ['4326','32612','3857','5070','3567']) {
  const f = `data/dem_${c}.tif`; const cog = await openCog(new Uint8Array(fs.readFileSync(f)));
  const b = cog.boundsLonLat; let worst = 0, n = 0, shifted = 0;
  const pts = []; for (let i = 0; i < 40; i++) pts.push([b[0] + (b[2]-b[0]) * (0.1 + 0.8 * Math.random()), b[1] + (b[3]-b[1]) * (0.1 + 0.8 * Math.random())]);
  const gd = execFileSync('gdallocationinfo', ['-wgs84', '-valonly', f, ...[]], { input: pts.map(p => p.join(' ')).join('\n') + '\n' }).toString().trim().split(/\r?\n/).map(Number);
  for (let i = 0; i < pts.length; i++) { const r = await cog.point(pts[i][0], pts[i][1]); const v = r.values[0]; const d = Math.abs(v - gd[i]); if (Number.isFinite(d)) { worst = Math.max(worst, d); n++; if (d > 3) shifted++; } }
  console.log(c, 'compared', n, 'max |diff|', worst.toFixed(3), 'diff>3 units:', shifted);
}
