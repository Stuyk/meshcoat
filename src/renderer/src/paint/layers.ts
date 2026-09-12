import * as THREE from 'three'
import {
  PaintEngine,
  configurePremultipliedSourceMaterial,
  DEFAULT_TEXTURE_SIZE,
  type FillOptions,
  type EdgeWearParams,
  type CpuPixelSnapshot
} from './paintEngine'
import { renderThumbnail } from './thumbnail'
import { HistoryManager } from './history'
import { createBlendCompositeMaterial, blendModeIndex, type BlendMode } from './blendShader'

let nextId = 1

export interface LayerSnapshot {
  id: number
  name: string
  visible: boolean
  opacity: number
  isMask?: boolean
  clippedToMaskId?: number
  blendMode?: BlendMode
  /** CPU-side pixel buffer (system RAM, not GPU/VRAM) — see PaintEngine.createCpuSnapshot(). */
  pixels: CpuPixelSnapshot
}

export interface StackSnapshot {
  activeId: number
  layers: LayerSnapshot[]
}

export interface Layer {
  id: number
  name: string
  visible: boolean
  opacity: number
  engine: PaintEngine
  isMask?: boolean
  clippedToMaskId?: number
  previewMaskOnModel?: boolean
  /** How this layer's color composites onto the layers below it. Ignored for
   * mask layers, which always modulate via their own grayscale coverage. */
  blendMode?: BlendMode
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
  // recomposite() runs on every paint dab and every opacity/visibility tick —
  // these are reused across calls instead of allocating a fresh Scene/Mesh/
  // Material/Map per layer per call, which otherwise churns the GC hard
  // during an ordinary painting session.
  private recompositeScene = new THREE.Scene()
  private recompositeQuadGeometry = new THREE.PlaneGeometry(2, 2)
  private recompositePlainMaterial = new THREE.MeshBasicMaterial()
  private recompositeQuad: THREE.Mesh
  private maskMapScratch = new Map<number, Layer>()
  /** Per-layer blend-mode compositing (see blendShader.ts) needs to read the
   * accumulated backdrop *and* write the new one in the same pass, which a
   * single accumulating target can't do — these two scratch buffers ping-pong
   * layer by layer, and the final result is blitted into compositeTarget
   * (kept as a single stable object since it's referenced elsewhere as the
   * mesh's material.map). */
  private blendMaterial: ReturnType<typeof createBlendCompositeMaterial>
  private scratchA: THREE.WebGLRenderTarget
  private scratchB: THREE.WebGLRenderTarget
  readonly textureSize: number
  /** Undo/redo history for this layer stack. Assigned once construction finishes. */
  history!: HistoryManager

  constructor(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, textureSize: number = DEFAULT_TEXTURE_SIZE) {
    this.renderer = renderer
    this.mesh = mesh
    this.textureSize = textureSize
    const targetOpts = {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    } as const
    this.compositeTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, targetOpts)
    this.scratchA = new THREE.WebGLRenderTarget(textureSize, textureSize, targetOpts)
    this.scratchB = new THREE.WebGLRenderTarget(textureSize, textureSize, targetOpts)
    this.blendMaterial = createBlendCompositeMaterial()
    this.recompositeQuad = new THREE.Mesh(this.recompositeQuadGeometry, this.recompositePlainMaterial)
    this.recompositeScene.add(this.recompositeQuad)

    this.addLayer('Background')
    this.recomposite()
    this.history = new HistoryManager(this)
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
    this.history?.record()
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

