const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    out += (TABLE[a >> 2] ?? '') + (TABLE[((a & 3) << 4) | (b >> 4)] ?? '')
    out += i + 1 < bytes.length ? (TABLE[((b & 15) << 2) | (c >> 6)] ?? '') : '='
    out += i + 2 < bytes.length ? (TABLE[c & 63] ?? '') : '='
  }
  return out
}

export function packCells(cells: readonly (readonly [number, number, number])[]): string {
  const bytes = new Uint8Array(cells.length * 12)
  const view = new DataView(bytes.buffer)
  cells.forEach(([code, foreground, background], index) => {
    view.setUint32(index * 12, code, true)
    view.setUint32(index * 12 + 4, foreground, true)
    view.setUint32(index * 12 + 8, background, true)
  })
  return encodeBase64(bytes)
}
