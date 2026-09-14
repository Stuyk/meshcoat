import * as THREE from 'three'

/**
 * The PBR channels a layer can carry. Every channel is stored exactly the way
 * base color has always been stored — an RGBA8 render target holding
 * premultiplied values, alpha = per-texel coverage — so the whole existing
 * pipeline (paint shader, dilate, blend compositing, blit, CPU snapshots) works
 * on all four without a second code path. What differs per channel is only:
 *
 *   - its color space (base color is sRGB, the data channels are linear), and
 *   - the constant the layer stack flattens the finished composite against,
 *     since MeshStandardMaterial samples a map with no notion of coverage.
 *
 * Flat-texture projects stay exactly as cheap as before: a layer allocates a
 * channel's ping-pong pair only when a stroke actually writes to that channel
 * (see PaintEngine.ensureChannel), so a base-color-only project allocates
 * base-color-only buffers and its undo snapshots carry base color only.
 */
export const PAINT_CHANNELS = ['baseColor', 'roughness', 'metalness', 'normal'] as const

export type PaintChannel = (typeof PAINT_CHANNELS)[number]

/** The three channels that are not base color — the ones lazily allocated. */
export const PBR_CHANNELS = ['roughness', 'metalness', 'normal'] as const
export type PbrChannel = (typeof PBR_CHANNELS)[number]

export interface ChannelSpec {
  label: string
  /** Short form for HUD pills / export suffixes. */
  short: string
  /**
   * sRGB for base color (it is looked at), NoColorSpace for the data channels
   * (roughness/metalness/normal are numbers, and gamma-encoding them would
   * silently bend every value the artist dialled in).
   */
  colorSpace: THREE.ColorSpace
  /**
   * What an unpainted texel resolves to once the stack is flattened for the
   * material. Base color has none — its background is the bottom layer's own
   * base color, as it has always been.
   */
  flattenDefault: THREE.Vector4 | null
  /** Filename suffix used by the PBR export set. */
  exportSuffix: string
  /** true = the channel is a direction, not a magnitude (needs re-normalizing). */
  vector: boolean
}

export const CHANNEL_SPECS: Record<PaintChannel, ChannelSpec> = {
  baseColor: {
    label: 'Base Color',
    short: 'Color',
    colorSpace: THREE.SRGBColorSpace,
    flattenDefault: null,
    exportSuffix: 'BaseColor',
    vector: false
  },
  roughness: {
    label: 'Roughness',
    short: 'Rough',
    colorSpace: THREE.NoColorSpace,
    // Fully rough — an unpainted surface should look like raw matte material,
    // not a mirror, which is what a 0 default would give.
    flattenDefault: new THREE.Vector4(1, 1, 1, 1),
    exportSuffix: 'Roughness',
    vector: false
  },
  metalness: {
    label: 'Metalness',
    short: 'Metal',
    colorSpace: THREE.NoColorSpace,
    flattenDefault: new THREE.Vector4(0, 0, 0, 1),
    exportSuffix: 'Metallic',
    vector: false
  },
  normal: {
    label: 'Normal',
    short: 'Normal',
    colorSpace: THREE.NoColorSpace,
    // Neutral tangent-space normal (0,0,1) in the usual 0.5-biased encoding.
    flattenDefault: new THREE.Vector4(0.5, 0.5, 1, 1),
    exportSuffix: 'Normal',
    vector: true
  }
}

/** Which channels a brush stroke writes, and the value it writes to each. */
export interface ChannelPayload {
  baseColor?: { color: THREE.Color; alpha: number }
  roughness?: number
  metalness?: number
  /**
   * Normal-map strength. Positive embosses the dab's own shape outward,
   * negative engraves it. 0 disables the channel for this stroke.
   */
  normal?: number
}

/** Channels this payload actually writes, in canonical order. */
export function payloadChannels(payload: ChannelPayload): PaintChannel[] {
  return PAINT_CHANNELS.filter((c) => payload[c] !== undefined)
}

export function createChannelRenderTarget(
  size: number,
  channel: PaintChannel
): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: CHANNEL_SPECS[channel].colorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  })
}
