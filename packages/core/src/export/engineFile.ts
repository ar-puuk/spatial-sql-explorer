// Spec 010 (research.md, S7/S9): in DuckDB-WASM 1.5.6 the extension writers
// (GDAL's COPY … (FORMAT GDAL), used for FlatGeobuf, and the excel
// extension's FORMAT xlsx) put one
// garbage byte in front of every file they write; the rest is byte-identical
// to native DuckDB's output. DuckDB's own CSV, Parquet and JSON writers are
// clean. Each file is checked against its format's signature: at byte 0 it is
// used as is (the bug fixed upstream), at byte 1 the stray byte is dropped,
// anywhere else the export stops rather than hand over a broken file.

/** How a written file starts. */
const SIGNATURES: Record<string, (b: Uint8Array, at: number) => boolean> = {
  fgb: (b, at) => b[at] === 0x66 && b[at + 1] === 0x67 && b[at + 2] === 0x62 && b[at + 3] === 0x03,
  // A zip package (xlsx).
  xlsx: (b, at) => b[at] === 0x50 && b[at + 1] === 0x4b && b[at + 2] === 0x03 && b[at + 3] === 0x04,
}

/** The file's bytes without the engine's stray first byte; throws when the file isn't the format at all. */
export function cleanEngineFile(bytes: Uint8Array, kind: string, name = kind): Uint8Array {
  const signed = SIGNATURES[kind]
  if (!signed) return bytes
  if (signed(bytes, 0)) return bytes
  if (bytes.length > 1 && signed(bytes, 1)) return bytes.subarray(1)
  throw new Error(`The engine wrote an unreadable ${name} file.`)
}
