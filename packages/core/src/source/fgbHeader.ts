// FlatGeobuf header facts (spec 007 FR-001): the envelope and feature count
// sit in the file's first bytes, so a 1.45 GB file's extent is known without
// a scan (ST_Read_Meta gives the count and CRS but no extent). Written from
// the FlatGeobuf specification (https://flatgeobuf.org, header.fbs), not
// copied code (Constitution VIII).
//
// Layout: 8-byte magic ("fgb" 0x03 "fgb" version), uint32 header size, then
// the Header table as a size-prefixed FlatBuffer. Fields used here:
// 1 envelope:[double], 8 features_count:ulong, 9 index_node_size:ushort.

export interface FgbHeader {
  /** [minX, minY, maxX, maxY] in the file's CRS, or null when absent. */
  envelope: [number, number, number, number] | null
  featuresCount: number | null
  /** 0 = no spatial index. */
  indexNodeSize: number
}

/** Bytes needed before parsing: the magic and the size prefix. */
export const FGB_PREFIX_BYTES = 12

export function fgbHeaderSize(prefix: Uint8Array): number {
  if (prefix.length < FGB_PREFIX_BYTES || prefix[0] !== 0x66 || prefix[1] !== 0x67 || prefix[2] !== 0x62 || prefix[4] !== 0x66 || prefix[5] !== 0x67 || prefix[6] !== 0x62) {
    throw new Error('Not a FlatGeobuf file (bad magic bytes).')
  }
  return new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(8, true)
}

/** Parses the header from the file's first `FGB_PREFIX_BYTES + fgbHeaderSize()` bytes. */
export function parseFgbHeader(bytes: Uint8Array): FgbHeader {
  const size = fgbHeaderSize(bytes)
  if (bytes.length < FGB_PREFIX_BYTES + size) throw new Error('FlatGeobuf header is truncated.')
  const v = new DataView(bytes.buffer, bytes.byteOffset + FGB_PREFIX_BYTES, size)
  const table = v.getUint32(0, true)
  const vtable = table - v.getInt32(table, true)
  const vtableSize = v.getUint16(vtable, true)
  const fieldOffset = (id: number): number => {
    const at = 4 + id * 2
    return at < vtableSize ? v.getUint16(vtable + at, true) : 0
  }

  let envelope: FgbHeader['envelope'] = null
  const env = fieldOffset(1)
  if (env) {
    const vec = table + env + v.getUint32(table + env, true)
    const n = v.getUint32(vec, true)
    if (n >= 4) {
      const d = (i: number): number => v.getFloat64(vec + 4 + i * 8, true)
      envelope = [d(0), d(1), d(2), d(3)]
    }
  }
  const count = fieldOffset(8)
  const featuresCount = count ? Number(v.getBigUint64(table + count, true)) : null
  const nodes = fieldOffset(9)
  // index_node_size defaults to 16 in the schema when the field is absent.
  const indexNodeSize = nodes ? v.getUint16(table + nodes, true) : 16
  return { envelope, featuresCount, indexNodeSize }
}
