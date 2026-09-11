import * as THREE from 'three'
import {
  PaintEngine,
  configurePremultipliedSourceMaterial,
  DEFAULT_TEXTURE_SIZE,
  type FillOptions,
  type EdgeWearParams
} from './paintEngine'
import { createMaskCompositeMaterial } from './maskCompositeShader'
import { renderThumbnail } from './thumbnail'

let nextId = 1

export interface Layer {
  id: number
  name: string
  visible: boolean
  opacity: number
  engine: PaintEngine
  isMask?: boolean
  clippedToMaskId?: number
  previewMaskOnModel?: boolean
}

/**
 * Layer stack managing color layers and top-level mask layers.
 * A layer marked as a mask (isMask = true) sits on top and masks the layer(s)
 * below it: painting on the layer below only reveals what is shown by the mask.
 */
export class LayerStack {
  layers: Layer[] = []
  activeId = 0
  readonly compositeTarget: THREE.WebGLRenderTarget
  private renderer: THREE.WebGLRenderer
  private mesh: THREE.Mesh
  private orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private maskMaterial?: THREE.ShaderMaterial
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

  get activePaintEngine(): PaintEngine | undefined {
    return this.active?.engine
  }

  get texture(): THREE.Texture {
    return this.compositeTarget.texture
  }

  addLayer(name?: string, isMask = false, fillWhite = false): Layer {
    const isFirst = this.layers.length === 0
    let baseCol: THREE.Color | null = null
    if (isFirst) {
      baseCol = new THREE.Color(0x999999)
    } else if (isMask) {
      baseCol = fillWhite ? new THREE.Color(0xffffff) : new THREE.Color(0x000000)
    }
    const engine = new PaintEngine(this.renderer, this.mesh, baseCol, this.textureSize)
    const layer: Layer = {
      id: nextId++,
      name: name ?? (isMask ? `Mask ${this.layers.length + 1}` : `Layer ${this.layers.length + 1}`),
      visible: true,
      opacity: 1,
      engine,
      isMask
    }
    this.layers.push(layer)
    this.activeId = layer.id
    this.recomposite()
    return layer
  }

  /** Adds a new Mask Layer on top of the active layer or stack, filled with white. */
  addMaskLayer(name?: string, fillWhite = true): Layer {
    const mask = this.addLayer(name ?? 'Mask Layer', true, fillWhite)
    // If there is an active layer before this one, clip that layer to this mask
    const maskIndex = this.layers.findIndex((l) => l.id === mask.id)
    if (maskIndex > 0) {
      this.layers[maskIndex - 1].clippedToMaskId = mask.id
    }
    this.recomposite()
    return mask
  }

  /** Adds a new Mask Layer directly above a specific layer, and clips that layer to it. */
  addMaskAbove(layerId: number, name?: string, fillWhite = true): Layer {
    const index = this.layers.findIndex((l) => l.id === layerId)
    if (index === -1) return this.addMaskLayer(name, fillWhite)
    const engine = new PaintEngine(
      this.renderer,
      this.mesh,
      fillWhite ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      this.textureSize
    )
    const mask: Layer = {
      id: nextId++,
      name: name ?? `Mask for ${this.layers[index].name}`,
      visible: true,
      opacity: 1,
      engine,
      isMask: true
    }
    this.layers.splice(index + 1, 0, mask)
    this.layers[index].clippedToMaskId = mask.id
    this.activeId = mask.id
    this.recomposite()
    return mask
  }

