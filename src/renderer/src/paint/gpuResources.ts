import * as THREE from 'three'
import { buildUvMesh } from './uvMesh'

/**
 * GPU resources that used to be allocated once per *layer* but only ever hold
 * one layer's worth of data at a time — or are identical for every layer of a
 * mesh — so they are shared instead. At 4096² one RGBA8 target is 64 MiB, and
 * these used to cost three of them per layer (write half of the ping-pong pair,
 * dilate scratch, coverage mask) plus a full copy of the UV mesh.
 */

/**
 * Every paint render target. Nothing that renders into one depth-tests, so the
 * depth renderbuffer three attaches by default (DEPTH_COMPONENT24 — as large as
 * the color buffer itself) is pure waste.
 */
export function createPaintTarget(
  size: number,
  colorSpace: THREE.ColorSpace,
  format: THREE.PixelFormat = THREE.RGBAFormat
): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    format,
    type: THREE.UnsignedByteType,
    colorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false
  })
}

/**
 * Which pooled target. `spare` is the free half of every layer's ping-pong
 * pair: an operation renders into it and then trades it for the layer's old
 * buffer (see exchangeSpare), so N layers cost N + 1 buffers instead of 2N.
 * `scratch` is used by dilation. Neither holds anything between calls — every
 * paint operation swaps its result out of the spare before returning — so the
 * layer stack's recomposite borrows the pair for its own ping-pong too.
 */
export type PoolSlot = 'spare' | 'scratch'

interface PoolEntry {
  refs: number
  targets: Map<string, THREE.WebGLRenderTarget>
}

const pools = new WeakMap<THREE.WebGLRenderer, Map<number, PoolEntry>>()

function poolKey(colorSpace: THREE.ColorSpace, slot: PoolSlot): string {
  return `${colorSpace}|${slot}`
}

function entryFor(renderer: THREE.WebGLRenderer, size: number): PoolEntry {
  let bySize = pools.get(renderer)
  if (!bySize) {
    bySize = new Map()
    pools.set(renderer, bySize)
  }
  let entry = bySize.get(size)
  if (!entry) {
    entry = { refs: 0, targets: new Map() }
    bySize.set(size, entry)
  }
  return entry
}

/** Keeps the pool for `size` alive; pair every call with releasePool. */
export function retainPool(renderer: THREE.WebGLRenderer, size: number): void {
  entryFor(renderer, size).refs++
}

/** Frees every pooled target of `size` once nothing at that size remains. */
export function releasePool(renderer: THREE.WebGLRenderer, size: number): void {
  const bySize = pools.get(renderer)
  const entry = bySize?.get(size)
  if (!bySize || !entry) {
    return
  }
  entry.refs--
  if (entry.refs > 0) {
    return
  }
  for (const target of entry.targets.values()) {
    target.dispose()
  }
  bySize.delete(size)
}

/** A pooled target, created on first use. Its contents are undefined. */
export function poolTarget(
  renderer: THREE.WebGLRenderer,
  size: number,
  colorSpace: THREE.ColorSpace,
  slot: PoolSlot
): THREE.WebGLRenderTarget {
  const entry = entryFor(renderer, size)
  const key = poolKey(colorSpace, slot)
  let target = entry.targets.get(key)
  if (!target) {
    target = createPaintTarget(size, colorSpace)
    entry.targets.set(key, target)
  }
  return target
}

/**
 * Hands `retired` (a layer's previous buffer) to the pool as the next spare,
 * after the caller has adopted the current spare as its own.
 */
export function exchangeSpare(
  renderer: THREE.WebGLRenderer,
  size: number,
  retired: THREE.WebGLRenderTarget
): void {
  entryFor(renderer, size).targets.set(
    poolKey(retired.texture.colorSpace as THREE.ColorSpace, 'spare'),
    retired
  )
}

/**
 * Thrown instead of returning pixels once the WebGL context has been lost.
 * A lost context reads back as all zeros, and a restored one comes back with
 * every render target blank — saving either way would overwrite real work
 * (the project file, the autosave) with empty layers.
 */
export class GpuContextLostError extends Error {
  constructor() {
    super('The graphics context was lost, so layer pixels can no longer be read back.')
    this.name = 'GpuContextLostError'
  }
}

/** Renderers whose context has been lost at least once — sticky even after a restore. */
const lostRenderers = new WeakSet<THREE.WebGLRenderer>()

export function markContextLost(renderer: THREE.WebGLRenderer): void {
  lostRenderers.add(renderer)
}

/** Throws GpuContextLostError if reading pixels back from `renderer` can't be trusted. */
export function assertGpuReadable(renderer: THREE.WebGLRenderer): void {
  if (lostRenderers.has(renderer) || renderer.getContext().isContextLost()) {
    throw new GpuContextLostError()
  }
}

const ndcVertexShader = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/**
 * Per-mesh state every layer of a stack shares: the UV-flattened geometry and
 * its coverage mask. Both depend only on the mesh, so a copy per layer bought
 * nothing — and the geometry alone is ~336 bytes per triangle.
 */
