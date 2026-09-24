import * as THREE from 'three'

/**
 * Renders *only the model meshes* into an offscreen linear-depth map from the
 * paint camera, so paintShader.ts can reject texels that aren't actually
 * visible from that camera (e.g. the far wall of a thin shell directly behind
 * the face under the brush).
 *
 * Two things make this reliable where a plain `scene.overrideMaterial` +
 * DepthTexture pass is not:
 *
 * 1. Everything that isn't a model mesh is hidden for the pass. The brush
 *    cursor ring/tip quad sits *exactly* on the hit point, the face-highlight
 *    and wireframe overlays are children of the model mesh itself, and the
 *    symmetry guide plane cuts straight through the model — rendering any of
 *    them into the map puts geometry in front of the surface being painted and
 *    rejects the whole stroke.
 * 2. The map stores linear camera-space distance normalised by `far`, not
 *    window-space depth. Reconstructing view Z from a 24-bit non-linear depth
 *    buffer with near = 0.01 / far = 1000 makes any fixed bias meaningless
 *    (it's worth millimetres at one camera distance and metres at another);
 *    storing Z directly means the comparison and the bias are both in world
 *    units. Unwritten texels clear to 1.0 (= `far`), so background never
 *    occludes.
 *
 * The target matches the canvas aspect ratio so the NDC -> uv mapping the
 * paint shader does lands on the same texel the camera rasterised.
 */
const MAX_DEPTH_TARGET_SIZE = 2048

const depthVertexShader = /* glsl */ `
  varying float vViewZ;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewZ = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const depthFragmentShader = /* glsl */ `
  uniform float uFar;
  varying float vViewZ;
  void main() {
    gl_FragColor = vec4(clamp(vViewZ / uFar, 0.0, 1.0), 0.0, 0.0, 1.0);
  }
