import * as THREE from 'three'
import type { FillOptions } from '../paint/paintEngine'
import type { PaintChannel } from '../paint/channels'
import { asyncLoadTexture } from '../utils/textureLoad'
import { toAssetUrl } from '../utils/assetUrl'
import { unpackOrmDataUrl } from '../paint/exportTexture'
import type { PaintPiece, InitialPbrTextures } from './viewportTypes'
import type { ViewportRuntime } from './viewportRuntime'

/**
 * Bakes a set of loaded maps into a piece's background layer. Shared by the
 * import wizard and by whatever textures an imported file already carried.
 */
export function fillPieceFromTextures(
  rt: ViewportRuntime,
  piece: PaintPiece,
  channelTextures: Partial<Record<PaintChannel, THREE.Texture>>,
  /** Restrict the fill to these faces (one material slot's range). */
  faces?: Set<number> | null,
  /** Flat colour for a slot that has no base-color map of its own. */
  flatColor?: THREE.Color | null
): void {
  const baseLayer = piece.stack.layers[0]
  if (!baseLayer) {
    return
  }
  const { baseColor, ...dataMaps } = channelTextures
  const restrict = faces && faces.size > 0 ? faces : null
  let filled = false

  const apply = (options: FillOptions): void => {
    if (restrict) {
      baseLayer.engine.fillFaces(restrict, options)
    } else {
      baseLayer.engine.fill(options)
    }
    filled = true
  }

  // Base color has to travel as the fill's `texture`, NOT as a channel map:
  // the paint shader samples base color only from uBrushTexture (see
  // applyChannelPayload — a baseColor entry in channelMaps is deliberately
  // dropped there), so passing an imported color map as a channel map fills
  // flat white and the import looks like it did nothing.
  if (baseColor) {
    apply({
      texture: baseColor,
      // Scale 1 = raw UV: an imported map is authored in this model's own UV
      // layout, so it must land texel-for-texel rather than tiled.
      scale: 1,
      color: new THREE.Color(0xffffff),
      alpha: 1,
      channels: { baseColor: { color: new THREE.Color(0xffffff), alpha: 1 } }
    })
  } else if (flatColor) {
    // A material slot with no texture still has a colour, and it is the
    // model's own look — laying it down beats leaving that slot's faces on
    // the default grey background.
    apply({
      color: flatColor,
      alpha: 1,
      channels: { baseColor: { color: flatColor, alpha: 1 } }
    })
  }

  // The data channels do sample their own maps, and go in one pass of their
  // own so the base color image can't mask them through texSample.a.
  const dataChannels = Object.keys(dataMaps) as PaintChannel[]
  if (dataChannels.length > 0) {
    apply({
      channelMaps: dataMaps,
      scale: 1,
      alpha: 1,
      channels: {
        ...(dataMaps.roughness ? { roughness: 1 } : {}),
        ...(dataMaps.metalness ? { metalness: 1 } : {}),
        ...(dataMaps.normal ? { normal: 1 } : {})
      }
    })
  }

  if (!filled) {
    return
  }

  // A multi-piece model is very often UV-mapped into one shared atlas, and
  // every piece was just handed that whole sheet. Clipping each piece to its
  // own UV coverage is what separates them back out into independent texture
  // sets: without it a piece carries its neighbours' islands, painting one
  // leaves the others' artwork sitting underneath, and a per-piece export
  // writes the entire atlas. Harmless for a model whose pieces each own the
  // full 0-1 square, since everything outside a piece's islands is unused.
  if (rt.pieces.length > 1) {
    baseLayer.engine.clipToCoverage()
  }

  piece.stack.recomposite()
}

export async function applyPbrTexturesToPiece(
  rt: ViewportRuntime,
  piece: PaintPiece,
  texMap: InitialPbrTextures
): Promise<void> {
  if (!piece.stack || piece.stack.layers.length === 0) {
    return
  }
  const channelTextures: Partial<Record<PaintChannel, THREE.Texture>> = {}

  /**
   * An imported map is authored in this model's UV layout, so it is sampled
   * 1:1 rather than tiled — clamping keeps the outermost texel from wrapping
   * around to the opposite edge of the sheet along every UV seam.
   */
  const prepare = (tex: THREE.Texture, srgb: boolean): THREE.Texture => {
    // Every model's UVs are normalized to a bottom-left origin at import
    // (modelLoader.ts), which is the origin TextureLoader's own flip already
    // produces — so an external map needs no further compensation.
    tex.flipY = true
    // Data maps carry numbers, not something to look at: decoding them as
    // sRGB would bend every roughness/metalness/normal value.
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }

  if (texMap.baseColor) {
    channelTextures.baseColor = prepare(await asyncLoadTexture(texMap.baseColor), true)
  }
  if (texMap.roughness) {
    channelTextures.roughness = prepare(await asyncLoadTexture(texMap.roughness), false)
  }
  if (texMap.metalness) {
    channelTextures.metalness = prepare(await asyncLoadTexture(texMap.metalness), false)
  }
  if (texMap.normal) {
    channelTextures.normal = prepare(await asyncLoadTexture(texMap.normal), false)
  }

  if (texMap.orm && (!channelTextures.roughness || !channelTextures.metalness)) {
    try {
      const isDirectUrl =
        texMap.orm.startsWith('asset-file://') ||
        texMap.orm.startsWith('data:') ||
        texMap.orm.startsWith('blob:')
      const ormUrl = isDirectUrl ? texMap.orm : toAssetUrl(texMap.orm)
      const unpacked = await unpackOrmDataUrl(ormUrl)
      if (!channelTextures.roughness && unpacked.roughness) {
        channelTextures.roughness = prepare(await asyncLoadTexture(unpacked.roughness), false)
      }
      if (!channelTextures.metalness && unpacked.metalness) {
        channelTextures.metalness = prepare(await asyncLoadTexture(unpacked.metalness), false)
      }
    } catch (e) {
      console.error('Failed to unpack initial ORM map:', e)
    }
  }

  fillPieceFromTextures(rt, piece, channelTextures)
}
