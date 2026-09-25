import { applyUvDab, type UvDab } from './brushMask'
import * as THREE from 'three'
import { buildUvMesh } from './uvMesh'
import { createPaintMaterial } from './paintShader'
import { createEdgeWearMaterial } from './edgeWearShader'
import { createEffectMaterial, EFFECT_MODE_INDEX, type EffectMode } from './effectShader'
import {
  CHANNEL_SPECS,
  PAINT_CHANNELS,
  createChannelRenderTarget,
  payloadChannels,
  type ChannelPayload,
  type PaintChannel
} from './channels'
import type { SurfaceHit } from '../viewport/raycast'

export const DEFAULT_TEXTURE_SIZE = 2048
export const TEXTURE_SIZE_OPTIONS = [512, 1024, 2048, 4096, 8192] as const
export type TextureSize = (typeof TEXTURE_SIZE_OPTIONS)[number]

/**
 * Configures a MeshBasicMaterial to correctly blend a `map` texture that is
 * *already* premultiplied (as every render target in this module stores —
 * see paintShader.ts) at a given opacity. Three.js's own `premultipliedAlpha`
 * flag assumes the opposite (a straight-alpha source it should premultiply
 * itself), which would double-apply alpha here — so this scales color+alpha
 * by `opacity` via the material's tint instead, and switches to the
 * premultiplied-source blend function (ONE, ONE_MINUS_SRC_ALPHA) directly.
 */
export function configurePremultipliedSourceMaterial(
  material: THREE.MeshBasicMaterial,
  opacity: number
): void {
  material.transparent = true
  material.opacity = opacity
  material.color.setScalar(opacity)
  material.blending = THREE.CustomBlending
  material.blendEquation = THREE.AddEquation
  material.blendSrc = THREE.OneFactor
  material.blendDst = THREE.OneMinusSrcAlphaFactor
}

function createRenderTarget(
  size: number,
  channel: PaintChannel = 'baseColor'
): THREE.WebGLRenderTarget {
  return createChannelRenderTarget(size, channel)
}

/** One channel's ping-pong pair. */
interface ChannelBuffers {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
}

const dilateVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Every UV island's own triangle rasterization leaves its outer border texels
// only exactly at the triangle edge — nothing paints *past* it. On the real
// mesh, bilinear filtering (and mip sampling) at that same border reads a
// texel or two beyond it, pulling in whatever's on the far side (background,
// or a different island entirely) and showing up as a dark seam/edge line.
// This bleeds each island's edge color outward by one texel per pass — guided
// by a static coverage mask (1 = inside some UV triangle) so it only pushes
// color into true gutter texels, never mixes two unrelated islands together.
const dilateFragmentShader = /* glsl */ `
  uniform sampler2D uColor;
  uniform sampler2D uMask;
  uniform vec2 uTexelSize;
  varying vec2 vUv;
  void main() {
    float ownMask = texture2D(uMask, vUv).r;
    vec4 ownColor = texture2D(uColor, vUv);
    if (ownMask > 0.5) {
      gl_FragColor = ownColor;
      return;
    }
    vec4 sum = vec4(0.0);
    float count = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        if (x == 0 && y == 0) continue;
        vec2 offset = vec2(float(x), float(y)) * uTexelSize;
        if (texture2D(uMask, vUv + offset).r > 0.5) {
          sum += texture2D(uColor, vUv + offset);
          count += 1.0;
        }
      }
    }
    gl_FragColor = count > 0.0 ? sum / count : ownColor;
  }
`

export interface StrokeParams {
  radius: number
  hardness: number
  opacity: number
  /** Projector reach along the surface normal, as a fraction of `radius`. */
  projectorDepth?: number
  /** Widest surface-vs-brush normal angle (degrees) that still takes paint. */
  maxAngle?: number
  color: THREE.Color
  alpha?: number
  brushTexture?: THREE.Texture | null
  brushTipTexture?: THREE.Texture | null
  textureScale?: number
  /** Sub-rectangle of the source texture to draw from (see brush.textureRegion). */
  textureRegion?: { x: number; y: number; w: number; h: number; rotation: number }
  /** How that region repeats: 'tile' (default), 'mirror', or 'once'. */
  textureRepeat?: 'tile' | 'mirror' | 'once'
  /** true = Stamp tool (whole image projected flat, once per application); false = Texture Brush (world-space tiling). */
  stampMode?: boolean
  /** Texture mapping mode: 'uv' (straightforward) or 'triplanar' (world triplanar). */
  textureMapping?: 'uv' | 'triplanar' | 'tip' | number
  /** Confine this stroke to these triangles (spec: face selection — SurfaceHit.faceIndex), empty/undefined = unrestricted. */
  restrictFaces?: ReadonlySet<number> | null
  /** Rotation angle in radians applied to the brush tip / stamp. */
  angle?: number
  /** Place the dab directly on the texture instead of projecting it (2D panel). */
  uvDab?: UvDab | null
  /** Camera-space occlusion test (see occlusionDepth.ts) — rejects paint on faces not actually visible from the paint camera, null/undefined = unrestricted. */
  occlusion?: OcclusionParams | null
  /** Screen-space stencil to paint through (see stencil.ts); null = unrestricted. */
  stencil?: StencilParams | null
  /**
   * Which PBR channels this stroke writes and with what values (see
   * channels.ts). Omitted = base color only, using `color`/`alpha` — which is
   * exactly the flat-texture behaviour this app has always had.
   */
  channels?: ChannelPayload
  /**
   * Per-channel source maps, when painting with a material set (see
   * materialSets.ts): each channel's pass samples its own map through the same
   * projection, so a set's color, roughness and relief land in register. The
   * base-color map keeps travelling as `brushTexture`, which already tints and
   * masks the stroke the way it always has.
   */
  channelMaps?: ChannelMaps
  /**
   * Erase rather than paint: base color reverts to the layer's own base
   * color/alpha (as it always has), and every other written channel has its
   * coverage taken back to zero so the layer below — or the channel's neutral
   * default — shows through again.
   */
  erase?: boolean
}

export interface StencilParams {
  texture: THREE.Texture
  /** Center (xy) and size (zw) of the stencil rect, in canvas pixels. */
  rect: THREE.Vector4
  rotationRad: number
  invert: boolean
  /**
   * The image carries real transparency. Its alpha is then the shape, not its
   * brightness — a brush PNG is typically black RGB with the shape in alpha,
   * which a luminance mask would read as "nothing here".
   */
  hasAlpha: boolean
  canvasWidth: number
  canvasHeight: number
  /** Camera view-projection, so the shader can place each texel on screen. */
  viewProjMatrix: THREE.Matrix4
}

export interface OcclusionParams {
  depthTexture: THREE.Texture
  /** 1 / depth-map dimensions, for the shader's neighbourhood sampling. */
  texelSize: THREE.Vector2
  viewProjMatrix: THREE.Matrix4
  viewMatrix: THREE.Matrix4
  cameraPosition: THREE.Vector3
  /** +1 normally, -1 when the mesh's normals point the wrong way. */
  normalSign: number
  near: number
  far: number
}

export interface FillOptions {
  color?: THREE.Color
  alpha?: number
  texture?: THREE.Texture | null
  scale?: number
  /** Sub-rectangle of the source texture to draw from (see brush.textureRegion). */
  textureRegion?: { x: number; y: number; w: number; h: number; rotation: number }
  /** How that region repeats: 'tile' (default), 'mirror', or 'once'. */
  textureRepeat?: 'tile' | 'mirror' | 'once'
  /** Fill PBR channels too (see channels.ts); omitted = base color only. */
  channels?: ChannelPayload
  /** Per-channel source maps for a material-set fill (see StrokeParams.channelMaps). */
  channelMaps?: ChannelMaps
  /**
   * Face UV Projector: places the texture on top of the mesh's own UV rather
   * than starting the crop at its raw origin — offset/scale in UV units (1 =
   * one full image width/height), rotation in degrees. Omitted = identity, the
   * previous "fill uses the mesh's UV as-is" behavior.
   */
  projection?: FaceProjectionOptions
}

/**
 * The Face UV Projector transform as the engine consumes it: the artist's
 * offset/scale/rotation, plus — when `fit` is on — the UV bounding box of the
 * faces being filled, which the caller computes because the engine has no
 * access to the triangle list.
 */