  /** Sets or unsets the clipping mask target for a layer. Pass 0 to explicitly unclip. */
  setClipToMask(layerId: number, maskId?: number): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer || layer.isMask) return
    this.history?.record()
    layer.clippedToMaskId = maskId
    this.recomposite()
  }

  /** Converts an existing layer into a Mask Layer. */
  convertToMask(layerId: number, fillWhite?: boolean): void {
    const index = this.layers.findIndex((l) => l.id === layerId)
    if (index === -1) return
    this.history?.record()
    const layer = this.layers[index]
    layer.isMask = true
    if (fillWhite !== undefined) {
      layer.engine.fill({ color: new THREE.Color(fillWhite ? 0xffffff : 0x000000), alpha: 1 })
    }
    // No auto-clipping of neighbors — the user must explicitly move a layer
    // (moveLayer) to attach it under this mask.
    this.recomposite()
  }

  /** Converts a mask layer back into a normal color layer. */
  unmaskLayer(layerId: number): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer || !layer.isMask) return
    this.history?.record()
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
    this.history?.record()
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
    this.history?.record()
    layer.engine.invert()
    this.recomposite()
  }

  /** Fills a mask layer with pure white (reveal all) or black (hide all). */
  fillMask(layerId: number, fillWhite = true): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer) return
    this.history?.record()
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
    this.history?.record()
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
      this.history?.record()
      layer.visible = visible
      this.recomposite()
    }
  }

  /**
   * `record` defaults to true for a single atomic change; pass false while a
   * continuous drag (e.g. an opacity slider) is already recording once at
   * drag-start, so every intermediate tick doesn't push its own full-stack
   * snapshot (and the CPU-readback cost that comes with it — see history.ts).
   */
  setOpacity(id: number, opacity: number, record = true): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer) {
      if (record) this.history?.record()
      layer.opacity = opacity
      this.recomposite()
    }
  }

  /** Sets how a (non-mask) layer's color composites onto the layers below it. */
  setBlendMode(id: number, mode: BlendMode): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer && layer.blendMode !== mode) {
      this.history?.record()
      layer.blendMode = mode
      this.recomposite()
    }
  }

  /** Merges the given layer onto the one below it in the stack (spec: Merge Down). */
  mergeDown(id: number): void {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index <= 0) return
    this.history?.record()
    const top = this.layers[index]
    const below = this.layers[index - 1]
    top.engine.mergeOnto(below.engine, top.opacity)
    top.engine.dispose()
    this.layers.splice(index, 1)
    this.activeId = below.id
    this.recomposite()
  }

  /** Moving a layer is the only way to attach/detach it from a mask — landing
   * directly below a mask clips it to that mask, landing anywhere else clears it. */
  moveLayer(id: number, direction: 'up' | 'down'): void {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) return
    const targetIndex = direction === 'up' ? index + 1 : index - 1
    if (targetIndex < 0 || targetIndex >= this.layers.length) return
    this.history?.record()
    const [layer] = this.layers.splice(index, 1)
    this.layers.splice(targetIndex, 0, layer)
    if (!layer.isMask) {
      const above = this.layers[targetIndex + 1]
      layer.clippedToMaskId = above && above.isMask ? above.id : undefined
    }
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
    this.history?.record()
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
      clippedToMaskId: source.clippedToMaskId,
      blendMode: source.blendMode
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
    if (faces.size === 0 || !this.activePaintEngine) return
    this.history?.record()
    this.activePaintEngine.fillFaces(faces, options, alpha)
    this.recomposite()
  }

  /** Bucket-fills the active layer across the whole model (spec: bucket tool with texture/color). */
  fillActiveLayer(
    options?: FillOptions | THREE.Color,
    alpha = 1
  ): void {
    if (!this.activePaintEngine) return
    this.history?.record()
    this.activePaintEngine.fill(options, alpha)
    this.recomposite()
  }

  clearLayer(id: number): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer) {
      this.history?.record()
      layer.engine.clear()
      this.recomposite()
    }
  }

  /**
   * Re-renders the visible, opacity/blend-mode-weighted stack into the shared
   * composite target. Ping-pongs through two scratch buffers (each layer's
   * blend mode needs to read the accumulated backdrop and write a new one in
   * the same pass — a single accumulating target can't do that), then blits
   * the final result into the stable public compositeTarget.
   */
  recomposite(): void {
    const prevAutoClear = this.renderer.autoClear
    const prevTarget = this.renderer.getRenderTarget()
    const prevClearColor = new THREE.Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    this.renderer.autoClear = false
    this.renderer.setClearColor(0x000000, 0)

    this.renderer.setRenderTarget(this.scratchA)
    this.renderer.clear(true, true, true)
    this.renderer.setRenderTarget(this.scratchB)
    this.renderer.clear(true, true, true)

    const maskMap = this.maskMapScratch
    maskMap.clear()
    for (const l of this.layers) {
      if (l.isMask) {
        maskMap.set(l.id, l)
      }
    }

    let backdrop = this.scratchA
    let target = this.scratchB
    this.recompositeQuad.material = this.blendMaterial
    const u = this.blendMaterial.uniforms

    const drawLayer = (sourceTexture: THREE.Texture, opacity: number, blendMode: BlendMode | undefined, mask?: Layer): void => {
      u.tBackdrop.value = backdrop.texture
      u.tSource.value = sourceTexture
      u.uOpacity.value = opacity
      u.uBlendMode.value = blendModeIndex(blendMode)
      if (mask) {
        u.uUseMask.value = 1
        u.tMask.value = mask.engine.texture
        u.uMaskOpacity.value = mask.opacity
      } else {
        u.uUseMask.value = 0
        u.tMask.value = null
      }
      this.renderer.setRenderTarget(target)
      this.renderer.render(this.recompositeScene, this.orthoCamera)
      const tmp = backdrop
      backdrop = target
      target = tmp
    }

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      if (!layer.visible) continue

      // If this is a Mask Layer:
      if (layer.isMask) {
        // Mask layers don't render on top of the composite as opaque sheets —
        // they modulate the layer(s) below them — except when the user has
        // asked to inspect the raw mask buffer directly on the model.
        if (layer.previewMaskOnModel) {
          drawLayer(layer.engine.texture, layer.opacity, 'normal')
        }
        continue
      }

      // Masking is only ever explicit (clippedToMaskId) — sitting directly
      // below a mask layer does not implicitly attach you to it; moveLayer
      // is what sets/clears this when a layer is deliberately repositioned.
      const maskLayer: Layer | undefined = layer.clippedToMaskId
        ? maskMap.get(layer.clippedToMaskId)
        : undefined

      drawLayer(
        layer.engine.texture,
        layer.opacity,
        layer.blendMode,
        maskLayer && maskLayer.visible ? maskLayer : undefined
      )
    }

    // Blit the final ping-pong result into the stable public composite target.
    this.recompositeQuad.material = this.recompositePlainMaterial
    this.recompositePlainMaterial.map = backdrop.texture
    configurePremultipliedSourceMaterial(this.recompositePlainMaterial, 1)
    this.renderer.setRenderTarget(this.compositeTarget)
    this.renderer.clear(true, true, true)
    this.renderer.render(this.recompositeScene, this.orthoCamera)

    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
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
      this.history?.record()
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

  /** Captures every layer's pixel content (to CPU RAM, not GPU) plus stack metadata. */
  captureState(): StackSnapshot {
    return {
      activeId: this.activeId,
      layers: this.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        isMask: l.isMask,
        clippedToMaskId: l.clippedToMaskId,
        blendMode: l.blendMode,
        pixels: l.engine.createCpuSnapshot()
      }))
    }
  }

  /** Restores the stack (layer order, metadata, and pixel content) from a captured snapshot. */
  restoreState(state: StackSnapshot): void {
    const existing = new Map(this.layers.map((l) => [l.id, l]))
    const restored: Layer[] = []
    for (const snap of state.layers) {
      let layer = existing.get(snap.id)
      if (layer) {
        existing.delete(snap.id)
      } else {
        layer = {
          id: snap.id,
          name: snap.name,
          visible: snap.visible,
          opacity: snap.opacity,
          engine: new PaintEngine(this.renderer, this.mesh, null, this.textureSize),
          isMask: snap.isMask,
          clippedToMaskId: snap.clippedToMaskId,
          blendMode: snap.blendMode
        }
      }
      layer.engine.restoreFromCpuSnapshot(snap.pixels)
      layer.name = snap.name
      layer.visible = snap.visible
      layer.opacity = snap.opacity
      layer.isMask = snap.isMask
      layer.clippedToMaskId = snap.clippedToMaskId
      layer.blendMode = snap.blendMode
      restored.push(layer)
    }
    // Anything left in `existing` was created after this snapshot and undone away.
    for (const leftover of existing.values()) {
      leftover.engine.dispose()
    }
    this.layers = restored
    this.activeId = state.activeId
    this.recomposite()
  }

  /** No GPU resources to free for a CPU-side snapshot — kept for symmetry with
   * the history manager's call sites and to make dropping the reference explicit. */
  disposeSnapshot(_state: StackSnapshot): void {}

  dispose(): void {
    this.history?.dispose()
    this.previewSnapshot?.dispose()
    this.blendMaterial.dispose()
    this.recompositeQuadGeometry.dispose()
    this.recompositePlainMaterial.dispose()
    this.scratchA.dispose()
    this.scratchB.dispose()
    for (const layer of this.layers) {
      layer.engine.dispose()
    }
    this.compositeTarget.dispose()
  }
}