  /** Sets or unsets the clipping mask target for a layer. Pass 0 to explicitly unclip. */
  setClipToMask(layerId: number, maskId?: number): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer || layer.isMask) return
    layer.clippedToMaskId = maskId
    this.recomposite()
  }

  /** Converts an existing layer into a Mask Layer. */
  convertToMask(layerId: number, fillWhite?: boolean): void {
    const index = this.layers.findIndex((l) => l.id === layerId)
    if (index === -1) return
    const layer = this.layers[index]
    layer.isMask = true
    if (fillWhite !== undefined) {
      layer.engine.fill({ color: new THREE.Color(fillWhite ? 0xffffff : 0x000000), alpha: 1 })
    }
    // Automatically clip the layer immediately below it to this mask
    if (index > 0) {
      this.layers[index - 1].clippedToMaskId = layer.id
    }
    this.recomposite()
  }

  /** Converts a mask layer back into a normal color layer. */
  unmaskLayer(layerId: number): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer || !layer.isMask) return
    layer.isMask = false
    // Unclip any layers clipped to this mask
    for (const l of this.layers) {
      if (l.clippedToMaskId === layerId) {
        l.clippedToMaskId = undefined
      }
    }
    this.recomposite()
  }

  /** Creates a new paint layer directly underneath a mask layer, clipped to it. */
  addLayerBelow(maskLayerId: number, name?: string): Layer {
    const index = this.layers.findIndex((l) => l.id === maskLayerId)
    if (index === -1) return this.addLayer(name)
    const engine = new PaintEngine(this.renderer, this.mesh, null, this.textureSize)
    const mask = this.layers[index]
    const newLayer: Layer = {
      id: nextId++,
      name: name ?? `Paint (under ${mask.name})`,
      visible: true,
      opacity: 1,
      engine,
      clippedToMaskId: maskLayerId
    }
    this.layers.splice(index, 0, newLayer)
    this.activeId = newLayer.id
    this.recomposite()
    return newLayer
  }

  /** Inverts the mask buffer of a layer (swaps black and white). */
  invertMask(layerId: number): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer) return
    layer.engine.invert()
    this.recomposite()
  }

  /** Fills a mask layer with pure white (reveal all) or black (hide all). */
  fillMask(layerId: number, fillWhite = true): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer) return
    layer.engine.fill({ color: new THREE.Color(fillWhite ? 0xffffff : 0x000000), alpha: 1 })
    this.recomposite()
  }

  /** Toggles viewing the raw grayscale mask on the 3D model surface. */
  toggleMaskPreviewOnModel(layerId: number): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer) return
    layer.previewMaskOnModel = !layer.previewMaskOnModel
    this.recomposite()
  }

  removeLayer(id: number): void {
    if (this.layers.length <= 1) return
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) return
    const [removed] = this.layers.splice(index, 1)
    removed.engine.dispose()
    // Unclip any layers clipped to the removed layer
    for (const l of this.layers) {
      if (l.clippedToMaskId === id) {
        l.clippedToMaskId = undefined
      }
    }
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
      engine,
      isMask: source.isMask,
      clippedToMaskId: source.clippedToMaskId
    }
    this.layers.splice(index + 1, 0, layer)
    this.activeId = layer.id
    this.recomposite()
    return layer
  }

  /** Bucket-fills only the given triangles on the active layer (spec: fill by face selection, multi-select, texture/color). */
  fillActiveFaces(
    faces: ReadonlySet<number>,
    options?: FillOptions | THREE.Color,
    alpha = 1
  ): void {
    this.activePaintEngine?.fillFaces(faces, options, alpha)
    this.recomposite()
  }

  /** Bucket-fills the active layer across the whole model (spec: bucket tool with texture/color). */
  fillActiveLayer(
    options?: FillOptions | THREE.Color,
    alpha = 1
  ): void {
    this.activePaintEngine?.fill(options, alpha)
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

    const maskMap = new Map<number, Layer>()
    for (const l of this.layers) {
      if (l.isMask) {
        maskMap.set(l.id, l)
      }
    }

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      if (!layer.visible) continue

      // If this is a Mask Layer:
      if (layer.isMask) {
        if (layer.previewMaskOnModel) {
          const mat = new THREE.MeshBasicMaterial({ map: layer.engine.texture })
          configurePremultipliedSourceMaterial(mat, layer.opacity)
          const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
          const scene = new THREE.Scene()
          scene.add(quad)
          this.renderer.render(scene, this.orthoCamera)
          mat.dispose()
          quad.geometry.dispose()
        }
        // Mask layers don't render on top of the composite image as opaque sheets;
        // they modulate the layer(s) below them.
        continue
      }

      // Check if this layer is masked by a mask layer above it
      let maskLayer: Layer | undefined
      if (layer.clippedToMaskId) {
        maskLayer = maskMap.get(layer.clippedToMaskId)
      } else if (i + 1 < this.layers.length && this.layers[i + 1].isMask) {
        maskLayer = this.layers[i + 1]
      }

      if (maskLayer && maskLayer.visible) {
        if (!this.maskMaterial) {
          this.maskMaterial = createMaskCompositeMaterial()
        }
        const u = this.maskMaterial.uniforms
        u.tSource.value = layer.engine.texture
        u.tMask.value = maskLayer.engine.texture
        u.uOpacity.value = layer.opacity * maskLayer.opacity
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskMaterial)
        const scene = new THREE.Scene()
        scene.add(quad)
        this.renderer.render(scene, this.orthoCamera)
        quad.geometry.dispose()
      } else {
        const mat = new THREE.MeshBasicMaterial({ map: layer.engine.texture })
        configurePremultipliedSourceMaterial(mat, layer.opacity)
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
        const scene = new THREE.Scene()
        scene.add(quad)
        this.renderer.render(scene, this.orthoCamera)
        mat.dispose()
        quad.geometry.dispose()
      }
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

  private previewSnapshot: THREE.WebGLRenderTarget | null = null
  private previewLayerId: number | null = null

  /** Previews edge wear in real time on the active layer by restoring from snapshot on each slider update. */
  previewEdgeWear(options: EdgeWearParams): void {
    const active = this.active
    if (!active) return

    if (!this.previewSnapshot || this.previewLayerId !== active.id) {
      this.previewSnapshot?.dispose()
      this.previewSnapshot = active.engine.createSnapshot()
      this.previewLayerId = active.id
    }

    // Revert to pristine snapshot first
    active.engine.copyFrom(this.previewSnapshot)
    // Apply wear with current slider values
    active.engine.applyEdgeWear(options)
    this.recomposite()
  }

  /** Cancels the edge wear preview and restores the active layer to pristine state. */
  cancelEdgeWearPreview(): void {
    if (this.previewSnapshot && this.previewLayerId !== null) {
      const layer = this.layers.find((l) => l.id === this.previewLayerId)
      if (layer) {
        layer.engine.copyFrom(this.previewSnapshot)
        this.recomposite()
      }
      this.previewSnapshot.dispose()
      this.previewSnapshot = null
      this.previewLayerId = null
    }
  }

  /** Commits edge wear, either onto the active layer or as a new dedicated layer. */
  commitEdgeWear(options: EdgeWearParams, asNewLayer = false): void {
    if (asNewLayer) {
      // Revert active layer to snapshot if preview was active
      this.cancelEdgeWearPreview()
      // Create new transparent layer
      const newLayer = this.addLayer('Edge Wear')
      newLayer.engine.applyEdgeWear(options)
      this.recomposite()
    } else {
      // If preview was active, revert to snapshot first then apply
      if (this.previewSnapshot && this.previewLayerId !== null) {
        const layer = this.layers.find((l) => l.id === this.previewLayerId)
        if (layer) {
          layer.engine.copyFrom(this.previewSnapshot)
          layer.engine.applyEdgeWear(options)
        }
        this.previewSnapshot.dispose()
        this.previewSnapshot = null
        this.previewLayerId = null
      } else {
        this.active?.engine.applyEdgeWear(options)
      }
      this.recomposite()
    }
  }

  dispose(): void {
    this.previewSnapshot?.dispose()
    this.maskMaterial?.dispose()
    for (const layer of this.layers) {
      layer.engine.dispose()
    }
    this.compositeTarget.dispose()
  }
}
