import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type LightingMode = 'studio' | 'flat' | 'outdoor' | 'showcase'

export interface SceneHandle {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitPanZoomControls
  setLightingMode: (mode: LightingMode) => void
  /**
   * Fits the shadow camera and the ground catcher around the model. Called
   * whenever a model loads or changes size — a directional light's shadow
   * camera is an orthographic box, and one sized for the wrong model either
   * clips the shadow or wastes the whole depth map on empty space.
   */
  fitShadows: (center: THREE.Vector3, radius: number, groundY: number) => void
  dispose: () => void
}

/**
 * Blender/Substance-style navigation: orbit/pan/zoom all require Alt held,
 * distinguished by which mouse button is down (spec section 2). Wheel zoom
 * works without Alt since it can't collide with anything else.
 */
export class OrbitPanZoomControls {
  target = new THREE.Vector3(0, 0, 0)
  private spherical = new THREE.Spherical()
  private camera: THREE.PerspectiveCamera
  private domElement: HTMLElement
  private dragging: 'orbit' | 'pan' | 'zoom' | null = null
  private lastX = 0
  private lastY = 0

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera
    this.domElement = domElement
    this.syncSphericalFromCamera()

    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    this.onWheel = this.onWheel.bind(this)
    this.onContextMenu = this.onContextMenu.bind(this)

    domElement.addEventListener('pointerdown', this.onPointerDown)
    domElement.addEventListener('wheel', this.onWheel, { passive: false })
    domElement.addEventListener('contextmenu', this.onContextMenu)
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.domElement.removeEventListener('wheel', this.onWheel)
    this.domElement.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
  }

  private syncSphericalFromCamera(): void {
    const offset = this.camera.position.clone().sub(this.target)
    this.spherical.setFromVector3(offset)
  }

  private applySpherical(): void {
    const offset = new THREE.Vector3().setFromSpherical(this.spherical)
    this.camera.position.copy(this.target).add(offset)
    this.camera.lookAt(this.target)
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault()
  }

  private onPointerDown(e: PointerEvent): void {
    const isMmb = e.button === 1
    const isAlt = e.altKey

    if (isMmb) {
      this.dragging = e.shiftKey ? 'pan' : 'orbit'
    } else if (isAlt) {
      if (e.button === 0) {
        this.dragging = 'orbit'
      } else if (e.button === 1) {
        this.dragging = 'pan'
      } else if (e.button === 2) {
        this.dragging = 'zoom'
      } else {
        return
      }
    } else {
      return
    }

    e.preventDefault()
    this.lastX = e.clientX
    this.lastY = e.clientY
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) {
      return
    }
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY

    if (this.dragging === 'orbit') {
      this.orbitBy(dx, dy)
    } else if (this.dragging === 'pan') {
      const panScale = this.spherical.radius * 0.0015
      const right = new THREE.Vector3()
      const up = new THREE.Vector3()
      this.camera.matrix.extractBasis(right, up, new THREE.Vector3())
      this.target.addScaledVector(right, -dx * panScale)
      this.target.addScaledVector(up, dy * panScale)
      this.applySpherical()
    } else if (this.dragging === 'zoom') {
      this.spherical.radius *= 1 + dy * 0.005
      this.spherical.radius = Math.max(0.05, this.spherical.radius)
      this.applySpherical()
    }
  }

  private onPointerUp(): void {
    this.dragging = null
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
  }

  private onWheel(e: WheelEvent): void {
    if (e.shiftKey) {
      // Shift+Wheel is reserved for brush radius / scale adjustment in viewport
      return
    }
    e.preventDefault()
    this.spherical.radius *= 1 + Math.sign(e.deltaY) * 0.1
    this.spherical.radius = Math.max(0.05, this.spherical.radius)
    this.applySpherical()
  }

  /** Orbits the camera around `target` by a screen-space pixel delta. Shared by pointer-drag orbit and the corner gizmo. */
  orbitBy(dx: number, dy: number): void {
    this.spherical.theta -= dx * 0.005
    this.spherical.phi -= dy * 0.005
    this.spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, this.spherical.phi))
    this.applySpherical()
  }

  /** Frame the given world-space bounding sphere (spec: "F" key). */
  focus(center: THREE.Vector3, radius: number): void {
    this.target.copy(center)
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const distance = (radius / Math.sin(fov / 2)) * 1.3
    this.spherical.radius = Math.max(distance, 0.1)
    this.applySpherical()
  }
}

