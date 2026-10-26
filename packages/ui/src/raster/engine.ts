// Spec 026 (constitution IV and v1.2.0): the raster engine is downloaded, not bundled, and it runs in a worker (tilerWorker.ts,
// tilerClient.ts). This is the page's entry to it: the one worker, and the colormaps it sampled for the previews.
import type { EngineSource } from '@spatial-explorer/core'
import { getTilerClient, rememberColormaps, type TilerClient } from './tilerClient.js'

export { colormapColors } from './tilerClient.js'
export type { TilerClient } from './tilerClient.js'

/** The raster engine (the worker, up and initialised), loaded once. */
export async function getRasterEngine(source: EngineSource = {}): Promise<TilerClient> {
  const client = await getTilerClient(source)
  rememberColormaps(client.colormaps)
  return client
}