`

export class OcclusionDepthPass {
  private target: THREE.WebGLRenderTarget
  private overrideMaterial: THREE.ShaderMaterial
  /** Objects hidden for the duration of one capture, restored right after. */
  private hidden: THREE.Object3D[] = []
  private prevClearColor = new THREE.Color()
  /** Camera + viewport state the current map was captured with, so a stroke of
   * many dabs from a stationary camera only pays for one scene render. */
  private cacheKey = ''

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter
    })
    this.overrideMaterial = new THREE.ShaderMaterial({
      vertexShader: depthVertexShader,
      fragmentShader: depthFragmentShader,
      uniforms: { uFar: { value: 1000 } },
      // Open/single-sided meshes still have to occlude from either winding, and a
      // flipped-normal import must not punch a hole in the map.
      side: THREE.DoubleSide
    })
  }

  get depthTexture(): THREE.Texture {
    return this.target.texture
  }

  /** Texel size of the map, for the neighbourhood max the paint shader takes. */
  get texelSize(): THREE.Vector2 {
    return new THREE.Vector2(1 / this.target.width, 1 / this.target.height)
  }

  /**
   * Captures linear camera-space depth of `meshes` only. Returns without
   * re-rendering when the camera and viewport haven't moved since the last
   * capture — a drag stroke fires one of these per dab otherwise.
   */
  capture(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    meshes: readonly THREE.Object3D[]
  ): void {
    this.resizeToCanvas(renderer)

    camera.updateMatrixWorld()
    // Keyed on everything that changes what the map should contain: the
    // camera, the viewport, and where the meshes actually are in world space.
    let meshKey = ''
    for (const m of meshes) {
      m.updateWorldMatrix(true, false)
      meshKey += m.id + ':' + m.matrixWorld.elements.join(',') + ';'
    }
    const key = `${camera.matrixWorld.elements.join(',')}|${camera.projectionMatrix.elements.join(
      ','
    )}|${this.target.width}x${this.target.height}|${meshKey}`
    if (key === this.cacheKey) {
      return
    }
    this.cacheKey = key

    this.overrideMaterial.uniforms.uFar.value = camera.far

    const keep = new Set<THREE.Object3D>(meshes)
    this.hideEverythingElse(scene, keep)

    const prevTarget = renderer.getRenderTarget()
    const prevOverride = scene.overrideMaterial
    const prevAlpha = renderer.getClearAlpha()
    const prevBackground = scene.background
    renderer.getClearColor(this.prevClearColor)

    /**
     * The background has to go for the duration of the pass.
     *
     * three renders a cube/equirect `scene.background` by unshifting its own
     * box mesh into the opaque render list, which means `overrideMaterial`
     * catches it like any other object — and the override writes depth. The
     * result is a map with 100% coverage at the backdrop's distance, so the
     * 3x3 neighbourhood max in brushMask.ts reads the backdrop instead of the
     * far plane along every silhouette and the occlusion test quietly stops
     * rejecting anything there. Clearing to white already means "nothing in
     * front of you", which is exactly what the background should contribute.
     */
    scene.background = null
    scene.overrideMaterial = this.overrideMaterial
    renderer.setRenderTarget(this.target)
    // White = far plane: anywhere the model didn't rasterise must read as
    // "nothing in front of you", never as "occluded at z = 0".
    renderer.setClearColor(0xffffff, 1)
    renderer.clear(true, true, false)
    renderer.render(scene, camera)

    renderer.setClearColor(this.prevClearColor, prevAlpha)
    renderer.setRenderTarget(prevTarget)
    scene.overrideMaterial = prevOverride
    scene.background = prevBackground
    this.restoreHidden()
  }

  /**
   * Diagnostic: reads the map back and reports how much of it the model
   * actually covers and the near/far distances written. `coverage: 0` means
   * the depth pass rendered nothing — the whole occlusion test is then a
   * no-op (everything reads as `far`, so nothing is ever rejected).
   */
  debugStats(
    renderer: THREE.WebGLRenderer,
    far: number
  ): {
    width: number
    height: number
    coverage: number
    minDist: number
    maxDist: number
  } {
    const { width, height } = this.target
    const buf = new Uint16Array(width * height * 4)
    const prevTarget = renderer.getRenderTarget()
    renderer.readRenderTargetPixels(this.target, 0, 0, width, height, buf)
    renderer.setRenderTarget(prevTarget)

    let covered = 0
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < buf.length; i += 4) {
      const v = THREE.DataUtils.fromHalfFloat(buf[i])
      if (v >= 0.999) {
        continue
      }
      covered++
      const d = v * far
      if (d < min) {
        min = d
      }
      if (d > max) {
        max = d
      }
    }
    return {
      width,
      height,
      coverage: covered / (width * height),
      minDist: covered ? min : NaN,
      maxDist: covered ? max : NaN
    }
  }

  /** Forces the next capture() to re-render (model changed, mesh added, …). */
  invalidate(): void {
    this.cacheKey = ''
  }

  private resizeToCanvas(renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const scale = Math.min(1, MAX_DEPTH_TARGET_SIZE / Math.max(size.x, size.y, 1))
    const w = Math.max(1, Math.floor(size.x * scale))
    const h = Math.max(1, Math.floor(size.y * scale))
    if (w !== this.target.width || h !== this.target.height) {
      this.target.setSize(w, h)
      this.cacheKey = ''
    }
  }

  private hideEverythingElse(scene: THREE.Scene, keep: Set<THREE.Object3D>): void {
    scene.traverse((obj) => {
      if (!obj.visible || keep.has(obj)) {
        return
      }
      const renderable =
        (obj as THREE.Mesh).isMesh ||
        (obj as THREE.Line).isLine ||
        (obj as THREE.Points).isPoints ||
        (obj as THREE.Sprite).isSprite
      if (!renderable) {
        return
      }
      obj.visible = false
      this.hidden.push(obj)
    })
  }

  private restoreHidden(): void {
    for (const obj of this.hidden) {
      obj.visible = true
    }
    this.hidden.length = 0
  }

  dispose(): void {
    this.target.dispose()
    this.overrideMaterial.dispose()
  }
}
