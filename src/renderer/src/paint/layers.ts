import * as THREE from 'three'
import {
  PaintEngine,
  DEFAULT_TEXTURE_SIZE,
  type FillOptions,
  type EdgeWearParams,
  type CpuPixelSnapshot
} from './paintEngine'
import { renderThumbnail } from './thumbnail'
import { HistoryManager } from './history'
import { createBlendCompositeMaterial, blendModeIndex, type BlendMode } from './blendShader'
import {
  CHANNEL_SPECS,
  PAINT_CHANNELS,
  PBR_CHANNELS,
  createChannelRenderTarget,
  type PaintChannel
} from './channels'
import { PaintSurface, createPaintTarget, poolTarget } from './gpuResources'
import type { LassoBakeParams } from './pixelSelection'

/**
 * Resolves a finished channel composite into something MeshStandardMaterial can
 * sample. The stack works in premultiplied alpha with coverage; a material map
 * has no notion of coverage, so unpainted texels have to land on the channel's
 * neutral default (rough 1, metal 0, flat normal) rather than on black.
 */
function createChannelFlattenMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uHasSrc: { value: 0 },
      uDefault: { value: new THREE.Vector4(0, 0, 0, 1) },
      uIsVector: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform int uHasSrc;
      uniform vec4 uDefault;
      uniform int uIsVector;
      varying vec2 vUv;
      void main() {
        vec4 s = uHasSrc == 1 ? texture2D(tSrc, vUv) : vec4(0.0);
        vec3 straight = s.a > 0.0001 ? s.rgb / s.a : s.rgb;
        vec3 resolved = mix(uDefault.rgb, straight, clamp(s.a, 0.0, 1.0));
        if (uIsVector == 1) {
          // Layers were composited by lerping *encoded* normals, which shortens
          // the vector wherever two differing directions met. Renormalizing here
          // is what turns that back into a unit direction the shading can use.
          vec3 n = resolved * 2.0 - 1.0;
          resolved = normalize(length(n) > 0.0001 ? n : vec3(0.0, 0.0, 1.0)) * 0.5 + 0.5;
        }
        gl_FragColor = vec4(resolved, 1.0);
      }
    `,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false
  })
}

/**
 * Layer ids only have to be unique within their own stack: `activeId` and
 * `clippedToMaskId` are both stack-local. Deriving the next id from the layers
 * present beats a module-level counter, which a hot reload resets while the
 * live stacks keep their layers — handing a new layer the id the background
 * already had, so both rendered as the active one. It also can't collide with
 * the ids restoreState() brings back from a saved project.
 */
function nextLayerId(layers: readonly { id: number }[]): number {
  let highest = 0
  for (const layer of layers) {
    highest = Math.max(highest, layer.id)
  }
  return highest + 1
}

/**
 * A pass-through layer folder: it groups a contiguous run of layers for
 * organisation, and its visibility and opacity apply on top of each member's
 * own. Members keep their own blend modes against everything below, exactly as
 * if the folder weren't there — so a folder costs no render target. Folders
 * live beside the layers rather than in the array, which keeps every place that
 * walks `layers` and reads `layer.engine` unaware of them.
 */
export interface LayerFolder {
  id: number
  name: string
  visible: boolean
  opacity: number
  /** UI-only: members hidden in the layers panel. Saved, but never an undo step. */
  collapsed?: boolean
}

export interface LayerSnapshot {
  id: number
  name: string
  visible: boolean
  opacity: number
  isMask?: boolean
  clippedToMaskId?: number
  blendMode?: BlendMode
  folderId?: number
  /** CPU-side pixel buffer (system RAM, not GPU/VRAM) — see PaintEngine.createCpuSnapshot(). */
  pixels: CpuPixelSnapshot
}

export interface StackSnapshot {
  activeId: number
  layers: LayerSnapshot[]
  /** Absent in snapshots from before folders existed. */
  folders?: LayerFolder[]
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
  /**
   * The folder this layer belongs to. A folder's members are always contiguous
   * in `layers`, and a mask and the layers clipped to it are always in the same
   * folder (or none) — every mutation below keeps both true.
   */
  folderId?: number
}

/**
 * Layer stack managing color layers and top-level mask layers.
 * A layer marked as a mask (isMask = true) sits on top and masks the layer(s)
 * below it: painting on the layer below only reveals what is shown by the mask.
 */
export class LayerStack {
  layers: Layer[] = []
  folders: LayerFolder[] = []
  activeId = 0
  readonly compositeTarget: THREE.WebGLRenderTarget
  private renderer: THREE.WebGLRenderer
  /** UV geometry + coverage mask, shared by every layer of this mesh. */
  private surface: PaintSurface
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
  private folderMapScratch = new Map<number, LayerFolder>()
  /** Per-layer blend-mode compositing (see blendShader.ts) needs to read the
   * accumulated backdrop *and* write the new one in the same pass, which a
   * single accumulating target can't do — so layers ping-pong through the two
   * pooled buffers (gpuResources.ts: shared by every stack of this size, since
   * they hold nothing between calls), and the last layer is drawn
   * straight into compositeTarget (kept as a single stable object since it's
   * referenced elsewhere as the mesh's material.map). The data channels use
   * the linear (NoColorSpace) pair: ping-ponging roughness or normals through
   * the sRGB pair would gamma-shift every value on the way through. */
  private blendMaterial: ReturnType<typeof createBlendCompositeMaterial>
  /** Flattened, material-ready normal map — see createChannelFlattenMaterial. */
  private normalTarget: THREE.WebGLRenderTarget | null = null
  /**
   * Flattened roughness and metalness, packed the way MeshStandardMaterial
   * reads them (and glTF/Unreal/Unity ship them): R = AO (always 1), G =
   * roughness, B = metalness. One target bound as both maps instead of two
   * full-resolution targets that each repeat a single value in RGB.
   */
  private ormTarget: THREE.WebGLRenderTarget | null = null
  private flattenMaterial: THREE.ShaderMaterial | null = null
  /** The mesh material these composites are bound to, so newly-appearing
   * channels can be attached the moment a layer first paints into them. */
  private boundMaterial: THREE.MeshStandardMaterial | null = null
  private boundChannelKey = ''
  readonly textureSize: number
  /** Undo/redo history for this layer stack. Assigned once construction finishes. */
  history!: HistoryManager

  constructor(
    renderer: THREE.WebGLRenderer,
    mesh: THREE.Mesh,
    textureSize: number = DEFAULT_TEXTURE_SIZE
  ) {
    this.renderer = renderer
    this.textureSize = textureSize
    this.surface = new PaintSurface(renderer, mesh, textureSize)
    this.compositeTarget = createPaintTarget(textureSize, THREE.SRGBColorSpace)
    this.blendMaterial = createBlendCompositeMaterial()
    this.recompositeQuad = new THREE.Mesh(
      this.recompositeQuadGeometry,
      this.recompositePlainMaterial
    )
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

  /** Channels at least one layer has painted into — base color always included. */
  activeChannels(): PaintChannel[] {
    const present = new Set<PaintChannel>(['baseColor'])
    for (const layer of this.layers) {
      for (const channel of layer.engine.allocatedChannels) {
        present.add(channel)
      }
    }
    return PAINT_CHANNELS.filter((c) => present.has(c))
  }

  /**
   * Flattened map for one PBR channel, or null if no layer carries it. For
   * roughness/metalness this is the shared packed target — read the value
   * from channelComponent(). Unpainted channels answer null even when a target
   * from earlier work still exists, so the material never keeps a stale map.
   */
  channelTexture(channel: PaintChannel): THREE.Texture | null {
    if (channel !== 'baseColor' && !this.hasChannel(channel)) {
      return null
    }
    return this.channelTarget(channel)?.texture ?? null
  }

  /**
   * Which component of channelTarget() holds this channel's value: null =
   * the target is the channel itself (RGB), otherwise 1 (G) or 2 (B) of the
   * packed ORM target.
   */
  channelComponent(channel: PaintChannel): 1 | 2 | null {
    if (channel === 'roughness') {
      return 1
    }
    if (channel === 'metalness') {
      return 2
    }
    return null
  }

  /** The packed AO/roughness/metalness target, if either scalar channel has ever been painted. */
  ormMapTarget(): THREE.WebGLRenderTarget | null {
    return this.ormTarget
  }

  private hasChannel(channel: PaintChannel): boolean {
    return this.layers.some((l) => l.engine.hasChannel(channel))
  }

  /**
   * UV coverage of this stack's mesh (see PaintSurface.coverageMask) — what an
   * atlas export masks each piece with. Single-channel (R8): read it back
   * through readTargetRgba, which renderTargetToPngDataUrl already does.
   */
  coverageTarget(): THREE.WebGLRenderTarget | null {
    return this.surface.coverageMask
  }

  /** This piece's lasso selection (see pixelSelection.ts), or null for none. */
  get pixelSelection(): THREE.Texture | null {
    return this.surface.pixelSelection
  }

  applyLasso(params: LassoBakeParams): void {
    this.surface.applyLasso(params)
  }

  invertPixelSelection(): void {
    this.surface.invertPixelSelection()
  }

  clearPixelSelection(): void {
    this.surface.clearPixelSelection()
  }

  /** The render target behind channelTexture — what the exporters read back. */
  channelTarget(channel: PaintChannel): THREE.WebGLRenderTarget | null {
    if (channel === 'baseColor') {
      return this.compositeTarget
    }
    if (channel === 'normal') {
      return this.normalTarget
    }
    return this.ormTarget
  }

  get roughnessTexture(): THREE.Texture | null {
    return this.channelTexture('roughness')
  }

  get metalnessTexture(): THREE.Texture | null {
    return this.channelTexture('metalness')
  }

  get normalTexture(): THREE.Texture | null {
    return this.channelTexture('normal')
  }

  /**
   * Binds this stack's composites onto the mesh material and keeps them bound:
   * a channel that first appears mid-session (the artist enables Metallic and
   * lays down one stroke) has to be attached to the material at that moment,
   * which is why recomposite() calls back into this rather than the viewport
   * wiring maps up once at load.
   *
   * roughness/metalness are pinned to 1.0 where a map exists because the
   * material multiplies scalar × map; anything less would silently scale down
   * every value the artist painted.
   */
  bindMaterial(material: THREE.MeshStandardMaterial): void {
    this.boundMaterial = material
    this.boundChannelKey = ''
    this.syncMaterialMaps()
  }

  private syncMaterialMaps(): void {
    const material = this.boundMaterial
    if (!material) {
      return
    }
    const active = this.activeChannels()
    const key = active.join(',')
    if (key === this.boundChannelKey) {
      return
    }
    this.boundChannelKey = key

    material.map = this.compositeTarget.texture
    material.roughnessMap = this.channelTexture('roughness')
    material.metalnessMap = this.channelTexture('metalness')
    material.normalMap = this.channelTexture('normal')
    if (material.roughnessMap) {
      material.roughness = 1
    }
    if (material.metalnessMap) {
      material.metalness = 1
    }
    material.needsUpdate = true
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
    const engine = new PaintEngine(this.renderer, this.surface, baseCol)
    const layer: Layer = {
      id: nextLayerId(this.layers),
      name: name ?? (isMask ? `Mask ${this.layers.length + 1}` : `Layer ${this.layers.length + 1}`),
      visible: true,
      opacity: 1,
      engine,
      isMask
    }
    const activeIndex = this.layers.findIndex((l) => l.id === this.activeId)
    // Inserted directly above the active layer, so it joins the active layer's
    // folder — anything else would split the folder in two.
    layer.folderId = this.layers[activeIndex]?.folderId
    this.layers.splice(activeIndex + 1, 0, layer)
    this.activeId = layer.id
    this.recomposite()
    return layer
  }

  /** Sets or unsets the clipping mask target for a layer. Pass 0 to explicitly unclip. */
  setClipToMask(layerId: number, maskId?: number): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer || layer.isMask) {
      return
    }
    this.history?.record()
    if (!maskId) {
      // Drop below the rest of its group so the remaining clipped layers stay contiguous.
      const index = this.layers.indexOf(layer)
      const unit = this.units().find((u) => index >= u.start && index <= u.end)
      if (unit && unit.end > index) {
        this.layers.splice(index, 1)
        this.layers.splice(unit.start, 0, layer)
      }
    }
    layer.clippedToMaskId = maskId
    this.recomposite()
  }

  /** Converts an existing layer into a Mask Layer. */
  convertToMask(layerId: number, fillWhite?: boolean): void {
    const index = this.layers.findIndex((l) => l.id === layerId)
    if (index === -1) {
      return
    }
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
    if (!layer || !layer.isMask) {
      return
    }
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
    if (index === -1) {
      return this.addLayer(name)
    }
    this.history?.record()
    const engine = new PaintEngine(this.renderer, this.surface, null)
    const mask = this.layers[index]
    const newLayer: Layer = {
      id: nextLayerId(this.layers),
      name: name ?? `Paint (under ${mask.name})`,
      visible: true,
      opacity: 1,
      engine,
      clippedToMaskId: maskLayerId,
      folderId: mask.folderId
    }
    this.layers.splice(index, 0, newLayer)
    this.activeId = newLayer.id
    this.recomposite()
    return newLayer
  }

  /**
   * Runs `mutate` on the layer with id `layerId` (no-op if it doesn't exist),
   * recording history first and recompositing after — the shape shared by
   * every simple per-layer property setter below. Pass `record: false` for a
   * property that shouldn't create its own undo step (e.g. a UI-only toggle).
   */
  private withLayer(
    layerId: number,
    mutate: (layer: Layer) => void,
    opts: { record?: boolean } = {}
  ): void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer) {
      return
    }
    if (opts.record !== false) {
      this.history?.record()
    }
    mutate(layer)
    this.recomposite()
  }

  /** Inverts the mask buffer of a layer (swaps black and white). */
  invertMask(layerId: number): void {
    this.withLayer(layerId, (layer) => layer.engine.invert())
  }

  /** Fills a mask layer with pure white (reveal all) or black (hide all). */
  fillMask(layerId: number, fillWhite = true): void {
    this.withLayer(layerId, (layer) =>
      layer.engine.fill({ color: new THREE.Color(fillWhite ? 0xffffff : 0x000000), alpha: 1 })
    )
  }

  /** Toggles viewing the raw grayscale mask on the 3D model surface. */
  toggleMaskPreviewOnModel(layerId: number): void {
    this.withLayer(layerId, (layer) => (layer.previewMaskOnModel = !layer.previewMaskOnModel), {
      record: false
    })
  }

  removeLayer(id: number): void {
    if (this.layers.length <= 1) {
      return
    }
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) {
      return
    }
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
    this.pruneFolders()
    this.recomposite()
  }

  setVisible(id: number, visible: boolean): void {
    this.withLayer(id, (layer) => (layer.visible = visible))
  }

  /**
   * `record` defaults to true for a single atomic change; pass false while a
   * continuous drag (e.g. an opacity slider) is already recording once at
   * drag-start, so every intermediate tick doesn't push its own full-stack
   * snapshot (and the CPU-readback cost that comes with it — see history.ts).
   */
  setOpacity(id: number, opacity: number, record = true): void {
    this.withLayer(id, (layer) => (layer.opacity = opacity), { record })
  }

  /** Sets how a (non-mask) layer's color composites onto the layers below it. */
  setBlendMode(id: number, mode: BlendMode): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer && layer.blendMode !== mode) {
      this.withLayer(id, (l) => (l.blendMode = mode))
    }
  }

  /**
   * Whether mergeDown can bake this layer into the one below without changing
   * what's on screen: both visible, neither a mask, and in the same folder (a
   * folder's own opacity/visibility can't be baked into a layer outside it).
   */
  canMergeDown(id: number): boolean {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index <= 0) {
      return false
    }
    const top = this.layers[index]
    const below = this.layers[index - 1]
    return (
      top.visible &&
      below.visible &&
      !top.isMask &&
      !below.isMask &&
      top.folderId === below.folderId
    )
  }

  /** Merges the given layer onto the one below it in the stack (spec: Merge Down). */
  mergeDown(id: number): void {
    if (!this.canMergeDown(id)) {
      return
    }
    const index = this.layers.findIndex((l) => l.id === id)
    this.history?.record()
    const top = this.layers[index]
    const below = this.layers[index - 1]
    // A mask both layers share keeps applying to the merged layer; one that
    // only clips the top layer has to be baked in, as the composite shows it.
    const mask =
      top.clippedToMaskId !== undefined && top.clippedToMaskId !== below.clippedToMaskId
        ? this.layers.find((l) => l.id === top.clippedToMaskId)
        : undefined
    top.engine.mergeOnto(below.engine, {
      opacity: top.opacity,
      blendMode: top.blendMode,
      mask: mask?.visible ? { texture: mask.engine.texture, opacity: mask.opacity } : undefined,
      backdropOpacity: below.opacity
    })
    below.opacity = 1
    top.engine.dispose()
    this.layers.splice(index, 1)
    this.activeId = below.id
    this.pruneFolders()
    this.recomposite()
  }

  /** Splits the stack (bottom → top) into units: a mask plus the contiguous run
   * of layers clipped to it directly below, or a single standalone layer. */
  private units(): Array<{ start: number; end: number }> {
    const units: Array<{ start: number; end: number }> = []
    let i = this.layers.length - 1
    while (i >= 0) {
      const layer = this.layers[i]
      let start = i
      while (
        layer.isMask &&
        start > 0 &&
        !this.layers[start - 1].isMask &&
        this.layers[start - 1].clippedToMaskId === layer.id &&
        this.layers[start - 1].folderId === layer.folderId
      ) {
        start--
      }
      units.unshift({ start, end: i })
      i = start - 1
    }
    return units
  }

  /** Masks move together with their clipped layers. A clipped layer moves within
   * its group and leaves it past the top/bottom edge; a standalone layer moving
   * into a group joins it at that edge. Folders work the same way one level up:
   * a unit at a folder's edge steps out of it, and a unit beside a folder steps
   * into it, before either actually changes position. */
  moveLayer(id: number, direction: 'up' | 'down'): void {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) {
      return
    }
    const layer = this.layers[index]
    const units = this.units()
    const unitIndex = units.findIndex((u) => index >= u.start && index <= u.end)
    const unit = units[unitIndex]
    const up = direction === 'up'

    // A clipped member never crosses a folder edge directly — it leaves its
    // mask group first, which is handled further down.
    const isClippedMember = !layer.isMask && unit.end > index
    if (!isClippedMember) {
      const neighbor = units[unitIndex + (up ? 1 : -1)]
      const neighborFolder = neighbor ? this.layers[neighbor.start].folderId : undefined
      if (layer.folderId !== undefined && neighborFolder !== layer.folderId) {
        this.history?.record()
        this.setUnitFolder(unit, undefined)
        this.pruneFolders()
        this.recomposite()
        return
      }
      if (layer.folderId === undefined && neighborFolder !== undefined) {
        this.history?.record()
        this.setUnitFolder(unit, neighborFolder)
        this.recomposite()
        return
      }
    }

    if (layer.isMask) {
      const neighbor = units[unitIndex + (up ? 1 : -1)]
      if (!neighbor) {
        return
      }
      this.history?.record()
      const lower = up ? unit : neighbor
      const upper = up ? neighbor : unit
      const reordered = [
        ...this.layers.slice(upper.start, upper.end + 1),
        ...this.layers.slice(lower.start, lower.end + 1)
      ]
      this.layers.splice(lower.start, reordered.length, ...reordered)
      this.recomposite()
      return
    }

    if (unit.end > index) {
      // Clipped member of the group whose mask sits at unit.end.
      this.history?.record()
      if (up && index + 1 === unit.end) {
        this.layers.splice(index, 1)
        this.layers.splice(unit.end, 0, layer)
        layer.clippedToMaskId = undefined
      } else if (!up && index === unit.start) {
        layer.clippedToMaskId = undefined
      } else {
        this.swap(index, up ? index + 1 : index - 1)
      }
      this.recomposite()
      return
    }

    const neighbor = units[unitIndex + (up ? 1 : -1)]
    if (!neighbor) {
      if (layer.clippedToMaskId) {
        this.history?.record()
        layer.clippedToMaskId = undefined
        this.recomposite()
      }
      return
    }
    this.history?.record()
    const mask = this.layers[neighbor.end]
    if (mask.isMask) {
      layer.clippedToMaskId = mask.id
      if (!up) {
        this.layers.splice(index, 1)
        this.layers.splice(neighbor.end, 0, layer)
      }
    } else {
      layer.clippedToMaskId = undefined
      this.swap(index, neighbor.start)
    }
    this.recomposite()
  }

  private setUnitFolder(unit: { start: number; end: number }, folderId: number | undefined): void {
    for (let i = unit.start; i <= unit.end; i++) {
      this.layers[i].folderId = folderId
    }
  }

  /** Drops folders with no members left, and member links to folders that no longer exist. */
  private pruneFolders(): void {
    const used = new Set(this.layers.map((l) => l.folderId))
    this.folders = this.folders.filter((f) => used.has(f.id))
    const live = new Set(this.folders.map((f) => f.id))
    for (const l of this.layers) {
      if (l.folderId !== undefined && !live.has(l.folderId)) {
        l.folderId = undefined
      }
    }
  }

  /** Index range of a folder's members in `layers`, or null if it has none. */
  folderRange(folderId: number): { start: number; end: number } | null {
    const start = this.layers.findIndex((l) => l.folderId === folderId)
    if (start === -1) {
      return null
    }
    let end = start
    while (end + 1 < this.layers.length && this.layers[end + 1].folderId === folderId) {
      end++
    }
    return { start, end }
  }

  /**
   * Puts a layer — together with its mask group, so the group stays whole —
   * into a new folder (spec: Group into Folder). Folders don't nest: a layer
   * that is already in one returns that folder unchanged.
   */
  groupIntoFolder(layerId: number, name?: string): LayerFolder | undefined {
    const index = this.layers.findIndex((l) => l.id === layerId)
    if (index === -1) {
      return undefined
    }
    const layer = this.layers[index]
    if (layer.folderId !== undefined) {
      return this.folders.find((f) => f.id === layer.folderId)
    }
    this.history?.record()
    const unit = this.units().find((u) => index >= u.start && index <= u.end)!
    const folder: LayerFolder = {
      id: nextLayerId(this.folders),
      name: name ?? `Folder ${this.folders.length + 1}`,
      visible: true,
      opacity: 1
    }
    this.folders.push(folder)
    this.setUnitFolder(unit, folder.id)
    this.recomposite()
    return folder
  }

  /** Removes a folder but keeps its layers where they are. */
  ungroupFolder(folderId: number): void {
    if (!this.folders.some((f) => f.id === folderId)) {
      return
    }
    this.history?.record()
    for (const l of this.layers) {
      if (l.folderId === folderId) {
        l.folderId = undefined
      }
    }
    this.pruneFolders()
    this.recomposite()
  }

  /** Deletes a folder and every layer in it. Refused if that would leave the stack empty. */
  removeFolder(folderId: number): void {
    const range = this.folderRange(folderId)
    if (!range || range.end - range.start + 1 >= this.layers.length) {
      return
    }
    this.history?.record()
    const removed = this.layers.splice(range.start, range.end - range.start + 1)
    const removedIds = new Set(removed.map((l) => l.id))
    for (const l of removed) {
      l.engine.dispose()
    }
    for (const l of this.layers) {
      if (l.clippedToMaskId !== undefined && removedIds.has(l.clippedToMaskId)) {
        l.clippedToMaskId = undefined
      }
    }
    if (removedIds.has(this.activeId)) {
      this.activeId = this.layers[Math.max(0, range.start - 1)].id
    }
    this.pruneFolders()
    this.recomposite()
  }

  /** Moves a whole folder past the neighboring unit or folder. */
  moveFolder(folderId: number, direction: 'up' | 'down'): void {
    const range = this.folderRange(folderId)
    if (!range) {
      return
    }
    const up = direction === 'up'
    const edge = up ? range.end + 1 : range.start - 1
    if (edge < 0 || edge >= this.layers.length) {
      return
    }
    // The neighbor is a whole folder if it sits in one, otherwise the mask unit at that edge.
    const neighborFolder = this.layers[edge].folderId
    const neighbor =
      neighborFolder !== undefined
        ? this.folderRange(neighborFolder)!
        : this.units().find((u) => edge >= u.start && edge <= u.end)!
    this.history?.record()
    const lower = up ? range : neighbor
    const upper = up ? neighbor : range
    const reordered = [
      ...this.layers.slice(upper.start, upper.end + 1),
      ...this.layers.slice(lower.start, lower.end + 1)
    ]
    this.layers.splice(lower.start, reordered.length, ...reordered)
    this.recomposite()
  }

  private withFolder(
    folderId: number,
    mutate: (folder: LayerFolder) => void,
    opts: { record?: boolean } = {}
  ): void {
    const folder = this.folders.find((f) => f.id === folderId)
    if (!folder) {
      return
    }
    if (opts.record !== false) {
      this.history?.record()
    }
    mutate(folder)
    this.recomposite()
  }

  setFolderVisible(folderId: number, visible: boolean): void {
    this.withFolder(folderId, (f) => (f.visible = visible))
  }

  /** `record` as for setOpacity: false while a drag already recorded once at its start. */
  setFolderOpacity(folderId: number, opacity: number, record = true): void {
    this.withFolder(folderId, (f) => (f.opacity = opacity), { record })
  }

  renameFolder(folderId: number, name: string): void {
    const folder = this.folders.find((f) => f.id === folderId)
    if (folder && name.trim()) {
      folder.name = name.trim()
    }
  }

  toggleFolderCollapsed(folderId: number): void {
    const folder = this.folders.find((f) => f.id === folderId)
    if (folder) {
      folder.collapsed = !folder.collapsed
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.layers[a]
    this.layers[a] = this.layers[b]
    this.layers[b] = tmp
  }

  renameLayer(id: number, name: string): void {
    const layer = this.layers.find((l) => l.id === id)
    if (layer && name.trim()) {
      layer.name = name.trim()
    }
  }

  duplicateLayer(id: number): Layer | undefined {
    const index = this.layers.findIndex((l) => l.id === id)
    if (index === -1) {
      return undefined
    }
    this.history?.record()
    const source = this.layers[index]
    const engine = new PaintEngine(this.renderer, this.surface, null)
    source.engine.copyOnto(engine)
    const layer: Layer = {
      id: nextLayerId(this.layers),
      name: `${source.name} Copy`,
      visible: source.visible,
      opacity: source.opacity,
      engine,
      isMask: source.isMask,
      clippedToMaskId: source.clippedToMaskId,
      blendMode: source.blendMode,
      folderId: source.folderId
    }
    this.layers.splice(index + 1, 0, layer)
    this.activeId = layer.id
    this.recomposite()
    return layer
  }

  /**
   * Adds a copy of a layer from ANOTHER piece's stack on top of this one
   * (issue #21). Pixels are copied in UV space, so this is meaningful when
   * both pieces share a UV layout — typically mirrored parts — with an
   * optional flip for islands that are reflected. Different texture sizes are
   * resampled. Clipping links don't carry over; they point at the other
   * stack's layers.
   */
  importLayer(
    source: Layer,
    name: string,
    transform?: { flipU?: boolean; flipV?: boolean }
  ): Layer {
    this.history?.record()
    const engine = new PaintEngine(this.renderer, this.surface, null)
    source.engine.copyOnto(engine, transform)
    const layer: Layer = {
      id: nextLayerId(this.layers),
      name,
      visible: true,
      opacity: source.opacity,
      engine,
      isMask: source.isMask,
      blendMode: source.blendMode
    }
    this.layers.push(layer)
    this.activeId = layer.id
    this.recomposite()
    return layer
  }

  /** Bucket-fills only the given triangles on the active layer (spec: fill by face selection, multi-select, texture/color). */
  fillActiveFaces(
    faces: ReadonlySet<number>,
    options?: FillOptions | THREE.Color,
    alpha = 1,
    /** False while continuing a drag, so the whole drag is one undo step. */
    recordHistory = true
  ): void {
    if (faces.size === 0 || !this.activePaintEngine) {
      return
    }
    if (recordHistory) {
      this.history?.record()
    }
    this.activePaintEngine.fillFaces(faces, options, alpha)
    this.recomposite()
  }

  /** Bucket-fills the active layer across the whole model (spec: bucket tool with texture/color). */
  fillActiveLayer(options?: FillOptions | THREE.Color, alpha = 1): void {
    if (!this.activePaintEngine) {
      return
    }
    this.history?.record()
    this.activePaintEngine.fill(options, alpha)
    this.recomposite()
  }

  clearLayer(id: number): void {
    this.withLayer(id, (layer) => layer.engine.clear())
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

    const maskMap = this.maskMapScratch
    maskMap.clear()
    for (const l of this.layers) {
      if (l.isMask) {
        maskMap.set(l.id, l)
      }
    }
    const folderMap = this.folderMapScratch
    folderMap.clear()
    for (const f of this.folders) {
      folderMap.set(f.id, f)
    }

    this.compositeChannel('baseColor', maskMap, folderMap)
    for (const channel of PBR_CHANNELS) {
      if (this.hasChannel(channel)) {
        this.compositeChannel(channel, maskMap, folderMap)
      } else if (this.ormTarget && this.channelComponent(channel) !== null) {
        // The packed target outlives either half: a scalar channel no layer
        // carries any more (undone away) resolves back to its neutral default
        // rather than leaving the last values behind for the other half's map.
        this.flattenChannel(channel, null)
      }
    }

    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
    this.syncMaterialMaps()
  }

  /**
   * Composites one channel of the stack. Identical blend/mask/opacity maths for
   * every channel — a layer's opacity and blend mode mean the same thing to its
   * roughness as to its color, and a mask hides all of a layer or none of it.
   * Only the buffers and the final resolve differ (see channels.ts).
   */
  private compositeChannel(
    channel: PaintChannel,
    maskMap: Map<number, Layer>,
    folderMap: Map<number, LayerFolder>
  ): void {
    const isBaseColor = channel === 'baseColor'
    const colorSpace = CHANNEL_SPECS[channel].colorSpace
    const scratchA = poolTarget(this.renderer, this.textureSize, colorSpace, 'scratch')
    const scratchB = poolTarget(this.renderer, this.textureSize, colorSpace, 'spare')

    // Only the starting backdrop needs clearing: every draw covers its whole
    // target with a full-screen quad.
    this.renderer.setRenderTarget(scratchA)
    this.renderer.clear(true, false, false)

    let backdrop = scratchA
    let target = scratchB
    this.recompositeQuad.material = this.blendMaterial
    const u = this.blendMaterial.uniforms

    // Collected first so the last draw can land directly in compositeTarget
    // instead of costing an extra full-resolution copy pass.
    const draws: Array<{
      source: THREE.Texture
      opacity: number
      blendMode: BlendMode | undefined
      mask?: Layer
    }> = []
    const drawLayer = (
      sourceTexture: THREE.Texture,
      opacity: number,
      blendMode: BlendMode | undefined,
      mask?: Layer
    ): void => {
      draws.push({ source: sourceTexture, opacity, blendMode, mask })
    }
    const executeDraw = (
      sourceTexture: THREE.Texture,
      opacity: number,
      blendMode: BlendMode | undefined,
      mask: Layer | undefined,
      output: THREE.WebGLRenderTarget
    ): void => {
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
      this.renderer.setRenderTarget(output)
      this.renderer.render(this.recompositeScene, this.orthoCamera)
      if (output === target) {
        const tmp = backdrop
        backdrop = target
        target = tmp
      }
    }

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      // Pass-through folder: it only gates and scales its members.
      const folder = layer.folderId !== undefined ? folderMap.get(layer.folderId) : undefined
      if (!layer.visible || (folder && !folder.visible)) {
        continue
      }
      const opacity = layer.opacity * (folder ? folder.opacity : 1)
      // A layer that never painted this channel contributes nothing to it,
      // rather than contributing an empty sheet.
      const source = layer.engine.textureFor(channel)
      if (!source) {
        continue
      }

      // If this is a Mask Layer:
      if (layer.isMask) {
        // Mask layers don't render on top of the composite as opaque sheets —
        // they modulate the layer(s) below them — except when the user has
        // asked to inspect the raw mask buffer directly on the model.
        if (layer.previewMaskOnModel && isBaseColor) {
          drawLayer(source, opacity, 'normal')
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
        source,
        opacity,
        layer.blendMode,
        maskLayer && maskLayer.visible ? maskLayer : undefined
      )
    }

    // Edge Wear "bake to new layer" live preview: composited as an extra top
    // layer so it doesn't have to mutate any real layer's content. It is a
    // base-color pass (see PaintEngine.applyEdgeWear).
    if (this.edgeWearGhost && isBaseColor) {
      drawLayer(this.edgeWearGhost.texture, 1, 'normal')
    }

    if (isBaseColor) {
      if (draws.length === 0) {
        // Nothing visible: the composite is simply transparent.
        this.renderer.setRenderTarget(this.compositeTarget)
        this.renderer.clear(true, false, false)
        return
      }
      draws.forEach((d, i) =>
        executeDraw(
          d.source,
          d.opacity,
          d.blendMode,
          d.mask,
          i === draws.length - 1 ? this.compositeTarget : target
        )
      )
      return
    }

    for (const d of draws) {
      executeDraw(d.source, d.opacity, d.blendMode, d.mask, target)
    }

    this.flattenChannel(channel, backdrop.texture)
  }

  /**
   * Resolves a data channel's composite (null = nothing painted) against its
   * neutral default: the material samples the map with no notion of coverage,
   * so an unpainted texel has to read as "plain matte dielectric", not black.
   * Roughness and metalness each write only their own component of the packed
   * ORM target.
   */
  private flattenChannel(channel: PaintChannel, source: THREE.Texture | null): void {
    const component = this.channelComponent(channel)
    let output: THREE.WebGLRenderTarget
    if (component === null) {
      this.normalTarget ??= createChannelRenderTarget(this.textureSize, channel)
      output = this.normalTarget
    } else {
      if (!this.ormTarget) {
        this.ormTarget = createChannelRenderTarget(this.textureSize, channel)
        // AO white, fully rough, fully dielectric — the neutral ORM texel.
        this.renderer.setRenderTarget(this.ormTarget)
        this.renderer.setClearColor(new THREE.Color(1, 1, 0), 1)
        this.renderer.clear(true, false, false)
        this.renderer.setClearColor(0x000000, 0)
      }
      output = this.ormTarget
    }
    this.flattenMaterial ??= createChannelFlattenMaterial()
    const spec = CHANNEL_SPECS[channel]
    this.flattenMaterial.uniforms.tSrc.value = source
    this.flattenMaterial.uniforms.uHasSrc.value = source ? 1 : 0
    this.flattenMaterial.uniforms.uDefault.value.copy(
      spec.flattenDefault ?? new THREE.Vector4(0, 0, 0, 1)
    )
    this.flattenMaterial.uniforms.uIsVector.value = spec.vector ? 1 : 0
    this.recompositeQuad.material = this.flattenMaterial
    this.renderer.setRenderTarget(output)
    // three only tracks an all-or-nothing color mask, so the per-component
    // mask is set on the context directly and put back to the all-true state
    // three's cache already believes is current.
    const gl = this.renderer.getContext()
    if (component !== null) {
      gl.colorMask(false, component === 1, component === 2, false)
    }
    this.renderer.render(this.recompositeScene, this.orthoCamera)
    if (component !== null) {
      gl.colorMask(true, true, true, true)
    }
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
    if (a === 0) {
      return new THREE.Color(0, 0, 0)
    }
    // The composite is sRGB, so these bytes are already gamma-encoded. Read
    // them as linear and getHexString() encodes them a second time — every
    // sample comes back lighter than what was painted.
    return new THREE.Color().setRGB(
      buffer[0] / a,
      buffer[1] / a,
      buffer[2] / a,
      this.compositeTarget.texture.colorSpace
    )
  }

  private previewSnapshot: THREE.WebGLRenderTarget | null = null
  private previewLayerId: number | null = null
  /** Transient PaintEngine used only to preview "bake to new layer" mode —
   * mirrors what commitEdgeWear would create, composited as an extra top
   * layer by recomposite(), without touching the active layer's real content
   * (which is what the "Merge into Active Layer" preview path mutates). */
  private edgeWearGhost: PaintEngine | null = null

  /** Previews edge wear in real time — either on the active layer (merge mode) or via a
   * transient ghost layer that mirrors "bake to new layer" mode's chosen background. */
  previewEdgeWear(
    options: EdgeWearParams,
    asNewLayer = false,
    newLayerBackground: 'transparent' | 'black' = 'transparent'
  ): void {
    // Erasing only means something against paint that is already there.
    if (asNewLayer && !options.erase) {
      // If a "merge into active layer" preview was in progress, revert it first.
      if (this.previewSnapshot && this.previewLayerId !== null) {
        const layer = this.layers.find((l) => l.id === this.previewLayerId)
        layer?.engine.copyFrom(this.previewSnapshot)
        this.previewSnapshot.dispose()
        this.previewSnapshot = null
        this.previewLayerId = null
      }

      if (!this.edgeWearGhost) {
        this.edgeWearGhost = new PaintEngine(this.renderer, this.surface, null)
      }
      if (newLayerBackground === 'black') {
        this.edgeWearGhost.fill({ color: new THREE.Color(0x000000), alpha: 1 })
      } else {
        this.edgeWearGhost.clear()
      }
      this.edgeWearGhost.applyEdgeWear(options)
      this.recomposite()
      return
    }

    // Merge-into-active-layer mode: drop any ghost from a previous "new layer" preview.
    if (this.edgeWearGhost) {
      this.edgeWearGhost.dispose()
      this.edgeWearGhost = null
    }

    const active = this.active
    if (!active) {
      return
    }

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
    if (this.edgeWearGhost) {
      this.edgeWearGhost.dispose()
      this.edgeWearGhost = null
      this.recomposite()
    }
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
  commitEdgeWear(
    options: EdgeWearParams,
    asNewLayer = false,
    newLayerBackground: 'transparent' | 'black' = 'transparent'
  ): void {
    if (asNewLayer && !options.erase) {
      // Revert active layer to snapshot / drop the preview ghost if either was active
      this.cancelEdgeWearPreview()
      // Create new layer — transparent by default, or opaque black if requested
      const newLayer = this.addLayer(options.mode === 'cavity' ? 'Crevice Dirt' : 'Edge Wear')
      if (newLayerBackground === 'black') {
        newLayer.engine.fill({ color: new THREE.Color(0x000000), alpha: 1 })
      }
      newLayer.engine.applyEdgeWear(options)
      this.recomposite()
    } else {
      this.history?.record()
      // If preview was active, revert to snapshot first then apply
      if (this.previewSnapshot && this.previewLayerId !== null) {
        const layer = this.layers.find((l) => l.id === this.previewLayerId)
        if (layer) {
          layer.engine.copyFrom(this.previewSnapshot)
          layer.engine.applyEdgeWear(options, true)
        }
        this.previewSnapshot.dispose()
        this.previewSnapshot = null
        this.previewLayerId = null
      } else {
        this.active?.engine.applyEdgeWear(options, true)
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
        folderId: l.folderId,
        pixels: l.engine.createCpuSnapshot()
      })),
      folders: this.folders.map((f) => ({ ...f }))
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
          engine: new PaintEngine(this.renderer, this.surface, null),
          isMask: snap.isMask,
          clippedToMaskId: snap.clippedToMaskId,
          blendMode: snap.blendMode,
          folderId: snap.folderId
        }
      }
      layer.engine.restoreFromCpuSnapshot(snap.pixels)
      layer.name = snap.name
      layer.visible = snap.visible
      layer.opacity = snap.opacity
      layer.isMask = snap.isMask
      layer.clippedToMaskId = snap.clippedToMaskId
      layer.blendMode = snap.blendMode
      layer.folderId = snap.folderId
      restored.push(layer)
    }
    // Anything left in `existing` was created after this snapshot and undone away.
    for (const leftover of existing.values()) {
      leftover.engine.dispose()
    }
    this.layers = restored
    this.folders = (state.folders ?? []).map((f) => ({ ...f }))
    this.pruneFolders()
    this.activeId = state.activeId
    this.recomposite()
  }

  /** No GPU resources to free for a CPU-side snapshot — kept for symmetry with
   * the history manager's call sites and to make dropping the reference explicit. */
  disposeSnapshot(_state: StackSnapshot): void {}

  dispose(): void {
    this.history?.dispose()
    this.previewSnapshot?.dispose()
    this.edgeWearGhost?.dispose()
    this.blendMaterial.dispose()
    this.recompositeQuadGeometry.dispose()
    this.recompositePlainMaterial.dispose()
    this.flattenMaterial?.dispose()
    this.normalTarget?.dispose()
    this.ormTarget?.dispose()
    for (const layer of this.layers) {
      layer.engine.dispose()
    }
    this.compositeTarget.dispose()
    this.surface.dispose()
  }
}
