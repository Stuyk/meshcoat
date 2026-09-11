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
  if (thumbTarget) return
  thumbTarget = new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType })
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
  if (!thumbTarget || !thumbScene || !thumbCamera || !thumbMaterial || !thumbCanvas || !thumbCtx) return ''

  thumbMaterial.map = texture
  const prevTarget = renderer.getRenderTarget()
  renderer.setRenderTarget(thumbTarget)
  renderer.render(thumbScene, thumbCamera)
  renderer.setRenderTarget(prevTarget)

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
