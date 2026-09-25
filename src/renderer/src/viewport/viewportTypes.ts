import type * as THREE from 'three'
import type { LayerStack, StackSnapshot } from '../paint/layers'
import type { LightingMode } from './scene'
import type { EdgeWearParams } from '../paint/paintEngine'
import type { PaintChannel } from '../paint/channels'
import type { ToolMode } from '../paint/brush'
import type { MeshCoatProject } from '../utils/projectSerializer'

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

/** UV coordinates are 0-1 with v up, as in the mesh's own UV attribute. */
export interface UvPanelApi {
  pointerDown: (u: number, v: number, e: PointerEvent) => void
  pointerMove: (u: number, v: number, e: PointerEvent) => void
  pointerUp: () => void
  /** Whether a UV lands on the active piece's unwrap. */
  covers: (u: number, v: number) => boolean
  /** Draws the active piece's composited base color into `ctx` at `size`². */
  renderInto: (ctx: CanvasRenderingContext2D, size: number) => boolean
  /** Active piece's UV edges as [u0, v0, u1, v1, ...]. */
  edges: () => Float32Array | null
}

export interface LoadOptions {
  /** Paint at the requested size even when the model's own maps are a different size. */
  forceTextureSize?: boolean
}

export interface ViewportHandle {
  loadFromUrl: (
    url: string,
    extension: string,
    textureSize?: number,
    initialTextures?: InitialTexturePayload | null,
    options?: LoadOptions
  ) => Promise<void>
  loadDefaultModel: (textureSize?: number, primitive?: 'sphere' | 'cube') => Promise<void>
  /** `snapshots` is one entry per saved piece, in the project's piece order. */
  loadProject: (
    project: MeshCoatProject,
    snapshots: StackSnapshot[],
    options?: { reload?: boolean }
  ) => Promise<void>
  focusModel: () => void
  /** Every paintable piece of the loaded model, in mesh order. */
  pieces: () => PieceInfo[]
  activePieceIndex: () => number
  /** Switches which piece receives strokes, layer edits and undo. */
  setActivePiece: (index: number) => void
  /** Frames the camera on one piece (defaults to the active one). */
  focusPiece: (index?: number) => void
  /** Texture-space painting on the active piece, for the 2D UV panel. */
  uvPanel: UvPanelApi
  /** The active piece's stack, or a specific piece's when given an index. */
  getLayerStack: (pieceIndex?: number) => LayerStack | undefined
  exportBaseColorPng: (pieceIndex?: number) => string | undefined
  /**
   * One LAYER's own full-resolution pixels for one channel, unflattened — what
   * the UV inspector shows. Undefined when that layer never painted the
   * channel, which is not an error: most layers only carry base color.
   */
  exportLayerPng: (
    layerId: number,
    channel?: PaintChannel,
    pieceIndex?: number
  ) => string | undefined
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
  previewEdgeWear: (
    options: EdgeWearParams,
    asNewLayer?: boolean,
    newLayerBackground?: 'transparent' | 'black'
  ) => void
  cancelEdgeWearPreview: () => void
  commitEdgeWear: (
    options: EdgeWearParams,
    asNewLayer?: boolean,
    newLayerBackground?: 'transparent' | 'black'
  ) => void
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
export interface PaintPiece {
  mesh: THREE.Mesh
  name: string
  stack: LayerStack
  /** Local-space triangle positions for the selection/hover overlays. */
  facePositions: Float32Array
  /** Parallel per-triangle UVs (same non-indexed triangle order as facePositions), for the projector preview. */
  faceUVs: Float32Array
  /** Parallel per-triangle normals (same order again) — lets the projector preview shade like the model. */
  faceNormals: Float32Array
  highlightMesh: THREE.LineSegments
  /** Translucent wash under the selection outline — a 1px line can't carry it alone. */
  selectionFillMesh: THREE.Mesh
  /** Live preview of the Face UV Projector fill — same triangles as selectionFillMesh, textured. */
  projectorPreviewMesh: THREE.Mesh
  hoverFaceMesh: THREE.LineSegments
  hoverFillMesh: THREE.Mesh
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
export interface EmbeddedSlot {
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

export interface ViewportProps {
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
}
