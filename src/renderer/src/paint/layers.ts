import * as THREE from 'three'
import { PaintEngine, configurePremultipliedSourceMaterial, DEFAULT_TEXTURE_SIZE } from './paintEngine'
import { renderThumbnail } from './thumbnail'

let nextId = 1

export interface Layer {
  id: number
  name: string
  visible: boolean
  opacity: number
  engine: PaintEngine
}

/**
 * A minimal Photoshop-style layer stack (spec section 6): each layer owns
 * its own PaintEngine (own ping-pong buffers), and the visible, opacity-
 * weighted result is re-composited into one target that the mesh's
 * material.map always points at — so unlike a single PaintEngine's ping-pong
 * swap, the material reference never needs to change after setup.
 */
export class LayerStack {
  layers: Layer[] = []
  activeId = 0
  readonly compositeTarget: THREE.WebGLRenderTarget
  private renderer: THREE.WebGLRenderer
  private mesh: THREE.Mesh
  private orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  readonly textureSize: number

  constructor(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, textureSize: number = DEFAULT_TEXTURE_SIZE) {
    this.renderer = renderer
    this.mesh = mesh
    this.textureSize = textureSize
    this.compositeTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    })
    this.addLayer('Background')
    this.recomposite()
  }

  get active(): Layer | undefined {
    return this.layers.find((l) => l.id === this.activeId)
  }

  get texture(): THREE.Texture {
    return this.compositeTarget.texture
  }

  addLayer(name?: string): Layer {
    const isFirst = this.layers.length === 0
    const engine = new PaintEngine(this.renderer, this.mesh, isFirst ? new THREE.Color(0x999999) : null, this.textureSize)
    const layer: Layer = { id: nextId++, name: name ?? `Layer ${this.layers.length + 1}`, visible: true, opacity: 1, engine }
    this.layers.push(layer)
    this.activeId = layer.id
    this.recomposite()
    return layer
  }

  removeLayer(id: number): void {
    if (this.layers.length <= 1) return
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) return
    const [removed] = this.layers.splice(index, 1)
    removed.engine.dispose()
    if (this.activeId === id) {
      this.activeId = this.layers[Math.max(0, index - 1)].id
    }
    this.recomposite()
  }

  setVisible(id: number, visible: boolean): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer) {
      layer.visible = visible
      this.recomposite()
    }
  }

  setOpacity(id: number, opacity: number): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer) {
      layer.opacity = opacity
      this.recomposite()
    }
  }

  /** Merges the given layer onto the one below it in the stack (spec: Merge Down). */
  mergeDown(id: number): void {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index <= 0) return
    const top = this.layers[index]
    const below = this.layers[index - 1]
    top.engine.mergeOnto(below.engine, top.opacity)
    top.engine.dispose()
    this.layers.splice(index, 1)
    this.activeId = below.id
    this.recomposite()
  }

  moveLayer(id: number, direction: 'up' | 'down'): void {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) return
    const targetIndex = direction === 'up' ? index + 1 : index - 1
    if (targetIndex < 0 || targetIndex >= this.layers.length) return
    const [layer] = this.layers.splice(index, 1)
    this.layers.splice(targetIndex, 0, layer)
    this.recomposite()
  }

  renameLayer(id: number, name: string): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer && name.trim()) {
      layer.name = name.trim()
    }
  }

  duplicateLayer(id: number): Layer | undefined {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) return undefined
    const source = this.layers[index]
    const engine = new PaintEngine(this.renderer, this.mesh, null, this.textureSize)
    source.engine.copyOnto(engine)
    const layer: Layer = {
      id: nextId++,
      name: `${source.name} Copy`,
      visible: source.visible,
      opacity: source.opacity,
      engine
    }
    this.layers.splice(index + 1, 0, layer)
    this.activeId = layer.id
    this.recomposite()
    return layer
  }

  /** Bucket-fills only the given triangles on the active layer (spec: fill by face selection, multi-select). */
  fillActiveFaces(faces: ReadonlySet<number>, color: THREE.Color, alpha = 1): void {
    this.active?.engine.fillFaces(faces, color, alpha)
    this.recomposite()
  }

  clearLayer(id: number): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer) {
      layer.engine.clear()
      this.recomposite()
    }
  }


  /** Re-renders the visible, opacity-weighted stack into the shared composite target. */
  recomposite(): void {
    const prevAutoClear = this.renderer.autoClear
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(this.compositeTarget)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear(true, true, true)
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
    for (const layer of this.layers) {
      if (!layer.visible) continue
      const mat = new THREE.MeshBasicMaterial({ map: layer.engine.texture })
      configurePremultipliedSourceMaterial(mat, layer.opacity)
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
      const scene = new THREE.Scene()
      scene.add(quad)
      this.renderer.render(scene, this.orthoCamera)
      mat.dispose()
      quad.geometry.dispose()
    }
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
  }

  /** Low-res preview thumbnail of one layer's own buffer (not the composite). */
  previewFor(layer: Layer): string {
    return renderThumbnail(this.renderer, layer.engine.texture)
  }

  /** Reads back the composited pixel color at a given UV (spec: eyedropper). */
  sampleAt(uv: THREE.Vector2): THREE.Color {
    const x = Math.floor(uv.x * this.textureSize)
    const y = Math.floor(uv.y * this.textureSize)
    const buffer = new Uint8Array(4)
    this.renderer.readRenderTargetPixels(this.compositeTarget, x, y, 1, 1, buffer)
    // Stored premultiplied (see paintShader.ts) — undo it to get the true color.
    const a = buffer[3]
    if (a === 0) return new THREE.Color(0, 0, 0)
    return new THREE.Color(buffer[0] / a, buffer[1] / a, buffer[2] / a)
  }

  dispose(): void {
    for (const layer of this.layers) layer.engine.dispose()
    this.compositeTarget.dispose()
  }
}