export interface FaceProjectionOptions {
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
  rotation: number
  /** Stretch one copy of the crop across `fitRect` instead of tiling at the fill scale. */
  fit?: boolean
  /** UV-space bounds of the target faces: xy = min corner, wh = size. */
  fitRect?: { x: number; y: number; w: number; h: number }
}

/** One texture per channel, for painting with a material set. */
export type ChannelMaps = Partial<Record<PaintChannel, THREE.Texture | null>>

/**
 * Owns the ping-pong render targets for one mesh and paints strokes onto them
 * via the UV-flattened mesh + custom shader (spec section 4.3-4.4).
 *
 * Base color is always allocated. The roughness / metalness / normal pairs are
 * allocated lazily, the first time a stroke or fill actually writes to them
 * (ensureChannel) — so a flat-texture project costs exactly what it always
 * did, in VRAM and in undo snapshots alike, and only a genuinely PBR layer
 * pays for four buffers. Every channel uses the same premultiplied RGBA8
 * storage, so all the machinery below (dilation, blit, snapshots, merging)
 * treats them identically; see channels.ts for what does differ.
 */
export class PaintEngine {
  private renderer: THREE.WebGLRenderer
  private uvMesh: THREE.Mesh
  private material: ReturnType<typeof createPaintMaterial>
  private orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private orthoScene = new THREE.Scene()
  /** Allocated channels, keyed by name. baseColor is always present. */
  private buffers = new Map<PaintChannel, ChannelBuffers>()
  /** Lazily built on first dilate() call — every layer pays for this render
   * pass at construction otherwise, even ones nobody ever paints on. */
  private coverageMask: THREE.WebGLRenderTarget | null = null
  private dilateMaterial: THREE.ShaderMaterial
  private dilateQuad: THREE.Mesh
  private dilateScene = new THREE.Scene()
  /** Lazily built passthrough blit used by copyFrom/createSnapshot/restore —
   * see blit() for why this can't be a MeshBasicMaterial. Reused rather than
   * rebuilt per call: undo/redo runs one of these per layer, and allocating a
   * Scene + Mesh + PlaneGeometry each time adds up on a deep history. */
  private blitMaterial: THREE.ShaderMaterial | null = null
  private blitQuad: THREE.Mesh | null = null
  private blitScene: THREE.Scene | null = null
  /** Lazily built — a layer that never sees the effect brush shouldn't compile its shader. */
  private effectMaterial: ReturnType<typeof createEffectMaterial> | null = null
  /** Color+alpha the eraser reveals — opaque base gray for a background layer, transparent for a stacked one. */
  readonly baseColor: THREE.Color
  readonly baseAlpha: number
  readonly textureSize: number
  /** Bumped on every content-changing operation — cheap way for consumers
   * (e.g. layer thumbnails) to know whether they need to re-render/re-encode
   * without redoing that work unconditionally on every unrelated change. */
  private _contentVersion = 0
  get contentVersion(): number {
    return this._contentVersion
  }

