import init, { CogBuilder, GeoTiffReader, geotiff_info } from 'geolibre-wasm';
const out = (k, v) => { (window.__r ||= {})[k] = v; };
async function main() {
  const q = new URLSearchParams(location.search);
  let t = performance.now();
  const wasm = await (await fetch('/engine/geolibre_wasm_bg.wasm')).arrayBuffer();
  await init({ module_or_path: wasm }); out('initMs', Math.round(performance.now() - t));
  const inp = document.getElementById('f'); while (!inp.files.length) await new Promise(r => setTimeout(r, 25));
  const file = inp.files[0]; out('fileMB', Math.round(file.size / 1e6));
  t = performance.now(); const bytes = new Uint8Array(await file.arrayBuffer()); out('readMs', Math.round(performance.now() - t));
  t = performance.now(); const info = JSON.parse(geotiff_info(bytes)); out('info', JSON.stringify(info)); out('infoMs', Math.round(performance.now() - t));
  const reader = new GeoTiffReader(bytes);
  const { width, height, bands } = reader;
  const b = new CogBuilder(width, height, bands);
  if (typeof reader.epsg === 'number') b.set_epsg(reader.epsg);
  b.set_geo_transform(reader.geo_transform()); if (Number.isFinite(reader.nodata)) b.set_nodata(reader.nodata);
  b.set_tile_size(512); b.set_compression('deflate');
  const lv = []; let f = 2; while (Math.max(width, height) / f > 256) { lv.push(f); f *= 2; } b.set_overview_levels(new Uint32Array(lv));
  t = performance.now(); const px = reader.read_all_f64(); out('decodeMs', Math.round(performance.now() - t));
  t = performance.now(); const cog = b.write_f32(Float32Array.from(px)); out('encodeMs', Math.round(performance.now() - t));
  out('cogMB', Math.round(cog.length / 1e6)); out('heapMB', Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6));
  window.__cog = cog; out('done', true);
}
main().catch(e => { out('error', String(e)); out('done', true); });
