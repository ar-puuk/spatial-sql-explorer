// Web implementation of HostAdapter (T031). Reads file bytes directly via
// the File/Blob API — no message-passing boundary to cross, unlike the VS
// Code implementation (apps/vscode-ext/src/webview/hostAdapter.ts).
import { createWebGdbHost, geodatabaseFiles } from './gdb/gdbHost.js'
import { fetchFromNetwork, type EngineFileRef, type FileSource, type HostAdapter, type OpenedFileRef, type SaveOptions, type SaveResult, type StatusFields, type ThemeKind, type WorkspaceFile, type WorkspaceResolution } from '@spatial-explorer/core'

const fileMap = new Map<string, File[]>()

/** Spec 008 FR-022: the web app's theme choice. 'system' follows the OS live. */
export type ThemePreference = 'system' | 'light' | 'dark'
let themePreference: ThemePreference = 'system'
const themeListeners = new Set<(theme: ThemeKind) => void>()

function systemTheme(): ThemeKind {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function detectTheme(): ThemeKind {
  return themePreference === 'system' ? systemTheme() : themePreference
}

/** Applies a theme choice: `data-theme` on <html> (none for 'system'), then tells the viewer. */
export function setThemePreference(preference: ThemePreference): void {
  themePreference = preference
  if (preference === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = preference
  const theme = detectTheme()
  themeListeners.forEach((cb) => cb(theme))
}

export function getThemePreference(): ThemePreference {
  return themePreference
}

function isLikelySidecar(name: string): boolean {
  const lower = name.toLowerCase()
  // .qml/.sld: a style dropped alongside the data (QGIS sidecar convention),
  // never the primary data file.
  return ['.shx', '.dbf', '.prj', '.cpg', '.qml', '.sld'].some((ext) => lower.endsWith(ext))
}

const STYLE_EXTENSIONS = ['.qml', '.sld']

function primaryOf(files: File[]): File {
  return files.find((f) => !isLikelySidecar(f.name)) ?? files[0]
}

let pendingOpenFilesResolve: ((refs: OpenedFileRef[]) => void) | null = null

/**
 * Called by App.svelte's picker/drop-zone UI once the user has chosen file(s)
 * — resolves the HostAdapter.openFiles() call the viewer store is awaiting.
 * Sidecar discovery (Shapefile's .shx/.dbf/.prj) depends on the user having
 * selected/dropped all of them together — the browser has no API to look up
 * sibling files from a single File handle (unlike VS Code's workspace.fs). A
 * bare .shp dropped alone surfaces as a clear ST_Read error (FR-011), per
 * contracts/host-adapter.md.
 */
export function provideFiles(files: File[]): void {
  // Spec 013: a picked or dropped .gdb folder is many files; it is opened by the folder's name.
  const gdbFolder = files.find((f) => /^[^/]+\.gdb\//i.test(f.webkitRelativePath))?.webkitRelativePath.split('/')[0] ?? null
  const primary = gdbFolder ? { name: gdbFolder, size: files.reduce((sum, f) => sum + f.size, 0), lastModified: Math.max(...files.map((f) => f.lastModified)) } : (files.find((f) => !isLikelySidecar(f.name)) ?? files[0])
  const id = crypto.randomUUID()
  fileMap.set(id, files)
  // Spec 010 phase 9: the open file is also a workspace file (a query may name it); a geodatabase's tables are not.
  openGroup = gdbFolder ? null : files
  notifyWorkspace()
  // No path exists in the browser: name + size + mtime identifies "the same
  // file" across sessions well enough for query history (spec 002).
  pendingOpenFilesResolve?.([{ id, displayName: primary.name, stateKey: `${primary.name}|${primary.size}|${primary.lastModified}` }])
  pendingOpenFilesResolve = null
}

// --- Spec 010 phase 9: files a query can name ------------------------------------
// The browser can't list folders: the workspace is the open file plus the files
// the user adds (SQL tab, Add files… or a drop), each with its sidecars, by name.
const workspaceGroups = new Map<string, File[]>()
let openGroup: File[] | null = null
const workspaceListeners = new Set<() => void>()
const notifyWorkspace = (): void => workspaceListeners.forEach((cb) => cb())

/**
 * Adds each data file under its name, with the sidecars of the same basename
 * (a Shapefile's .dbf/.shx/.prj). sample.shp and sample.gpkg stay two files.
 */
export function addWorkspaceFileList(files: File[]): WorkspaceFile[] {
  const baseOf = (name: string): string => name.replace(/\.[^.]+$/, '').toLowerCase()
  const sidecars = files.filter((f) => isLikelySidecar(f.name))
  const added: WorkspaceFile[] = []
  for (const primary of files.filter((f) => !isLikelySidecar(f.name))) {
    workspaceGroups.set(primary.name, [primary, ...sidecars.filter((s) => baseOf(s.name) === baseOf(primary.name))])
    added.push({ path: primary.name, size: primary.size })
  }
  if (added.length) notifyWorkspace()
  return added
}

interface DirectoryHandle {
  readonly name: string
  values(): AsyncIterable<{ kind: 'file'; name: string; getFile(): Promise<File> } | (DirectoryHandle & { kind: 'directory' })>
}

/** Every file under a directory handle, each carrying its path inside the folder like a dropped folder's files. */
async function filesOf(dir: DirectoryHandle, prefix: string): Promise<File[]> {
  const out: File[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      Object.defineProperty(file, 'webkitRelativePath', { value: `${prefix}${entry.name}` })
      out.push(file)
    } else out.push(...(await filesOf(entry, `${prefix}${entry.name}/`)))
  }
  return out
}

/**
 * Spec 013: a folder picker. Chrome and Edge get the File System Access picker, whose prompt says the
 * site may view the files (true); the `<input webkitdirectory>` fallback is worded by the browser as an
 * upload ("Upload N files to this site"), though nothing leaves the tab.
 */
export async function pickFolder(): Promise<File[]> {
  const show = (window as unknown as { showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<DirectoryHandle> }).showDirectoryPicker
  if (show) {
    try {
      const dir = await show.call(window, { mode: 'read' })
      return await filesOf(dir, `${dir.name}/`)
    } catch (err) {
      // Cancelled; any other failure (a blocked folder, say) falls back to the input.
      if (err instanceof DOMException && err.name === 'AbortError') return []
    }
  }
  return pickFolderInput()
}

function pickFolderInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.setAttribute('webkitdirectory', '')
    input.addEventListener('change', () => resolve([...(input.files ?? [])]))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

/** A file picker, resolved with the chosen files (none when cancelled). */
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.addEventListener('change', () => resolve([...(input.files ?? [])]))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

function groupSource(path: string, group: File[]): FileSource {
  const primary = primaryOf(group)
  const sidecars = group.filter((f) => f !== primary && !STYLE_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
  return { kind: 'handle', name: `ws/${path}`, size: primary.size, handle: primary, sidecars: sidecars.map((f) => ({ name: `ws/${f.name}`, handle: f })), styleSidecar: null }
}

/** e2e (spec 007 T053): range reads served, to show PMTiles is never read whole. */
export const rangeReads = { count: 0, bytes: 0, largest: 0 }

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' }

// Spec 008 research §15: the SQL engine's local copy, in Cache Storage (not
// the HTTP cache, which the browser evicts freely). Keyed by content hash.
const ENGINE_CACHE = 'spatial-explorer-engine'
const engineKey = (sha256: string, name: string): string => `${location.origin}/__engine/${sha256}/${name}`
let persistAsked = false

async function engineFile(file: EngineFileRef, options?: { refresh?: boolean }): Promise<ArrayBuffer> {
  // No Cache Storage (an insecure context, a locked-down browser): download every time.
  if (typeof caches === 'undefined') return fetchFromNetwork(file.url, file.sha256, file.name)
  const cache = await caches.open(ENGINE_CACHE)
  const key = engineKey(file.sha256, file.name)
  if (options?.refresh) await cache.delete(key)
  else {
    const hit = await cache.match(key)
    if (hit) return hit.arrayBuffer()
  }
  const bytes = await fetchFromNetwork(file.url, file.sha256, file.name)
  await cache.put(key, new Response(bytes.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {})
  if (!persistAsked) {
    // Ask the browser not to clear it under storage pressure (it may say no).
    persistAsked = true
    void navigator.storage?.persist?.().catch(() => false)
  }
  return bytes
}

async function pruneEngineFiles(keep: string[]): Promise<void> {
  if (typeof caches === 'undefined') return
  const cache = await caches.open(ENGINE_CACHE)
  for (const req of await cache.keys()) {
    const sha = new URL(req.url).pathname.split('/')[2]
    if (!keep.includes(sha)) await cache.delete(req)
  }
}

export function createWebHostAdapter(): HostAdapter {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    // An explicit Light or Dark choice ignores the OS.
    if (themePreference !== 'system') return
    const theme = detectTheme()
    themeListeners.forEach((cb) => cb(theme))
  })

  return {
    engineFile,
    pruneEngineFiles,
    gdb: createWebGdbHost({ engine: { host: { engineFile, pruneEngineFiles } }, getFiles: async (ref) => geodatabaseFiles(fileMap.get(ref.id) ?? []) }),
    getTheme(): ThemeKind {
      return detectTheme()
    },
    onThemeChange(cb: (theme: ThemeKind) => void): () => void {
      themeListeners.add(cb)
      return () => themeListeners.delete(cb)
    },
    openFiles(): Promise<OpenedFileRef[]> {
      // Resolves once the user picks/drops a file via App.svelte's UI
      // (provideFiles) — this is the web shell's equivalent of the VS Code
      // webview waiting for the extension host's file-transfer messages.
      return new Promise((resolve) => {
        pendingOpenFilesResolve = resolve
      })
    },
    async getFileSource(ref: OpenedFileRef, options?: { whole?: boolean }): Promise<FileSource> {
      const files = fileMap.get(ref.id)
      if (!files) throw new Error(`Unknown file reference: ${ref.id}`)
      const primary = primaryOf(files)
      // The QGIS-convention style sidecar (<basename>.qml) is read as text;
      // other style files are never data.
      const wantedStyle = `${primary.name.replace(/\.[^.]+$/, '')}.qml`.toLowerCase()
      const style = files.find((f) => f !== primary && f.name.toLowerCase() === wantedStyle)
      const styleSidecar = style ? { fileName: style.name, text: await style.text() } : null
      const sidecars = files.filter((f) => f !== primary && !STYLE_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
      if (options?.whole) {
        // FlatGeobuf "load for queries" (spec 007): the whole file, in memory.
        return {
          kind: 'bytes',
          name: primary.name,
          size: primary.size,
          bytes: new Uint8Array(await primary.arrayBuffer()),
          sidecars: await Promise.all(sidecars.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
          styleSidecar,
        }
      }
      // Spec 007 research §2: the engine reads the File in slices; nothing is copied up front.
      return { kind: 'handle', name: primary.name, size: primary.size, handle: primary, sidecars: sidecars.map((f) => ({ name: f.name, handle: f })), styleSidecar }
    },
    async listWorkspaceFiles(): Promise<WorkspaceFile[]> {
      const open = openGroup ? [{ path: primaryOf(openGroup).name, size: primaryOf(openGroup).size, open: true }] : []
      const added = [...workspaceGroups.entries()].map(([path, g]) => ({ path, size: primaryOf(g).size }))
      const seen = new Set(open.map((f) => f.path))
      return [...open, ...added.filter((f) => !seen.has(f.path)).sort((a, b) => a.path.localeCompare(b.path))]
    },
    async resolveWorkspaceFiles(paths: string[]): Promise<WorkspaceResolution[]> {
      return paths.map((path) => {
        const group = workspaceGroups.get(path) ?? (openGroup && primaryOf(openGroup).name === path ? openGroup : null)
        return group ? { path, source: groupSource(path, group) } : { path, error: `Add ${path} to the workspace first (SQL tab, Add files…).`, missing: true }
      })
    },
    async addWorkspaceFiles(files?: File[]): Promise<WorkspaceFile[]> {
      return addWorkspaceFileList(files ?? (await pickFiles()))
    },
    onWorkspaceFilesChanged(cb: () => void): () => void {
      workspaceListeners.add(cb)
      return () => workspaceListeners.delete(cb)
    },
    async readRange(ref: OpenedFileRef, offset: number, length: number): Promise<Uint8Array> {
      const files = fileMap.get(ref.id)
      if (!files) throw new Error(`Unknown file reference: ${ref.id}`)
      const bytes = new Uint8Array(await primaryOf(files).slice(offset, offset + length).arrayBuffer())
      rangeReads.count++
      rangeReads.bytes += bytes.byteLength
      rangeReads.largest = Math.max(rangeReads.largest, bytes.byteLength)
      return bytes
    },
    async saveFile(name: string, content: Uint8Array | string, options?: SaveOptions): Promise<SaveResult> {
      // The browser cannot write next to a picked file, so every save is a
      // download (HostAdapter.saveSidecar is intentionally not implemented).
      const blob = new Blob([content as BlobPart], { type: options?.kind === 'image' ? (IMAGE_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/png') : 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { saved: true, location: name }
    },
    pickTextFile(options: { title: string; extensions: readonly string[] }): Promise<{ name: string; text: string } | null> {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = options.extensions.join(',')
        input.addEventListener('change', async () => {
          const file = input.files?.[0]
          resolve(file ? { name: file.name, text: await file.text() } : null)
        })
        input.addEventListener('cancel', () => resolve(null))
        input.click()
      })
    },
    async loadState<T>(key: string): Promise<T | undefined> {
      // Storage can be unavailable (private mode, blocked site data): treat as empty.
      try {
        const raw = window.localStorage.getItem(`spatial-explorer:${key}`)
        return raw === null ? undefined : (JSON.parse(raw) as T)
      } catch {
        return undefined
      }
    },
    async saveState(key: string, value: unknown): Promise<void> {
      try {
        if (value === null || value === undefined) window.localStorage.removeItem(`spatial-explorer:${key}`)
        else window.localStorage.setItem(`spatial-explorer:${key}`, JSON.stringify(value))
      } catch {
        // Not persisted; the choice still applies for this session.
      }
    },
    // Spec 010: basemap keys stay in this browser (localStorage); unavailable storage means no key.
    secretLocation: 'browser',
    async getSecret(name: string): Promise<string | undefined> {
      try {
        return window.localStorage.getItem(`spatialExplorer.secret.${name}`) ?? undefined
      } catch {
        return undefined
      }
    },
    async setSecret(name: string, value: string | null): Promise<void> {
      try {
        if (value) window.localStorage.setItem(`spatialExplorer.secret.${name}`, value)
        else window.localStorage.removeItem(`spatialExplorer.secret.${name}`)
      } catch {
        // Not kept; the key still applies for this session.
      }
    },
    setStatus(_fields: StatusFields): void {
      // No-op on the web shell (CLAUDE.md: "no-op on web" for setStatus).
    },
  }
}
