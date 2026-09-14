import * as THREE from 'three'
import { toAssetUrl } from './assetUrl'

/**
 * Loads a texture from a shelf path, dispatching on format.
 *
 * Chromium's image decoder — which `THREE.TextureLoader` rides on — has no TGA
 * support, and texture packs regularly ship a `.tga` albedo alongside `.png`
 * roughness/normal maps. Routing those through three's own TGALoader is the
 * difference between such a material painting its color and silently painting
 * nothing at all.
 */
export function loadPaintTexture(
  loader: THREE.TextureLoader,
  path: string,
  onLoad: (texture: THREE.Texture) => void
): void {
  const url = toAssetUrl(path)
  if (!/\.tga$/i.test(path)) {
    loader.load(url, onLoad)
    return
  }
  // Imported on demand so the decoder isn't parsed at boot for the (common)
  // case of a project that never touches a TGA.
  void import('three/examples/jsm/loaders/TGALoader.js').then(({ TGALoader }) => {
    new TGALoader().load(url, onLoad)
  })
}

/** Asynchronously loads a texture by file path or asset URL, handling TGA and standard image formats. */
export async function asyncLoadTexture(pathOrUrl: string): Promise<THREE.Texture> {
  const isDirectUrl =
    pathOrUrl.startsWith('asset-file://') ||
    pathOrUrl.startsWith('data:') ||
    pathOrUrl.startsWith('blob:')
  const url = isDirectUrl ? pathOrUrl : toAssetUrl(pathOrUrl)
  if (/\.tga$/i.test(pathOrUrl)) {
    const { TGALoader } = await import('three/examples/jsm/loaders/TGALoader.js')
    return await new TGALoader().loadAsync(url)
  }
  return await new THREE.TextureLoader().loadAsync(url)
}

/** True for formats an <img> tag can display — the shelf's thumbnails. */
export function isBrowserDisplayable(path: string): boolean {
  return !/\.tga$/i.test(path)
}
