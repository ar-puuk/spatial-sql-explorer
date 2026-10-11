// T038 (specs/001-quick-look/tasks.md, User Story 4): basemap failure
// (offline, blocked, bad response, timeout) degrades to blank + a short
// message, never an exception, so the data layer is never affected (FR-016).
// Selection follows the host theme in 'auto' (FR-009/FR-017).
import { describe, expect, it } from 'vitest'
import { BASEMAP_CATALOG, BasemapHealth, loadBasemapStyle, resolveBasemap, getDefaultBasemap } from '@spatial-explorer/core'

const positron = BASEMAP_CATALOG.find((e) => e.id === 'openfreemap-positron')!
const blank = BASEMAP_CATALOG.find((e) => e.id === 'blank')!
const validStyle = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] }

const respond = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as typeof fetch

describe('resolveBasemap', () => {
  it("'auto' follows the host appearance", () => {
    expect(resolveBasemap('auto', 'light').id).toBe('openfreemap-positron')
    expect(resolveBasemap('auto', 'dark').id).toBe('openfreemap-dark')
  })
  it('an explicit choice ignores the appearance, and an unknown id falls back to the default', () => {
    expect(resolveBasemap('blank', 'dark').id).toBe('blank')
    expect(resolveBasemap('nope', 'dark')).toEqual(getDefaultBasemap('dark'))
  })
  it('every non-blank catalog entry has a preview', () => {
    for (const e of BASEMAP_CATALOG) {
      if (e.type === 'blank') expect(e.preview).toBeNull()
      else expect(e.preview?.land).toMatch(/^#/)
    }
  })
})

describe('loadBasemapStyle', () => {
  it('blank needs no network', async () => {
    const result = await loadBasemapStyle(blank, (() => {
      throw new Error('should not fetch')
    }) as typeof fetch)
    expect(result).toEqual({ ok: true, entry: blank, style: null })
  })

  it('returns the style when the request succeeds', async () => {
    const result = await loadBasemapStyle(positron, respond(validStyle))
    expect(result.ok).toBe(true)
  })

  it('offline / blocked request -> blank + message, no throw', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    const result = await loadBasemapStyle(positron, offline)
    expect(result).toEqual({ ok: false, entry: positron, message: 'Positron basemap unavailable (offline or blocked). Showing a blank background.' })
  })

  it('HTTP error -> message with the status', async () => {
    const result = await loadBasemapStyle(positron, respond('nope', 403))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toMatch(/HTTP 403/)
  })

  it('malformed JSON or not a v8 style -> invalid style', async () => {
    for (const body of ['<html>captive portal</html>', { version: 7, layers: [] }]) {
      const result = await loadBasemapStyle(positron, respond(body))
      expect(!result.ok && result.message).toMatch(/invalid style/)
    }
  })

  it('a hung request times out', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    const result = await loadBasemapStyle(positron, hang, 20)
    expect(!result.ok && result.message).toMatch(/timed out/)
  })
})

describe('BasemapHealth', () => {
  it('abandons a basemap only after repeated failures with no success', () => {
    const h = new BasemapHealth(3)
    expect(h.recordFailure()).toBe(false)
    expect(h.recordFailure()).toBe(false)
    expect(h.recordFailure()).toBe(true)
  })
  it('never abandons once tiles have loaded', () => {
    const h = new BasemapHealth(2)
    h.recordSuccess()
    expect(h.recordFailure()).toBe(false)
    expect(h.recordFailure()).toBe(false)
  })
})
