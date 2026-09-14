import * as THREE from 'three'
import { toAssetUrl } from '../utils/assetUrl'

/**
 * Snaps a pixel dimension to a canvas size the app actually supports. Painting
 * at the source map's own resolution is what keeps an imported texture
 * pixel-exact: a 2048 atlas rebuilt on a 4096 canvas is resampled up on the
 * way in and back down on export, softening every edge in the artwork, and it
 * costs four times the GPU memory to do it.
 */
export function snapToCanvasSize(pixels: number): number {
  const sizes = [512, 1024, 2048, 4096, 8192]
  let best = sizes[0]
  for (const size of sizes) {
    if (size <= pixels) {
      best = size
    }
  }
  return best
}

/** Reads an image's pixel dimensions without decoding it into a GPU texture. */
export function probeImageSize(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    // TGA can't be measured by an <img>; those fall back to the chosen size.
    if (/\.tga$/i.test(path)) {
      resolve(null)
      return
    }
    const isDirect = /^(asset-file:|data:|blob:)/.test(path)
    const img = new Image()
    img.onload = () => resolve(Math.max(img.naturalWidth, img.naturalHeight) || null)
    img.onerror = () => resolve(null)
    img.src = isDirect ? path : toAssetUrl(path)
  })
}

/** Native size of whatever maps a mesh's material slots already carry. */
export function embeddedMapSize(mesh: THREE.Mesh): number | null {
  const slots = (
    Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  ) as THREE.MeshStandardMaterial[]
  let largest = 0
  for (const slot of slots) {
    for (const map of [slot?.map, slot?.roughnessMap, slot?.metalnessMap, slot?.normalMap]) {
      const img = map?.image as { width?: number; height?: number } | undefined
      if (img?.width) {
        largest = Math.max(largest, img.width, img.height ?? 0)
      }
    }
  }
  return largest > 0 ? snapToCanvasSize(largest) : null
}
