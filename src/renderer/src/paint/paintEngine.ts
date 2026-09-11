import * as THREE from 'three'
import { buildUvMesh } from './uvMesh'
import { createPaintMaterial } from './paintShader'
import type { SurfaceHit } from '../viewport/raycast'

export const DEFAULT_TEXTURE_SIZE = 1024
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
export function configurePremultipliedSourceMaterial(material: THREE.MeshBasicMaterial, opacity: number): void {
  material.transparent = true
  material.opacity = opacity
  material.color.setScalar(opacity)
  material.blending = THREE.CustomBlending
  material.blendEquation = THREE.AddEquation
  material.blendSrc = THREE.OneFactor
  material.blendDst = THREE.OneMinusSrcAlphaFactor
}

function createRenderTarget(size: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  })
  return target
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
  color: THREE.Color
  alpha?: number
  brushTexture?: THREE.Texture | null
  textureScale?: number
  /** true = Stamp tool (whole image projected flat, once per application); false = Texture Brush (world-space tiling). */
  stampMode?: boolean
  /** Confine this stroke to these triangles (spec: face selection — SurfaceHit.faceIndex), empty/undefined = unrestricted. */
  restrictFaces?: ReadonlySet<number> | null
}

/**
 * Owns the ping-pong base-color render targets for one mesh and paints
 * strokes onto them via the UV-flattened mesh + custom shader (spec
 * section 4.3-4.4). Only the baseColor channel is implemented — roughness/
 * metalness/normal ping-pong pairs follow the same pattern once needed.
 */
export class PaintEngine {
  private renderer: THREE.WebGLRenderer
  private uvMesh: THREE.Mesh
  private material: ReturnType<typeof createPaintMaterial>
  private orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private orthoScene = new THREE.Scene()
  private targetA: THREE.WebGLRenderTarget
  private targetB: THREE.WebGLRenderTarget
  private readTarget: THREE.WebGLRenderTarget
  private writeTarget: THREE.WebGLRenderTarget
  private coverageMask: THREE.WebGLRenderTarget
  private dilateMaterial: THREE.ShaderMaterial
  private dilateQuad: THREE.Mesh
  private dilateScene = new THREE.Scene()
  /** Color+alpha the eraser reveals — opaque base gray for a background layer, transparent for a stacked one. */
  readonly baseColor: THREE.Color
  readonly baseAlpha: number
  readonly textureSize: number

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

    this.targetA = createRenderTarget(textureSize)
    this.targetB = createRenderTarget(textureSize)
    this.readTarget = this.targetA
    this.writeTarget = this.targetB

