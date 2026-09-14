import * as THREE from 'three'

/**
 * Reads a render target back to a PNG data URL. WebGL render targets store
 * row 0 at the bottom (GL convention) while Canvas ImageData expects row 0
 * at the top, so rows are flipped during the copy or the exported image
 * would come out upside down.
 */
export function renderTargetToPngDataUrl(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget
): string {
  const width = target.width
  const height = target.height
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable for export')
  }

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

/**
 * Packs roughness and metalness into the industry-standard ORM map that
 * Unreal, Unity HDRP and glTF all expect:
 *
 *   R = ambient occlusion, G = roughness, B = metalness
 *
 * One texture instead of three halves the sampler count and the download size
 * in an engine, which is why every pipeline asks for it. There is no baked AO
 * channel in this app, so R is written fully white (no occlusion) rather than
 * left black — black would darken every surface the moment the map is plugged
 * in, which reads as a broken export rather than an absent AO pass.
 *
 * Either input may be null (that channel was never painted); it then falls back
 * to its neutral default — fully rough, fully dielectric.
 */
export function packOrmDataUrl(
  renderer: THREE.WebGLRenderer,
  roughnessTarget: THREE.WebGLRenderTarget | null,
  metalnessTarget: THREE.WebGLRenderTarget | null,
  size: number
): string {
  const readChannel = (target: THREE.WebGLRenderTarget | null, fallback: number): Uint8Array => {
    const out = new Uint8Array(size * size * 4)
    if (!target) {
      out.fill(fallback)
      return out
    }
    renderer.readRenderTargetPixels(target, 0, 0, size, size, out)
    return out
  }

  const rough = readChannel(roughnessTarget, 255)
  const metal = readChannel(metalnessTarget, 0)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable for export')
  }
  const imageData = ctx.createImageData(size, size)
  const rowBytes = size * 4

  for (let y = 0; y < size; y++) {
    // Same bottom-row-first flip as renderTargetToPngDataUrl.
    const srcStart = (size - 1 - y) * rowBytes
    for (let x = 0; x < size; x++) {
      const src = srcStart + x * 4
      const dst = y * rowBytes + x * 4
      imageData.data[dst] = 255
      imageData.data[dst + 1] = rough[src]
      imageData.data[dst + 2] = metal[src]
      imageData.data[dst + 3] = 255
    }
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(new Error(`Failed to load image for export: ${e}`))
    img.src = src
  })
}

/**
 * Turns a coverage mask (white = covered, rendered opaque) into a canvas whose
 * ALPHA carries the coverage, which is what `destination-in` compositing needs.
 */
async function maskToAlphaCanvas(maskUrl: string, size: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(maskUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable for export')
  }
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    // The mask is rendered white-on-black with alpha 1 everywhere, so coverage
    // lives in RGB, not in alpha. Red alone is enough, and the edge texels are
    // antialiased — keeping that gradient feathers the seam between pieces
    // instead of leaving a hard stair-stepped join.
    px[i + 3] = px[i]
    px[i] = 255
    px[i + 1] = 255
    px[i + 2] = 255
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/**
 * Merges one map per piece into a single atlas image, each piece clipped to its
 * own UV coverage.
 *
 * Plain stacking cannot work here: a flat fill (every layer's background
 * included) writes the whole square opaquely, so the last piece drawn would
 * erase every piece beneath it. `background` is what the untouched parts of the
 * sheet resolve to — transparent for base color, the channel's neutral value
 * for a data map, so an engine reads "nothing here" rather than black.
 */
export async function combineMaskedDataUrls(
  entries: { url: string | undefined | null; maskUrl: string | undefined | null }[],
  size: number,
  background?: string
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable for export')
  }

  ctx.clearRect(0, 0, size, size)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, size, size)
  }

  for (const entry of entries) {
    if (!entry.url) {
      continue
    }
    const img = await loadImage(entry.url)
    if (!entry.maskUrl) {
      ctx.drawImage(img, 0, 0, size, size)
      continue
    }
    const layer = document.createElement('canvas')
    layer.width = size
    layer.height = size
    const lctx = layer.getContext('2d')
    if (!lctx) {
      throw new Error('2D canvas context unavailable for export')
    }
    lctx.drawImage(img, 0, 0, size, size)
    lctx.globalCompositeOperation = 'destination-in'
    lctx.drawImage(await maskToAlphaCanvas(entry.maskUrl, size), 0, 0)
    ctx.drawImage(layer, 0, 0)
  }

  return canvas.toDataURL('image/png')
}

