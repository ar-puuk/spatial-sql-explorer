import http from 'http'; import fs from 'fs'; import path from 'path';
export const stats = { bytes: {}, reqs: {} };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.tif': 'image/tiff' };
export function start(port = 0, csp = true) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = u.pathname === '/' ? '/index.html' : u.pathname;
    const file = path.join(process.cwd(), p.startsWith('/data/') ? '' : 'web', p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(file).size; const h = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (csp && p === '/index.html') h['Content-Security-Policy'] = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob: 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'";
    const r = req.headers.range; let s = 0, e = size - 1, code = 200;
    if (r) { const m = /bytes=(\d*)-(\d*)/.exec(r); if (m[1] !== '') { s = +m[1]; if (m[2] !== '') e = Math.min(+m[2], size - 1); } else { s = Math.max(0, size - +m[2]); } code = 206; h['Content-Range'] = `bytes ${s}-${e}/${size}`; }
    h['Content-Length'] = e - s + 1; res.writeHead(code, h);
    const key = p; stats.bytes[key] = (stats.bytes[key] || 0) + (e - s + 1); stats.reqs[key] = (stats.reqs[key] || 0) + 1;
    fs.createReadStream(file, { start: s, end: e }).pipe(res);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