    // A hardware clear (not a blended quad) so the target's alpha channel
    // ends up exactly baseAlpha regardless of the renderer's own default
    // clear color/alpha — a transparent (opacity 0) quad can't be trusted to
    // undo whatever autoClear wrote first.
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(this.baseColor, this.baseAlpha)
    this.renderer.setRenderTarget(this.targetA)
    this.renderer.clear(true, true, true)
    this.renderer.setRenderTarget(this.targetB)
    this.renderer.clear(true, true, true)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)

    this.coverageMask = createRenderTarget(textureSize)
    this.dilateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: null },
        uMask: { value: this.coverageMask.texture },
        uTexelSize: { value: new THREE.Vector2(1 / textureSize, 1 / textureSize) }
      },
      vertexShader: dilateVertexShader,
      fragmentShader: dilateFragmentShader,
      depthTest: false,
      depthWrite: false
    })
    this.dilateQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dilateMaterial)
    this.dilateScene.add(this.dilateQuad)
    this.buildCoverageMask()
  }

  /** Rasterizes the UV mesh as flat white once — used to guide edge dilation (see dilateFragmentShader). */
  private buildCoverageMask(): void {
    const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
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

  /** Bleeds `target`'s island-edge colors outward into gutter texels by a couple texels (see dilateFragmentShader). */
  private dilate(target: THREE.WebGLRenderTarget, iterations = 4): void {
    if (!this.scratchDilateTarget) this.scratchDilateTarget = createRenderTarget(this.textureSize)
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

  /** Rewrites the uvMesh's `aSelected` attribute (see uvMesh.ts) from a set of triangle indices, for the paint shader's face-restriction mask. */
  private setSelectionMask(faces: ReadonlySet<number> | null | undefined): void {
    const attr = this.uvMesh.geometry.getAttribute('aSelected') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    arr.fill(0)
    if (faces) {
      for (const face of faces) {
        const base = face * 3
        if (base < 0 || base + 2 >= arr.length) continue
        arr[base] = 1
        arr[base + 1] = 1
        arr[base + 2] = 1
      }
    }
    attr.needsUpdate = true
  }

  get texture(): THREE.Texture {
    return this.readTarget.texture
  }

  paintStroke(hit: SurfaceHit, params: StrokeParams): void {
    const u = this.material.uniforms
    u.uPrevTexture.value = this.readTarget.texture
    u.uBrushWorldPos.value.copy(hit.point)
    u.uBrushNormal.value.copy(hit.normal)
    u.uBrushRadius.value = params.radius
    u.uBrushHardness.value = params.hardness
    u.uBrushOpacity.value = params.opacity
    u.uBrushColor.value.set(params.color.r, params.color.g, params.color.b, params.alpha ?? 1)
    u.uBrushTexture.value = params.brushTexture ?? null
    u.uUseTexture.value = params.brushTexture ? 1 : 0
    u.uTextureScale.value = params.textureScale ?? 1
    u.uStampMode.value = params.stampMode ? 1 : 0
    u.uFillMode.value = 0
    const restrict = !!params.restrictFaces && params.restrictFaces.size > 0
    u.uRestrictFace.value = restrict ? 1 : 0
    if (restrict) this.setSelectionMask(params.restrictFaces)

    if (params.stampMode) {
      // Arbitrary but stable tangent basis for the stamp's local plane, built
      // from whichever world axis is least parallel to the surface normal.
      const up = Math.abs(hit.normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
      const tangent = new THREE.Vector3().crossVectors(up, hit.normal).normalize()
      const bitangent = new THREE.Vector3().crossVectors(hit.normal, tangent).normalize()
      u.uBrushTangent.value.copy(tangent)
      u.uBrushBitangent.value.copy(bitangent)
    }

    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.writeTarget)
    this.renderer.render(this.orthoScene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    this.dilate(this.writeTarget)

    const tmp = this.readTarget
    this.readTarget = this.writeTarget
    this.writeTarget = tmp
  }

  /** Fills the whole active layer with a solid color (spec: bucket tool). */
  fill(color: THREE.Color, alpha = 1): void {
    const fillScene = new THREE.Scene()
    // A fresh straight-alpha color source (not sampled from a premultiplied
    // render target), so three's own premultipliedAlpha flag is exactly right.
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alpha, premultipliedAlpha: true })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    fillScene.add(quad)
    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.writeTarget)
    this.renderer.render(fillScene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    mat.dispose()
    quad.geometry.dispose()

    const tmp = this.readTarget
    this.readTarget = this.writeTarget
    this.writeTarget = tmp
  }

  /** Fills only the given triangles (spec: bucket fill by face selection — SurfaceHit.faceIndex, multi-select). */
  fillFaces(faces: ReadonlySet<number>, color: THREE.Color, alpha = 1): void {
    if (faces.size === 0) return
    this.setSelectionMask(faces)
    const u = this.material.uniforms
    u.uPrevTexture.value = this.readTarget.texture
    u.uBrushColor.value.set(color.r, color.g, color.b, alpha)
    u.uBrushOpacity.value = 1
    u.uFillMode.value = 1
    u.uRestrictFace.value = 1
    u.uUseTexture.value = 0
    u.uStampMode.value = 0

    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.writeTarget)
    this.renderer.render(this.orthoScene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    this.dilate(this.writeTarget)

    u.uFillMode.value = 0
    u.uRestrictFace.value = 0

    const tmp = this.readTarget
    this.readTarget = this.writeTarget
    this.writeTarget = tmp
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

    const prevAutoClear = this.renderer.autoClear
    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(other.writeTarget)
    this.renderer.clear(true, true, true)
    drawQuad(other.readTarget.texture, 1)
    drawQuad(this.readTarget.texture, opacity)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear

    const tmp = other.readTarget
    other.readTarget = other.writeTarget
    other.writeTarget = tmp
  }

  /** Copies this layer's content onto another PaintEngine buffer (for duplication). */
  copyOnto(other: PaintEngine): void {
    const mat = new THREE.MeshBasicMaterial({ map: this.readTarget.texture })
    configurePremultipliedSourceMaterial(mat, 1)
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    const scene = new THREE.Scene()
    scene.add(quad)

    const prevAutoClear = this.renderer.autoClear
    const prevTarget = this.renderer.getRenderTarget()
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(other.writeTarget)
    this.renderer.clear(true, true, true)
    this.renderer.render(scene, this.orthoCamera)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
    mat.dispose()
    quad.geometry.dispose()

    const tmp = other.readTarget
    other.readTarget = other.writeTarget
    other.writeTarget = tmp
  }

  /** Clears this layer's buffer back to baseColor / baseAlpha. */
  clear(): void {
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(this.baseColor, this.baseAlpha)
    this.renderer.setRenderTarget(this.readTarget)
    this.renderer.clear(true, true, true)
    this.renderer.setRenderTarget(this.writeTarget)
    this.renderer.clear(true, true, true)
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
    this.renderer.setRenderTarget(prevTarget)
  }

  /** Reads back the pixel color at a given UV (spec: eyedropper). */
  sampleAt(uv: THREE.Vector2): THREE.Color {
    const x = Math.floor(uv.x * this.textureSize)
    const y = Math.floor(uv.y * this.textureSize)
    const buffer = new Uint8Array(4)
    this.renderer.readRenderTargetPixels(this.readTarget, x, y, 1, 1, buffer)
    // Stored premultiplied (see paintShader.ts) — undo it to get the true color.
    const a = buffer[3]
    if (a === 0) return new THREE.Color(0, 0, 0)
    return new THREE.Color(buffer[0] / a, buffer[1] / a, buffer[2] / a)
  }

  dispose(): void {
    this.targetA.dispose()
    this.targetB.dispose()
    this.material.dispose()
    this.uvMesh.geometry.dispose()
    this.coverageMask.dispose()
    this.dilateMaterial.dispose()
    this.dilateQuad.geometry.dispose()
    this.scratchDilateTarget?.dispose()
  }
}

