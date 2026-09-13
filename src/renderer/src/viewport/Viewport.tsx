import { onMount, onCleanup, createEffect, createSignal, Show } from 'solid-js'
import * as THREE from 'three'
import { createScene, type SceneHandle, type LightingMode } from './scene'
import { loadModel, createDefaultTestModel, type LoadedModel } from './modelLoader'
import { raycastMeshes, screenToNdc, type SurfaceHit } from './raycast'
import {
  brush,
  setRadius,
  setOpacity,
  setHardness,
  stepRadius,
  selectOnlyFace,
  toggleFaceSelection,
  addFaceToSelection,
  removeFaceFromSelection,
  selectAllFaces,
  invertFaceSelection,
  clearFaceSelection,
  setTextureScale,
  recordRecentTexture,
  applyPressure,
  hasPressure,
  type ToolMode,
  type SymmetryAxis
} from '../paint/brush'
import {
  stencil,
  setStencilCenter,
  setStencilScale,
  setStencilRotation,
  setStencilTransforming
} from '../paint/stencil'
import { LayerStack, type StackSnapshot } from '../paint/layers'
import {
  DEFAULT_TEXTURE_SIZE,
  type FillOptions,
  type EdgeWearParams,
  type OcclusionParams,
  type StencilParams
} from '../paint/paintEngine'
import { OcclusionDepthPass } from '../paint/occlusionDepth'
import { renderTargetToPngDataUrl, packOrmDataUrl, unpackOrmDataUrl } from '../paint/exportTexture'
import { createChannelViewMaterial } from '../paint/channelViewShader'
import { CHANNEL_SPECS, PBR_CHANNELS, type PaintChannel } from '../paint/channels'
import type { ChannelMaps } from '../paint/paintEngine'
import { loadPaintTexture, asyncLoadTexture } from '../utils/textureLoad'
import { toAssetUrl } from '../utils/assetUrl'
import { findUvIslandFaces } from '../paint/uvMesh'
import type { MeshCoatProject } from '../utils/projectSerializer'
import RadialPieMenu from '../components/RadialPieMenu'

export interface InitialPbrTextures {
  baseColor?: string | null
  roughness?: string | null
  metalness?: string | null
  normal?: string | null
  orm?: string | null
}

export type InitialTexturePayload =
  | string
  | InitialPbrTextures
  | {
      mode: 'shared'
      textures: InitialPbrTextures
    }
  | {
      mode: 'per-piece'
      pieces: Record<string, InitialPbrTextures>
    }

export interface ViewportHandle {
  loadFromUrl: (
    url: string,
    extension: string,
    textureSize?: number,
    initialTextures?: InitialTexturePayload | null
  ) => Promise<void>
  loadDefaultModel: (textureSize?: number, primitive?: 'sphere' | 'cube') => Promise<void>
  /** `snapshots` is one entry per saved piece, in the project's piece order. */
  loadProject: (project: MeshCoatProject, snapshots: StackSnapshot[]) => Promise<void>
  focusModel: () => void
  /** Every paintable piece of the loaded model, in mesh order. */
  pieces: () => PieceInfo[]
  activePieceIndex: () => number
  /** Switches which piece receives strokes, layer edits and undo. */
  setActivePiece: (index: number) => void
  /** Frames the camera on one piece (defaults to the active one). */
  focusPiece: (index?: number) => void
  /** The active piece's stack, or a specific piece's when given an index. */
  getLayerStack: (pieceIndex?: number) => LayerStack | undefined
  exportBaseColorPng: (pieceIndex?: number) => string | undefined
  /** Flattened, export-ready PNG for one channel, or undefined if unpainted. */
  exportChannelPng: (channel: PaintChannel, pieceIndex?: number) => string | undefined
  /** Which channels the current project actually carries. */
  paintedChannels: (pieceIndex?: number) => PaintChannel[]
  /** Packed AO/Roughness/Metalness map (see packOrmDataUrl). */
  exportOrmPng: (pieceIndex?: number) => string | undefined
  /**
   * White where this piece's UVs cover the texture, black elsewhere. Needed to
   * merge several pieces into one atlas image — every piece's maps are opaque
   * across the full square, so they have to be masked to their own region.
   */
  exportCoverageMaskPng: (pieceIndex?: number) => string | undefined
  setViewMode: (mode: ChannelViewMode) => void
  getViewMode: () => ChannelViewMode
  setLightingMode: (mode: LightingMode) => void
  setWireframeVisible: (visible: boolean) => void
  setIsolateActivePiece: (isolate: boolean) => void
  getIsolateActivePiece: () => boolean
  fillActive: () => void
  selectAllFaces: () => void
  invertFaceSelection: () => void
  getTotalFaces: () => number
  /** Projects the screen-space stencil onto the model as a one-shot decal. Returns false if it couldn't run. */
  stampStencil: () => boolean
  previewEdgeWear: (options: EdgeWearParams, asNewLayer?: boolean, newLayerBackground?: 'transparent' | 'black') => void
  cancelEdgeWearPreview: () => void
  commitEdgeWear: (options: EdgeWearParams, asNewLayer?: boolean, newLayerBackground?: 'transparent' | 'black') => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * Viewport display mode. 'material' is the real shaded PBR result; the rest
 * isolate one stored map so the artist can read it directly.
 */
export type ChannelViewMode = 'material' | PaintChannel

/**
 * One paintable piece of the model — a "texture set" in Substance terms. Each
 * mesh of a multi-object import gets its own layer stack, undo history and
 * maps, because separate pieces normally reuse the same 0-1 UV square: a stroke
 * shared between them would land on both.
 */
interface PaintPiece {
  mesh: THREE.Mesh
  name: string
  stack: LayerStack
  /** Local-space triangle positions for the selection/hover overlays. */
  facePositions: Float32Array
  highlightMesh: THREE.LineSegments
  hoverFaceMesh: THREE.LineSegments
  shadedMaterial: THREE.MeshStandardMaterial
  /**
   * What the imported file already had on this mesh, per material slot, baked
   * into the background layer at load. One entry per slot because a Blender
   * object commonly carries several materials over one mesh, each covering its
   * own range of faces.
   */
  embedded: EmbeddedSlot[]
  /** Built lazily, per piece, since each carries its own channel map uniform. */
  channelViewMaterial?: THREE.ShaderMaterial
}

/** One material slot of an imported mesh, and the faces it covers. */
interface EmbeddedSlot {
  maps: Partial<Record<PaintChannel, THREE.Texture>>
  /** Flat colour to lay down where the slot has no base-color map. */
  color: THREE.Color | null
  /** Faces this slot owns, or null when the slot covers the whole mesh. */
  faces: Set<number> | null
}

/** Piece summary handed to the UI for the texture-set selector. */
export interface PieceInfo {
  index: number
  name: string
  textureSize: number
  faceCount: number
}

interface GizmoHandle {
  group: THREE.Group
  brushRing: THREE.Mesh
  eyedropperReticle: THREE.Group
  bucketReticle: THREE.Group
  stampReticle: THREE.Group
  brushTipMesh: THREE.Mesh
  brushTipMaterial: THREE.ShaderMaterial
  stampPreviewMesh: THREE.Mesh
  stampPreviewMaterial: THREE.MeshBasicMaterial
  mirrorGroup: THREE.Group
  mirrorBrushRing: THREE.Mesh
  mirrorBrushTipMesh: THREE.Mesh
  mirrorStampPreviewMesh: THREE.Mesh
}

const brushOutlineVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const brushOutlineFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  varying vec2 vUv;

