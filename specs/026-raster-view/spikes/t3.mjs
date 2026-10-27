import { openCog, init } from 'cog-tiler-wasm'; import fs from 'fs'; import { fileURLToPath } from 'url';
const of = globalThis.fetch; globalThis.fetch = (u, o) => { const s = String(u && u.url ? u.url : u); return s.startsWith('file:') ? Promise.resolve(new Response(fs.readFileSync(fileURLToPath(s)), { headers: { 'content-type': 'application/wasm' } })) : of(u, o); };
await init();
const tile = (b) => { const z = 9; const x = Math.floor((((b[0]+b[2])/2)+180)/360*2**z); const lat=(b[1]+b[3])/2*Math.PI/180; const y = Math.floor((1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*2**z); return [z,x,y]; };
for (const [f, opts] of [['dem_5070.tif', { min: -300, max: 1000, colormap: 'viridis' }], ['rgb_u16.tif', { min: 0, max: 60000 }], ['classes_pal.tif', {}]]) {
  const c = await openCog(new Uint8Array(fs.readFileSync('data/' + f))); const [z,x,y] = tile(c.boundsLonLat);
  let tr=0, op=0, n=0; const colors=new Set();
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) { const t = await c.renderTileRGBA(z,x+dx,y+dy,opts); if (!t) continue; for (let i=0;i<t.length;i+=4){ n++; if(t[i+3]===0) tr++; else { op++; if (colors.size<12) colors.add(t[i]+','+t[i+1]+','+t[i+2]); } } }
  const p = await c.point((c.boundsLonLat[0]+c.boundsLonLat[2])/2,(c.boundsLonLat[1]+c.boundsLonLat[3])/2);
  console.log(f, 'palette', c.hasPalette, 'bands', c.levels[0].bands, 'transparent px', tr, 'opaque', op, 'sample colors', [...colors].slice(0,6).join(' | '), 'point', JSON.stringify(p.values), 'info dtype', JSON.stringify(c.info()).match(/"dtype":"[^"]*"/)?.[0]);
}