interface LightingConfig {
  /** Weight of the image-based environment light for this preset. */
  envIntensity: number
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  keyIntensity: number
  keyColor: number
  fillIntensity: number
  fillColor: number
  rimIntensity: number
  rimColor: number
  exposure: number
  background: number
  /**
   * Cast shadows. Off for the working presets: a shadow darkens the very
   * texels being judged, and the depth pass costs a second scene render every
   * frame. Showcase exists to look at the finished result, which is where a
   * contact shadow earns its keep.
   */
  shadows?: boolean
  /** Strength of the ground shadow, 0-1. */
  shadowOpacity?: number
  /**
   * Where the key light sits, when a preset needs a specific angle rather than
   * the default three-point placement. A grazing key is the difference between
   * a normal map you can see and one you have to take on faith: light arriving
   * near-parallel to the surface throws every bump's shading across the whole
   * facet, while an overhead key lights bump and valley almost equally.
   */
  keyPosition?: [number, number, number]
}

/** Standard three-point key placement, used by every preset that doesn't move it. */
const DEFAULT_KEY_POSITION: [number, number, number] = [3, 5, 2]

const LIGHTING_PRESETS: Record<LightingMode, LightingConfig> = {
  // Balanced 3-point rig with gentle contrast — general-purpose default.
  studio: {
    hemiSky: 0xffffff,
    hemiGround: 0x3a3a44,
    hemiIntensity: 1.6,
    keyIntensity: 2.4,
    keyColor: 0xffffff,
    fillIntensity: 0.9,
    fillColor: 0xcfe0ff,
    rimIntensity: 1.1,
    rimColor: 0xffffff,
    exposure: 1.1,
    envIntensity: 0.85,
    // A near-black background makes thin/grazing-angle edges look like harsh
    // black outlines wherever GPU edge antialiasing blends surface color
    // toward it — a much lighter neutral gray keeps that same antialiasing
    // from ever reading as "black," matching what other texture painters do.
    background: 0x3a3a40
  },
  // Bright, near-shadowless — for judging true texture color while painting.
  flat: {
    hemiSky: 0xffffff,
    hemiGround: 0xe8e8ec,
    hemiIntensity: 3.6,
    keyIntensity: 0.15,
    keyColor: 0xffffff,
    fillIntensity: 0.15,
    fillColor: 0xffffff,
    rimIntensity: 0,
    rimColor: 0xffffff,
    exposure: 1.35,
    // Flat mode exists to judge raw texture color: a strong environment would
    // paint reflections over exactly the thing being judged.
    envIntensity: 0.15,
    background: 0x57575e
  },
  // Strong warm sun + cool sky fill, higher contrast — good for checking material response.
  outdoor: {
    hemiSky: 0xaecbff,
    hemiGround: 0x1a1610,
    hemiIntensity: 0.9,
    keyIntensity: 5.5,
    keyColor: 0xffe4b0,
    fillIntensity: 0.35,
    fillColor: 0x6f9fff,
    rimIntensity: 0.5,
    rimColor: 0xaecbff,
    exposure: 1.0,
    envIntensity: 1.2,
    background: 0x2e333c
  },
  // Environment-dominant, for judging PBR material response rather than form.
  //
  // Roughness and metalness are read off *reflections*: a metal shows whatever
  // surrounds it, and gloss reads as how sharply the surroundings appear in the
  // surface. Direct lights give a surface almost nothing to reflect but a few
  // hot spots, which is why a correct metalness map can look like flat grey
  // paint under the other presets. Here the image-based environment carries the
  // lighting and the direct rig drops to a single raking key — kept only
  // because a grazing angle is what makes normal-map relief legible.
  showcase: {
    hemiSky: 0xffffff,
    hemiGround: 0x2a2a33,
    hemiIntensity: 0.25,
    keyIntensity: 1.4,
    keyColor: 0xfff2e0,
    fillIntensity: 0.1,
    fillColor: 0xbfd4ff,
    rimIntensity: 0.6,
    rimColor: 0xdce8ff,
    exposure: 1.0,
    envIntensity: 2.4,
    // Low and to the side: a raking angle across the surface.
    keyPosition: [4.5, 0.9, 2.2],
    shadows: true,
    shadowOpacity: 0.4,
    // Darker ground than the other presets so specular highlights and
    // reflections read against it instead of competing with a bright field.
    background: 0x23252b
  }
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x3a3a40)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000)
  camera.position.set(2, 1.5, 2.5)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    precision: 'highp'
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  // PCF rather than hard edges: one directional light casting a crisp stencil
  // looks like a bug next to an image-based environment. (PCFSoftShadowMap is
  // deprecated as of three r185 and silently falls back to this anyway; the
  // softness comes from the map size and the light's shadow radius instead.)
  // Left enabled as a capability and switched per preset below.
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.enabled = false

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.1)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(...DEFAULT_KEY_POSITION)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  // A painted surface is exactly where shadow acne shows worst — it stripes the
  // texture the artist is judging. normalBias pushes the comparison along the
  // surface normal, which handles curved and grazing-lit geometry far better
  // than a constant depth bias alone; the small negative bias cleans up the rest
  // without opening a visible gap at contact points ("peter-panning").
  key.shadow.radius = 3
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  scene.add(key)
  scene.add(key.target)
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6)
  fill.position.set(-4, 1.5, -2)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffffff, 0.8)
  rim.position.set(-1, 2, -4)
  scene.add(rim)

  function setLightingMode(mode: LightingMode): void {
    const c = LIGHTING_PRESETS[mode]
    hemi.color.set(c.hemiSky)
    hemi.groundColor.set(c.hemiGround)
    hemi.intensity = c.hemiIntensity
    key.color.set(c.keyColor)
    key.intensity = c.keyIntensity
    fill.color.set(c.fillColor)
    fill.intensity = c.fillIntensity
    rim.color.set(c.rimColor)
    rim.intensity = c.rimIntensity
    key.position.set(...(c.keyPosition ?? DEFAULT_KEY_POSITION))

    const shadows = !!c.shadows
    renderer.shadowMap.enabled = shadows
    shadowCatcher.visible = shadows
    shadowCatcherMaterial.opacity = c.shadowOpacity ?? 0.4
    if (shadows) {
      // The preset just moved the key, and shadow maps are only re-rendered
      // when something asks: re-fit against the last known model bounds.
      fitShadows(shadowFit.center, shadowFit.radius, shadowFit.groundY)
    }

    renderer.toneMappingExposure = c.exposure
    scene.environmentIntensity = c.envIntensity
    scene.background = new THREE.Color(c.background)
  }

  // Image-based lighting. Roughness and metalness are only legible against a
  // varied environment: a metal surface renders as whatever it reflects, and
  // with directional lights alone it has nothing to reflect but a couple of
  // point highlights on black — so a painted metalness map would look like
  // dark grey paint rather than metal. RoomEnvironment is generated in-process
  // (no HDRI file to ship or fetch) and prefiltered once into a PMREM cubemap.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = environmentTexture
  pmrem.dispose()

  const grid = new THREE.GridHelper(10, 20, 0x333340, 0x22222a)
  scene.add(grid)

  /**
   * Invisible ground that receives the model's shadow. ShadowMaterial renders
   * nothing but the shadow itself, so the plane never hides the grid or shifts
   * the background color — the model just gains something to sit on.
   */
  const shadowCatcherMaterial = new THREE.ShadowMaterial({ opacity: 0.4, transparent: true })
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowCatcherMaterial)
  shadowCatcher.rotation.x = -Math.PI / 2
  shadowCatcher.receiveShadow = true
  shadowCatcher.visible = false
  // Under the grid lines, so a shadow never draws over them.
  shadowCatcher.renderOrder = -1
  scene.add(shadowCatcher)

  /** Last fit, replayed when a preset turns shadows on after a model is loaded. */
  let shadowFit = { center: new THREE.Vector3(0, 0.5, 0), radius: 1.5, groundY: 0 }

  function fitShadows(center: THREE.Vector3, radius: number, groundY: number): void {
    shadowFit = { center: center.clone(), radius: Math.max(radius, 0.05), groundY }

    const r = shadowFit.radius
    // The key is a direction, not a place: park it that direction away from the
    // model at a distance scaled to the model, so the same rig works for a
    // 0.1-unit prop and a 50-unit building.
    const dir = key.position.clone().normalize()
    key.position.copy(center).addScaledVector(dir, r * 4)
    key.target.position.copy(center)
    key.target.updateMatrixWorld()

    const cam = key.shadow.camera
    // 1.6x the bounding sphere: enough slack for a shadow cast well past the
    // silhouette at the raking showcase angle.
    const half = r * 1.6
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 0.01
    cam.far = r * 10
    cam.updateProjectionMatrix()

    shadowCatcher.position.set(center.x, groundY, center.z)
    shadowCatcher.scale.set(r * 8, r * 8, 1)
    renderer.shadowMap.needsUpdate = true
  }

  // Applied here, not next to the light rig: the preset drives the shadow
  // catcher and the shadow-camera fit, which only exist from this point on.
  setLightingMode('showcase')

  const controls = new OrbitPanZoomControls(camera, renderer.domElement)
  controls.focus(new THREE.Vector3(0, 0.5, 0), 1.5)

  function resize(): void {
    const parent = canvas.parentElement
    if (!parent) {
      return
    }
    const { clientWidth: w, clientHeight: h } = parent
    if (w === 0 || h === 0) {
      return
    }
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const resizeObserver = new ResizeObserver(resize)
  if (canvas.parentElement) {
    resizeObserver.observe(canvas.parentElement)
  }
  resize()

  function dispose(): void {
    shadowCatcher.geometry.dispose()
    shadowCatcherMaterial.dispose()
    environmentTexture.dispose()
    resizeObserver.disconnect()
    controls.dispose()
    renderer.dispose()
  }

  return { scene, camera, renderer, controls, setLightingMode, fitShadows, dispose }
}