  constructor(
    renderer: THREE.WebGLRenderer,
    mesh: THREE.Mesh,
    baseColor: THREE.Color | null = new THREE.Color(0x999999),
    textureSize: number = DEFAULT_TEXTURE_SIZE
  ) {
    this.renderer = renderer
    this.baseColor = baseColor ?? new THREE.Color(0x000000)
    this.baseAlpha = baseColor ? 1 : 0
    this.textureSize = textureSize
    this.uvMesh = buildUvMesh(mesh)
    this.material = createPaintMaterial()
    this.uvMesh.material = this.material
    this.orthoScene.add(this.uvMesh)

    this.ensureChannel('baseColor')

    this.dilateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: null },
        uMask: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / textureSize, 1 / textureSize) }
      },
      vertexShader: dilateVertexShader,
      fragmentShader: dilateFragmentShader,
      depthTest: false,
      depthWrite: false
    })
    this.dilateQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dilateMaterial)
    this.dilateScene.add(this.dilateQuad)
    // Coverage mask (and its render pass) is built lazily — see ensureCoverageMask().
  }

  /**
   * Allocates a channel's ping-pong pair if it doesn't exist yet, cleared to
   * its starting state: base color to the layer's own base color/alpha (an
   * opaque background layer, a transparent stacked one), every PBR channel to
   * zero coverage — an unpainted PBR texel resolves to that channel's neutral
   * default at flatten time (see LayerStack), never to black.
   */
  private ensureChannel(channel: PaintChannel): ChannelBuffers {
    const existing = this.buffers.get(channel)
    if (existing) {
      return existing
    }

    const read = createRenderTarget(this.textureSize, channel)
    const write = createRenderTarget(this.textureSize, channel)

    // A hardware clear (not a blended quad) so the target's alpha channel ends
    // up exactly right regardless of the renderer's own default clear
    // color/alpha — a transparent (opacity 0) quad can't be trusted to undo
    // whatever autoClear wrote first.
    const clearColor = channel === 'baseColor' ? this.baseColor : new THREE.Color(0x000000)
    const clearAlpha = channel === 'baseColor' ? this.baseAlpha : 0
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(clearColor, clearAlpha)
    this.renderer.setRenderTarget(read)
    this.renderer.clear(true, true, true)
    this.renderer.setRenderTarget(write)
    this.renderer.clear(true, true, true)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)

    const buffers: ChannelBuffers = { read, write }
    this.buffers.set(channel, buffers)
    this._channelsVersion++
    return buffers
  }

  /** Bumped whenever the set of allocated channels changes, so the layer stack
   * knows to (re)bind maps onto the mesh material. */
  private _channelsVersion = 0
  get channelsVersion(): number {
    return this._channelsVersion
  }

  /** Channels this layer actually has buffers for, in canonical order. */
  get allocatedChannels(): PaintChannel[] {
    return PAINT_CHANNELS.filter((c) => this.buffers.has(c))
  }

  hasChannel(channel: PaintChannel): boolean {
    return this.buffers.has(channel)
  }

  /** This layer's own buffer for one channel, or null if it was never painted. */
  textureFor(channel: PaintChannel): THREE.Texture | null {
    return this.buffers.get(channel)?.read.texture ?? null
  }

  /**
   * The render target behind textureFor — what a readback needs. Deliberately
   * does NOT allocate: asking to inspect a channel this layer never painted
   * answers "nothing here" instead of quietly costing three render targets.
   */
  targetFor(channel: PaintChannel): THREE.WebGLRenderTarget | null {
    return this.buffers.get(channel)?.read ?? null
  }

  private buf(channel: PaintChannel): ChannelBuffers {
    return this.ensureChannel(channel)
  }

  /** Promotes the just-rendered write buffer to be the readable one. */
  private swap(channel: PaintChannel): void {
    const b = this.buffers.get(channel)
    if (!b) {
      return
    }
    const tmp = b.read
    b.read = b.write
    b.write = tmp
  }

  /**
   * This mesh's UV coverage: white where a triangle of this piece rasterizes,
   * black elsewhere. Exporting several pieces onto one atlas needs it — a
   * piece's maps are opaque across the whole square (a flat fill covers every
   * texel, painted or not), so without a mask the last piece drawn erases
   * every piece under it.
   */
  coverageTarget(): THREE.WebGLRenderTarget {
    this.ensureCoverageMask()
    return this.coverageMask!
  }

  /**
   * Whether the coverage mask actually came out with anything in it. A mask
   * that rasterized empty is indistinguishable from "this mesh covers no
   * texels", and anything that trusts it then erases the layer it was meant to
   * protect — so it is measured once and the destructive paths opt out.
   */
  private coverageUsable = true

  /** Allocates and rasterizes the coverage mask the first time it's actually needed. */
  private ensureCoverageMask(): void {
    if (this.coverageMask) {
      return
    }
    this.coverageMask = createRenderTarget(this.textureSize)
    this.dilateMaterial.uniforms.uMask.value = this.coverageMask.texture
    this.buildCoverageMask()
    this.coverageUsable = this.measureCoverage()
    if (!this.coverageUsable) {
      console.warn(
        '[slip] UV coverage mask rasterized empty — masking and dilation are disabled for this ' +
          'mesh. Either its UVs are degenerate, or the mask pass is broken.'
      )
    }
  }

  /**
   * Re-rasterizes the coverage at a small fixed size purely to answer "did
   * anything land?". Reading the full-size mask back would mean pulling up to
   * 256 MB across the bus at 8192; a 64x64 copy costs 16 KB and only misses UV
   * islands too small to matter.
   */
  private measureCoverage(): boolean {
    const probe = new THREE.WebGLRenderTarget(64, 64, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter
    })
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
      side: THREE.DoubleSide,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false
    })
    const prevMaterial = this.uvMesh.material
    const prevTarget = this.renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    this.renderer.getClearColor(prevClear)
    const prevClearAlpha = this.renderer.getClearAlpha()

    this.uvMesh.material = material
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.setRenderTarget(probe)
    this.renderer.clear(true, true, true)
    this.renderer.render(this.orthoScene, this.orthoCamera)

    const pixels = new Uint8Array(64 * 64 * 4)
    this.renderer.readRenderTargetPixels(probe, 0, 0, 64, 64, pixels)

    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevClear, prevClearAlpha)
    this.uvMesh.material = prevMaterial
    material.dispose()
    probe.dispose()

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        return true
      }
    }
    return false
  }

  /** Rasterizes the UV mesh as flat white once — used to guide edge dilation (see dilateFragmentShader). */
  private buildCoverageMask(): void {
    /**
     * Must use the same NDC passthrough vertex shader the paint material uses.
     * The UV mesh's positions ARE clip coordinates already (uv * 2 - 1, z = 0),
     * so a stock material — which multiplies them by the view/projection of an
     * ortho camera sitting at the origin with near = 0 — puts every triangle
     * exactly on the near plane and clips the lot. That silently produced a
     * fully black mask: dilation became a no-op, and anything that treats the
     * mask as coverage (atlas export, clipToCoverage) saw the mesh as covering
     * nothing at all.
     */
    const maskMaterial = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); }
      `,
      // See the paint material: a glTF model's UV winding is reversed, so
      // FrontSide culls the whole flattened mesh and the mask comes out empty.
      side: THREE.DoubleSide,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false
    })
    const prevMaterial = this.uvMesh.material
    this.uvMesh.material = maskMaterial
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.setRenderTarget(this.coverageMask)
    this.renderer.clear(true, true, true)
    this.renderer.render(this.orthoScene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
    this.uvMesh.material = prevMaterial
    maskMaterial.dispose()
  }

  /**
   * Diagnostic: how much of this mesh's UV layout is *shared* by more than one
   * triangle. Overlapping UVs (mirrored islands are the usual cause — a
   * symmetric model reuses one island for both halves) mean two different
   * faces read and write the same texels, so painting a visible face also
   * paints whatever else is stacked on those texels. No amount of camera
   * occlusion testing can fix that: the texel is physically shared, and both
   * faces sample it when rendered. The only fixes are a non-overlapping unwrap
   * or a UDIM/second-UV-set workflow.
   *
   * Rasterizes the UV mesh with additive blending (each covered texel gets +4
   * per triangle) and counts texels that came out above one triangle's worth.
   */
  debugUvOverlap(): { coveredTexels: number; overlappedTexels: number; overlapRatio: number } {
    const size = Math.min(this.textureSize, 1024)
    const target = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter
    })
    const countMaterial = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(4.0 / 255.0); }',
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    })

    const prevMaterial = this.uvMesh.material
    const prevTarget = this.renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    this.renderer.getClearColor(prevClear)
    const prevClearAlpha = this.renderer.getClearAlpha()

    this.uvMesh.material = countMaterial
    this.renderer.setRenderTarget(target)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear(true, true, true)
    this.renderer.render(this.orthoScene, this.orthoCamera)

    const pixels = new Uint8Array(size * size * 4)
    this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)

    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevClear, prevClearAlpha)
    this.uvMesh.material = prevMaterial
    countMaterial.dispose()
    target.dispose()

    let covered = 0
    let overlapped = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const v = pixels[i]
      if (v >= 2) {
        covered++
      }
      // 4 = exactly one triangle, 8+ = two or more stacked on this texel.
      if (v >= 6) {
        overlapped++
      }
    }
    return {
      coveredTexels: covered,
      overlappedTexels: overlapped,
      overlapRatio: covered > 0 ? overlapped / covered : 0
    }
  }

  /** Bleeds `target`'s island-edge colors outward into gutter texels by a couple texels (see dilateFragmentShader). */
  private dilate(target: THREE.WebGLRenderTarget, iterations = 4): void {
    this.ensureCoverageMask()
    if (!this.scratchDilateTarget) {
      this.scratchDilateTarget = createRenderTarget(this.textureSize)
    }
    const scratch = this.scratchDilateTarget

    const prevTarget = this.renderer.getRenderTarget()
    const prevAutoClear = this.renderer.autoClear
    this.renderer.autoClear = false

    let read = target
    let write = scratch
    for (let i = 0; i < iterations; i++) {
      this.dilateMaterial.uniforms.uColor.value = read.texture
      this.renderer.setRenderTarget(write)
      this.renderer.render(this.dilateScene, this.orthoCamera)
      const tmp = read
      read = write
      write = tmp
    }
    // If the result landed in scratch (odd iteration count), copy it back
    // into target so callers always find the dilated result there.
    if (read !== target) {
      this.dilateMaterial.uniforms.uColor.value = scratch.texture
      this.renderer.setRenderTarget(target)
      this.renderer.render(this.dilateScene, this.orthoCamera)
    }

    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
  }

  private scratchDilateTarget: THREE.WebGLRenderTarget | null = null
  private coverageClipMaterial: THREE.ShaderMaterial | null = null
  private coverageClipQuad: THREE.Mesh | null = null
  private coverageClipScene: THREE.Scene | null = null

  /**
   * Clips every allocated channel to this mesh's own UV coverage.
   *
   * This is what makes a shared atlas importable. When several pieces of a
   * model index into one texture sheet, each piece's layer stack is handed the
   * *whole* sheet, so every piece would carry every other piece's artwork:
   * paint one and the neighbour's islands sit underneath it, export one and the
   * file contains the entire atlas. Zeroing the texels this mesh's triangles
   * don't rasterize into leaves each texture set holding only its own region.
   *
   * Everything is stored premultiplied, so scaling RGB and alpha by the same
   * mask is the correct way to take coverage to zero; the dilation afterwards
   * puts the bilinear bleed margin back around the kept islands.
   */
  clipToCoverage(): void {
    this.ensureCoverageMask()
    const mask = this.coverageMask
    if (!mask) {
      return
    }
    // Never clip against a mask that came out empty: that multiplies the whole
    // layer by zero and throws away artwork this was supposed to be separating.
    if (!this.coverageUsable) {
      return
    }

    if (!this.coverageClipMaterial) {
      this.coverageClipMaterial = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: null }, uMask: { value: mask.texture } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uColor;
          uniform sampler2D uMask;
          varying vec2 vUv;
          void main() {
            // The mask is rendered white-on-black and opaque, so coverage is in
            // red. Hard threshold rather than a multiply: an antialiased edge
            // texel is still this piece's texel, and halving its alpha would
            // show as a seam once the dilation spreads it.
            float covered = step(0.004, texture2D(uMask, vUv).r);
            gl_FragColor = texture2D(uColor, vUv) * covered;
          }
        `,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false
      })
      this.coverageClipQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        this.coverageClipMaterial
      )
      this.coverageClipScene = new THREE.Scene()
      this.coverageClipScene.add(this.coverageClipQuad)
    }
    this.coverageClipMaterial.uniforms.uMask.value = mask.texture

    const prevTarget = this.renderer.getRenderTarget()
    for (const channel of this.allocatedChannels) {
      const buffers = this.buf(channel)
      this.coverageClipMaterial.uniforms.uColor.value = buffers.read.texture
      this.renderer.setRenderTarget(buffers.write)
      this.renderer.render(this.coverageClipScene!, this.orthoCamera)
      this.dilate(buffers.write)
      this.swap(channel)
    }
    this.renderer.setRenderTarget(prevTarget)
    this._contentVersion++
  }

  /** Rewrites the uvMesh's `aSelected` attribute (see uvMesh.ts) from a set of triangle indices, for the paint shader's face-restriction mask. */
  private setSelectionMask(faces: ReadonlySet<number> | null | undefined): void {
    const attr = this.uvMesh.geometry.getAttribute('aSelected') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    arr.fill(0)
    if (faces) {
      for (const face of faces) {
        const base = face * 3
        if (base < 0 || base + 2 >= arr.length) {
          continue
        }
        arr[base] = 1
        arr[base + 1] = 1
        arr[base + 2] = 1
      }
    }
    attr.needsUpdate = true
  }

  get texture(): THREE.Texture {
    return this.buf('baseColor').read.texture
  }

  /**
   * Fills in the payload (rgb, alpha, shader channel mode) for one channel of a
   * stroke. Erasing takes base color back to the layer's own base color/alpha
   * exactly as it always has, and takes a PBR channel's coverage to zero, which
   * re-exposes whatever is underneath rather than stamping a black normal or a
   * zero roughness over it.
   */
  private applyChannelPayload(
    channel: PaintChannel,
    payload: ChannelPayload,
    erase: boolean,
    maps?: ChannelMaps
  ): void {
    const u = this.material.uniforms
    // Base color takes its map through uBrushTexture (the long-standing shelf
    // texture path, which tints and masks); the data channels sample their own.
    const channelMap = channel === 'baseColor' ? null : (maps?.[channel] ?? null)
    // Erasing removes coverage, so there is nothing for a map to supply.
    u.uChannelMap.value = erase ? null : channelMap
    u.uUseChannelMap.value = !erase && channelMap ? 1 : 0
    switch (channel) {
      case 'baseColor': {
        const bc = payload.baseColor
        const color = erase ? this.baseColor : (bc?.color ?? new THREE.Color(0xffffff))
        const alpha = erase ? this.baseAlpha : (bc?.alpha ?? 1)
        u.uBrushColor.value.set(color.r, color.g, color.b, alpha)
        u.uChannelMode.value = 0
        u.uNormalStrength.value = 1
        break
      }
      case 'roughness':
      case 'metalness': {
        const v = THREE.MathUtils.clamp(payload[channel] ?? 0, 0, 1)
        u.uBrushColor.value.set(v, v, v, erase ? 0 : 1)
        u.uChannelMode.value = 1
        u.uNormalStrength.value = 1
        break
      }
      case 'normal': {
        u.uBrushColor.value.set(0.5, 0.5, 1, erase ? 0 : 1)
        u.uChannelMode.value = 2
        u.uNormalStrength.value = payload.normal ?? 1
        break
      }
    }
  }

  paintStroke(hit: SurfaceHit, params: StrokeParams): void {
    // No `channels` means the legacy flat-texture call: base color only, from
    // the stroke's own color/alpha.
    const payload: ChannelPayload = params.channels ?? {
      baseColor: { color: params.color, alpha: params.alpha ?? 1 }
    }
    const channels = payloadChannels(payload)
    if (channels.length === 0) {
      return
    }

    const u = this.material.uniforms
    u.uBrushWorldPos.value.copy(hit.point)
    u.uBrushNormal.value.copy(hit.normal)
    u.uBrushRadius.value = params.radius
    u.uBrushHardness.value = params.hardness
    u.uProjectorDepth.value = params.projectorDepth ?? 0.35
    u.uMaxAngle.value = params.maxAngle ?? 85
    u.uBrushOpacity.value = params.opacity
    u.uBrushTexture.value = params.brushTexture ?? null
    u.uUseTexture.value = params.brushTexture ? 1 : 0
    u.uBrushTipTexture.value = params.brushTipTexture ?? null
    u.uUseTipTexture.value = params.brushTipTexture ? 1 : 0
    u.uTextureScale.value = params.textureScale ?? 1
    this.applyTextureRegion(params.textureRegion, params.textureRepeat)
    // 'tip' placement means one copy of the region per dab, centred and rotated
    // with the cursor — which is exactly the stamp projection, so the brush
    // borrows it rather than having a third code path.
    u.uStampMode.value = params.stampMode || params.textureMapping === 'tip' ? 1 : 0
    let mappingMode = 0 // 0 = uv, 1 = triplanar
    if (params.textureMapping === 'triplanar' || params.textureMapping === 1) {
      mappingMode = 1
    }
    u.uTextureMapping.value = mappingMode
    u.uFillMode.value = 0
    // An empty (but non-null) set is deliberately "restrict to nothing" (e.g.
    // the brush's geodesic neighborhood doesn't overlap the active face
    // selection at all) — every caller already passes null, not an empty
    // set, for "no restriction", so this distinction is intentional and
    // must not collapse an empty set back into "paint everywhere".
    const restrict = params.restrictFaces != null
    u.uRestrictFace.value = restrict ? 1 : 0
    if (restrict) {
      this.setSelectionMask(params.restrictFaces)
    }

    u.uStencilStamp.value = 0
    if (params.stencil) {
      u.uUseStencil.value = 1
      u.uStencilTex.value = params.stencil.texture
      u.uStencilRect.value.copy(params.stencil.rect)
      u.uStencilRotation.value = params.stencil.rotationRad
      u.uStencilInvert.value = params.stencil.invert ? 1 : 0
      u.uStencilHasAlpha.value = params.stencil.hasAlpha ? 1 : 0
      u.uCanvasSize.value.set(params.stencil.canvasWidth, params.stencil.canvasHeight)
      // The stencil needs the same projection the occlusion test uses, but it
      // must be set even when occlusion is off — otherwise the stencil would
      // silently sample against a stale camera.
      u.uCameraViewProjMatrix.value.copy(params.stencil.viewProjMatrix)
    } else {
      u.uUseStencil.value = 0
      u.uStencilTex.value = null
    }

    if (params.occlusion) {
      u.uUseOcclusion.value = 1
      u.uOcclusionDepthTex.value = params.occlusion.depthTexture
      u.uCameraViewProjMatrix.value.copy(params.occlusion.viewProjMatrix)
      u.uCameraViewMatrix.value.copy(params.occlusion.viewMatrix)
      u.uCameraPosition.value.copy(params.occlusion.cameraPosition)
      u.uNormalSign.value = params.occlusion.normalSign
      u.uOcclusionTexel.value.copy(params.occlusion.texelSize)
      u.uCameraNear.value = params.occlusion.near
      u.uCameraFar.value = params.occlusion.far
    } else {
      u.uUseOcclusion.value = 0
      u.uOcclusionDepthTex.value = null
    }

    // Arbitrary but stable tangent basis for the brush's local plane, built
    // from whichever world axis is least parallel to the surface normal. This
    // is set on *every* stroke, not just stamps: the projector bounds in
    // paintShader.ts work in this frame, so a stale basis left over from an
    // earlier dab would misshape the dab and mis-measure its penetration.
    const up =
      Math.abs(hit.normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const tangent = new THREE.Vector3().crossVectors(up, hit.normal).normalize()
    const bitangent = new THREE.Vector3().crossVectors(hit.normal, tangent).normalize()
    if (params.angle) {
      tangent.applyAxisAngle(hit.normal, params.angle)
      bitangent.applyAxisAngle(hit.normal, params.angle)
    }
    u.uBrushTangent.value.copy(tangent)
    u.uBrushBitangent.value.copy(bitangent)
    applyUvDab(u, params.uvDab, params.angle ?? 0)

    // One pass per enabled channel. They share every dab parameter set above —
    // the same footprint, the same tip alpha, the same stencil and occlusion
    // gates — so a multi-channel brush stroke lands in perfect register across
    // base color, roughness, metalness and normal.
    const prevTarget = this.renderer.getRenderTarget()
    for (const channel of channels) {
      const buffers = this.buf(channel)
      this.applyChannelPayload(channel, payload, params.erase ?? false, params.channelMaps)
      u.uPrevTexture.value = buffers.read.texture
      this.renderer.setRenderTarget(buffers.write)
      this.renderer.render(this.orthoScene, this.orthoCamera)
      this.renderer.setRenderTarget(prevTarget)
      this.dilate(buffers.write)
      this.swap(channel)
    }
    u.uChannelMode.value = 0
    u.uUseChannelMap.value = 0
    // The material is shared with fill and the stencil stamp; a texture-space
    // dab must not leak into them.
    u.uUvDab.value = 0
    this._contentVersion++
  }

  /**
   * Applies a filter (blur / sharpen / smudge / pixelate) under the brush dab,
   * reworking texels that are already on the layer rather than laying down new
   * color. Shares the paint brush's projector footprint and camera-visibility
   * test (see brushMask.ts), so it can't blur through a thin wall or smear a
   * face hidden behind the model any more than the paint brush can paint them.
   */
  applyEffect(hit: SurfaceHit, params: EffectParams): void {
    if (!this.effectMaterial) {
      this.effectMaterial = createEffectMaterial(this.textureSize)
    }
    const u = this.effectMaterial.uniforms
    u.uBrushWorldPos.value.copy(hit.point)
    u.uBrushNormal.value.copy(hit.normal)
    u.uBrushRadius.value = params.radius
    u.uBrushHardness.value = params.hardness
    u.uProjectorDepth.value = params.projectorDepth ?? 0.35
    u.uMaxAngle.value = params.maxAngle ?? 85
    u.uBrushOpacity.value = params.opacity
    u.uEffectMode.value = EFFECT_MODE_INDEX[params.mode]
    u.uEffectStrength.value = params.strength
    u.uEffectRadius.value = params.effectRadius
    u.uPixelSize.value = params.pixelSize
    u.uSmudgeDir.value.set(params.smudgeDir?.x ?? 0, params.smudgeDir?.y ?? 0)
    u.uTexelSize.value.set(1 / this.textureSize, 1 / this.textureSize)

    const up =
      Math.abs(hit.normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const tangent = new THREE.Vector3().crossVectors(up, hit.normal).normalize()
    const bitangent = new THREE.Vector3().crossVectors(hit.normal, tangent).normalize()
    if (params.angle) {
      tangent.applyAxisAngle(hit.normal, params.angle)
      bitangent.applyAxisAngle(hit.normal, params.angle)
    }
    u.uBrushTangent.value.copy(tangent)
    u.uBrushBitangent.value.copy(bitangent)
    u.uBrushTipTexture.value = params.brushTipTexture ?? null
    u.uUseTipTexture.value = params.brushTipTexture ? 1 : 0
    applyUvDab(u, params.uvDab, params.angle ?? 0)

    const restrict = params.restrictFaces != null
    u.uRestrictFace.value = restrict ? 1 : 0
    if (restrict) {
      this.setSelectionMask(params.restrictFaces)
    }

    if (params.occlusion) {
      u.uUseOcclusion.value = 1
      u.uOcclusionDepthTex.value = params.occlusion.depthTexture
      u.uOcclusionTexel.value.copy(params.occlusion.texelSize)
      u.uCameraViewProjMatrix.value.copy(params.occlusion.viewProjMatrix)
      u.uCameraViewMatrix.value.copy(params.occlusion.viewMatrix)
      u.uCameraPosition.value.copy(params.occlusion.cameraPosition)
      u.uNormalSign.value = params.occlusion.normalSign
      u.uCameraNear.value = params.occlusion.near
      u.uCameraFar.value = params.occlusion.far
    } else {
      u.uUseOcclusion.value = 0
      u.uOcclusionDepthTex.value = null
    }

    const prevMaterial = this.uvMesh.material
    this.uvMesh.material = this.effectMaterial

    // Filters rework whatever is already on the layer, so they run over every
    // channel this layer has: blurring a stroke's color while leaving its
    // roughness and normal razor-sharp underneath would look wrong under
    // lighting, not just inconsistent on export.
    const prevTarget = this.renderer.getRenderTarget()
    for (const channel of this.allocatedChannels) {
      const buffers = this.buf(channel)
      u.uPrevTexture.value = buffers.read.texture
      this.renderer.setRenderTarget(buffers.write)
      this.renderer.render(this.orthoScene, this.orthoCamera)
      this.renderer.setRenderTarget(prevTarget)
      this.dilate(buffers.write)
      this.swap(channel)
    }

    this.uvMesh.material = prevMaterial
    u.uBrushTipTexture.value = null
    u.uUseTipTexture.value = 0
    this._contentVersion++
  }

  /**
   * Projects the screen-space stencil onto the model as a decal, in a single
   * pass — the "stamp it on" action rather than brushing through it.
   *
   * Every texel that falls inside the stencil rect AND is visible from the
   * paint camera takes the stencil's color at once. The visibility test is not
   * optional here: without it the projection would wrap straight through the
   * model and reprint itself, mirrored, on the far side — the classic failure
   * of naive planar decal projection.
   */
  stampStencil(params: {
    stencil: StencilParams
    occlusion: OcclusionParams
    color: THREE.Color
    opacity: number
    /** Shape from image brightness (and paint `color`) instead of image alpha + color. */
    useLuminance?: boolean
    /** Confine the projection to these triangles; null = the whole model. */
    restrictFaces?: ReadonlySet<number> | null
    /** PBR values to stamp alongside the decal; omitted = base color only. */
    channels?: ChannelPayload
  }): void {
    const payload: ChannelPayload = params.channels ?? {
      baseColor: { color: params.color, alpha: 1 }
    }
    // The normal channel is deliberately excluded: a stamped decal has no dab
    // geometry, so there is no height field to take a slope from — it would
    // write a flat (neutral) normal over whatever is already there and quietly
    // erase detail. Stamping surface relief is the brush's job.
    const channels = payloadChannels(payload).filter((c) => c !== 'normal')
    if (channels.length === 0) {
      return
    }

    const u = this.material.uniforms
    u.uBrushOpacity.value = params.opacity
    u.uFillMode.value = 0
    u.uUseTexture.value = 0
    u.uBrushTexture.value = null
    u.uUseTipTexture.value = 0
    u.uBrushTipTexture.value = null
    u.uStampMode.value = 0
    // An active face selection confines a stamp the same way it confines every
    // other paint operation — no separate opt-in to remember.
    const restrict = params.restrictFaces != null
    u.uRestrictFace.value = restrict ? 1 : 0
    if (restrict) {
      this.setSelectionMask(params.restrictFaces)
    }

    u.uUseStencil.value = 0
    u.uStencilStamp.value = 1
    u.uStencilUseLuma.value = params.useLuminance ? 1 : 0
    u.uStencilTex.value = params.stencil.texture
    u.uStencilRect.value.copy(params.stencil.rect)
    u.uStencilRotation.value = params.stencil.rotationRad
    u.uStencilInvert.value = params.stencil.invert ? 1 : 0
    u.uStencilHasAlpha.value = params.stencil.hasAlpha ? 1 : 0
    u.uCanvasSize.value.set(params.stencil.canvasWidth, params.stencil.canvasHeight)

    u.uUseOcclusion.value = 1
    u.uOcclusionDepthTex.value = params.occlusion.depthTexture
    u.uCameraViewProjMatrix.value.copy(params.occlusion.viewProjMatrix)
    u.uCameraViewMatrix.value.copy(params.occlusion.viewMatrix)
    u.uCameraPosition.value.copy(params.occlusion.cameraPosition)
    u.uNormalSign.value = params.occlusion.normalSign
    u.uOcclusionTexel.value.copy(params.occlusion.texelSize)
    u.uCameraNear.value = params.occlusion.near
    u.uCameraFar.value = params.occlusion.far
    // The depth bias scales with brush radius; a stamp has no radius, so pin it
    // small or the bias would swallow genuinely occluded geometry.
    u.uBrushRadius.value = 0.01

    const prevTarget = this.renderer.getRenderTarget()
    for (const channel of channels) {
      const buffers = this.buf(channel)
      this.applyChannelPayload(channel, payload, false)
      u.uPrevTexture.value = buffers.read.texture
      this.renderer.setRenderTarget(buffers.write)
      this.renderer.render(this.orthoScene, this.orthoCamera)
      this.renderer.setRenderTarget(prevTarget)
      this.dilate(buffers.write)
      this.swap(channel)
    }
    this._contentVersion++

    u.uStencilStamp.value = 0
    u.uUseChannelMap.value = 0
    u.uChannelMode.value = 0
  }

  /** Fills the whole active layer with color or pattern (spec: bucket tool across whole model). */
  fill(options?: FillOptions | THREE.Color, legacyAlpha = 1): void {
    let color: THREE.Color
    let alpha: number
    let texture: THREE.Texture | null = null
    let scale = 1

    if (options instanceof THREE.Color) {
      color = options
      alpha = legacyAlpha
    } else if (options) {
      color = options.color ?? new THREE.Color(0xffffff)
      alpha = options.alpha ?? 1
      texture = options.texture ?? null
      scale = options.scale ?? 1
    } else {
      color = new THREE.Color(0xffffff)
      alpha = 1
    }

    const payload: ChannelPayload = (options instanceof THREE.Color
      ? undefined
      : options?.channels) ?? {
      baseColor: { color, alpha }
    }
    const channels = payloadChannels(payload)
    if (channels.length === 0) {
      return
    }

    const maps = options instanceof THREE.Color ? undefined : options?.channelMaps
    const region = options instanceof THREE.Color ? undefined : options?.textureRegion
    const repeat = options instanceof THREE.Color ? undefined : options?.textureRepeat
    // A whole-model fill has no face selection, but it does have an area: the
    // whole UV square. Passing the projection through means "Fill Area" means
    // the same thing here as it does for a face fill, instead of silently
    // falling back to tiling.
    const projection = options instanceof THREE.Color ? undefined : options?.projection
    for (const channel of channels) {
      // A material-set fill goes through the textured path even when the base
      // color itself is a flat swatch, since the data channels still have maps
      // of their own to tile across the model.
      if (texture || maps?.[channel]) {
        this.fillChannelWithTexture(
          channel,
          payload,
          texture,
          scale,
          alpha,
          null,
          maps,
          region,
          repeat,
          projection
        )
      } else {
        this.fillChannelFlat(channel, payload, alpha)
      }
    }
    this._contentVersion++
  }

  /** Flat (untextured) fill of one channel — replaces the channel outright. */
  private fillChannelFlat(channel: PaintChannel, payload: ChannelPayload, alpha: number): void {
    const buffers = this.buf(channel)
    const { color, quadAlpha } = this.flatFillValue(channel, payload, alpha)
    const fillScene = new THREE.Scene()
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: quadAlpha,
      premultipliedAlpha: true
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    fillScene.add(quad)
    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(buffers.write)
    this.renderer.render(fillScene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    mat.dispose()
    quad.geometry.dispose()
    this.swap(channel)
  }

  /** The constant a flat fill writes into one channel. */
  private flatFillValue(
    channel: PaintChannel,
    payload: ChannelPayload,
    alpha: number
  ): { color: THREE.Color; quadAlpha: number } {
    if (channel === 'baseColor') {
      const bc = payload.baseColor
      return { color: bc?.color ?? new THREE.Color(0xffffff), quadAlpha: bc?.alpha ?? alpha }
    }
    if (channel === 'normal') {
      // Filling the normal channel means "flat surface everywhere" — the
      // neutral encoded normal, fully covering.
      return { color: new THREE.Color(0.5, 0.5, 1), quadAlpha: 1 }
    }
    const v = THREE.MathUtils.clamp(payload[channel] ?? 0, 0, 1)
    return { color: new THREE.Color(v, v, v), quadAlpha: 1 }
  }

  /**
   * Textured fill of one channel. The texture tiles across the model (or the
   * given face selection) and, for a data channel, contributes its alpha as a
   * mask only — see the uChannelMode note in paintShader.ts.
   */
  /**
   * Pushes a texture crop into the shader, defaulting to the whole image. Set
   * on every pass rather than once, because the material's uniforms are shared
   * by strokes, fills and stamps — a crop left over from the last stroke would
   * otherwise silently apply to an unrelated fill.
   */
  private applyTextureRegion(
    region?: { x: number; y: number; w: number; h: number; rotation: number },
    repeat?: 'tile' | 'mirror' | 'once'
  ): void {
    const u = this.material.uniforms
    u.uRepeatMode.value = repeat === 'once' ? 2 : repeat === 'mirror' ? 1 : 0
    if (region) {
      // The picker measures y from the TOP of the image (how it is displayed
      // and how CSS lays it out); texture space measures v from the bottom, and
      // an image loaded with flipY puts its top row at v = 1. Converting here,
      // once, is what keeps "the square I dragged over" and "the pixels the
      // brush lays down" the same square rather than mirrored halves.
      u.uTextureRegion.value.set(region.x, 1 - region.y - region.h, region.w, region.h)
      u.uTextureRegionRotation.value = (region.rotation * Math.PI) / 180
    } else {
      u.uTextureRegion.value.set(0, 0, 1, 1)
      u.uTextureRegionRotation.value = 0
    }
  }

  /** Pushes the Face UV Projector transform, defaulting to identity (no-op). */
  private applyProjection(projection?: FaceProjectionOptions): void {
    const u = this.material.uniforms
    if (projection) {
      u.uProjOffset.value.set(projection.offsetX, projection.offsetY)
      u.uProjScale.value.set(projection.scaleX, projection.scaleY)
      u.uProjRotation.value = (projection.rotation * Math.PI) / 180
      // Fit needs the selection's UV bounds, which only the caller knows (the
      // engine never sees the triangle list). No rect means nothing to fit to,
      // so it falls back to the raw-UV tiling path rather than stretching the
      // crop across a bogus box.
      const rect = projection.fit ? projection.fitRect : undefined
      u.uFillFit.value = rect ? 1 : 0
      if (rect) {
        u.uFitRect.value.set(rect.x, rect.y, rect.w, rect.h)
      }
    } else {
      u.uProjOffset.value.set(0, 0)
      u.uProjScale.value.set(1, 1)
      u.uProjRotation.value = 0
      u.uFillFit.value = 0
      u.uFitRect.value.set(0, 0, 1, 1)
    }
  }

  private fillChannelWithTexture(
    channel: PaintChannel,
    payload: ChannelPayload,
    texture: THREE.Texture | null,
    scale: number,
    alpha: number,
    faces: ReadonlySet<number> | null,
    maps?: ChannelMaps,
    region?: { x: number; y: number; w: number; h: number; rotation: number },
    repeat?: 'tile' | 'mirror' | 'once',
    projection?: FaceProjectionOptions
  ): void {
    const buffers = this.buf(channel)
    const u = this.material.uniforms
    this.applyChannelPayload(channel, payload, false, maps)
    if (channel === 'baseColor') {
      u.uBrushColor.value.w = payload.baseColor?.alpha ?? alpha
    }
    u.uPrevTexture.value = buffers.read.texture
    u.uBrushOpacity.value = alpha
    u.uFillMode.value = 1
    u.uRestrictFace.value = faces ? 1 : 0
    // A bucket fill is not a brush dab: clear the per-stroke gates so it can't
    // inherit the stencil or occlusion state left by the last stroke.
    u.uUseStencil.value = 0
    u.uUseOcclusion.value = 0
    u.uUseTexture.value = texture ? 1 : 0
    u.uBrushTexture.value = texture
    u.uFillScale.value = scale
    u.uStampMode.value = 0
    this.applyTextureRegion(region, repeat)
    this.applyProjection(projection)

    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(buffers.write)
    this.renderer.render(this.orthoScene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    this.dilate(buffers.write)

    u.uFillMode.value = 0
    u.uRestrictFace.value = 0
    u.uUseTexture.value = 0
    u.uBrushTexture.value = null
    u.uChannelMode.value = 0
    u.uUseChannelMap.value = 0
    this.applyProjection(undefined)

    this.swap(channel)
  }

  /** Fills only the given triangles (spec: bucket fill by face selection, best-effort texture mapping). */
  fillFaces(
    faces: ReadonlySet<number>,
    options?: FillOptions | THREE.Color,
    legacyAlpha = 1
  ): void {
    if (faces.size === 0) {
      return
    }

    let color: THREE.Color
    let alpha: number
    let texture: THREE.Texture | null = null
    let scale = 1

    if (options instanceof THREE.Color) {
      color = options
      alpha = legacyAlpha
    } else if (options) {
      color = options.color ?? new THREE.Color(0xffffff)
      alpha = options.alpha ?? 1
      texture = options.texture ?? null
      scale = options.scale ?? 1
    } else {
      color = new THREE.Color(0xffffff)
      alpha = 1
    }

    this.setSelectionMask(faces)

    const payload: ChannelPayload = (options instanceof THREE.Color
      ? undefined
      : options?.channels) ?? {
      baseColor: { color, alpha }
    }
    const channels = payloadChannels(payload)
    if (channels.length === 0) {
      return
    }

    const maps = options instanceof THREE.Color ? undefined : options?.channelMaps
    const region = options instanceof THREE.Color ? undefined : options?.textureRegion
    const repeat = options instanceof THREE.Color ? undefined : options?.textureRepeat
    const projection = options instanceof THREE.Color ? undefined : options?.projection
    for (const channel of channels) {
      this.fillChannelWithTexture(
        channel,
        payload,
        texture,
        scale,
        alpha,
        faces,
        maps,
        region,
        repeat,
        projection
      )
    }
    this._contentVersion++
  }

  /**
   * Composites this layer at `opacity` on top of `other`'s current content
   * and writes the merged result into `other`'s buffers (spec: Merge Down —
   * `other` becomes the combined layer, `this` is discarded by the caller).
   */
  mergeOnto(other: PaintEngine, opacity: number): void {
    const drawQuad = (map: THREE.Texture, quadOpacity: number): void => {
      const mat = new THREE.MeshBasicMaterial({ map })
      configurePremultipliedSourceMaterial(mat, quadOpacity)
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
      const scene = new THREE.Scene()
      scene.add(quad)
      this.renderer.render(scene, this.orthoCamera)
      mat.dispose()
      quad.geometry.dispose()
    }

    // Every channel either layer has, so merging down never silently drops the
    // roughness or normal work on the layer being merged.
    const channels = new Set([...this.allocatedChannels, ...other.allocatedChannels])
    const prevAutoClear = this.renderer.autoClear
    const prevTarget = this.renderer.getRenderTarget()
    // Transparent clear, for the same reason as copyOnto: an inherited opaque
    // clear colour would give the merged result a solid backing.
    const prevMergeClear = new THREE.Color()
    this.renderer.getClearColor(prevMergeClear)
    const prevMergeClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.autoClear = false
    for (const channel of channels) {
      const mine = this.buf(channel)
      const theirs = other.buf(channel)
      this.renderer.setRenderTarget(theirs.write)
      this.renderer.clear(true, true, true)
      drawQuad(theirs.read.texture, 1)
      drawQuad(mine.read.texture, opacity)
      other.swap(channel)
    }
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevMergeClear, prevMergeClearAlpha)
    this.renderer.autoClear = prevAutoClear
    other._contentVersion++
  }

  /** Copies this layer's content onto another PaintEngine buffer (for duplication). */
  /**
   * `transform` mirrors the copy in UV space — for putting a layer painted on
   * one half of a symmetric model onto the other half, whose UV island is the
   * same shape but reflected. The target may be a different texture size; the
   * blit resamples.
   */
  copyOnto(other: PaintEngine, transform?: { flipU?: boolean; flipV?: boolean }): void {
    const prevAutoClear = this.renderer.autoClear
    const prevTarget = this.renderer.getRenderTarget()
    // The destination must be cleared to TRANSPARENT, explicitly. clear() uses
    // the renderer's current clear colour, which belongs to whatever ran last
    // (a depth pass, a mask pass, the viewport itself) — inheriting an opaque
    // one leaves the copy sitting on a solid sheet, since the premultiplied
    // blend below only adds where the source has coverage. That is what made a
    // duplicated layer look like it had filled its background.
    const prevClear = new THREE.Color()
    this.renderer.getClearColor(prevClear)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.autoClear = false
    for (const channel of this.allocatedChannels) {
      const mat = new THREE.MeshBasicMaterial({ map: this.buf(channel).read.texture })
      configurePremultipliedSourceMaterial(mat, 1)
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
      if (transform?.flipU || transform?.flipV) {
        // A negative scale reverses the winding, so the quad must draw both sides.
        mat.side = THREE.DoubleSide
        quad.scale.set(transform.flipU ? -1 : 1, transform.flipV ? -1 : 1, 1)
      }
      const scene = new THREE.Scene()
      scene.add(quad)
      this.renderer.setRenderTarget(other.buf(channel).write)
      this.renderer.clear(true, true, true)
      this.renderer.render(scene, this.orthoCamera)
      mat.dispose()
      quad.geometry.dispose()
      other.swap(channel)
    }
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevClear, prevClearAlpha)
    this.renderer.autoClear = prevAutoClear
    other._contentVersion++
  }

  /** Clears every channel of this layer back to its starting state. */
  clear(): void {
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    for (const channel of this.allocatedChannels) {
      const buffers = this.buf(channel)
      const color = channel === 'baseColor' ? this.baseColor : new THREE.Color(0x000000)
      const alpha = channel === 'baseColor' ? this.baseAlpha : 0
      this.renderer.setClearColor(color, alpha)
      this.renderer.setRenderTarget(buffers.read)
      this.renderer.clear(true, true, true)
      this.renderer.setRenderTarget(buffers.write)
      this.renderer.clear(true, true, true)
    }
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
    this.renderer.setRenderTarget(prevTarget)
    this._contentVersion++
  }

  /** Reads back the pixel color at a given UV (spec: eyedropper). */
  sampleAt(uv: THREE.Vector2): THREE.Color {
    const x = Math.floor(uv.x * this.textureSize)
    const y = Math.floor(uv.y * this.textureSize)
    const buffer = new Uint8Array(4)
    this.renderer.readRenderTargetPixels(this.buf('baseColor').read, x, y, 1, 1, buffer)
    // Stored premultiplied (see paintShader.ts) — undo it to get the true color.
    const a = buffer[3]
    if (a === 0) {
      return new THREE.Color(0, 0, 0)
    }
    return new THREE.Color(buffer[0] / a, buffer[1] / a, buffer[2] / a)
  }

  /** Inverts the RGB color of the current target (useful for inverting layer masks). */
  invert(): void {
    const invertMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: this.buf('baseColor').read.texture } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        varying vec2 vUv;
        void main() {
          vec4 col = texture2D(tSrc, vUv);
          gl_FragColor = vec4(vec3(1.0) - col.rgb, col.a);
        }
      `,
      depthTest: false,
      depthWrite: false
    })
    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.buf('baseColor').write)
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), invertMat)
    const scene = new THREE.Scene()
    scene.add(quad)
    this.renderer.render(scene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    invertMat.dispose()
    quad.geometry.dispose()

    this.swap('baseColor')
    this._contentVersion++
  }

  private edgeWearMaterial?: THREE.ShaderMaterial

  /** Generates procedural edge wear across detected sharp ridges. */
  applyEdgeWear(options: EdgeWearParams): void {
    if (!this.edgeWearMaterial) {
      this.edgeWearMaterial = createEdgeWearMaterial()
    }

    // Edge wear lays down a color (chipped paint, settled grime), so it is a
    // base-color operation; roughness/metalness/normal are left to the brush
    // rather than being invented from a curvature pass.
    const buffers = this.buf('baseColor')
    const u = this.edgeWearMaterial.uniforms
    u.tSource.value = buffers.read.texture
    if (typeof options.color === 'string') {
      u.uColor.value.set(options.color)
    } else {
      u.uColor.value.copy(options.color)
    }
    u.uOpacity.value = options.opacity ?? 1.0
    u.uWearWidth.value = options.wearWidth
    u.uThreshold.value = 1.0 - Math.cos(options.thresholdAngle * (Math.PI / 180))
    u.uNoiseScale.value = options.noiseScale
    u.uRoughness.value = options.roughness
    u.uAmount.value = options.amount
    u.uContrast.value = options.contrast
    u.uSeed.value = options.seed ?? 0.0
    u.tWearTexture.value = options.texture ?? null
    u.uUseWearTexture.value = options.texture ? 1 : 0
    u.uTextureScale.value = options.textureScale ?? 1.0
    u.uTextureMapping.value = options.textureMapping === 'triplanar' ? 1 : 0
    const mode: EdgeWearMode = options.mode ?? 'wear'
    u.uCurvatureMode.value = mode === 'cavity' ? 1 : 0
    u.uSmoothness.value = options.smoothness ?? (mode === 'cavity' ? 0.6 : 0)

    const prevMaterial = this.uvMesh.material
    this.uvMesh.material = this.edgeWearMaterial

    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(buffers.write)
    this.renderer.render(this.orthoScene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    this.dilate(buffers.write)

    this.uvMesh.material = prevMaterial

    this.swap('baseColor')
    this._contentVersion++
  }

  /**
   * Verbatim texel-for-texel copy of `source` into `dest`.
   *
   * This deliberately does NOT use MeshBasicMaterial. Three defines `OPAQUE`
   * for any material with `transparent === false` and `blending ===
   * NormalBlending` — which is exactly MeshBasicMaterial's default — and the
   * `opaque_fragment` chunk then hard-sets `diffuseColor.a = 1.0`. Copying a
   * layer through such a material therefore *destroys its alpha channel*:
   * every transparent texel, which this module stores premultiplied as
   * (0,0,0,0), comes out (0,0,0,1) — opaque black. A layer restored that way
   * becomes a solid black sheet covering everything under it.
   *
   * A plain passthrough shader has no such chunk, and NoBlending writes RGBA
   * straight through. sRGB encode/decode still round-trips exactly, because
   * both source and destination carry SRGBColorSpace (so they're
   * SRGB8_ALPHA8 internally) and the hardware decodes on read and re-encodes
   * on write symmetrically.
   */
  private blit(source: THREE.Texture, dest: THREE.WebGLRenderTarget): void {
    if (!this.blitScene) {
      this.blitMaterial = new THREE.ShaderMaterial({
        uniforms: { uSrc: { value: null } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uSrc;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(uSrc, vUv);
          }
        `,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending
      })
      this.blitScene = new THREE.Scene()
      this.blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial)
      this.blitScene.add(this.blitQuad)
    }

    this.blitMaterial!.uniforms.uSrc.value = source
    const prevTarget = this.renderer.getRenderTarget()
    const prevAutoClear = this.renderer.autoClear
    // The quad covers the whole target, so skip the clear rather than depend on
    // whatever clear color/alpha the renderer happens to be carrying.
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(dest)
    this.renderer.render(this.blitScene!, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
  }

  /** Copies content from a source render target into this engine's base-color read target. */
  copyFrom(sourceTarget: THREE.WebGLRenderTarget): void {
    this.blit(sourceTarget.texture, this.buf('baseColor').read)
    this._contentVersion++
  }

  /** Creates a snapshot clone of the current base-color target so preview can be reverted. */
  createSnapshot(): THREE.WebGLRenderTarget {
    const snapshot = createRenderTarget(this.textureSize)
    this.blit(this.buf('baseColor').read.texture, snapshot)
    return snapshot
  }

  /**
   * Reads this layer's pixels back to a plain CPU buffer — used for undo
   * history instead of createSnapshot()'s GPU render-target clone. History
   * can pile up dozens of these per layer; keeping them in system RAM instead
   * of VRAM avoids the GPU memory pressure (and the silent allocation
   * failures / context-loss risk that comes with it) that a large canvas
   * with several layers would otherwise hit almost immediately.
   */
  createCpuSnapshot(): CpuPixelSnapshot {
    const size = this.textureSize
    const readChannel = (channel: PaintChannel): Uint8Array => {
      const data = new Uint8Array(size * size * 4)
      this.renderer.readRenderTargetPixels(this.buf(channel).read, 0, 0, size, size, data)
      return data
    }
    const snapshot: CpuPixelSnapshot = { size, data: readChannel('baseColor') }
    // Only channels this layer actually has: a flat-color layer's snapshot
    // stays exactly the size it always was, which is what keeps undo depth on
    // a large canvas from collapsing the moment PBR exists in the build.
    for (const channel of this.allocatedChannels) {
      if (channel === 'baseColor') {
        continue
      }
      snapshot.channels ??= {}
      snapshot.channels[channel] = readChannel(channel)
    }
    return snapshot
  }

  /** Restores this layer's content from a createCpuSnapshot() buffer. */
  restoreFromCpuSnapshot(snapshot: CpuPixelSnapshot): void {
    const restoreChannel = (channel: PaintChannel, data: Uint8Array): void => {
      const tex = new THREE.DataTexture(
        data,
        snapshot.size,
        snapshot.size,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      )
      // Must match the render target's color space: with both the same, the
      // hardware's decode-on-read cancels its encode-on-write and the bytes
      // land back exactly as readRenderTargetPixels saw them. Getting this
      // wrong on a linear data channel would gamma-shift every roughness and
      // normal value on every undo.
      tex.colorSpace = CHANNEL_SPECS[channel].colorSpace
      tex.needsUpdate = true
      this.blit(tex, this.buf(channel).read)
      tex.dispose()
    }

    restoreChannel('baseColor', snapshot.data)
    for (const channel of PAINT_CHANNELS) {
      if (channel === 'baseColor') {
        continue
      }
      const data = snapshot.channels?.[channel]
      if (data) {
        restoreChannel(channel, data)
      } else if (this.buffers.has(channel)) {
        // The snapshot predates this channel existing on the layer — undoing
        // back past the first PBR stroke has to take the channel back to
        // "never painted", not leave the last strokes standing.
        this.clearChannel(channel)
      }
    }
    this._contentVersion++
  }

  /** Resets one channel to zero coverage (PBR) / the layer base (base color). */
  private clearChannel(channel: PaintChannel): void {
    const buffers = this.buffers.get(channel)
    if (!buffers) {
      return
    }
    const color = channel === 'baseColor' ? this.baseColor : new THREE.Color(0x000000)
    const alpha = channel === 'baseColor' ? this.baseAlpha : 0
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(color, alpha)
    this.renderer.setRenderTarget(buffers.read)
    this.renderer.clear(true, true, true)
    this.renderer.setRenderTarget(buffers.write)
    this.renderer.clear(true, true, true)
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
    this.renderer.setRenderTarget(prevTarget)
  }

  dispose(): void {
    for (const buffers of this.buffers.values()) {
      buffers.read.dispose()
      buffers.write.dispose()
    }
    this.buffers.clear()
    this.material.dispose()
    this.edgeWearMaterial?.dispose()
    this.effectMaterial?.dispose()
    this.uvMesh.geometry.dispose()
    this.coverageMask?.dispose()
    this.coverageClipMaterial?.dispose()
    this.coverageClipQuad?.geometry.dispose()
    this.dilateMaterial.dispose()
    this.dilateQuad.geometry.dispose()
    this.blitMaterial?.dispose()
    this.blitQuad?.geometry.dispose()
    this.scratchDilateTarget?.dispose()
  }
}