  void main() {
    if (uHasTexture < 0.5) {
      discard;
    }
    vec2 uv = vUv;
    float centerAlpha = texture2D(uTexture, uv).a;

    // 4-sample cross edge detection for silhouette contour
    float off = 1.0 / 64.0;
    float aL = texture2D(uTexture, uv - vec2(off, 0.0)).a;
    float aR = texture2D(uTexture, uv + vec2(off, 0.0)).a;
    float aU = texture2D(uTexture, uv - vec2(0.0, off)).a;
    float aD = texture2D(uTexture, uv + vec2(0.0, off)).a;

    float edge = max(abs(centerAlpha - aL), max(abs(centerAlpha - aR), max(abs(centerAlpha - aU), abs(centerAlpha - aD))));
    float isEdge = smoothstep(0.06, 0.35, edge);

    // Outline color: vibrant cyan/sky blue with bright white edge
    vec4 outline = vec4(0.22, 0.74, 0.98, 0.95);
    // Interior fill: subtle semi-transparent ghost imprint of the brush
    vec4 fill = vec4(0.23, 0.51, 0.96, centerAlpha * 0.32);

    vec4 outColor = mix(fill, outline, isEdge);
    if (outColor.a < 0.02) discard;

    gl_FragColor = outColor;
  }
`

function createGizmo(): GizmoHandle {
  const group = new THREE.Group()

  // 1. Brush Ring (for circular brush, eraser, line)
  const brushRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
  )
  group.add(brushRing)

  // 2. Eyedropper Reticle (precision crosshair + target ring)
  const eyedropperReticle = new THREE.Group()
  const eyeOuterRing = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.88, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
  )
  const eyeCenterDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.18, 16),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
  )
  const eyeCrosshairGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.4, 0, 0), new THREE.Vector3(-0.95, 0, 0),
    new THREE.Vector3(0.95, 0, 0), new THREE.Vector3(1.4, 0, 0),
    new THREE.Vector3(0, -1.4, 0), new THREE.Vector3(0, -0.95, 0),
    new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0, 1.4, 0)
  ])
  const eyeCrosshair = new THREE.LineSegments(
    eyeCrosshairGeom,
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })
  )
  eyedropperReticle.add(eyeOuterRing, eyeCenterDot, eyeCrosshair)
  eyedropperReticle.visible = false
  group.add(eyedropperReticle)

  // 3. Bucket Reticle (flood indicator target ring)
  const bucketReticle = new THREE.Group()
  const bucketOuterRing = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 0.96, 32),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
  )
  const bucketInnerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.48, 32),
    new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false })
  )
  const bucketCrosshairGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.4, 0, 0), new THREE.Vector3(-1.0, 0, 0),
    new THREE.Vector3(1.0, 0, 0), new THREE.Vector3(1.4, 0, 0),
    new THREE.Vector3(0, -1.4, 0), new THREE.Vector3(0, -1.0, 0),
    new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0, 1.4, 0)
  ])
  const bucketCrosshair = new THREE.LineSegments(
    bucketCrosshairGeom,
    new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false })
  )
  bucketReticle.add(bucketOuterRing, bucketInnerRing, bucketCrosshair)
  bucketReticle.visible = false
  group.add(bucketReticle)

  // 4. Stamp Reticle (amber square frame with orientation pointer & crosshair)
  const stampReticle = new THREE.Group()
  const stampFrameGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1, -1, 0),
    new THREE.Vector3(1, -1, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(-1, 1, 0),
    new THREE.Vector3(-1, -1, 0)
  ])
  const stampFrame = new THREE.Line(
    stampFrameGeom,
    new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false })
  )
  const stampArrowGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.3, 0.6, 0),
    new THREE.Vector3(0, 0.95, 0),
    new THREE.Vector3(0.3, 0.6, 0),
    new THREE.Vector3(0, 0.95, 0),
    new THREE.Vector3(0, 0.2, 0)
  ])
  const stampArrow = new THREE.Line(
    stampArrowGeom,
    new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false })
  )
  const stampCrosshairGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0),
    new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 0.2, 0)
  ])
  const stampCrosshair = new THREE.LineSegments(
    stampCrosshairGeom,
    new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false })
  )
  stampReticle.add(stampFrame, stampArrow, stampCrosshair)
  stampReticle.visible = false
  group.add(stampReticle)

  // 5. Brush Tip Silhouette / Outline Mesh (for custom brush tips & ABR stamps)
  const brushTipMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: null },
      uHasTexture: { value: 0 }
    },
    vertexShader: brushOutlineVertexShader,
    fragmentShader: brushOutlineFragmentShader,
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide
  })
  const brushTipGeom = new THREE.PlaneGeometry(2, 2)
  const brushTipMesh = new THREE.Mesh(brushTipGeom, brushTipMaterial)

  // Outer bounds helper line
  const brushTipBoundsGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1, -1, 0),
    new THREE.Vector3(1, -1, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(-1, 1, 0),
    new THREE.Vector3(-1, -1, 0)
  ])
  const brushTipBounds = new THREE.Line(
    brushTipBoundsGeom,
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, depthTest: false })
  )
  brushTipMesh.add(brushTipBounds)
  brushTipMesh.visible = false
  group.add(brushTipMesh)

  // 5b. Stamp Tool Live Preview (full-color decal, not just an outline) — shows
  // what the selected shelf texture will actually look like when stamped, so
  // aiming/rotating the stamp doesn't require a guess-and-check placement.
  const stampPreviewMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
    opacity: 0.85
  })
  const stampPreviewMesh = new THREE.Mesh(brushTipGeom, stampPreviewMaterial)
  stampPreviewMesh.visible = false
  group.add(stampPreviewMesh)

  group.visible = false
  group.renderOrder = 999

  // 6. Mirrored Gizmo Group for Symmetry Mode
  const mirrorGroup = new THREE.Group()
  const mirrorBrushRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false })
  )
  const mirrorBrushTipMesh = new THREE.Mesh(brushTipGeom, brushTipMaterial)
  const mirrorBrushTipBounds = new THREE.Line(
    brushTipBoundsGeom,
    new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.35, depthTest: false })
  )
  mirrorBrushTipMesh.add(mirrorBrushTipBounds)
  const mirrorStampPreviewMesh = new THREE.Mesh(brushTipGeom, stampPreviewMaterial)
  mirrorStampPreviewMesh.visible = false
  mirrorGroup.add(mirrorBrushRing, mirrorBrushTipMesh, mirrorStampPreviewMesh)
  mirrorBrushTipMesh.visible = false
  mirrorGroup.visible = false
  mirrorGroup.renderOrder = 999

  return {
    group,
    brushRing,
    eyedropperReticle,
    bucketReticle,
    stampReticle,
    brushTipMesh,
    stampPreviewMesh,
    stampPreviewMaterial,
    brushTipMaterial,
    mirrorGroup,
    mirrorBrushRing,
    mirrorBrushTipMesh,
    mirrorStampPreviewMesh
  }
}

interface SymmetryGuideHandle {
  group: THREE.Group
  update: (axis: SymmetryAxis, model: LoadedModel | undefined, mesh?: THREE.Mesh) => void
  dispose: () => void
}

function createSymmetryGuide(): SymmetryGuideHandle {
  const group = new THREE.Group()
  group.name = 'SymmetryGuidePlane'
  group.visible = false
  group.renderOrder = 992

  // 1. Translucent planar wall mesh
  const wallGeom = new THREE.PlaneGeometry(1, 1, 8, 8)
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x06b6d4,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true
  })
  const wallMesh = new THREE.Mesh(wallGeom, wallMat)
  group.add(wallMesh)

  // 2. Outer glowing perimeter border
  const borderGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
    new THREE.Vector3(-0.5, -0.5, 0)
  ])
  const borderMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  })
  const borderLine = new THREE.Line(borderGeom, borderMat)
  group.add(borderLine)

  // 3. Center crosshair lines through the middle of the wall
  const crossGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0.5, 0, 0),
    new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.5, 0)
  ])
  const crossMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.5,
    depthWrite: false
  })
  const crossLine = new THREE.LineSegments(crossGeom, crossMat)
  group.add(crossLine)

  // 4. Subtle grid lines inside the plane to enhance the "big wall" visual depth
  const innerGridGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.25, 0), new THREE.Vector3(0.5, -0.25, 0),
    new THREE.Vector3(-0.5, 0.25, 0), new THREE.Vector3(0.5, 0.25, 0),
    new THREE.Vector3(-0.25, -0.5, 0), new THREE.Vector3(-0.25, 0.5, 0),
    new THREE.Vector3(0.25, -0.5, 0), new THREE.Vector3(0.25, 0.5, 0)
  ])
  const innerGridMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  })
  const innerGridLine = new THREE.LineSegments(innerGridGeom, innerGridMat)
  group.add(innerGridLine)

  function update(axis: SymmetryAxis, model: LoadedModel | undefined, meshOverride?: THREE.Mesh): void {
    if (axis === 'off' || !model || model.meshes.length === 0) {
      group.visible = false
      return
    }

    // Sized around the piece being painted, since that's what the mirror acts on.
    const mesh = meshOverride ?? model.meshes[0]
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox()
    }
    const bbox = mesh.geometry.boundingBox
    if (!bbox) {
      group.visible = false
      return
    }

    const size = new THREE.Vector3()
    bbox.getSize(size)
    const center = new THREE.Vector3()
    bbox.getCenter(center)

    // Make the plane large enough to comfortably pass through and frame the entire mesh
    const maxDim = Math.max(size.x, size.y, size.z, 0.8)
    const wallSpan = maxDim * 1.6
    group.scale.set(wallSpan, wallSpan, 1)

    if (axis === 'x') {
      // Perpendicular to X axis (YZ plane) through X = 0
      group.position.set(0, center.y, center.z)
      group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
      wallMat.color.setHex(0x06b6d4)
      borderMat.color.setHex(0x38bdf8)
      crossMat.color.setHex(0x38bdf8)
      innerGridMat.color.setHex(0x38bdf8)
    } else if (axis === 'y') {
      // Perpendicular to Y axis (XZ plane) through Y = 0
      group.position.set(center.x, 0, center.z)
      group.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
      wallMat.color.setHex(0x10b981)
      borderMat.color.setHex(0x34d399)
      crossMat.color.setHex(0x34d399)
      innerGridMat.color.setHex(0x34d399)
    } else if (axis === 'z') {
      // Perpendicular to Z axis (XY plane) through Z = 0
      group.position.set(center.x, center.y, 0)
      group.quaternion.identity()
      wallMat.color.setHex(0xa855f7)
      borderMat.color.setHex(0xc084fc)
      crossMat.color.setHex(0xc084fc)
      innerGridMat.color.setHex(0xc084fc)
    }

    group.visible = true
  }

  function dispose(): void {
    wallGeom.dispose()
    wallMat.dispose()
    borderGeom.dispose()
    borderMat.dispose()
    crossGeom.dispose()
    crossMat.dispose()
    innerGridGeom.dispose()
    innerGridMat.dispose()
  }

  return { group, update, dispose }
}

export default function Viewport(props: {
  tool: () => ToolMode
  textures?: string[]
  onToolChange?: (tool: ToolMode) => void
  onReady?: (handle: ViewportHandle) => void
  onMissingUv?: (names: string[]) => void
  onLayersChanged?: () => void
  onWireframeChanged?: (visible: boolean) => void
  onIsolatePieceChanged?: (isolate: boolean) => void
  /** Fires when the piece list or the active piece changes. */
  onPiecesChanged?: () => void
}) {
  let canvasRef: HTMLCanvasElement | undefined
  let sceneHandle: SceneHandle | undefined
  let currentModel: LoadedModel | undefined
  /**
   * One texture set per mesh in the model. `layerStack` (and the highlight /
   * facePositions / shadedMaterial variables below) always mirror the ACTIVE
   * piece, so every existing painting path keeps working on one stack while the
   * others stay painted and visible in the viewport.
   */
  let pieces: PaintPiece[] = []
  let activePieceIndex = 0
  let isolateActivePiece = false
  let layerStack: LayerStack | undefined
  let viewMode: ChannelViewMode = 'material'
  let gizmoHandle: GizmoHandle | undefined
  let hoverFaceMesh: THREE.LineSegments | undefined
  let symmetryGuide: SymmetryGuideHandle | undefined
  /** Box around the piece receiving strokes; only drawn for multi-piece models. */
  let activePieceBox: THREE.Box3Helper | undefined
  /** Box around the piece under the cursor when it isn't the active one. */
  let hoverPieceBox: THREE.Box3Helper | undefined
  let rafId = 0
  let painting = false
  let lastStampPos: THREE.Vector3 | null = null
  /**
   * World position of the last brush/eraser/stamp dab, kept ACROSS strokes (unlike
   * lastStampPos, which resets on every pointer-down for dab spacing). Shift +
   * click connects this point to the new click with a straight interpolated
   * line, the way Photoshop/Procreate/Substance do, so panel lines and seams
   * don't require switching to the Line tool.
   */
  let lastBrushDabPos: THREE.Vector3 | null = null
  /** Previous dab's UV, so the smudge effect knows which way the stroke is heading. */
  let lastEffectUv: THREE.Vector2 | null = null
  let stencilTexture: THREE.Texture | null = null
  /** Active stencil-transform drag (Transform Stencil mode), in client pixels. */
  let stencilDrag: { lastX: number; lastY: number } | null = null
  let occlusionPass: OcclusionDepthPass | undefined
  let brushTexture: THREE.Texture | null = null
  /** Per-channel maps of the active material set (see materialSets.ts), loaded
   * alongside brushTexture so a stroke can feed each channel its own source. */
  let channelMaps: ChannelMaps = {}
  let brushTipTexture: THREE.Texture | null = null
  const textureLoader = new THREE.TextureLoader()
  let wireframeMeshes: THREE.LineSegments[] = []
  let wireframeVisible = false
  let highlightMesh: THREE.LineSegments | undefined
  /** Local-space positions, 9 floats per triangle, in the same order as SurfaceHit.faceIndex — built once per model so the highlight overlay can slice out selected triangles without recomputing toNonIndexed(). */
  let facePositions: Float32Array | undefined

  let resizeDrag: { shift: boolean; lastX: number; lastY: number } | null = null
  let ctrlFaceSelecting = false
  let ctrlFaceDeselecting = false
  let lineStartHit: SurfaceHit | null = null
  let currentHit: SurfaceHit | null = null
  let lineGuideMesh: THREE.Line | null = null

  /**
   * Which piece is being painted, and which one the cursor is over. Shown as a
   * viewport badge because the layers panel alone doesn't answer the question
   * an artist asks mid-stroke: "is this click going to land on the head or the
   * body?" Null while the model has a single piece — nothing to disambiguate.
   */
  const [pieceHud, setPieceHud] = createSignal<{ active: string; hover: string | null } | null>(null)

  const [eyedropperPreview, setEyedropperPreview] = createSignal<{
    visible: boolean
    x: number
    y: number
    color: string
  }>({ visible: false, x: 0, y: 0, color: '#000000' })

  let lastClientX = window.innerWidth / 2
  let lastClientY = window.innerHeight / 2
  const [pieMenu, setPieMenu] = createSignal<{ x: number; y: number } | null>(null)

  function getMirroredHit(hit: SurfaceHit): SurfaceHit | null {
    if (!currentModel || currentModel.meshes.length === 0) return null
    const axis = brush.symmetryAxis()
    if (axis === 'off') return null

    // Model root local space: mirror coordinate along selected axis
    const localPt = currentModel.root.worldToLocal(hit.point.clone())
    if (axis === 'x') localPt.x = -localPt.x
    else if (axis === 'y') localPt.y = -localPt.y
    else if (axis === 'z') localPt.z = -localPt.z
    const mirroredWorldPt = currentModel.root.localToWorld(localPt.clone())

    const rotMatrix = new THREE.Matrix3().getNormalMatrix(currentModel.root.matrixWorld)
    const invRotMatrix = rotMatrix.clone().invert()
    const localNormal = hit.normal.clone().applyMatrix3(invRotMatrix).normalize()
    if (axis === 'x') localNormal.x = -localNormal.x
    else if (axis === 'y') localNormal.y = -localNormal.y
    else if (axis === 'z') localNormal.z = -localNormal.z
    const mirroredWorldNorm = localNormal.applyMatrix3(rotMatrix).normalize()

    // Raycast towards surface around the mirrored location
    const rayOrigin = mirroredWorldPt.clone().addScaledVector(mirroredWorldNorm, 0.25)
    const rayDir = mirroredWorldNorm.clone().negate()
    const raycaster = new THREE.Raycaster(rayOrigin, rayDir, 0.001, 0.5)
    // Only the piece being painted: the mirrored point can easily land on a
    // neighbouring piece, whose UVs address a completely different texture set.
    const mirrorTarget = activeMesh()
    const hits = mirrorTarget ? raycaster.intersectObject(mirrorTarget, false) : []
    if (hits.length > 0) {
      const h0 = hits[0]
      return {
        mesh: h0.object as THREE.Mesh,
        point: h0.point,
        normal: h0.face
          ? h0.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(h0.object.matrixWorld)).normalize()
          : mirroredWorldNorm,
        uv: h0.uv ? h0.uv.clone() : hit.uv.clone(),
        faceIndex: h0.faceIndex ?? -1
      }
    }
    return {
      mesh: mirrorTarget,
      point: mirroredWorldPt,
      normal: mirroredWorldNorm,
      uv: hit.uv.clone(),
      faceIndex: -1
    }
  }

  function clearCurrentModel(): void {
    if (currentModel && sceneHandle) {
      sceneHandle.scene.remove(currentModel.root)
    }
    for (const wf of wireframeMeshes) {
      wf.geometry.dispose()
      ;(wf.material as THREE.Material).dispose()
    }
    wireframeMeshes = []
    lastBrushDabPos = null
    lastEffectUv = null
    occlusionPass?.invalidate()
    for (const piece of pieces) {
      piece.stack.dispose()
      piece.channelViewMaterial?.dispose()
      for (const overlay of [piece.highlightMesh, piece.hoverFaceMesh]) {
        overlay.geometry.dispose()
        ;(overlay.material as THREE.Material).dispose()
        overlay.parent?.remove(overlay)
      }
    }
    pieces = []
    activePieceIndex = 0
    layerStack = undefined
    currentModel = undefined
    isolateActivePiece = false
    props.onIsolatePieceChanged?.(false)
    if (activePieceBox) activePieceBox.visible = false
    if (hoverPieceBox) hoverPieceBox.visible = false
    setPieceHud(null)
    if (symmetryGuide && symmetryGuide.group.parent) {
      symmetryGuide.group.parent.remove(symmetryGuide.group)
      symmetryGuide.group.visible = false
    }
    // Both overlays belong to a piece and were disposed with it above.
    highlightMesh = undefined
    hoverFaceMesh = undefined
    facePositions = undefined
    // A picked triangle index only means anything for the mesh it was picked
    // on — carrying it into a freshly loaded model could restrict painting
    // to an unrelated (or out-of-range) face.
    clearFaceSelection()
  }

  function setupWireframe(model: LoadedModel): void {
    const material = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5 })
    wireframeMeshes = model.meshes.map((mesh) => {
      const overlay = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), material)
      overlay.visible = wireframeVisible
      overlay.renderOrder = 998
      mesh.add(overlay)
      return overlay
    })
  }

  function setWireframeVisible(visible: boolean): void {
    wireframeVisible = visible
    for (const wf of wireframeMeshes) wf.visible = visible
  }

  /**
   * Swaps the mesh between the shaded PBR material and the isolated
   * channel-inspection material. The shaded material is parked, not rebuilt, so
   * switching back restores every map binding exactly as the layer stack left
   * it. Re-applied after every setupLayers so a reload keeps the chosen view.
   */
  function applyViewModeToPiece(piece: PaintPiece): void {
    if (viewMode === 'material') {
      piece.mesh.material = piece.shadedMaterial
      return
    }

    const map = piece.stack.channelTexture(viewMode)
    if (!map) {
      // Nothing painted in that channel yet — fall back to the shaded view
      // rather than showing a black model and looking broken.
      piece.mesh.material = piece.shadedMaterial
      return
    }
    if (!piece.channelViewMaterial) piece.channelViewMaterial = createChannelViewMaterial()
    const mat = piece.channelViewMaterial
    mat.uniforms.tMap.value = map
    mat.uniforms.uIsNormal.value = CHANNEL_SPECS[viewMode].vector ? 1 : 0
    // Only the base-color composite is stored premultiplied; the data channels
    // are already resolved to straight values by the flatten pass.
    mat.uniforms.uPremultiplied.value = viewMode === 'baseColor' ? 1 : 0
    piece.mesh.material = mat
  }

  /** Every piece stays in its own channel view, so the whole model reads the same. */
  function applyViewMode(): void {
    for (const piece of pieces) applyViewModeToPiece(piece)
  }

  function createPiece(mesh: THREE.Mesh, textureSize?: number): PaintPiece {
    const stack = new LayerStack(sceneHandle!.renderer, mesh, textureSize)

    // Pieces of an imported model routinely SHARE one material instance (both
    // OBJ and glTF do this whenever the parts were exported with the same
    // material). Each piece binds its own composite and channel maps, so
    // binding onto a shared instance means the last piece built wins and every
    // other piece renders someone else's texture — which reads as "painting
    // does nothing". A private clone per piece is what makes each texture set
    // actually independent.
    const source = mesh.material
    const slots = (Array.isArray(source) ? source : [source]) as THREE.MeshStandardMaterial[]
    const base = slots[0]
    const material = base.clone()
    material.name = `${mesh.name || 'Piece'}_Material`
    // Collapsed to one material on purpose: a piece is one texture set, and
    // every slot's artwork is baked into it below. three renders a grouped
    // geometry with a single (non-array) material perfectly well.
    mesh.material = material

    /**
     * A GLB from Blender carries its textures inside the file, already bound to
     * the material. Binding the layer stack replaces those maps with this
     * stack's own composites, so without capturing them first the model's
     * artwork disappears the moment it loads and comes back as flat grey.
     *
     * Each material SLOT is captured separately with the faces it covers. A
     * Blender object with a body material and a trim material is one mesh with
     * two slots; keeping only the first (what this used to do) drops the trim's
     * texture entirely and paints its faces with the body's.
     *
     * flipY is deliberately left as each loader set it: GLTFLoader clears it
     * because glTF UVs run top-down and three compensates on the texture rather
     * than on the UV attribute, while TextureLoader sets it for an ordinary
     * PNG. Both sample correctly against the same vUv, and forcing either one
     * would flip that half of the imports.
     */
    const groups = mesh.geometry.groups
    const embedded: EmbeddedSlot[] = slots.map((slot, slotIndex) => {
      const maps: Partial<Record<PaintChannel, THREE.Texture>> = {}
      if (slot?.map) maps.baseColor = slot.map
      if (slot?.roughnessMap) maps.roughness = slot.roughnessMap
      if (slot?.metalnessMap) maps.metalness = slot.metalnessMap
      if (slot?.normalMap) maps.normal = slot.normalMap

      let faces: Set<number> | null = null
      if (slots.length > 1 && groups.length > 0) {
        faces = new Set<number>()
        for (const group of groups) {
          if ((group.materialIndex ?? 0) !== slotIndex) continue
          // Groups are expressed in index-buffer elements; three vertices per
          // triangle, and triangle numbering is what faceIndex counts in.
          const first = Math.floor(group.start / 3)
          const count = Math.floor(group.count / 3)
          for (let i = 0; i < count; i++) faces.add(first + i)
        }
      }

      return { maps, color: slot?.color ? slot.color.clone() : null, faces }
    })

    // The stack binds every channel it has (and re-binds when a new one first
    // appears mid-session), rather than the viewport wiring up base color once.
    stack.bindMaterial(material)

    // Same non-indexed expansion PaintEngine's uvMesh uses (see uvMesh.ts) —
    // keeps triangle numbering identical to SurfaceHit.faceIndex so the
    // highlight overlay lines up with what's actually selected for painting.
    const nonIndexed = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const piecePositions = (nonIndexed.attributes.position as THREE.BufferAttribute)
      .array.slice() as Float32Array

    const highlightGeometry = new THREE.BufferGeometry()
    highlightGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    const highlightMaterial = new THREE.LineBasicMaterial({
      color: 0xffaa00, // Blender-style warm amber outline
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
    const pieceHighlight = new THREE.LineSegments(highlightGeometry, highlightMaterial)
    pieceHighlight.renderOrder = 999
    pieceHighlight.frustumCulled = false
    mesh.add(pieceHighlight)

    const hoverFaceGeometry = new THREE.BufferGeometry()
    hoverFaceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    const hoverFaceMaterial = new THREE.LineBasicMaterial({
      color: 0x38bdf8, // Sky blue hover indicator for bucket & face select
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3
    })
    const pieceHover = new THREE.LineSegments(hoverFaceGeometry, hoverFaceMaterial)
    pieceHover.renderOrder = 998
    pieceHover.frustumCulled = false
    pieceHover.visible = false
    mesh.add(pieceHover)

    const piece: PaintPiece = {
      mesh,
      name: mesh.name || 'Piece',
      stack,
      embedded,
      facePositions: piecePositions,
      highlightMesh: pieceHighlight,
      hoverFaceMesh: pieceHover,
      shadedMaterial: material
    }
    applyViewModeToPiece(piece)
    return piece
  }

  /** The mesh currently receiving strokes, or undefined before a model loads. */
  function activeMesh(): THREE.Mesh | undefined {
    return pieces[activePieceIndex]?.mesh
  }

  /**
   * The meshes the depth pass treats as occluders.
   *
   * ONLY the piece being painted. The pass exists to stop a dab wrapping onto
   * the far side of the surface being aimed at; including the other pieces
   * turns every overlapping part into a stencil that blocks paint, and pieces
   * routinely interpenetrate or sit as coincident shells — a strap over a
   * torso, an eye inside a socket — which rejects the whole stroke and looks
   * exactly like painting is broken.
   */
  function occluderMeshes(): THREE.Mesh[] {
    const mesh = activeMesh()
    return mesh ? [mesh] : []
  }

  /** The named piece's stack, or the active one when no index is given. */
  function stackFor(pieceIndex?: number): LayerStack | undefined {
    return pieceIndex == null ? layerStack : pieces[pieceIndex]?.stack
  }

  function pieceIndexForMesh(mesh: THREE.Mesh | undefined): number {
    if (!mesh) return -1
    return pieces.findIndex((p) => p.mesh === mesh)
  }

  /**
   * Enforces mesh visibility based on `isolateActivePiece`.
   * When isolated, all pieces except the active piece (and any non-piece meshes)
   * are hidden.
   */
  function applyPieceVisibility(): void {
    if (!currentModel) return
    for (let i = 0; i < pieces.length; i++) {
      pieces[i].mesh.visible = !isolateActivePiece || i === activePieceIndex
    }
    for (const mesh of currentModel.meshes) {
      if (!pieces.some((p) => p.mesh === mesh)) {
        mesh.visible = !isolateActivePiece
      }
    }
  }

  /**
   * Draws the amber box around the active piece and the dimmer one around a
   * hovered inactive piece, and refreshes the badge. Both boxes are world-space
   * Box3Helpers rather than a material tint, so nothing about how the piece is
   * shaded (or which channel view is up) has to change to show selection.
   */
  function updatePieceOutlines(hoverMesh?: THREE.Mesh | null): void {
    if (!sceneHandle) return
    const multi = pieces.length > 1
    const active = pieces[activePieceIndex]

    if (!multi || !active) {
      if (activePieceBox) activePieceBox.visible = false
      if (hoverPieceBox) hoverPieceBox.visible = false
      setPieceHud(null)
      return
    }

    if (isolateActivePiece) {
      if (activePieceBox) activePieceBox.visible = false
      if (hoverPieceBox) hoverPieceBox.visible = false
      setPieceHud({ active: active.name, hover: null })
      return
    }

    if (!activePieceBox) {
      activePieceBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffaa00))
      ;(activePieceBox.material as THREE.LineBasicMaterial).transparent = true
      ;(activePieceBox.material as THREE.LineBasicMaterial).opacity = 0.75
      activePieceBox.renderOrder = 997
      sceneHandle.scene.add(activePieceBox)
    }
    activePieceBox.box.setFromObject(active.mesh)
    activePieceBox.visible = true

    const hoverPiece =
      hoverMesh && hoverMesh !== active.mesh ? pieces[pieceIndexForMesh(hoverMesh)] : undefined
    if (!hoverPieceBox) {
      hoverPieceBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x38bdf8))
      ;(hoverPieceBox.material as THREE.LineBasicMaterial).transparent = true
      ;(hoverPieceBox.material as THREE.LineBasicMaterial).opacity = 0.4
      hoverPieceBox.renderOrder = 996
      sceneHandle.scene.add(hoverPieceBox)
    }
    if (hoverPiece) {
      hoverPieceBox.box.setFromObject(hoverPiece.mesh)
      hoverPieceBox.visible = true
    } else {
      hoverPieceBox.visible = false
    }

    setPieceHud({ active: active.name, hover: hoverPiece?.name ?? null })
  }

  /**
   * Points every "current piece" variable at `index`. The paint paths, the
   * layers panel and undo all read those, so this one swap is what switching
   * texture sets means.
   */
  function setActivePiece(index: number): void {
    if (index < 0 || index >= pieces.length) return
    activePieceIndex = index
    const piece = pieces[index]
    layerStack = piece.stack
    facePositions = piece.facePositions
    highlightMesh = piece.highlightMesh
    hoverFaceMesh = piece.hoverFaceMesh
    // Face indices are per-mesh, so a selection made on another piece would
    // restrict painting to unrelated (or out-of-range) triangles here.
    clearFaceSelection()
    for (const other of pieces) {
      if (other !== piece) other.hoverFaceMesh.visible = false
    }
    updateHighlight()
    if (symmetryGuide && currentModel) symmetryGuide.update(brush.symmetryAxis(), currentModel, activeMesh())
    // The depth map is keyed on its occluder set, which just changed.
    occlusionPass?.invalidate()
    applyPieceVisibility()
    updatePieceOutlines()
    // Only onPiecesChanged: switching piece redraws the layers panel but is not
    // an edit, so it must not mark the project dirty.
    props.onPiecesChanged?.()
  }

  /**
   * Builds one texture set per mesh. Meshes without UV0 can't be painted at all
   * (modelLoader reports them) — they still render, they just get no stack.
   */
  function setupLayers(
    model: LoadedModel,
    textureSize?: number,
    /** Per-piece override by piece name, used when reopening a saved project. */
    sizeByName?: Record<string, number>
  ): void {
    if (!sceneHandle) return
    // Shadows are only rendered by the showcase preset, but the flags are a
    // property of the model rather than the lighting — set once here so
    // switching preset needs no traversal.
    for (const mesh of model.meshes) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }

    const paintable = model.meshes.filter((mesh) => !!mesh.geometry.attributes.uv)

    /**
     * Every piece is a full texture set, and a texture set at 4096 costs
     * roughly 320 MB of GPU memory (composite + two scratch buffers + the
     * layer's own ping-pong pair, 64 MB each). Eight pieces at that size ask
     * for ~2.5 GB, which most GPUs refuse — and a render target that failed to
     * allocate doesn't throw, it just reads back as zeroes, so the model turns
     * black and every export comes out empty.
     *
     * Scale the per-piece resolution down until the whole model fits a sane
     * budget. One piece keeps whatever the artist picked.
     */
    const BUDGET_TEXELS = 4096 * 4096 * 4
    const fitSize = (requested: number): number => {
      let size = requested
      while (size > 512 && paintable.length * size * size > BUDGET_TEXELS) size /= 2
      return size
    }

    pieces = paintable.map((mesh) => {
      const requested = sizeByName?.[mesh.name] ?? textureSize ?? DEFAULT_TEXTURE_SIZE
      const fitted = fitSize(requested)
      if (fitted !== requested) {
        console.warn(
          `[slip] ${paintable.length} paintable pieces at ${requested}px would exceed the GPU ` +
            `texture budget; "${mesh.name}" allocated at ${fitted}px instead.`
        )
      }
      return createPiece(mesh, fitted)
    })
    activePieceIndex = 0
    applyPieceVisibility()
    if (pieces.length > 0) setActivePiece(0)
    updatePieceOutlines()
    props.onPiecesChanged?.()
    props.onLayersChanged?.()
  }

  /** Rebuilds the selection outline — draws ONLY perimeter boundary edges with depth test. */
  function updateHighlight(): void {
    if (!highlightMesh || !facePositions) return
    const faces = brush.selectedFaces()
    if (faces.size === 0) {
      highlightMesh.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      highlightMesh.geometry.attributes.position.needsUpdate = true
      return
    }

    // Map each undirected edge to count and coordinates.
    // Quantize vertex coordinates to 4 decimals to weld co-located vertices across shared edges.
    const edgeMap = new Map<string, { count: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }>()

    const toKey = (x: number, y: number, z: number): string =>
      `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`

    const addEdge = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
      const k0 = toKey(x0, y0, z0)
      const k1 = toKey(x1, y1, z1)
      if (k0 === k1) return // degenerate zero-length edge
      const edgeKey = k0 < k1 ? `${k0}_${k1}` : `${k1}_${k0}`
      const existing = edgeMap.get(edgeKey)
      if (existing) {
        existing.count++
      } else {
        edgeMap.set(edgeKey, { count: 1, x0, y0, z0, x1, y1, z1 })
      }
    }

    for (const face of faces) {
      const base = face * 9
      if (base < 0 || base + 9 > facePositions.length) continue
      const v0x = facePositions[base], v0y = facePositions[base + 1], v0z = facePositions[base + 2]
      const v1x = facePositions[base + 3], v1y = facePositions[base + 4], v1z = facePositions[base + 5]
      const v2x = facePositions[base + 6], v2y = facePositions[base + 7], v2z = facePositions[base + 8]

      addEdge(v0x, v0y, v0z, v1x, v1y, v1z)
      addEdge(v1x, v1y, v1z, v2x, v2y, v2z)
      addEdge(v2x, v2y, v2z, v0x, v0y, v0z)
    }

    // A boundary edge belongs to only one selected face (count === 1)
    const boundaryCoords: number[] = []
    for (const edge of edgeMap.values()) {
      if (edge.count === 1) {
        boundaryCoords.push(edge.x0, edge.y0, edge.z0, edge.x1, edge.y1, edge.z1)
      }
    }

    // If an entire closed mesh is selected, all edges have count 2. In that case, show all edges.
    const finalCoords = boundaryCoords.length === 0 && faces.size > 0
      ? Array.from(edgeMap.values()).flatMap((e) => [e.x0, e.y0, e.z0, e.x1, e.y1, e.z1])
      : boundaryCoords

    const out = new Float32Array(finalCoords)
    highlightMesh.geometry.setAttribute('position', new THREE.BufferAttribute(out, 3))
    highlightMesh.geometry.attributes.position.needsUpdate = true
  }

  function frameModel(model: LoadedModel): void {
    if (!sceneHandle) return
    const box = new THREE.Box3().setFromObject(model.root)
    if (box.isEmpty()) return
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    sceneHandle.controls.focus(sphere.center, sphere.radius || 1)
    // Same bounds drive the shadow camera and the ground plane the model's
    // shadow lands on — the plane sits at the model's lowest point, not at
    // y = 0, so a model authored off the origin still gets a contact shadow.
    sceneHandle.fitShadows(sphere.center, sphere.radius || 1, box.min.y)
  }


  /**
   * Bakes a set of loaded maps into a piece's background layer. Shared by the
   * import wizard and by whatever textures an imported file already carried.
   */
  function fillPieceFromTextures(
    piece: PaintPiece,
    channelTextures: Partial<Record<PaintChannel, THREE.Texture>>,
    /** Restrict the fill to these faces (one material slot's range). */
    faces?: Set<number> | null,
    /** Flat colour for a slot that has no base-color map of its own. */
    flatColor?: THREE.Color | null
  ): void {
    const baseLayer = piece.stack.layers[0]
    if (!baseLayer) return
    const { baseColor, ...dataMaps } = channelTextures
    const restrict = faces && faces.size > 0 ? faces : null
    let filled = false

    const apply = (options: FillOptions): void => {
      if (restrict) baseLayer.engine.fillFaces(restrict, options)
      else baseLayer.engine.fill(options)
      filled = true
    }

    // Base color has to travel as the fill's `texture`, NOT as a channel map:
    // the paint shader samples base color only from uBrushTexture (see
    // applyChannelPayload — a baseColor entry in channelMaps is deliberately
    // dropped there), so passing an imported color map as a channel map fills
    // flat white and the import looks like it did nothing.
    if (baseColor) {
      apply({
        texture: baseColor,
        // Scale 1 = raw UV: an imported map is authored in this model's own UV
        // layout, so it must land texel-for-texel rather than tiled.
        scale: 1,
        color: new THREE.Color(0xffffff),
        alpha: 1,
        channels: { baseColor: { color: new THREE.Color(0xffffff), alpha: 1 } }
      })
    } else if (flatColor) {
      // A material slot with no texture still has a colour, and it is the
      // model's own look — laying it down beats leaving that slot's faces on
      // the default grey background.
      apply({
        color: flatColor,
        alpha: 1,
        channels: { baseColor: { color: flatColor, alpha: 1 } }
      })
    }

    // The data channels do sample their own maps, and go in one pass of their
    // own so the base color image can't mask them through texSample.a.
    const dataChannels = Object.keys(dataMaps) as PaintChannel[]
    if (dataChannels.length > 0) {
      apply({
        channelMaps: dataMaps,
        scale: 1,
        alpha: 1,
        channels: {
          ...(dataMaps.roughness ? { roughness: 1 } : {}),
          ...(dataMaps.metalness ? { metalness: 1 } : {}),
          ...(dataMaps.normal ? { normal: 1 } : {})
        }
      })
    }

    if (!filled) return

    // A multi-piece model is very often UV-mapped into one shared atlas, and
    // every piece was just handed that whole sheet. Clipping each piece to its
    // own UV coverage is what separates them back out into independent texture
    // sets: without it a piece carries its neighbours' islands, painting one
    // leaves the others' artwork sitting underneath, and a per-piece export
    // writes the entire atlas. Harmless for a model whose pieces each own the
    // full 0-1 square, since everything outside a piece's islands is unused.
    if (pieces.length > 1) baseLayer.engine.clipToCoverage()

    piece.stack.recomposite()
  }

  async function applyPbrTexturesToPiece(
    piece: PaintPiece,
    texMap: InitialPbrTextures,
    /**
     * True for glTF-derived models (.glb/.gltf, and .blend once Blender has
     * converted it). glTF puts the UV origin at the TOP-left and Blender's
     * exporter flips V to match, while THREE.TextureLoader flips an ordinary
     * image on upload so V = 0 reads the bottom row. Applied together, an
     * external atlas lands vertically mirrored: a piece unwrapped into the top
     * of the sheet samples the bottom of it. Not flipping the upload cancels
     * that out. (Textures that come embedded in the file are already correct —
     * GLTFLoader clears flipY on those itself.)
     */
    uvOriginTopLeft: boolean
  ): Promise<void> {
    if (!piece.stack || piece.stack.layers.length === 0) return
    const channelTextures: Partial<Record<PaintChannel, THREE.Texture>> = {}

    /**
     * An imported map is authored in this model's UV layout, so it is sampled
     * 1:1 rather than tiled — clamping keeps the outermost texel from wrapping
     * around to the opposite edge of the sheet along every UV seam.
     */
    const prepare = (tex: THREE.Texture, srgb: boolean): THREE.Texture => {
      tex.flipY = !uvOriginTopLeft
      // Data maps carry numbers, not something to look at: decoding them as
      // sRGB would bend every roughness/metalness/normal value.
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.needsUpdate = true
      return tex
    }

    if (texMap.baseColor) {
      channelTextures.baseColor = prepare(await asyncLoadTexture(texMap.baseColor), true)
    }
    if (texMap.roughness) {
      channelTextures.roughness = prepare(await asyncLoadTexture(texMap.roughness), false)
    }
    if (texMap.metalness) {
      channelTextures.metalness = prepare(await asyncLoadTexture(texMap.metalness), false)
    }
    if (texMap.normal) {
      channelTextures.normal = prepare(await asyncLoadTexture(texMap.normal), false)
    }

    if (texMap.orm && (!channelTextures.roughness || !channelTextures.metalness)) {
      try {
        const isDirectUrl =
          texMap.orm.startsWith('asset-file://') ||
          texMap.orm.startsWith('data:') ||
          texMap.orm.startsWith('blob:')
        const ormUrl = isDirectUrl ? texMap.orm : toAssetUrl(texMap.orm)
        const unpacked = await unpackOrmDataUrl(ormUrl)
        if (!channelTextures.roughness && unpacked.roughness) {
          channelTextures.roughness = prepare(await asyncLoadTexture(unpacked.roughness), false)
        }
        if (!channelTextures.metalness && unpacked.metalness) {
          channelTextures.metalness = prepare(await asyncLoadTexture(unpacked.metalness), false)
        }
      } catch (e) {
        console.error('Failed to unpack initial ORM map:', e)
      }
    }

    fillPieceFromTextures(piece, channelTextures)
  }

  /**
   * Snaps a pixel dimension to a canvas size the app actually supports. Painting
   * at the source map's own resolution is what keeps an imported texture
   * pixel-exact: a 2048 atlas rebuilt on a 4096 canvas is resampled up on the
   * way in and back down on export, softening every edge in the artwork, and it
   * costs four times the GPU memory to do it.
   */
  function snapToCanvasSize(pixels: number): number {
    const sizes = [512, 1024, 2048, 4096, 8192]
    let best = sizes[0]
    for (const size of sizes) {
      if (size <= pixels) best = size
    }
    return best
  }

  /** Reads an image's pixel dimensions without decoding it into a GPU texture. */
  function probeImageSize(path: string): Promise<number | null> {
    return new Promise((resolve) => {
      // TGA can't be measured by an <img>; those fall back to the chosen size.
      if (/\.tga$/i.test(path)) {
        resolve(null)
        return
      }
      const isDirect = /^(asset-file:|data:|blob:)/.test(path)
      const img = new Image()
      img.onload = () => resolve(Math.max(img.naturalWidth, img.naturalHeight) || null)
      img.onerror = () => resolve(null)
      img.src = isDirect ? path : toAssetUrl(path)
    })
  }

  /** Native size of whatever maps a mesh's material slots already carry. */
  function embeddedMapSize(mesh: THREE.Mesh): number | null {
    const slots = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]
    let largest = 0
    for (const slot of slots) {
      for (const map of [slot?.map, slot?.roughnessMap, slot?.metalnessMap, slot?.normalMap]) {
        const img = map?.image as { width?: number; height?: number } | undefined
        if (img?.width) largest = Math.max(largest, img.width, img.height ?? 0)
      }
    }
    return largest > 0 ? snapToCanvasSize(largest) : null
  }

  async function loadFromUrl(
    url: string,
    extension: string,
    textureSize?: number,
    initialTextures?: InitialTexturePayload | null
  ): Promise<void> {
    if (!sceneHandle) return
    const model = await loadModel(url, extension)
    // A .blend arrives here already converted to .glb by the Blender bridge,
    // so it carries glTF's top-left UV origin like any other glTF model.
    const uvOriginTopLeft = /^(glb|gltf)$/i.test(extension)
    /**
     * Canvas size follows the artwork being imported, not the number in the
     * wizard: a piece whose maps are 2048 is painted at 2048. Measured BEFORE
     * the stacks exist, because a LayerStack's resolution is fixed at
     * construction.
     */
    const sizeByName: Record<string, number> = {}
    for (const mesh of model.meshes) {
      const native = embeddedMapSize(mesh)
      if (native) sizeByName[mesh.name] = native
    }
    if (initialTextures) {
      const probe = async (maps: InitialPbrTextures): Promise<number | null> => {
        for (const path of [maps.baseColor, maps.normal, maps.orm, maps.roughness, maps.metalness]) {
          if (!path) continue
          const px = await probeImageSize(path)
          if (px) return snapToCanvasSize(px)
        }
        return null
      }
      if (typeof initialTextures === 'object' && 'mode' in initialTextures && initialTextures.mode === 'per-piece') {
        for (const [name, maps] of Object.entries(initialTextures.pieces || {})) {
          const native = await probe(maps)
          if (native) sizeByName[name] = native
        }
      } else {
        const shared: InitialPbrTextures =
          typeof initialTextures === 'string'
            ? { baseColor: initialTextures }
            : 'mode' in initialTextures && initialTextures.mode === 'shared'
              ? initialTextures.textures
              : (initialTextures as InitialPbrTextures)
        const native = await probe(shared)
        // A shared atlas is one image across every piece, so they all match it.
        if (native) for (const mesh of model.meshes) sizeByName[mesh.name] = native
      }
    }

    clearCurrentModel()
    currentModel = model
    sceneHandle.scene.add(model.root)
    frameModel(model)
    setupLayers(model, textureSize, sizeByName)
    setupWireframe(model)
    if (!symmetryGuide) symmetryGuide = createSymmetryGuide()
    model.root.add(symmetryGuide.group)
    symmetryGuide.update(brush.symmetryAxis(), model, activeMesh())

    if (initialTextures && pieces.length > 0) {
      try {
        if (
          typeof initialTextures === 'object' &&
          'mode' in initialTextures &&
          initialTextures.mode === 'per-piece'
        ) {
          const pieceMap = initialTextures.pieces || {}
          for (let i = 0; i < pieces.length; i++) {
            const piece = pieces[i]
            const name = piece.name
            const assigned =
              pieceMap[name] ||
              pieceMap[name.toLowerCase()] ||
              pieceMap[String(i)]
            if (assigned) {
              await applyPbrTexturesToPiece(piece, assigned, uvOriginTopLeft)
            }
          }
        } else {
          const sharedMap: InitialPbrTextures =
            typeof initialTextures === 'string'
              ? { baseColor: initialTextures }
              : 'mode' in initialTextures && initialTextures.mode === 'shared'
                ? initialTextures.textures
                : (initialTextures as InitialPbrTextures)

          for (const piece of pieces) {
            await applyPbrTexturesToPiece(piece, sharedMap, uvOriginTopLeft)
          }
        }
        props.onLayersChanged?.()
      } catch (err) {
        console.error('Failed to load initial PBR texture maps:', err)
      }
    }

    if (model.missingUv.length > 0) props.onMissingUv?.(model.missingUv)
  }

  async function loadDefaultModel(
    textureSize?: number,
    primitive: 'sphere' | 'cube' = 'sphere'
  ): Promise<void> {
    if (!sceneHandle) return
    const model = createDefaultTestModel(primitive)
    clearCurrentModel()
    currentModel = model
    sceneHandle.scene.add(model.root)
    frameModel(model)
    setupLayers(model, textureSize)
    setupWireframe(model)
    if (!symmetryGuide) symmetryGuide = createSymmetryGuide()
    model.root.add(symmetryGuide.group)
    symmetryGuide.update(brush.symmetryAxis(), model, activeMesh())
    props.onLayersChanged?.()
  }

  async function loadProject(project: MeshCoatProject, snapshots: StackSnapshot[]): Promise<void> {
    if (!sceneHandle) return
    let model: LoadedModel
    if (project.modelPath) {
      const ext = project.modelPath.split('.').pop() || 'glb'
      const url = window.api.assetUrl(project.modelPath)
      model = await loadModel(url, ext)
    } else {
      model = createDefaultTestModel()
    }
    clearCurrentModel()
    currentModel = model
    sceneHandle.scene.add(model.root)
    frameModel(model)
    const sizeByName: Record<string, number> = {}
    for (const saved of project.pieces ?? []) {
      if (saved.textureSize) sizeByName[saved.name] = saved.textureSize
    }
    setupLayers(model, project.textureSize, sizeByName)
    setupWireframe(model)
    if (!symmetryGuide) symmetryGuide = createSymmetryGuide()
    model.root.add(symmetryGuide.group)
    symmetryGuide.update(brush.symmetryAxis(), model, activeMesh())

    // Saved pieces are matched by name first — a re-exported model can reorder
    // its objects, and restoring a head's layers onto a weapon is unrecoverable.
    // Position is the fallback for older files and for renamed pieces.
    const savedNames = project.pieces?.map((p) => p.name) ?? []
    const taken = new Set<number>()
    pieces.forEach((piece, i) => {
      let saved = savedNames.findIndex((name, si) => name === piece.name && !taken.has(si))
      if (saved < 0 && !taken.has(i) && i < snapshots.length) saved = i
      if (saved < 0 || !snapshots[saved]) return
      taken.add(saved)
      piece.stack.restoreState(snapshots[saved])
    })
    setActivePiece(Math.min(project.activePieceIndex ?? 0, Math.max(0, pieces.length - 1)))
    props.onLayersChanged?.()
  }

  function updateHoverFace(faceIndex: number): void {
    if (!hoverFaceMesh || !facePositions) return
    const base = faceIndex * 9
    if (base < 0 || base + 9 > facePositions.length) {
      hoverFaceMesh.visible = false
      return
    }
    const v0x = facePositions[base], v0y = facePositions[base + 1], v0z = facePositions[base + 2]
    const v1x = facePositions[base + 3], v1y = facePositions[base + 4], v1z = facePositions[base + 5]
    const v2x = facePositions[base + 6], v2y = facePositions[base + 7], v2z = facePositions[base + 8]
    const out = new Float32Array([
      v0x, v0y, v0z, v1x, v1y, v1z,
      v1x, v1y, v1z, v2x, v2y, v2z,
      v2x, v2y, v2z, v0x, v0y, v0z
    ])
    hoverFaceMesh.geometry.setAttribute('position', new THREE.BufferAttribute(out, 3))
    hoverFaceMesh.geometry.attributes.position.needsUpdate = true
    hoverFaceMesh.visible = true
  }

  function updateGizmo(hit: SurfaceHit | null): void {
    if (!gizmoHandle) return
    const tool = props.tool()

    if (!hit) {
      gizmoHandle.group.visible = false
      gizmoHandle.mirrorGroup.visible = false
      if (hoverFaceMesh) hoverFaceMesh.visible = false
      return
    }

    gizmoHandle.group.position.copy(hit.point)
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal)
    gizmoHandle.group.quaternion.copy(quat)

    const dist = sceneHandle ? sceneHandle.camera.position.distanceTo(hit.point) : 2
    const reticleScale = Math.max(0.02, dist * 0.035)

    const hasTip = !!brushTipTexture || (tool === 'stamp' && !!brushTexture)
    // Stamp tool with a shelf texture (not a custom ABR alpha tip) gets a
    // real full-color preview instead of the blue alpha-silhouette outline —
    // a decal image's actual colors are the whole point of aiming a stamp.
    const showStampColorPreview = tool === 'stamp' && !brushTipTexture && !!brushTexture

    if (gizmoHandle) {
      const activeTipTex = brushTipTexture ?? (tool === 'stamp' && !showStampColorPreview ? brushTexture : null)
      gizmoHandle.brushTipMaterial.uniforms.uTexture.value = activeTipTex
      gizmoHandle.brushTipMaterial.uniforms.uHasTexture.value = activeTipTex ? 1 : 0
      gizmoHandle.stampPreviewMaterial.map = showStampColorPreview ? brushTexture : null
      gizmoHandle.stampPreviewMaterial.needsUpdate = true

      const rotRad = (brush.brushRotation() * Math.PI) / 180
      gizmoHandle.brushTipMesh.rotation.z = rotRad
      gizmoHandle.mirrorBrushTipMesh.rotation.z = -rotRad
      gizmoHandle.stampPreviewMesh.rotation.z = rotRad
      gizmoHandle.mirrorStampPreviewMesh.rotation.z = -rotRad
    }

    if (tool === 'brush' || tool === 'eraser' || tool === 'line' || tool === 'effect') {
      gizmoHandle.group.visible = true
      gizmoHandle.eyedropperReticle.visible = false
      gizmoHandle.bucketReticle.visible = false
      gizmoHandle.stampReticle.visible = false
      // The effect brush has a plain circular footprint — a tip alpha shapes
      // where paint lands, which is not something a filter can honour.
      if (hasTip && tool !== 'eraser' && tool !== 'effect') {
        gizmoHandle.brushRing.visible = false
        gizmoHandle.brushTipMesh.visible = true
        gizmoHandle.brushTipMesh.scale.setScalar(brush.radius())
      } else {
        gizmoHandle.brushTipMesh.visible = false
        gizmoHandle.brushRing.visible = true
        gizmoHandle.brushRing.scale.setScalar(brush.radius())
      }
      gizmoHandle.stampPreviewMesh.visible = false
      if (hoverFaceMesh) hoverFaceMesh.visible = false
    } else if (tool === 'stamp') {
      gizmoHandle.group.visible = true
      gizmoHandle.brushRing.visible = false
      gizmoHandle.eyedropperReticle.visible = false
      gizmoHandle.bucketReticle.visible = false
      gizmoHandle.stampReticle.visible = true
      gizmoHandle.stampReticle.scale.setScalar(brush.radius())
      gizmoHandle.stampPreviewMesh.visible = showStampColorPreview
      gizmoHandle.brushTipMesh.visible = hasTip && !showStampColorPreview
      if (showStampColorPreview) {
        gizmoHandle.stampPreviewMesh.scale.setScalar(brush.radius())
      } else if (hasTip) {
        gizmoHandle.brushTipMesh.scale.setScalar(brush.radius())
      }
      if (hoverFaceMesh) hoverFaceMesh.visible = false
    } else if (tool === 'eyedropper') {
      gizmoHandle.group.visible = true
      gizmoHandle.brushRing.visible = false
      gizmoHandle.eyedropperReticle.visible = true
      gizmoHandle.eyedropperReticle.scale.setScalar(reticleScale)
      gizmoHandle.bucketReticle.visible = false
      gizmoHandle.stampReticle.visible = false
      gizmoHandle.stampPreviewMesh.visible = false
      if (hoverFaceMesh) hoverFaceMesh.visible = false
    } else if (tool === 'fill') {
      gizmoHandle.group.visible = true
      gizmoHandle.brushRing.visible = false
      gizmoHandle.eyedropperReticle.visible = false
      gizmoHandle.bucketReticle.visible = true
      gizmoHandle.bucketReticle.scale.setScalar(reticleScale)
      gizmoHandle.stampReticle.visible = false
      gizmoHandle.stampPreviewMesh.visible = false
      if (hoverFaceMesh) updateHoverFace(hit.mesh === activeMesh() ? hit.faceIndex : -1)
    } else if (tool === 'faceSelect') {
      gizmoHandle.stampPreviewMesh.visible = false
      gizmoHandle.group.visible = false
      if (hoverFaceMesh) updateHoverFace(hit.mesh === activeMesh() ? hit.faceIndex : -1)
    }

    // Mirror reticle for Symmetry Mode
    if (brush.symmetryEnabled() && (tool === 'brush' || tool === 'eraser' || tool === 'line' || tool === 'stamp')) {
      const mirroredHit = getMirroredHit(hit)
      if (mirroredHit) {
        gizmoHandle.mirrorGroup.position.copy(mirroredHit.point)
        const mirrorQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), mirroredHit.normal)
        gizmoHandle.mirrorGroup.quaternion.copy(mirrorQuat)
        gizmoHandle.mirrorGroup.visible = true

        if (showStampColorPreview) {
          gizmoHandle.mirrorBrushRing.visible = false
          gizmoHandle.mirrorBrushTipMesh.visible = false
          gizmoHandle.mirrorStampPreviewMesh.visible = true
          gizmoHandle.mirrorStampPreviewMesh.scale.setScalar(brush.radius())
        } else if (hasTip && tool !== 'eraser') {
          gizmoHandle.mirrorBrushRing.visible = false
          gizmoHandle.mirrorBrushTipMesh.visible = true
          gizmoHandle.mirrorStampPreviewMesh.visible = false
          gizmoHandle.mirrorBrushTipMesh.scale.setScalar(brush.radius())
        } else {
          gizmoHandle.mirrorBrushTipMesh.visible = false
          gizmoHandle.mirrorStampPreviewMesh.visible = false
          gizmoHandle.mirrorBrushRing.visible = true
          gizmoHandle.mirrorBrushRing.scale.setScalar(brush.radius())
        }
      } else {
        gizmoHandle.mirrorGroup.visible = false
      }
    } else {
      gizmoHandle.mirrorGroup.visible = false
    }
  }

  /**
   * The paint hit: the pointer aimed at the ACTIVE piece only.
   *
   * Pieces of a real model interpenetrate — a strap crossing a torso, a tooth
   * inside a jaw — so a ray against the whole model constantly comes back with
   * the neighbour that happens to be nearer the camera. Restricting the ray to
   * the piece being painted means the cursor keeps following that piece even
   * where another one is in front of it; the occlusion depth pass (which still
   * sees every mesh) is what stops paint landing on the parts genuinely hidden
   * behind the neighbour. Switching piece is a separate, explicit gesture.
   */
  function hitFromEvent(e: PointerEvent): SurfaceHit | null {
    if (!canvasRef || !sceneHandle) return null
    const mesh = activeMesh()
    if (!mesh) return null
    const { x, y } = screenToNdc(e.clientX, e.clientY, canvasRef)
    return raycastMeshes(x, y, sceneHandle.camera, [mesh])
  }

  /** Frontmost piece under the pointer, whichever it is — selection gestures only. */
  function pieceHitFromEvent(e: { clientX: number; clientY: number }): SurfaceHit | null {
    if (!canvasRef || !sceneHandle || !currentModel) return null
    const { x, y } = screenToNdc(e.clientX, e.clientY, canvasRef)
    const visibleMeshes = pieces.map((p) => p.mesh).filter((m) => m.visible)
    return raycastMeshes(x, y, sceneHandle.camera, visibleMeshes)
  }

  /** Selects the piece under the pointer. Returns false if that's already the active one. */
  function selectPieceAt(e: { clientX: number; clientY: number }): boolean {
    if (pieces.length < 2) return false
    const picked = pieceHitFromEvent(e)
    const index = pieceIndexForMesh(picked?.mesh)
    if (index < 0 || index === activePieceIndex) return false
    setActivePiece(index)
    return true
  }

  /**
   * Paints a straight run of dabs from `fromPoint` to the pointer position,
   * used by Shift + click on the brush tools.
   *
   * The interpolation walks SCREEN space and raycasts each step back onto the
   * mesh, rather than lerping world positions: a straight line in world space
   * would tunnel through the surface on anything curved, painting the far side
   * or nothing at all. Stepping in screen space and re-hitting the surface is
   * what makes the line follow the geometry the artist is actually looking at,
   * and it naturally stops at silhouettes where there's no surface to hit.
   */
  function strokeLineFrom(fromPoint: THREE.Vector3, toClientX: number, toClientY: number): void {
    if (!canvasRef || !sceneHandle || !currentModel) return
    const mesh = activeMesh()
    const camera = sceneHandle.camera
    const rect = canvasRef.getBoundingClientRect()

    const ndc = fromPoint.clone().project(camera)
    const fromX = ((ndc.x + 1) / 2) * rect.width + rect.left
    const fromY = ((1 - ndc.y) / 2) * rect.height + rect.top

    const dx = toClientX - fromX
    const dy = toClientY - fromY
    const distPx = Math.hypot(dx, dy)
    if (distPx < 1) return

    // Convert the brush's world-space dab spacing into screen pixels by
    // projecting a point one radius to the camera's right of the start, so the
    // line's dab density matches a hand-drawn stroke at any zoom level.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const offsetNdc = fromPoint.clone().addScaledVector(right, brush.radius()).project(camera)
    const radiusPx = Math.abs((offsetNdc.x - ndc.x) / 2) * rect.width
    const stepPx = Math.max(1.5, radiusPx * brush.spacing())

    // Capped so a line drawn across a huge zoomed-in surface can't fire
    // thousands of full paint passes in one click.
    const steps = Math.min(1024, Math.max(1, Math.round(distPx / stepPx)))

    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const px = fromX + dx * t
      const py = fromY + dy * t
      const { x, y } = screenToNdc(px, py, canvasRef)
      // Active piece only, for the same reason hitFromEvent is.
      const hit = mesh ? raycastMeshes(x, y, camera, [mesh]) : null
      // No event: an interpolated dab isn't a real pointer sample, so it paints
      // at full (non-pressure-scaled) strength, which is what a deliberate
      // straight line wants.
      if (hit) applyToolAt(hit)
    }
  }

  /**
   * One-shot projection of the screen-space stencil onto the model (the
   * "stamp it on" action, as opposed to brushing through the stencil).
   *
   * The camera-visibility test is mandatory, so the depth pass is captured
   * here even though no brush dab is involved — without it a planar projection
   * reprints itself on the far side of the model.
   */
  function stampStencilNow(): boolean {
    const layer = layerStack?.active
    if (!layerStack || !layer || !sceneHandle || !canvasRef || !currentModel) return false
    if (!stencilTexture || !stencil.texturePath()) return false
    if (currentModel.meshes.length === 0) return false

    const camera = sceneHandle.camera
    const rect = canvasRef.getBoundingClientRect()
    const r = stencil.stencilRect(rect.width, rect.height)

    if (!occlusionPass) occlusionPass = new OcclusionDepthPass()
    occlusionPass.capture(sceneHandle.renderer, sceneHandle.scene, camera, occluderMeshes())

    // Derive the normal sign from whatever the stencil's own center is pointing
    // at, the same way a brush dab derives it from the face under the cursor —
    // an inverted-normal import would otherwise reject the entire projection.
    const centerNdc = screenToNdc(rect.left + r.centerX, rect.top + r.centerY, canvasRef)
    const stampMesh = activeMesh()
    const centerHit = stampMesh
      ? raycastMeshes(centerNdc.x, centerNdc.y, camera, [stampMesh])
      : null
    const camPos = camera.getWorldPosition(new THREE.Vector3())
    const normalSign =
      centerHit && centerHit.normal.dot(camPos.clone().sub(centerHit.point)) < 0 ? -1 : 1

    const viewProjMatrix = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    )

    layerStack.history.record()
    layer.engine.stampStencil({
      stencil: {
        texture: stencilTexture,
        rect: new THREE.Vector4(r.centerX, r.centerY, r.width, r.height),
        rotationRad: r.rotationRad,
        invert: stencil.invert(),
        canvasWidth: rect.width,
        canvasHeight: rect.height,
        viewProjMatrix
      },
      occlusion: {
        depthTexture: occlusionPass.depthTexture,
        texelSize: occlusionPass.texelSize,
        viewProjMatrix,
        viewMatrix: camera.matrixWorldInverse.clone(),
        cameraPosition: camPos,
        normalSign,
        near: camera.near,
        far: camera.far
      },
      color: new THREE.Color(brush.color()),
      opacity: brush.opacity(),
      useLuminance: stencil.stampUseLuminance(),
      restrictFaces: brush.selectedFaces().size > 0 ? brush.selectedFaces() : null,
      channels: brush.buildChannelPayload({
        baseColor: { color: new THREE.Color(brush.color()), alpha: 1 },
        baseColorOnly: !!layer.isMask
      })
    })
    layerStack.recomposite()
    props.onLayersChanged?.()
    return true
  }

  function applyToolAt(hit: SurfaceHit, additive = false, event?: PointerEvent): void {
    const layer = layerStack?.active
    if (!layerStack || !layer) return
    const tool = props.tool()

    // Pieces are separate texture sets that usually reuse the same 0-1 UV
    // square, so a dab meant for one would overwrite unrelated islands on
    // another. Everything that writes pixels is confined to the active piece;
    // the eyedropper is the exception, since reading a color off any piece is
    // exactly what the artist means by clicking it.
    if (hit.mesh && hit.mesh !== activeMesh()) {
      if (tool === 'eyedropper') {
        const other = pieces[pieceIndexForMesh(hit.mesh)]
        if (!other) return
        const sampled = other.stack.sampleAt(hit.uv)
        const hex = `#${sampled.getHexString().toUpperCase()}`
        brush.setColor(hex.toLowerCase())
        setEyedropperPreview((prev) => ({ ...prev, color: hex }))
      }
      return
    }
    // Any selected faces automatically confine painting/filling to them —
    // no separate toggle to remember to flip.
    const selection = brush.selectedFaces()
    const restrictFaces = selection.size > 0 ? selection : null
    if (tool === 'faceSelect') {
      const islandMesh = activeMesh()
      if (event?.altKey && islandMesh && hit.faceIndex >= 0) {
        const mesh = islandMesh
        const island = findUvIslandFaces(mesh.geometry, hit.faceIndex)
        if (additive) {
          for (const f of island) toggleFaceSelection(f)
        } else {
          clearFaceSelection()
          for (const f of island) addFaceToSelection(f)
        }
        return
      }
      if (additive) toggleFaceSelection(hit.faceIndex)
      else selectOnlyFace(hit.faceIndex)
    } else if (tool === 'brush' || tool === 'stamp' || tool === 'eraser') {
      const isMask = !!layer.isMask
      const engine = layer.engine

      // Depth map covers only the model meshes — the cursor gizmo sits right on
      // the hit point and the highlight/wireframe overlays are children of the
      // mesh itself, so any of them in the map would occlude the very surface
      // being painted (see occlusionDepth.ts).
      let occlusion: OcclusionParams | null = null
      if (sceneHandle && currentModel && currentModel.meshes.length > 0) {
        if (!occlusionPass) occlusionPass = new OcclusionDepthPass()
        const camera = sceneHandle.camera
        occlusionPass.capture(sceneHandle.renderer, sceneHandle.scene, camera, occluderMeshes())
        const camPos = camera.getWorldPosition(new THREE.Vector3())
        // The face under the cursor is one the user can see, so its normal must
        // point back towards the camera. If it doesn't, this mesh's normals are
        // inverted and every camera-facing test has to flip with them.
        const normalSign = hit.normal.dot(camPos.clone().sub(hit.point)) < 0 ? -1 : 1
        occlusion = {
          depthTexture: occlusionPass.depthTexture,
          texelSize: occlusionPass.texelSize,
          viewProjMatrix: new THREE.Matrix4().multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
          ),
          viewMatrix: camera.matrixWorldInverse.clone(),
          cameraPosition: camPos,
          normalSign,
          near: camera.near,
          far: camera.far
        }
      }
      // Screen-space stencil: gate the dab by the viewport-pinned image.
      let stencilParams: StencilParams | null = null
      if (stencilTexture && stencil.stencilActive() && canvasRef && sceneHandle) {
        const rect = canvasRef.getBoundingClientRect()
        const r = stencil.stencilRect(rect.width, rect.height)
        const camera = sceneHandle.camera
        stencilParams = {
          texture: stencilTexture,
          rect: new THREE.Vector4(r.centerX, r.centerY, r.width, r.height),
          rotationRad: r.rotationRad,
          invert: stencil.invert(),
          canvasWidth: rect.width,
          canvasHeight: rect.height,
          viewProjMatrix: new THREE.Matrix4().multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
          )
        }
      }

      const color = isMask
        ? (tool === 'eraser' ? new THREE.Color(0x000000) : new THREE.Color(brush.color()))
        : (tool === 'eraser' ? engine.baseColor : new THREE.Color(brush.color()))
      const alpha = isMask
        ? (tool === 'eraser' ? 1 : 1)
        : (tool === 'eraser' ? engine.baseAlpha : 1)
      const strokeTexture = isMask ? null : (tool === 'eraser' ? null : brushTexture)
      const strokeTip = tool === 'eraser' ? null : brushTipTexture

      const baseAngle = (brush.brushRotation() * Math.PI) / 180
      let strokeAngle = baseAngle

      if (brush.angleFollowStroke() && lastStampPos) {
        const moveVec = hit.point.clone().sub(lastStampPos)
        if (moveVec.lengthSq() > 0.000001) {
          const up = Math.abs(hit.normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
          const tangent = new THREE.Vector3().crossVectors(up, hit.normal).normalize()
          const bitangent = new THREE.Vector3().crossVectors(hit.normal, tangent).normalize()
          strokeAngle = Math.atan2(moveVec.dot(bitangent), moveVec.dot(tangent)) + baseAngle
        }
      }

      if (brush.angleJitter() > 0) {
        strokeAngle += (Math.random() - 0.5) * 2 * Math.PI * brush.angleJitter()
      }

      let strokeRadius = brush.radius()
      if (brush.sizeJitter() > 0) {
        strokeRadius *= Math.max(0.1, 1 + (Math.random() - 0.5) * 2 * brush.sizeJitter())
      }

      // Stylus pressure. `event` is absent for synthesized dabs (shift-click
      // line interpolation, symmetry), which correctly fall back to full
      // strength — those aren't real pointer samples and have no pressure.
      strokeRadius = applyPressure(strokeRadius, event, brush.pressureRadius())
      const strokeOpacity = applyPressure(brush.opacity(), event, brush.pressureOpacity())

      // A mask layer is grayscale coverage, and the eraser takes material back
      // out rather than laying it down — neither wants the brush's PBR values.
      const channels = brush.buildChannelPayload({
        baseColor: { color, alpha },
        baseColorOnly: isMask || tool === 'eraser'
      })

      engine.paintStroke(hit, {
        radius: strokeRadius,
        hardness: brush.hardness(),
        opacity: strokeOpacity,
        projectorDepth: brush.projectorDepth(),
        maxAngle: brush.maxAngle(),
        color,
        alpha,
        channels,
        channelMaps: tool === 'eraser' || isMask ? undefined : channelMaps,
        erase: tool === 'eraser',
        brushTexture: strokeTexture,
        brushTipTexture: strokeTip,
        textureScale: brush.textureScale(),
        stampMode: tool === 'stamp',
        textureMapping: brush.textureMapping(),
        restrictFaces,
        angle: strokeAngle,
        occlusion,
        stencil: stencilParams
      })

      if (brush.symmetryEnabled()) {
        const mirrored = getMirroredHit(hit)
        if (mirrored) {
          engine.paintStroke(mirrored, {
            radius: strokeRadius,
            hardness: brush.hardness(),
            opacity: strokeOpacity,
            projectorDepth: brush.projectorDepth(),
            maxAngle: brush.maxAngle(),
            color,
            alpha,
            channels,
            channelMaps: tool === 'eraser' || isMask ? undefined : channelMaps,
            erase: tool === 'eraser',
            brushTexture: strokeTexture,
            brushTipTexture: strokeTip,
            textureScale: brush.textureScale(),
            stampMode: tool === 'stamp',
            textureMapping: brush.textureMapping(),
            restrictFaces,
            angle: -strokeAngle,
            // The mirrored dab lands on the far side of the model, which is by
            // definition not visible from the paint camera — testing it against
            // the camera depth map would reject every symmetric stroke.
            occlusion: null,
            stencil: stencilParams
          })
        }
      }

      layerStack.recomposite()
      lastStampPos = hit.point.clone()
      lastBrushDabPos = hit.point.clone()
    } else if (tool === 'effect') {
      // Reworks texels already on the layer, so it never touches color, texture
      // or alpha settings — only the dab footprint and the filter.
      const engine = layer.engine
      let occlusion: OcclusionParams | null = null
      if (sceneHandle && currentModel && currentModel.meshes.length > 0) {
        if (!occlusionPass) occlusionPass = new OcclusionDepthPass()
        const camera = sceneHandle.camera
        occlusionPass.capture(sceneHandle.renderer, sceneHandle.scene, camera, occluderMeshes())
        const camPos = camera.getWorldPosition(new THREE.Vector3())
        const normalSign = hit.normal.dot(camPos.clone().sub(hit.point)) < 0 ? -1 : 1
        occlusion = {
          depthTexture: occlusionPass.depthTexture,
          texelSize: occlusionPass.texelSize,
          viewProjMatrix: new THREE.Matrix4().multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
          ),
          viewMatrix: camera.matrixWorldInverse.clone(),
          cameraPosition: camPos,
          normalSign,
          near: camera.near,
          far: camera.far
        }
      }

      // Smudge pulls color from behind the stroke, so it needs the stroke's
      // direction in the same space the shader samples in — UV. Consecutive hit
      // UVs give exactly that, and stay valid because the UV map is locally
      // affine across one dab. A large UV jump means the stroke crossed an
      // island seam, where dragging color would smear two unrelated parts of
      // the model together, so that step is dropped instead.
      let smudgeDir: THREE.Vector2 | null = null
      if (brush.effectMode() === 'smudge' && lastEffectUv) {
        const delta = hit.uv.clone().sub(lastEffectUv)
        if (delta.length() < 0.25) smudgeDir = delta.multiplyScalar(brush.smudgeLength())
      }

      let effectDabRadius = brush.radius()
      if (brush.sizeJitter() > 0) {
        effectDabRadius *= Math.max(0.1, 1 + (Math.random() - 0.5) * 2 * brush.sizeJitter())
      }
      effectDabRadius = applyPressure(effectDabRadius, event, brush.pressureRadius())

      engine.applyEffect(hit, {
        mode: brush.effectMode(),
        radius: effectDabRadius,
        hardness: brush.hardness(),
        opacity: applyPressure(brush.opacity(), event, brush.pressureOpacity()),
        projectorDepth: brush.projectorDepth(),
        maxAngle: brush.maxAngle(),
        strength: brush.effectStrength(),
        effectRadius: brush.effectRadius(),
        pixelSize: brush.pixelSize(),
        smudgeDir,
        restrictFaces,
        occlusion
      })

      layerStack.recomposite()
      lastStampPos = hit.point.clone()
      lastEffectUv = hit.uv.clone()
    } else if (tool === 'fill') {
      const isMask = !!layer.isMask
      const fillOpts: FillOptions = {
        color: new THREE.Color(brush.color()),
        alpha: isMask ? 1 : brush.opacity(),
        texture: isMask ? null : brushTexture,
        scale: brush.textureScale(),
        channels: brush.buildChannelPayload({
          baseColor: { color: new THREE.Color(brush.color()), alpha: isMask ? 1 : brush.opacity() },
          baseColorOnly: isMask
        }),
        channelMaps: isMask ? undefined : channelMaps
      }
      if (!isMask && brushTexture && brush.texturePath()) recordRecentTexture(brush.texturePath()!)
      if (brush.fillMode() === 'face') {
        if (hit.faceIndex >= 0) layerStack.fillActiveFaces(new Set([hit.faceIndex]), fillOpts)
      } else if (restrictFaces && restrictFaces.size > 0) {
        layerStack.fillActiveFaces(restrictFaces, fillOpts)
      } else {
        layerStack.history.record()
        layer.engine.fill(fillOpts)
        layerStack.recomposite()
      }
    } else if (tool === 'eyedropper') {
      const sampled = layerStack.sampleAt(hit.uv)
      const hex = `#${sampled.getHexString().toUpperCase()}`
      brush.setColor(hex.toLowerCase())
      setEyedropperPreview((prev) => ({ ...prev, color: hex }))
    }
  }

  function fillActive(): void {
    const layer = layerStack?.active
    if (!layerStack || !layer) return
    const selection = brush.selectedFaces()
    const isMask = !!layer.isMask
    const fillOpts: FillOptions = {
      color: new THREE.Color(brush.color()),
      alpha: isMask ? 1 : brush.opacity(),
      texture: isMask ? null : brushTexture,
      scale: brush.textureScale(),
      channels: brush.buildChannelPayload({
        baseColor: { color: new THREE.Color(brush.color()), alpha: isMask ? 1 : brush.opacity() },
        baseColorOnly: isMask
      }),
      channelMaps: isMask ? undefined : channelMaps
    }
    if (!isMask && brushTexture && brush.texturePath()) recordRecentTexture(brush.texturePath()!)
    if (selection.size > 0) {
      layerStack.fillActiveFaces(selection, fillOpts)
    } else {
      layerStack.history.record()
      layer.engine.fill(fillOpts)
      layerStack.recomposite()
    }
  }

  function onPointerMove(e: PointerEvent): void {
    lastClientX = e.clientX
    lastClientY = e.clientY

    if (stencilDrag && canvasRef) {
      const rect = canvasRef.getBoundingClientRect()
      const dx = (e.clientX - stencilDrag.lastX) / rect.width
      const dy = (e.clientY - stencilDrag.lastY) / rect.height
      stencilDrag.lastX = e.clientX
      stencilDrag.lastY = e.clientY
      setStencilCenter(stencil.centerX() + dx, stencil.centerY() + dy)
      return
    }

    if (resizeDrag) {
      const dx = e.clientX - resizeDrag.lastX
      const dy = e.clientY - resizeDrag.lastY
      resizeDrag.lastX = e.clientX
      resizeDrag.lastY = e.clientY
      if (resizeDrag.shift) {
        setOpacity(brush.opacity() + dy * -0.005)
        setHardness(brush.hardness() + dx * 0.005)
      } else {
        setRadius(brush.radius() * (1 + dx * 0.01))
      }
      return
    }
    if (e.altKey && props.tool() !== 'faceSelect') {
      if (eyedropperPreview().visible) setEyedropperPreview((p) => ({ ...p, visible: false }))
      return
    }
    const hit = hitFromEvent(e)
    updateGizmo(hit)
    // The badge/outline answer "what would a double-click select?", so they
    // follow the frontmost piece, not the one being painted.
    if (pieces.length > 1) updatePieceOutlines(pieceHitFromEvent(e)?.mesh ?? null)
    if (hit) currentHit = hit

    if (painting && props.tool() === 'line') {
      if (hit && lineStartHit && lineGuideMesh) {
        const pos = lineGuideMesh.geometry.attributes.position as THREE.BufferAttribute
        pos.setXYZ(0, lineStartHit.point.x, lineStartHit.point.y, lineStartHit.point.z)
        pos.setXYZ(1, hit.point.x, hit.point.y, hit.point.z)
        pos.needsUpdate = true
        lineGuideMesh.visible = true
      }
      return
    }

    // Eyedropper Live Preview Floating Callout (left side of cursor)
    if (props.tool() === 'eyedropper') {
      if (hit && layerStack) {
        const sampled = layerStack.sampleAt(hit.uv)
        const hex = `#${sampled.getHexString().toUpperCase()}`
        const boxWidth = 95
        const boxHeight = 28
        let posX = e.clientX - boxWidth - 16
        let posY = e.clientY - boxHeight / 2
        // Flip to right side if too close to screen left edge
        if (posX < 10) posX = e.clientX + 24
        posY = Math.max(10, Math.min(window.innerHeight - boxHeight - 10, posY))

        setEyedropperPreview({
          visible: true,
          x: posX,
          y: posY,
          color: hex
        })
      } else {
        if (eyedropperPreview().visible) {
          setEyedropperPreview((prev) => ({ ...prev, visible: false }))
        }
      }
    } else if (eyedropperPreview().visible) {
      setEyedropperPreview((prev) => ({ ...prev, visible: false }))
    }

    if (ctrlFaceSelecting) {
      if (hit && hit.mesh === activeMesh()) {
        if (ctrlFaceDeselecting) {
          removeFaceFromSelection(hit.faceIndex)
        } else {
          addFaceToSelection(hit.faceIndex)
        }
      }
      return
    }

    if (!painting || !hit) return

    const tool = props.tool()
    if (tool === 'fill' || tool === 'eyedropper' || tool === 'line') return
    if (tool === 'brush' || tool === 'stamp' || tool === 'eraser' || tool === 'effect') {
      // Discrete applications at spacing intervals (spec: brush Spacing)
      // instead of painting every pointer sample, which would blend into a
      // smear rather than a repeated pass.
      // Spacing follows the pressure-adjusted radius, so a light (thin) part of
      // a tapered stroke lays dabs closer together instead of leaving gaps
      // sized for the full-pressure brush.
      const minDist = applyPressure(brush.radius(), e, brush.pressureRadius()) * brush.spacing()
      if (lastStampPos && hit.point.distanceTo(lastStampPos) < minDist) return
    }
    applyToolAt(hit, e.shiftKey, e)
  }

  function onPointerDown(e: PointerEvent): void {
    // Transform Stencil mode owns the viewport outright: while it's on, drags
    // position the stencil sheet and nothing paints. It's modal rather than
    // modifier-driven because every viewport modifier is already taken, and
    // positioning a stencil is a one-off act followed by many strokes.
    if (stencil.transforming() && stencil.stencilActive() && e.button === 0) {
      e.preventDefault()
      e.stopImmediatePropagation()
      stencilDrag = { lastX: e.clientX, lastY: e.clientY }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      return
    }

    const isCtrl = e.ctrlKey || e.metaKey
    const isFaceSelectTool = props.tool() === 'faceSelect'

    // Connected UV Island Selection: In Face Select mode (or holding Ctrl), Alt + Click
    if ((isFaceSelectTool || isCtrl) && e.altKey && e.button === 0) {
      const hit = hitFromEvent(e)
      // Face indices address one piece's geometry, so an island pick on any
      // other piece would select unrelated triangles here.
      if (hit?.mesh && hit.mesh === activeMesh() && hit.faceIndex >= 0) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const mesh = hit.mesh
        const island = findUvIslandFaces(mesh.geometry, hit.faceIndex)
        if (e.shiftKey) {
          for (const f of island) toggleFaceSelection(f)
        } else {
          clearFaceSelection()
          for (const f of island) addFaceToSelection(f)
        }
        return
      }
    }

    if (e.altKey || e.button === 1) return

    // Face Select uses shift+click for multi-select, so it can't also use
    // shift+drag for the brush-size gesture below — right-click resize still
    // applies to every other tool unless holding Ctrl.
    if (e.button === 2 && !isFaceSelectTool && !isCtrl) {
      e.preventDefault()
      resizeDrag = { shift: e.shiftKey, lastX: e.clientX, lastY: e.clientY }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      return
    }
    if (e.button === 0) {
      const hit = hitFromEvent(e)

      if (isCtrl || isFaceSelectTool) {
        e.preventDefault()
        ctrlFaceSelecting = true
        ctrlFaceDeselecting = e.shiftKey
        if (hit) {
          if (ctrlFaceDeselecting) {
            removeFaceFromSelection(hit.faceIndex)
          } else if (isCtrl || e.shiftKey) {
            addFaceToSelection(hit.faceIndex)
          } else {
            selectOnlyFace(hit.faceIndex)
          }
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        return
      }

      if (!hit) return

      if (props.tool() === 'line') {
        layerStack?.history.record()
        painting = true
        lineStartHit = hit
        currentHit = hit
        if (lineGuideMesh) {
          const pos = lineGuideMesh.geometry.attributes.position as THREE.BufferAttribute
          pos.setXYZ(0, hit.point.x, hit.point.y, hit.point.z)
          pos.setXYZ(1, hit.point.x, hit.point.y, hit.point.z)
          pos.needsUpdate = true
          lineGuideMesh.visible = true
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        return
      }

      const tool = props.tool()
      if (tool === 'effect') {
        layerStack?.history.record()
        // Smudge direction is meaningless across a pen lift — a fresh stroke
        // must not drag color from wherever the last one ended.
        lastEffectUv = null
      }
      if (tool === 'brush' || tool === 'stamp' || tool === 'eraser') {
        layerStack?.history.record()
        if (tool !== 'eraser' && !layerStack?.active?.isMask && brush.texturePath()) {
          recordRecentTexture(brush.texturePath()!)
        }
      }
      painting = true
      lastStampPos = null
      // Shift + click: connect the previous dab to this one with a straight
      // line and skip the plain dab, since strokeLineFrom already ends on the
      // clicked point.
      if (e.shiftKey && lastBrushDabPos && (tool === 'brush' || tool === 'stamp' || tool === 'eraser')) {
        strokeLineFrom(lastBrushDabPos, e.clientX, e.clientY)
      } else if (hasPressure(e) && e.pressure <= 0) {
        // Many tablets report pressure 0 on the contact event itself and only
        // send real readings from the first pointermove. Painting that sample
        // would either stamp a full-strength dab (if it were treated as "no
        // sensor") or a minimum-strength one — neither is what the artist
        // pressed. Skip it; lastStampPos is null, so the next move paints
        // immediately with a real reading and the stroke still starts on touch.
      } else {
        applyToolAt(hit, e.shiftKey, e)
      }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }
  }

  function onDblClick(e: MouseEvent): void {
    const isFaceSelectTool = props.tool() === 'faceSelect'
    const isCtrl = e.ctrlKey || e.metaKey
    if ((isFaceSelectTool || isCtrl) && currentModel && currentModel.meshes.length > 0) {
      const hit = hitFromEvent(e as unknown as PointerEvent)
      if (hit?.mesh && hit.mesh === activeMesh() && hit.faceIndex >= 0) {
        const mesh = hit.mesh
        const island = findUvIslandFaces(mesh.geometry, hit.faceIndex)
        if (e.shiftKey) {
          for (const f of island) toggleFaceSelection(f)
        } else {
          clearFaceSelection()
          for (const f of island) addFaceToSelection(f)
        }
      }
      return
    }

    // Plain double-click picks the piece under the cursor. Deliberately a
    // double-click: a single click has to stay a paint stroke, or painting near
    // any overlapping part would keep jumping to the neighbour instead.
    selectPieceAt(e)
  }

  function onPointerUp(e?: PointerEvent): void {
    stencilDrag = null
    resizeDrag = null
    ctrlFaceSelecting = false
    ctrlFaceDeselecting = false
    if (lineGuideMesh) lineGuideMesh.visible = false

    if (painting && props.tool() === 'line') {
      painting = false
      const endHit = (e ? hitFromEvent(e) : null) || currentHit
      if (lineStartHit && endHit && layerStack) {
        const layer = layerStack.active
        if (layer) {
          const isMask = !!layer.isMask
          const engine = layer.engine
          const dist = lineStartHit.point.distanceTo(endHit.point)
          const radius = brush.radius()
          const spacing = Math.max(0.05, brush.spacing())
          const stepDist = Math.max(0.002, radius * spacing)
          const steps = Math.max(1, Math.ceil(dist / stepDist))

          const strokeColor = new THREE.Color(brush.color())
          const strokeAlpha = 1
          const lineChannels = brush.buildChannelPayload({
            baseColor: { color: strokeColor, alpha: strokeAlpha },
            baseColorOnly: isMask
          })
          const strokeTexture = isMask ? null : brushTexture
          const strokeTip = brushTipTexture
          if (strokeTexture && brush.texturePath()) recordRecentTexture(brush.texturePath()!)
          const selection = brush.selectedFaces()

          for (let i = 0; i <= steps; i++) {
            const t = i / steps
            const point = new THREE.Vector3().lerpVectors(lineStartHit.point, endHit.point, t)
            const normal = new THREE.Vector3().lerpVectors(lineStartHit.normal, endHit.normal, t).normalize()
            const uv = new THREE.Vector2().lerpVectors(lineStartHit.uv, endHit.uv, t)
            const faceIndex = t < 0.5 ? lineStartHit.faceIndex : endHit.faceIndex

            const hitObj = { point, normal, uv, faceIndex }
            engine.paintStroke(
              hitObj,
              {
                radius: brush.radius(),
                hardness: brush.hardness(),
                opacity: brush.opacity(),
                color: strokeColor,
                alpha: strokeAlpha,
                channels: lineChannels,
                channelMaps: isMask ? undefined : channelMaps,
                brushTexture: strokeTexture,
                brushTipTexture: strokeTip,
                textureScale: brush.textureScale(),
                stampMode: false,
                textureMapping: brush.textureMapping(),
                restrictFaces: selection.size > 0 ? selection : null
              }
            )

            if (brush.symmetryEnabled()) {
              const mirrored = getMirroredHit(hitObj)
              if (mirrored) {
                engine.paintStroke(mirrored, {
                  radius: brush.radius(),
                  hardness: brush.hardness(),
                  opacity: brush.opacity(),
                  color: strokeColor,
                  alpha: strokeAlpha,
                  channels: lineChannels,
                  channelMaps: isMask ? undefined : channelMaps,
                  brushTexture: strokeTexture,
                  brushTipTexture: strokeTip,
                  textureScale: brush.textureScale(),
                  stampMode: false,
                  textureMapping: brush.textureMapping(),
                  restrictFaces: selection.size > 0 ? selection : null
                })
              }
            }
          }
          layerStack.recomposite()
          props.onLayersChanged?.()
        }
      }
      lineStartHit = null
      currentHit = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      return
    }

    if (painting) props.onLayersChanged?.()
    painting = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  function onWheel(e: WheelEvent): void {
    // In Transform Stencil mode the wheel scales the sheet, and Shift+wheel
    // rotates it — the two adjustments an artist reaches for constantly while
    // lining a stencil up against the model.
    if (stencil.transforming() && stencil.stencilActive()) {
      e.preventDefault()
      if (e.shiftKey) {
        setStencilRotation(stencil.rotation() + (e.deltaY < 0 ? 5 : -5))
      } else {
        setStencilScale(stencil.scale() * (e.deltaY < 0 ? 1.08 : 1 / 1.08))
      }
      return
    }
    if (e.shiftKey) {
      e.preventDefault()
      if (props.tool() === 'fill' || (props.tool() === 'brush' && brush.texturePath())) {
        const delta = e.deltaY < 0 ? 0.25 : -0.25
        setTextureScale(Math.max(0, Math.min(16, parseFloat((brush.textureScale() + delta).toFixed(2)))))
      } else {
        stepRadius(e.deltaY < 0 ? 1 : -1)
      }
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    const activeEl = document.activeElement
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')
    if (isInput) return

    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault()
      if (pieMenu()) {
        setPieMenu(null)
      } else {
        setPieMenu({ x: lastClientX, y: lastClientY })
      }
      return
    }

    if (e.key === 'Escape') {
      if (stencil.transforming()) {
        e.preventDefault()
        setStencilTransforming(false)
        return
      }
      if (pieMenu()) {
        e.preventDefault()
        setPieMenu(null)
        return
      }
    }

    // Tab / Shift+Tab step through the model's pieces — the keyboard route to
    // a piece that's buried inside another and awkward to click.
    if (e.key === 'Tab' && pieces.length > 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const step = e.shiftKey ? -1 : 1
      setActivePiece((activePieceIndex + step + pieces.length) % pieces.length)
      return
    }

    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const delta = e.shiftKey ? -15 : 15
      brush.setBrushRotation(brush.brushRotation() + delta)
      return
    }

    if ((e.key.toLowerCase() === 'f' || e.key === 'Home') && currentModel) {
      frameModel(currentModel)
    } else if (e.key === '[') {
      stepRadius(-1)
    } else if (e.key === ']') {
      stepRadius(1)
    } else if (e.key.toLowerCase() === 'w') {
      setWireframeVisible(!wireframeVisible)
      props.onWireframeChanged?.(wireframeVisible)
    }
  }

  onMount(() => {
    if (!canvasRef) return
    sceneHandle = createScene(canvasRef)

    gizmoHandle = createGizmo()
    sceneHandle.scene.add(gizmoHandle.group)
    sceneHandle.scene.add(gizmoHandle.mirrorGroup)

    const lineGuideGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3()
    ])
    lineGuideMesh = new THREE.Line(
      lineGuideGeom,
      new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
        linewidth: 2
      })
    )
    lineGuideMesh.renderOrder = 998
    lineGuideMesh.visible = false
    sceneHandle.scene.add(lineGuideMesh)

    const testModel = createDefaultTestModel()
    currentModel = testModel
    sceneHandle.scene.add(testModel.root)
    frameModel(testModel)
    setupLayers(testModel)
    setupWireframe(testModel)
    symmetryGuide = createSymmetryGuide()
    testModel.root.add(symmetryGuide.group)
    symmetryGuide.update(brush.symmetryAxis(), testModel, activeMesh())

    // Paint-bleed diagnostics, run from the DevTools console. Occlusion is one
    // of two independent ways paint reaches a face it shouldn't; the other is
    // overlapping UVs, which no visibility test can fix (see debugUvOverlap).
    ;(window as unknown as { slipDebug: unknown }).slipDebug = {
      /**
       * Prints the stack exactly as recomposite() walks it. A blend mode only
       * has a visible effect where the layers *below* it have coverage (the
       * W3C model: over bare canvas a blended layer just shows its own color),
       * so this also reports whether each layer actually has anything under it
       * to blend against.
       */
      blend: () => {
        if (!layerStack) return 'no layer stack'
        const rows = layerStack.layers.map((l, i) => ({
          index: i,
          id: l.id,
          name: l.name,
          visible: l.visible,
          isMask: !!l.isMask,
          opacity: l.opacity,
          blendMode: l.blendMode ?? 'normal',
          clippedToMaskId: l.clippedToMaskId ?? null,
          // Anything at index 0, or with only hidden/mask layers beneath it,
          // has no backdrop — its blend mode is a deliberate no-op.
          hasBackdrop: layerStack!.layers.slice(0, i).some((u) => u.visible && !u.isMask)
        }))
        console.table(rows)
        return rows
      },
      /**
       * Import diagnostics: what each piece's material arrived with, and what
       * actually ended up in its background layer. A texture that loaded but
       * never landed shows as a map present with an empty composite; a texture
       * that never loaded shows as no map at all.
       */
      pieces: () => {
        if (!sceneHandle || pieces.length === 0) return 'no model'
        const rows = pieces.map((piece, index) => {
          const embeddedNames = piece.embedded.map((slot, slotIndex) => {
            const maps = (Object.keys(slot.maps) as PaintChannel[]).map((c) => {
              const img = slot.maps[c]!.image as { width?: number; height?: number } | undefined
              return `${c}(${img?.width ?? '?'}x${img?.height ?? '?'})`
            })
            const where = slot.faces ? `${slot.faces.size}f` : 'all'
            return `#${slotIndex}[${where}] ${maps.join(' ') || 'no maps'}`
          })

          // Mean coverage and color of the composite, read back at low cost by
          // sampling a coarse grid rather than the whole sheet.
          const size = piece.stack.textureSize
          const step = Math.max(1, Math.floor(size / 64))
          const px = new Uint8Array(size * size * 4)
          sceneHandle!.renderer.readRenderTargetPixels(piece.stack.compositeTarget, 0, 0, size, size, px)
          let n = 0
          let alpha = 0
          let r = 0
          let g = 0
          let b = 0
          let distinct = new Set<number>()
          for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
              const i = (y * size + x) * 4
              alpha += px[i + 3]
              r += px[i]
              g += px[i + 1]
              b += px[i + 2]
              distinct.add((px[i] >> 3 << 10) | (px[i + 1] >> 3 << 5) | (px[i + 2] >> 3))
              n++
            }
          }
          // Same measurement taken straight off the base LAYER's own buffer.
          // Layer full but composite empty means recomposite is the problem;
          // both empty means the fill never landed (or the targets are dead).
          const layerSnap = piece.stack.layers[0]?.engine.createCpuSnapshot()
          let layerAlpha = 0
          if (layerSnap) {
            let ln = 0
            for (let y = 0; y < layerSnap.size; y += step) {
              for (let x = 0; x < layerSnap.size; x += step) {
                layerAlpha += layerSnap.data[(y * layerSnap.size + x) * 4 + 3]
                ln++
              }
            }
            layerAlpha = +(layerAlpha / ln / 255).toFixed(3)
          }

          return {
            index,
            name: piece.name,
            size,
            layerAlpha,
            uvAttr: !!piece.mesh.geometry.attributes.uv,
            slots: piece.embedded.length,
            embedded: embeddedNames.join(' | ') || 'none',
            layers: piece.stack.layers.length,
            meanAlpha: +(alpha / n / 255).toFixed(3),
            meanRGB: `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`,
            // One colour across the whole sheet means nothing textured landed.
            distinctColors: distinct.size
          }
        })
        console.table(rows)

        // Context health. A 4096 canvas costs ~64MB per render target and a
        // piece holds several, so a multi-piece model at high resolution can
        // simply run out of GPU memory — at which point every target reads back
        // as zeroes, exactly like a stack that was never painted.
        const gl = sceneHandle!.renderer.getContext()
        const info = sceneHandle!.renderer.info
        console.log('[slip] renderer', {
          glError: gl.getError(),
          contextLost: gl.isContextLost(),
          textures: info.memory.textures,
          geometries: info.memory.geometries,
          pieces: pieces.length,
          textureSize: pieces[0]?.stack.textureSize,
          approxTargetVram:
            `${Math.round((pieces.reduce((acc, p) => acc + p.stack.textureSize ** 2 * 4 * 5, 0)) / 1e6)} MB`
        })
        return rows
      },
      uvOverlap: () => {
        const engine = layerStack?.active?.engine
        if (!engine) return 'no active layer'
        const r = engine.debugUvOverlap()
        console.log(
          `[slip] UV overlap: ${(r.overlapRatio * 100).toFixed(1)}% of covered texels carry ` +
            `2+ triangles (${r.overlappedTexels} / ${r.coveredTexels}). ` +
            (r.overlapRatio > 0.02
              ? 'OVERLAPPING UVs — painting one face necessarily paints every other face ' +
                'sharing those texels. Occlusion cannot fix this; the model needs a ' +
                'non-overlapping unwrap.'
              : 'UV layout looks non-overlapping.')
        )
        return r
      },
      occlusion: () => {
        if (!sceneHandle || !currentModel) return 'no model'
        if (!occlusionPass) occlusionPass = new OcclusionDepthPass()
        occlusionPass.invalidate()
        occlusionPass.capture(
          sceneHandle.renderer,
          sceneHandle.scene,
          sceneHandle.camera,
          currentModel.meshes
        )
        const r = occlusionPass.debugStats(sceneHandle.renderer, sceneHandle.camera.far)
        console.log(
          `[slip] occlusion map ${r.width}x${r.height}, model covers ` +
            `${(r.coverage * 100).toFixed(1)}% of it, distances ${r.minDist?.toFixed(3)}..` +
            `${r.maxDist?.toFixed(3)} world units. ` +
            (r.coverage < 0.001
              ? 'EMPTY — the depth pass rendered nothing, so the occlusion test is a no-op.'
              : 'Depth pass is producing data.')
        )
        return r
      }
    }

    window.addEventListener('keydown', onKeyDown)
    canvasRef.addEventListener('pointermove', onPointerMove)
    canvasRef.addEventListener('pointerdown', onPointerDown, { capture: true })
    canvasRef.addEventListener('dblclick', onDblClick)
    canvasRef.addEventListener('wheel', onWheel, { passive: false })
    canvasRef.addEventListener('pointerleave', () => {
      updateGizmo(null)
      updatePieceOutlines(null)
      setEyedropperPreview((prev) => ({ ...prev, visible: false }))
    })

    const handle: ViewportHandle = {
      loadFromUrl,
      loadDefaultModel,
      loadProject,
      focusModel: () => currentModel && frameModel(currentModel),
      pieces: () =>
        pieces.map((piece, index) => ({
          index,
          name: piece.name,
          textureSize: piece.stack.textureSize,
          faceCount: piece.facePositions.length / 9
        })),
      activePieceIndex: () => activePieceIndex,
      setActivePiece,
      focusPiece: (index?: number) => {
        const mesh = pieces[index ?? activePieceIndex]?.mesh
        if (!mesh || !sceneHandle) return
        const box = new THREE.Box3().setFromObject(mesh)
        if (box.isEmpty()) return
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        sceneHandle.controls.focus(sphere.center, sphere.radius || 1)
      },
      getLayerStack: (pieceIndex?: number) => stackFor(pieceIndex),
      exportBaseColorPng: (pieceIndex?: number) => {
        const stack = stackFor(pieceIndex)
        if (!sceneHandle || !stack) return undefined
        return renderTargetToPngDataUrl(sceneHandle.renderer, stack.compositeTarget)
      },
      exportChannelPng: (channel: PaintChannel, pieceIndex?: number) => {
        const stack = stackFor(pieceIndex)
        if (!sceneHandle || !stack) return undefined
        const target = stack.channelTarget(channel)
        if (!target) return undefined
        return renderTargetToPngDataUrl(sceneHandle.renderer, target)
      },
      paintedChannels: (pieceIndex?: number) => stackFor(pieceIndex)?.activeChannels() ?? [],
      exportCoverageMaskPng: (pieceIndex?: number) => {
        const stack = stackFor(pieceIndex)
        const target = stack?.coverageTarget()
        if (!sceneHandle || !target) return undefined
        return renderTargetToPngDataUrl(sceneHandle.renderer, target)
      },
      exportOrmPng: (pieceIndex?: number) => {
        const stack = stackFor(pieceIndex)
        if (!sceneHandle || !stack) return undefined
        return packOrmDataUrl(
          sceneHandle.renderer,
          stack.channelTarget('roughness'),
          stack.channelTarget('metalness'),
          stack.textureSize
        )
      },
      setViewMode: (mode) => {
        viewMode = mode
        applyViewMode()
      },
      getViewMode: () => viewMode,
      setLightingMode: (mode) => sceneHandle?.setLightingMode(mode),
      setWireframeVisible,
      setIsolateActivePiece: (isolate: boolean) => {
        isolateActivePiece = isolate
        applyPieceVisibility()
        updatePieceOutlines()
        props.onIsolatePieceChanged?.(isolate)
      },
      getIsolateActivePiece: () => isolateActivePiece,
      fillActive,
      selectAllFaces: () => {
        const total = facePositions ? facePositions.length / 9 : 0
        if (total > 0) selectAllFaces(total)
      },
      invertFaceSelection: () => {
        const total = facePositions ? facePositions.length / 9 : 0
        if (total > 0) invertFaceSelection(total)
      },
      getTotalFaces: () => (facePositions ? facePositions.length / 9 : 0),
      stampStencil: () => stampStencilNow(),
      previewEdgeWear: (options: EdgeWearParams, asNewLayer = false, newLayerBackground = 'transparent' as 'transparent' | 'black') => {
        if (!layerStack) return
        layerStack.previewEdgeWear(options, asNewLayer, newLayerBackground)
        props.onLayersChanged?.()
      },
      cancelEdgeWearPreview: () => {
        if (!layerStack) return
        layerStack.cancelEdgeWearPreview()
        props.onLayersChanged?.()
      },
      commitEdgeWear: (options: EdgeWearParams, asNewLayer = false, newLayerBackground = 'transparent' as 'transparent' | 'black') => {
        if (!layerStack) return
        layerStack.commitEdgeWear(options, asNewLayer, newLayerBackground)
        props.onLayersChanged?.()
      },
      undo: () => {
        if (!layerStack) return
        layerStack.history.undo()
        props.onLayersChanged?.()
      },
      redo: () => {
        if (!layerStack) return
        layerStack.history.redo()
        props.onLayersChanged?.()
      },
      canUndo: () => layerStack?.history.canUndo() ?? false,
      canRedo: () => layerStack?.history.canRedo() ?? false
    }

    props.onReady?.(handle)

    // Expose helpers on window for automation / test suite
    if (typeof window !== 'undefined') {
      ;(window as any).__viewportHandle = handle
      ;(window as any).__openPieMenu = (x?: number, y?: number) => {
        setPieMenu({ x: x ?? window.innerWidth * 0.48, y: y ?? window.innerHeight * 0.45 })
      }
      ;(window as any).__closePieMenu = () => setPieMenu(null)
      ;(window as any).__setWireframe = (v: boolean) => setWireframeVisible(v)
    }

    const animate = (): void => {
      rafId = requestAnimationFrame(animate)
      if (sceneHandle) sceneHandle.renderer.render(sceneHandle.scene, sceneHandle.camera)
    }
    animate()
  })

  createEffect(() => {
    // Hide gizmo, mirror, hoverFace, and preview when tool switches to prevent visual ghosts
    props.tool()
    if (gizmoHandle) {
      gizmoHandle.group.visible = false
      gizmoHandle.mirrorGroup.visible = false
    }
    if (hoverFaceMesh) hoverFaceMesh.visible = false
    setEyedropperPreview((prev) => ({ ...prev, visible: false }))
  })

  createEffect(() => {
    // keep gizmo scale live while hovering and adjusting radius via [ ] or drag
    const r = brush.radius()
    if (gizmoHandle && gizmoHandle.group.visible) {
      if (gizmoHandle.brushRing.visible) {
        gizmoHandle.brushRing.scale.setScalar(r)
      }
      if (gizmoHandle.stampReticle.visible) {
        gizmoHandle.stampReticle.scale.setScalar(r)
      }
      if (gizmoHandle.brushTipMesh.visible) {
        gizmoHandle.brushTipMesh.scale.setScalar(r)
      }
      if (gizmoHandle.stampPreviewMesh.visible) {
        gizmoHandle.stampPreviewMesh.scale.setScalar(r)
      }
    }
    if (gizmoHandle && gizmoHandle.mirrorGroup.visible) {
      if (gizmoHandle.mirrorBrushRing.visible) {
        gizmoHandle.mirrorBrushRing.scale.setScalar(r)
      }
      if (gizmoHandle.mirrorBrushTipMesh.visible) {
        gizmoHandle.mirrorBrushTipMesh.scale.setScalar(r)
      }
      if (gizmoHandle.mirrorStampPreviewMesh.visible) {
        gizmoHandle.mirrorStampPreviewMesh.scale.setScalar(r)
      }
    }
  })

  createEffect(() => {
    brush.selectedFaces()
    updateHighlight()
  })

  createEffect(() => {
    const path = brush.texturePath()
    if (!path) {
      brushTexture = null
      if (currentHit) updateGizmo(currentHit)
      return
    }
    loadPaintTexture(textureLoader, path, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      // TGALoader hands back a texture with no mipmaps configured the way the
      // image loader's does; regenerate so a tiled material doesn't shimmer.
      texture.needsUpdate = true
      brushTexture = texture
      if (currentHit) updateGizmo(currentHit)
    })
  })

  // A material set's data maps. Base color keeps travelling through
  // brushTexture (above), which already handles tint, tiling and masking; these
  // are the roughness / metalness / normal sources, loaded linear because they
  // carry numbers rather than something to look at.
  createEffect(() => {
    const set = brush.materialSet()
    channelMaps = {}
    if (!set) return

    // Tiling is in world units per repeat, and the default (8) is tuned for
    // stamping a small pattern, not for dressing a model in a material — on a
    // sphere a metre across it packs the texture into unreadable moiré, which
    // looks like the material isn't working at all rather than like a scale
    // problem. Pick a scale from the model's own size so a freshly chosen set
    // reads immediately; the artist can still take the slider anywhere.
    if (currentModel) {
      const box = new THREE.Box3().setFromObject(currentModel.root)
      if (!box.isEmpty()) {
        const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1
        const REPEATS_ACROSS_MODEL = 3
        brush.setTextureScale(REPEATS_ACROSS_MODEL / (radius * 2))
      }
    }
    for (const channel of PBR_CHANNELS) {
      const path = set.maps[channel]
      if (!path) continue
      loadPaintTexture(textureLoader, path, (texture) => {
        texture.colorSpace = THREE.NoColorSpace
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.needsUpdate = true
        // The effect may have re-run for a different set while this decoded.
        if (brush.materialSet()?.id === set.id) channelMaps[channel] = texture
      })
    }
  })

  createEffect(() => {
    const path = stencil.texturePath()
    if (!path) {
      stencilTexture = null
      return
    }
    textureLoader.load(toAssetUrl(path), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      // Clamped, not repeating: the shader already rejects texels outside the
      // stencil rect, and wrapping would smear the edge pixels across the
      // whole viewport if that test were ever loosened.
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      stencilTexture = texture
      const img = texture.image as { width?: number; height?: number } | undefined
      if (img?.width && img?.height) {
        stencil.setStencilImageAspect(img.width / img.height)
      }
    })
  })

  createEffect(() => {
    const path = brush.tipTexturePath()
    if (!path) {
      brushTipTexture = null
      if (currentHit) updateGizmo(currentHit)
      return
    }
    textureLoader.load(toAssetUrl(path), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      brushTipTexture = texture
      if (currentHit) updateGizmo(currentHit)
    })
  })

  onCleanup(() => {
    cancelAnimationFrame(rafId)
    occlusionPass?.dispose()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    canvasRef?.removeEventListener('pointermove', onPointerMove)
    canvasRef?.removeEventListener('pointerdown', onPointerDown, { capture: true })
    canvasRef?.removeEventListener('dblclick', onDblClick)
    canvasRef?.removeEventListener('wheel', onWheel)
    if (lineGuideMesh) {
      sceneHandle?.scene.remove(lineGuideMesh)
      lineGuideMesh.geometry.dispose()
      ;(lineGuideMesh.material as THREE.Material).dispose()
      lineGuideMesh = null
    }
    if (gizmoHandle) {
      sceneHandle?.scene.remove(gizmoHandle.group)
      sceneHandle?.scene.remove(gizmoHandle.mirrorGroup)
    }
    symmetryGuide?.dispose()
    for (const box of [activePieceBox, hoverPieceBox]) {
      if (!box) continue
      sceneHandle?.scene.remove(box)
      box.geometry.dispose()
      ;(box.material as THREE.Material).dispose()
    }
    activePieceBox = undefined
    hoverPieceBox = undefined
    for (const piece of pieces) {
      piece.stack.dispose()
      piece.channelViewMaterial?.dispose()
    }
    pieces = []
    layerStack = undefined
    sceneHandle?.dispose()
  })

  createEffect(() => {
    const axis = brush.symmetryAxis()
    if (symmetryGuide && currentModel) {
      symmetryGuide.update(axis, currentModel, activeMesh())
    }
  })

  createEffect(() => {
    const rotRad = (brush.brushRotation() * Math.PI) / 180
    if (gizmoHandle) {
      gizmoHandle.brushTipMesh.rotation.z = rotRad
      gizmoHandle.mirrorBrushTipMesh.rotation.z = -rotRad
      gizmoHandle.stampPreviewMesh.rotation.z = rotRad
      gizmoHandle.mirrorStampPreviewMesh.rotation.z = -rotRad
    }
  })

  return (
    <>
      <canvas
        ref={canvasRef}
        class={`absolute inset-0 w-full h-full block ${
          stencil.transforming() && stencil.stencilActive()
            ? 'stencil-transform-active'
            : `tool-${props.tool()}`
        }`}
      />
      {/* Screen-space stencil sheet. Positioned from the exact same
          stencilRect() numbers the paint shader samples with, so what the
          artist lines up is what actually paints. pointer-events stay off even
          while transforming — the viewport's own handlers drive the drag, so
          the sheet never swallows a stroke. */}
      <Show when={stencil.stencilActive()}>
        <div
          class="absolute inset-0 overflow-hidden pointer-events-none z-10"
          style={{ opacity: `${stencil.displayOpacity()}` }}
        >
          <div
            class={`absolute max-w-none select-none transition-shadow ${
              stencil.transforming()
                ? 'outline-2 outline-dashed outline-blue-400/90 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]'
                : ''
            }`}
            style={{
              left: `${stencil.centerX() * 100}%`,
              top: `${stencil.centerY() * 100}%`,
              width: `${stencil.scale() * 100}%`,
              transform: `translate(-50%, -50%) rotate(${stencil.rotation()}deg)`
            }}
          >
            <img
              src={toAssetUrl(stencil.texturePath()!)}
              alt="Stencil"
              class="w-full h-auto block select-none pointer-events-none"
              style={{
                filter: stencil.invert() ? 'invert(1)' : 'none'
              }}
            />
            {/* Visual boundary handles & center marker when in transform mode */}
            <Show when={stencil.transforming()}>
              <div class="absolute -top-1 -left-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-400 border border-white shadow-xs" />
            </Show>
          </div>
        </div>
      </Show>
      <Show when={stencil.transforming() && stencil.stencilActive()}>
        <div class="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-zinc-900/95 border border-blue-500/60 text-zinc-100 text-xs shadow-xl shadow-black/50 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 select-none">
          <span class="flex items-center gap-1.5 text-blue-300 font-medium">
            <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Transform Stencil
          </span>
          <span class="text-zinc-600">|</span>
          <div class="flex items-center gap-2 text-[11px] text-zinc-300">
            <span>Drag <span class="text-zinc-400">Move</span></span>
            <span class="text-zinc-600">·</span>
            <span>Wheel <span class="text-zinc-400">Scale</span></span>
            <span class="text-zinc-600">·</span>
            <span>Shift+Wheel <span class="text-zinc-400">Rotate</span></span>
          </div>
          <button
            type="button"
            onClick={() => setStencilTransforming(false)}
            class="ml-1 px-2.5 py-0.5 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium text-[11px] transition-colors cursor-pointer shadow-xs"
          >
            Done (Esc)
          </button>
        </div>
      </Show>
      {/* Active-piece badge. Only appears for multi-piece models, where "which
          texture set am I painting?" has a real answer. */}
      <Show when={pieceHud()}>
        <div class="absolute top-3 left-3 z-20 flex flex-col gap-1 select-none pointer-events-none">
          <div class="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-amber-500/50 text-[11px] text-zinc-100 shadow-lg shadow-black/50 backdrop-blur-sm">
            <span class="w-2 h-2 rounded-sm bg-amber-400" />
            <span class="text-zinc-400">Painting</span>
            <span class="font-medium">{pieceHud()!.active}</span>
          </div>
          <Show when={pieceHud()!.hover}>
            <div class="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-sky-500/50 text-[11px] text-zinc-100 shadow-lg shadow-black/50 backdrop-blur-sm">
              <span class="w-2 h-2 rounded-sm bg-sky-400" />
              <span class="text-zinc-400">Double-click to select</span>
              <span class="font-medium">{pieceHud()!.hover}</span>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={props.tool() === 'eyedropper' && eyedropperPreview().visible}>
        <div
          class="fixed z-50 pointer-events-none flex items-center gap-2 px-2.5 py-1 bg-zinc-900/95 border border-zinc-700/80 rounded-lg shadow-xl shadow-black/60 backdrop-blur-sm select-none"
          style={{
            left: `${eyedropperPreview().x}px`,
            top: `${eyedropperPreview().y}px`
          }}
        >
          <div
            class="w-4 h-4 rounded border border-white/40 shadow-inner flex-shrink-0"
            style={{ 'background-color': eyedropperPreview().color }}
          />
          <span class="font-mono text-xs text-zinc-200 tabular-nums">{eyedropperPreview().color}</span>
        </div>
      </Show>
      <Show when={pieMenu()}>
        <RadialPieMenu
          x={pieMenu()!.x}
          y={pieMenu()!.y}
          activeTool={props.tool()}
          availableTextures={props.textures}
          isMaskTarget={() => !!layerStack?.active?.isMask}
          onSelectTool={(tool) => {
            props.onToolChange?.(tool)
            setPieMenu(null)
          }}
          onClose={() => setPieMenu(null)}
        />
      </Show>
    </>
  )
}
