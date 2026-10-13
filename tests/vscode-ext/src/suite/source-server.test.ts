// T010 (spec 007, contracts/host-and-shells.md): the loopback range server
// that lets the engine read opened files in parts (research §3).
import * as assert from 'assert'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import * as vscode from 'vscode'

interface ServerForTests {
  register(primaryPath: string, sidecarPaths: string[]): Promise<{ token: string; urlFor(name: string): string; port: number }>
  release(token: string): void
  isListening(): boolean
  addFiles(token: string, files: Array<{ name: string; fsPath: string }>): void
}

const fixture = (name: string): string => path.resolve(__dirname, '../../fixtures', name)

interface Reply {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

function request(port: number, method: string, urlPath: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex')

suite('Spec 007: loopback source server', () => {
  let server: ServerForTests
  let resolveInside: (root: string, p: string) => string | null
  let token: string
  let port: number
  const parquet = fixture('parcels-10k.parquet')
  const size = fs.statSync(parquet).size
  const route = (name: string): string => `/${token}/${encodeURIComponent(name)}`
  const origin = { Origin: 'vscode-webview://abc123' }

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'spatial-explorer')
    assert.ok(ext, 'extension not found')
    const api = (await ext.activate()) as { sourceServerForTests: ServerForTests; resolveInsideForTests: typeof resolveInside }
    server = api.sourceServerForTests
    resolveInside = api.resolveInsideForTests
    const reg = await server.register(parquet, [fixture('sample.dbf'), fixture('sample.shx'), fixture('sample.prj')])
    token = reg.token
    port = reg.port
    assert.match(reg.urlFor('parcels-10k.parquet'), /^http:\/\/localhost\.:\d+\/[0-9a-f]{32}\/parcels-10k\.parquet$/)
  })

  suiteTeardown(() => server?.release(token))

  test('HEAD with a Range answers 206 with the full length (what DuckDB-WASM probes)', async () => {
    const r = await request(port, 'HEAD', route('parcels-10k.parquet'), { ...origin, Range: 'bytes=0-' })
    assert.strictEqual(r.status, 206)
    assert.strictEqual(Number(r.headers['content-length']), size)
    assert.strictEqual(r.headers['content-range'], `bytes 0-${size - 1}/${size}`)
    assert.strictEqual(r.headers['accept-ranges'], 'bytes')
  })

  test('HEAD without a Range answers 200', async () => {
    const r = await request(port, 'HEAD', route('parcels-10k.parquet'), origin)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(Number(r.headers['content-length']), size)
  })

  test('a single range returns exactly those bytes', async () => {
    const r = await request(port, 'GET', route('parcels-10k.parquet'), { ...origin, Range: 'bytes=1000-66535' })
    assert.strictEqual(r.status, 206)
    assert.strictEqual(r.headers['content-range'], `bytes 1000-66535/${size}`)
    assert.strictEqual(sha(r.body), sha(fs.readFileSync(parquet).subarray(1000, 66536)))
  })

  test('an open-ended range and a suffix range', async () => {
    const tail = await request(port, 'GET', route('parcels-10k.parquet'), { ...origin, Range: `bytes=${size - 8}-` })
    assert.strictEqual(tail.status, 206)
    assert.strictEqual(tail.body.subarray(4).toString('latin1'), 'PAR1')
    const suffix = await request(port, 'GET', route('parcels-10k.parquet'), { ...origin, Range: 'bytes=-4' })
    assert.strictEqual(suffix.status, 206)
    assert.strictEqual(suffix.body.toString('latin1'), 'PAR1')
  })

  test('without a Range the whole file is streamed', async () => {
    const r = await request(port, 'GET', route('parcels-10k.parquet'), origin)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(sha(r.body), sha(fs.readFileSync(parquet)))
  })