export class PaintSurface {
  readonly geometry: THREE.BufferGeometry
  readonly textureSize: number
  private renderer: THREE.WebGLRenderer
  private mask: THREE.WebGLRenderTarget | null = null
  private _coverageUsable = true
  private disposed = false

  constructor(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, textureSize: number) {
    this.renderer = renderer
    this.textureSize = textureSize
    this.geometry = buildUvMesh(mesh).geometry
    retainPool(renderer, textureSize)
  }

  /**
   * UV coverage: 1 where a triangle of this mesh rasterizes, 0 elsewhere.
   * Single-channel — every consumer reads `.r` — so R8 rather than RGBA8.
   */
  get coverageMask(): THREE.WebGLRenderTarget {
    if (!this.mask) {
      this.mask = createPaintTarget(this.textureSize, THREE.NoColorSpace, THREE.RedFormat)
      this.rasterizeCoverage(this.mask)
      this._coverageUsable = this.measureCoverage()
      if (!this._coverageUsable) {
        console.warn(
          '[slip] UV coverage mask rasterized empty — masking and dilation are disabled for this ' +
            'mesh. Either its UVs are degenerate, or the mask pass is broken.'
        )
      }
    }
    return this.mask
  }

  /**
   * Whether the coverage mask actually came out with anything in it. A mask
   * that rasterized empty is indistinguishable from "this mesh covers no
   * texels", and anything that trusts it then erases the layer it was meant to
   * protect — so it is measured once and the destructive paths opt out.
   */
  get coverageUsable(): boolean {
    void this.coverageMask
    return this._coverageUsable
  }

  /**
   * Rasterizes the UV mesh as flat white.
   *
   * Must use an NDC passthrough vertex shader, like the paint material. The UV
   * mesh's positions ARE clip coordinates already (uv * 2 - 1, z = 0), so a
   * stock material — which multiplies them by the view/projection of an ortho
   * camera sitting at the origin with near = 0 — puts every triangle exactly
   * on the near plane and clips the lot. That silently produced a fully black
   * mask: dilation became a no-op, and anything that treats the mask as
   * coverage (atlas export, clipToCoverage) saw the mesh as covering nothing.
   */
  private rasterizeCoverage(target: THREE.WebGLRenderTarget): void {
    const material = new THREE.ShaderMaterial({
      vertexShader: ndcVertexShader,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
      // A glTF model's UV winding is reversed, so FrontSide culls the whole
      // flattened mesh and the mask comes out empty.
      side: THREE.DoubleSide,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false
    })
    const scene = new THREE.Scene()
    const flat = new THREE.Mesh(this.geometry, material)
    flat.frustumCulled = false
    scene.add(flat)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const prevTarget = this.renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    this.renderer.getClearColor(prevClear)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.setRenderTarget(target)
    this.renderer.clear(true, false, false)
    this.renderer.render(scene, camera)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevClear, prevClearAlpha)
    material.dispose()
  }

  /**
   * Re-rasterizes the coverage at a small fixed size purely to answer "did
   * anything land?". Reading the full-size mask back would mean pulling up to
   * 64 MB across the bus at 8192; a 64x64 copy costs 16 KB and only misses UV
   * islands too small to matter.
   */
  private measureCoverage(): boolean {
    const probe = new THREE.WebGLRenderTarget(64, 64, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false
    })
    this.rasterizeCoverage(probe)
    const pixels = new Uint8Array(64 * 64 * 4)
    this.renderer.readRenderTargetPixels(probe, 0, 0, 64, 64, pixels)
    probe.dispose()
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        return true
      }
    }
    return false
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.geometry.dispose()
    this.mask?.dispose()
    this.mask = null
    releasePool(this.renderer, this.textureSize)
  }
}

let expandMaterial: THREE.ShaderMaterial | null = null
let expandScene: THREE.Scene | null = null
const expandCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

/**
 * Reads any paint target back as RGBA8. readPixels only guarantees RGBA for
 * every format, so a single-channel target (the R8 coverage mask) is first
 * expanded to opaque grayscale through a temporary RGBA target.
 */
export function readTargetRgba(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  out: Uint8Array = new Uint8Array(target.width * target.height * 4)
): Uint8Array {
  assertGpuReadable(renderer)
  if (target.texture.format === THREE.RGBAFormat) {
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out)
    return out
  }
  if (!expandMaterial || !expandScene) {
    expandMaterial = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSrc;
        varying vec2 vUv;
        void main() { gl_FragColor = vec4(vec3(texture2D(uSrc, vUv).r), 1.0); }
      `,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false
    })
    expandScene = new THREE.Scene()
    expandScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), expandMaterial))
  }
  const temp = new THREE.WebGLRenderTarget(target.width, target.height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false
  })
  expandMaterial.uniforms.uSrc.value = target.texture
  const prevTarget = renderer.getRenderTarget()
  renderer.setRenderTarget(temp)
  renderer.render(expandScene, expandCamera)
  renderer.readRenderTargetPixels(temp, 0, 0, target.width, target.height, out)
  renderer.setRenderTarget(prevTarget)
  expandMaterial.uniforms.uSrc.value = null
  temp.dispose()
  return out
}
