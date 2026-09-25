import * as THREE from 'three'

const THUMB_SIZE = 64

let thumbTarget: THREE.WebGLRenderTarget | undefined
let thumbScene: THREE.Scene | undefined
let thumbCamera: THREE.OrthographicCamera | undefined
let thumbQuad: THREE.Mesh | undefined
let thumbMaterial: THREE.MeshBasicMaterial | undefined
let thumbCanvas: HTMLCanvasElement | undefined
let thumbCtx: CanvasRenderingContext2D | undefined

function ensureSetup(): void {
  if (thumbTarget) {
    return
  }
  thumbTarget = new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType
  })
  thumbScene = new THREE.Scene()
  thumbCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  // The source texture is stored premultiplied (see paintShader.ts); telling
  // the material so lets it use the matching premultiplied blend function
  // instead of double-applying alpha.
  thumbMaterial = new THREE.MeshBasicMaterial({ transparent: true, premultipliedAlpha: true })
  thumbQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), thumbMaterial)
  thumbScene.add(thumbQuad)
  thumbCanvas = document.createElement('canvas')
  thumbCanvas.width = THUMB_SIZE
  thumbCanvas.height = THUMB_SIZE
  thumbCtx = thumbCanvas.getContext('2d') ?? undefined
}

/** Cheap low-res readback used for layer-stack thumbnails, refreshed on every stroke. */
export function renderThumbnail(renderer: THREE.WebGLRenderer, texture: THREE.Texture): string {
  ensureSetup()
  if (!thumbTarget || !thumbScene || !thumbCamera || !thumbMaterial || !thumbCanvas || !thumbCtx) {
    return ''
  }

  thumbMaterial.map = texture
  const prevTarget = renderer.getRenderTarget()
  const prevClearColor = new THREE.Color()
  renderer.getClearColor(prevClearColor)
  const prevClearAlpha = renderer.getClearAlpha()
  // Without an explicit transparent clear here, an empty layer (alpha 0
  // everywhere) inherits whatever the renderer's ambient clear color/alpha
  // happens to be — typically opaque black — so its thumbnail renders as a
  // solid filled square instead of see-through, misleadingly suggesting the
  // layer actually has content.
  renderer.setClearColor(0x000000, 0)
  renderer.setRenderTarget(thumbTarget)
  renderer.clear(true, true, true)
  renderer.render(thumbScene, thumbCamera)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevClearColor, prevClearAlpha)

  const pixels = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 4)
  renderer.readRenderTargetPixels(thumbTarget, 0, 0, THUMB_SIZE, THUMB_SIZE, pixels)

  const imageData = thumbCtx.createImageData(THUMB_SIZE, THUMB_SIZE)
  const rowBytes = THUMB_SIZE * 4
  for (let y = 0; y < THUMB_SIZE; y++) {
    const srcStart = (THUMB_SIZE - 1 - y) * rowBytes
    for (let x = 0; x < THUMB_SIZE; x++) {
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
  thumbCtx.putImageData(imageData, 0, 0)
  return thumbCanvas.toDataURL('image/png')
}

let viewTarget: THREE.WebGLRenderTarget | undefined
let viewPixels: Uint8Array | undefined
let viewImage: ImageData | undefined

/**
 * Larger sibling of renderThumbnail for the 2D paint panel: resamples
 * `texture` to `size`² and returns straight-alpha ImageData (reused between
 * calls, so a live-refreshing panel doesn't allocate a frame's worth of
 * pixels every refresh).
 */
export function renderTextureToImageData(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Texture,
  size: number
): ImageData | null {
  ensureSetup()
  if (!thumbScene || !thumbCamera || !thumbMaterial) {
    return null
  }
  if (!viewTarget || viewTarget.width !== size) {
    viewTarget?.dispose()
    viewTarget = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType
    })
    viewPixels = new Uint8Array(size * size * 4)
    viewImage = new ImageData(size, size)
  }
  const pixels = viewPixels!
  const image = viewImage!

  thumbMaterial.map = texture
  const prevTarget = renderer.getRenderTarget()
  const prevClearColor = new THREE.Color()
  renderer.getClearColor(prevClearColor)
  const prevClearAlpha = renderer.getClearAlpha()
  renderer.setClearColor(0x000000, 0)
  renderer.setRenderTarget(viewTarget)
  renderer.clear(true, true, true)
  renderer.render(thumbScene, thumbCamera)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevClearColor, prevClearAlpha)
  renderer.readRenderTargetPixels(viewTarget, 0, 0, size, size, pixels)

  // Flip to top-down rows and un-premultiply (see renderThumbnail).
  const rowBytes = size * 4
  const out = image.data
  for (let y = 0; y < size; y++) {
    const srcStart = (size - 1 - y) * rowBytes
    const dstStart = y * rowBytes
    for (let x = 0; x < rowBytes; x += 4) {
      const src = srcStart + x
      const dst = dstStart + x
      const a = pixels[src + 3]
      if (a > 0) {
        out[dst] = Math.min(255, Math.round((pixels[src] * 255) / a))
        out[dst + 1] = Math.min(255, Math.round((pixels[src + 1] * 255) / a))
        out[dst + 2] = Math.min(255, Math.round((pixels[src + 2] * 255) / a))
      } else {
        out[dst] = out[dst + 1] = out[dst + 2] = 0
      }
      out[dst + 3] = a
    }
  }
  return image
}