/**
 * Combines multiple PNG data URLs onto a single canvas in array order.
 * Used when multiple mesh pieces share the same UV layout (atlas / shared UVs).
 */
export async function combineDataUrls(
  dataUrls: (string | undefined | null)[],
  width: number,
  height: number
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable for export')
  }

  ctx.clearRect(0, 0, width, height)
  for (const url of dataUrls) {
    if (!url) {
      continue
    }
    const img = await loadImage(url)
    ctx.drawImage(img, 0, 0, width, height)
  }
  return canvas.toDataURL('image/png')
}

/**
 * Packs separate Roughness, Metalness, and AO data URLs into a single ORM texture:
 * R = AO, G = Roughness, B = Metalness, A = 255.
 */
export async function packOrmFromDataUrls(
  roughnessUrl: string | null | undefined,
  metalnessUrl: string | null | undefined,
  aoUrl: string | null | undefined,
  size: number
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable for export')
  }

  const getImagePixels = async (
    url: string | null | undefined,
    fallback: number
  ): Promise<Uint8ClampedArray> => {
    if (!url) {
      const arr = new Uint8ClampedArray(size * size * 4)
      arr.fill(fallback)
      return arr
    }
    const img = await loadImage(url)
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const cx = c.getContext('2d')!
    cx.drawImage(img, 0, 0, size, size)
    return cx.getImageData(0, 0, size, size).data
  }

  const [roughData, metalData, aoData] = await Promise.all([
    getImagePixels(roughnessUrl, 255),
    getImagePixels(metalnessUrl, 0),
    getImagePixels(aoUrl, 255)
  ])

  const out = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4
    out.data[idx] = aoData[idx] // Red = AO
    out.data[idx + 1] = roughData[idx] // Green = Roughness
    out.data[idx + 2] = metalData[idx] // Blue = Metalness
    out.data[idx + 3] = 255 // Alpha = 255
  }
  ctx.putImageData(out, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Extracts Roughness (Green) and Metalness (Blue) maps from an ORM texture into PNG data URLs.
 */
export async function unpackOrmDataUrl(
  src: string
): Promise<{ roughness: string; metalness: string }> {
  const img = await loadImage(src)
  const width = img.naturalWidth || 2048
  const height = img.naturalHeight || 2048

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable')
  }
  ctx.drawImage(img, 0, 0)
  const imgData = ctx.getImageData(0, 0, width, height)
  const pixels = imgData.data

  // Roughness canvas (Green channel replicated across RGB)
  const roughCanvas = document.createElement('canvas')
  roughCanvas.width = width
  roughCanvas.height = height
  const roughCtx = roughCanvas.getContext('2d')!
  const roughImgData = roughCtx.createImageData(width, height)
  for (let i = 0; i < pixels.length; i += 4) {
    const g = pixels[i + 1]
    roughImgData.data[i] = g
    roughImgData.data[i + 1] = g
    roughImgData.data[i + 2] = g
    roughImgData.data[i + 3] = 255
  }
  roughCtx.putImageData(roughImgData, 0, 0)

  // Metalness canvas (Blue channel replicated across RGB)
  const metalCanvas = document.createElement('canvas')
  metalCanvas.width = width
  metalCanvas.height = height
  const metalCtx = metalCanvas.getContext('2d')!
  const metalImgData = metalCtx.createImageData(width, height)
  for (let i = 0; i < pixels.length; i += 4) {
    const b = pixels[i + 2]
    metalImgData.data[i] = b
    metalImgData.data[i + 1] = b
    metalImgData.data[i + 2] = b
    metalImgData.data[i + 3] = 255
  }
  metalCtx.putImageData(metalImgData, 0, 0)

  return {
    roughness: roughCanvas.toDataURL('image/png'),
    metalness: metalCanvas.toDataURL('image/png')
  }
}
