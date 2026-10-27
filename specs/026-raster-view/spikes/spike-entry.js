import * as maplibregl from 'maplibre-gl';
import initWhitebox from 'whitebox-wasm';
import initTiler from 'cog-tiler-wasm/wasm';
import { openCog, init, registerCogProtocol } from 'cog-tiler-wasm';

maplibregl.setWorkerUrl('/maplibre-worker.js');
const out = (k, v) => { (window.__r ||= {})[k] = v; };
async function main() {
  const q = new URLSearchParams(location.search);
  const t0 = performance.now();
  // pinned-URL style: fetch the two wasm files ourselves, hand bytes/response to init
  const wb = await (await fetch('/engine/whitebox_wasm_bg.wasm')).arrayBuffer();
  const ct = await (await fetch('/engine/cog_tiler_wasm_bg.wasm')).arrayBuffer();
  await initWhitebox({ module_or_path: wb });
  await initTiler({ module_or_path: ct });
  await init();
  out('engineInitMs', Math.round(performance.now() - t0));
  const file = q.get('file');
  let source;
  if (file === 'LOCAL') {
    const inp = document.getElementById('f'); while (!inp.files.length) await new Promise(r => setTimeout(r, 25)); out('fileSize', inp.files[0].size); source = inp.files[0];
  } else source = location.origin + '/data/' + file;
  const t1 = performance.now();
  const cog = await openCog(source);
  out('openMs', Math.round(performance.now() - t1));
  out('levels', cog.levels.length); out('mode', cog.mode); out('crs', cog.crsLabel);
  out('bounds', cog.boundsLonLat); out('viaGeoTiff', cog.readsViaGeoTiff);
  out('bands', cog.levels[0]?.bands);
  const t2 = performance.now();
  const st = await cog.statistics({ maxSize: 512 });
  out('statsMs', Math.round(performance.now() - t2)); out('stats', JSON.stringify(st).slice(0, 200));
  const b = cog.boundsLonLat; const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const t3 = performance.now(); const p = await cog.point(cx, cy); out('pointMs', Math.round(performance.now() - t3)); out('point', JSON.stringify(p));
  const s0 = st.b1 || Object.values(st)[0];
  const render = { min: s0?.percentile_2 ?? s0?.min ?? 0, max: s0?.percentile_98 ?? s0?.max ?? 255, colormap: 'viridis' };
  registerCogProtocol(maplibregl, 'cog', () => ({ source: cog, render: cog.levels[0]?.bands >= 3 ? {} : render }));
  const map = new maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] }, bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 20 }, fadeDuration: 0 });
  await new Promise(r => map.on('load', r));
  const t4 = performance.now();
  map.addSource('r', { type: 'raster', tiles: ['cog://{z}/{x}/{y}'], tileSize: 256, bounds: b });
  map.addLayer({ id: 'r', type: 'raster', source: 'r' });
  await new Promise(r => { const f = () => { if (map.areTilesLoaded() && map.isSourceLoaded('r')) { map.off('idle', f); r(); } }; map.on('idle', f); setTimeout(r, 20000); });
  out('firstViewMs', Math.round(performance.now() - t4)); out('zoom', +map.getZoom().toFixed(2));
  out('heapMB', performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
  out('done', true);
}
main().catch(e => { out('error', String(e) + ' | ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')); out('done', true); });
