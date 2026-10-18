// Spec 013: a dropped folder (a File Geodatabase is one) arrives as a directory
// entry, not as files. This lists every file in it and gives each its path
// inside the folder (`network.gdb/a00000001.gdbtable`), the way a folder picker does.

const PAGE = 100

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const next = (): void =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all)
        all.push(...batch)
        next()
      }, reject)
    next()
  })
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry)
    Object.defineProperty(file, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') })
    out.push(file)
    return
  }
  const children = await readAll((entry as FileSystemDirectoryEntry).createReader())
  for (let i = 0; i < children.length; i += PAGE) await Promise.all(children.slice(i, i + PAGE).map((child) => walk(child, out)))
}

/** True when something dropped is a folder. */
export function dropHasFolder(items: DataTransferItemList | undefined): boolean {
  return !!items && [...items].some((item) => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory)
}

/** The dropped files; the files inside dropped folders come with their paths. */
export async function filesFromDrop(items: DataTransferItemList, plain: FileList): Promise<File[]> {
  if (!dropHasFolder(items)) return Array.from(plain)
  // Entries must be taken synchronously from the event; walking them is async.
  const entries = [...items].map((item) => item.webkitGetAsEntry?.() ?? null).filter((e): e is FileSystemEntry => e !== null)
  const out: File[] = []
  for (const entry of entries) await walk(entry, out)
  return out
}