/**
 * Plain CPU-side copy of one layer's pixels — see createCpuSnapshot().
 *
 * `data` is base color, which every layer has. The PBR channels appear in
 * `channels` only when the layer actually carries them, so a flat-texture
 * project's undo history weighs exactly what it always did.
 */
export interface CpuPixelSnapshot {
  size: number
  data: Uint8Array
  channels?: Partial<Record<PaintChannel, Uint8Array>>
}

export interface EdgeWearParams {
  color: THREE.Color | string
  opacity?: number
  wearWidth: number
  thresholdAngle: number // degrees (e.g. 15 to 90)
  noiseScale: number // e.g. 5 to 60
  roughness: number // e.g. 0 to 1
  amount: number // e.g. 0 to 1
  contrast: number // e.g. 0 to 1
  seed?: number
  texture?: THREE.Texture | null
  textureScale?: number
  /** Sub-rectangle of the source texture to draw from (see brush.textureRegion). */
  textureRegion?: { x: number; y: number; w: number; h: number; rotation: number }
  /** How that region repeats: 'tile' (default), 'mirror', or 'once'. */
  textureRepeat?: 'tile' | 'mirror' | 'once'
  textureMapping?: 'uv' | 'triplanar'
  /**
   * Which curvature population to target. 'wear' chips convex ridges and
   * exposed corners; 'cavity' settles dirt, grime and ambient shadow into
   * concave folds and interior valleys — the exact inverse set of edges.
   */
  mode?: EdgeWearMode
  /**
   * 0 = noisy, chipped break-up; 1 = clean curvature gradient with no noise at
   * all (an ambient-occlusion style pass). Defaults per mode: wear stays noisy,
   * cavity leans smooth.
   */
  smoothness?: number
}

export type EdgeWearMode = 'wear' | 'cavity'

export interface EffectParams {
  mode: EffectMode
  radius: number
  hardness: number
  opacity: number
  projectorDepth?: number
  maxAngle?: number
  /** How far toward the filtered result each dab moves (0-1). */
  strength: number
  /** Blur/sharpen kernel radius, in texels. */
  effectRadius: number
  /** Pixelate block size, in texels. */
  pixelSize: number
  /** Stroke direction in UV space, pre-scaled by smudge length. */
  smudgeDir?: THREE.Vector2 | null
  restrictFaces?: ReadonlySet<number> | null
  occlusion?: OcclusionParams | null
  brushTipTexture?: THREE.Texture | null
  angle?: number
  /** Place the dab directly on the texture instead of projecting it (2D panel). */
  uvDab?: UvDab | null
}