  test('multi-range and unsatisfiable ranges are refused with 416', async () => {
    for (const range of ['bytes=0-1,5-9', `bytes=${size}-`, 'bytes=9-3', 'items=0-1']) {
      const r = await request(port, 'GET', route('parcels-10k.parquet'), { ...origin, Range: range })
      assert.strictEqual(r.status, 416, range)
    }
  })

  test('a wrong token or an unregistered name is 404', async () => {
    assert.strictEqual((await request(port, 'GET', `/${'0'.repeat(32)}/parcels-10k.parquet`, origin)).status, 404)
    assert.strictEqual((await request(port, 'GET', route('other.parquet'), origin)).status, 404)
    assert.strictEqual((await request(port, 'GET', `/${token}/..%2F..%2Fpackage.json`, origin)).status, 404)
  })

  test('only VS Code webviews may read (Origin check)', async () => {
    assert.strictEqual((await request(port, 'GET', route('parcels-10k.parquet'), { Origin: 'https://evil.example', Range: 'bytes=0-3' })).status, 403)
    const ok = await request(port, 'GET', route('parcels-10k.parquet'), { ...origin, Range: 'bytes=0-3' })
    assert.strictEqual(ok.status, 206)
    assert.strictEqual(ok.headers['access-control-allow-origin'], origin.Origin)
    assert.strictEqual(ok.headers['access-control-allow-private-network'], 'true')
    assert.match(String(ok.headers['access-control-expose-headers']), /Content-Range/)
  })

  test('preflight requests are answered with the CORS headers', async () => {
    const r = await request(port, 'OPTIONS', route('parcels-10k.parquet'), { ...origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' })
    assert.strictEqual(r.status, 204)
    assert.match(String(r.headers['access-control-allow-headers']), /Range/i)
    assert.match(String(r.headers['access-control-allow-methods']), /HEAD/)
  })

  test('sidecars are served by name', async () => {
    for (const name of ['sample.dbf', 'sample.shx', 'sample.prj']) {
      const r = await request(port, 'GET', route(name), { ...origin, Range: 'bytes=0-3' })
      assert.strictEqual(r.status, 206, name)
      assert.strictEqual(sha(r.body), sha(fs.readFileSync(fixture(name)).subarray(0, 4)))
    }
  })

  test('spec 010: workspace files are served under the token by their ws/ name, with range reads', async () => {
    server.addFiles(token, [{ name: 'ws/data/sample.gpkg', fsPath: fixture('sample.gpkg') }])
    const r = await request(port, 'GET', route('ws/data/sample.gpkg'), { ...origin, Range: 'bytes=0-15' })
    assert.strictEqual(r.status, 206)
    assert.strictEqual(r.body.toString('latin1'), 'SQLite format 3\0')
    assert.strictEqual((await request(port, 'GET', route('ws/data/other.gpkg'), origin)).status, 404)
  })

  test('spec 010: a workspace path that leaves the root is refused', () => {
    const root = path.resolve(__dirname, '../../fixtures')
    assert.strictEqual(resolveInside(root, 'sample.shp'), path.join(root, 'sample.shp'))
    assert.strictEqual(resolveInside(root, 'a/b.shp'), path.join(root, 'a', 'b.shp'))
    for (const bad of ['../x.shp', 'a/../../x.shp', '/etc/passwd', 'C:/x.shp', 'a\\..\\..\\x.shp', 'file:///x.shp', ''])
      assert.strictEqual(resolveInside(root, bad), null, bad)
  })

  test('the server stops when its last file is released', async () => {
    const other = await server.register(fixture('sample.fgb'), [])
    server.release(other.token)
    assert.strictEqual((await request(port, 'GET', `/${other.token}/sample.fgb`, origin)).status, 404)
    assert.ok(server.isListening(), 'still serving the suite file')
    server.release(token)
    await new Promise((r) => setTimeout(r, 100))
    assert.strictEqual(server.isListening(), false)
    const again = await server.register(parquet, [])
    token = again.token
    port = again.port
    assert.ok(server.isListening())
  })
})
