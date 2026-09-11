import * as THREE from 'three'

export type LightingMode = 'studio' | 'flat' | 'outdoor'

export interface SceneHandle {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitPanZoomControls
  setLightingMode: (mode: LightingMode) => void
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
    if (!this.dragging) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY

    if (this.dragging === 'orbit') {
      this.spherical.theta -= dx * 0.005
      this.spherical.phi -= dy * 0.005
      this.spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, this.spherical.phi))
      this.applySpherical()
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
}

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
    background: 0x2e333c
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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.1)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(3, 5, 2)
  scene.add(key)
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
    renderer.toneMappingExposure = c.exposure
    scene.background = new THREE.Color(c.background)
  }
  setLightingMode('studio')

  const grid = new THREE.GridHelper(10, 20, 0x333340, 0x22222a)
  scene.add(grid)

  const controls = new OrbitPanZoomControls(camera, renderer.domElement)
  controls.focus(new THREE.Vector3(0, 0.5, 0), 1.5)

  function resize(): void {
    const parent = canvas.parentElement
    if (!parent) return
    const { clientWidth: w, clientHeight: h } = parent
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const resizeObserver = new ResizeObserver(resize)
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)
  resize()

  function dispose(): void {
    resizeObserver.disconnect()
    controls.dispose()
    renderer.dispose()
  }

  return { scene, camera, renderer, controls, setLightingMode, dispose }
}
