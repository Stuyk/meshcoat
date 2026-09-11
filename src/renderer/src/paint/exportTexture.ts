import * as THREE from 'three'

/**
 * Reads a render target back to a PNG data URL. WebGL render targets store
 * row 0 at the bottom (GL convention) while Canvas ImageData expects row 0
 * at the top, so rows are flipped during the copy or the exported image
 * would come out upside down.
 */
export function renderTargetToPngDataUrl(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): string {
  const width = target.width
  const height = target.height
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for export')

  // The render target stores premultiplied color (see paintShader.ts), but
  // Canvas ImageData is straight/non-premultiplied — undo it per pixel or
  // any translucent area exports too dark.
  const imageData = ctx.createImageData(width, height)
  const rowBytes = width * 4
  for (let y = 0; y < height; y++) {
    const srcStart = (height - 1 - y) * rowBytes
    for (let x = 0; x < width; x++) {
      const src = srcStart + x * 4
      const dst = y * rowBytes + x * 4
      const a = pixels[src + 3]
      if (a > 0) {
        imageData.data[dst] = Math.min(255, Math.round((pixels[src] * 255) / a))
        imageData.data[dst + 1] = Math.min(255, Math.round((pixels[src + 1] * 255) / a))
        imageData.data[dst + 2] = Math.min(255, Math.round((pixels[src + 2] * 255) / a))
      }
      imageData.data[dst + 3] = a
    }
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}
