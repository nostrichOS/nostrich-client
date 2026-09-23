import qrcode from 'qrcode-generator'

/** A QR code as ONE SVG path, shared by both platforms. */
export function qrPath(value: string): { d: string; count: number } {
  // 0 = pick the smallest version that fits the data.
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const count = qr.getModuleCount()
  const parts: string[] = []
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`)
    }
  }
  return { d: parts.join(''), count }
}
