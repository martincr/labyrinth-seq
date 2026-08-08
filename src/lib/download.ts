// Copied verbatim from the mc-202 project (src/lib/download.ts).
// Kept in sync by hand; if you change it here, consider porting back.

// The only place in the export path that touches the DOM, so everything that
// builds a file stays pure and testable.

function clickDownload(href: string, filename: string, revoke = false) {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  if (revoke) URL.revokeObjectURL(href)
}

export function downloadBlob(blob: Blob, filename: string) {
  clickDownload(URL.createObjectURL(blob), filename, true)
}

export function downloadDataUri(dataUri: string, filename: string) {
  clickDownload(dataUri, filename)
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
  // Copy into a fresh ArrayBuffer so the Blob never sees a SharedArrayBuffer
  // view, which the BlobPart types reject.
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  downloadBlob(new Blob([copy.buffer], { type }), filename)
}

export function downloadJson(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename)
}
