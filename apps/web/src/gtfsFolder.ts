// Spec 024: a GTFS feed picked or dropped as a folder, or as its loose `.txt` files, becomes one zip
// (core's zipGtfsFolder decides, by content) which then opens like any zip. Nothing is read unless
// some file has a feed's name.
import { mayBeGtfs, zipGtfsFolder } from '@spatial-explorer/core'

/** The files as one `.zip` File when they are a GTFS feed; otherwise null. */
export async function gtfsFeedFile(files: readonly File[]): Promise<File | null> {
  const pathOf = (f: File): string => f.webkitRelativePath || f.name
  if (!mayBeGtfs(files.map(pathOf))) return null
  const feed = await zipGtfsFolder(
    files.map((f) => ({
      path: pathOf(f),
      head: async () => new Uint8Array(await f.slice(0, 8192).arrayBuffer()),
      read: async () => new Uint8Array(await f.arrayBuffer()),
    }))
  )
  if (!feed) return null
  return new File([feed.zip as BlobPart], feed.name, { lastModified: Math.max(...files.map((f) => f.lastModified)) })
}
