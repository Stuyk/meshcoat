import { createSignal } from 'solid-js'
import * as THREE from 'three'
import type { SceneHandle } from './scene'
import type { LoadedModel } from './modelLoader'
import type { SurfaceHit } from './raycast'
import type { UvDab } from '../paint/brushMask'
import type { LayerStack } from '../paint/layers'
import type { ChannelMaps } from '../paint/paintEngine'
import { OcclusionDepthPass } from '../paint/occlusionDepth'
import type { GizmoHandle, SymmetryGuideHandle } from './gizmos'
import type { PaintPiece, ChannelViewMode, ViewportProps } from './viewportTypes'
import { onPointerMove, onPointerUp } from './viewportPointer'

/**
 * Every piece of mutable state the viewport's paint/pointer/piece-management
 * logic shares. This used to be a wall of `let` closures inside one 3700-line
 * component function; every extracted module below (viewportPieces,
 * viewportPointer, viewportLoad, ...) takes an instance of this class as its
 * first argument instead of capturing the same variables — the fields are
 * exactly the old closure variables, just addressed as `rt.x` instead of `x`.
 */
export class ViewportRuntime {
  props: ViewportProps

  canvasRef: HTMLCanvasElement | undefined
  sceneHandle: SceneHandle | undefined
  currentModel: LoadedModel | undefined
  /**
   * One texture set per mesh in the model. `layerStack` (and the highlight /
   * facePositions / shadedMaterial fields) always mirror the ACTIVE piece, so
   * every existing painting path keeps working on one stack while the others
   * stay painted and visible in the viewport.
   */
  pieces: PaintPiece[] = []
  activePieceIndex = 0
  isolateActivePiece = false
  layerStack: LayerStack | undefined
  viewMode: ChannelViewMode = 'material'
  gizmoHandle: GizmoHandle | undefined
  hoverFaceMesh: THREE.LineSegments | undefined
  symmetryGuide: SymmetryGuideHandle | undefined
  /** Box around the piece receiving strokes; only drawn for multi-piece models. */
  activePieceBox: THREE.Box3Helper | undefined
  /** Box around the piece under the cursor when it isn't the active one. */
  hoverPieceBox: THREE.Box3Helper | undefined
  rafId = 0
  painting = false
  /**
   * True while a stroke is driven from the 2D UV panel. There is no camera
   * involved there, so the camera-visibility test and the screen-space
   * stencil must not gate the dab — every texel in the footprint is "visible".
   */
  uvPaintMode = false
  /** The texture-space dab for the current 2D-panel application (see uvPaint.ts). */
  uvDab: UvDab | null = null
  lastStampPos: THREE.Vector3 | null = null
  /**
   * World position of the last brush/eraser/stamp dab, kept ACROSS strokes (unlike
   * lastStampPos, which resets on every pointer-down for dab spacing). Shift +
   * click connects this point to the new click with a straight interpolated
   * line, the way Photoshop/Procreate/Substance do, so panel lines and seams
   * don't require switching to the Line tool.
   */
  lastBrushDabPos: THREE.Vector3 | null = null
  /** Previous dab's UV, so the smudge effect knows which way the stroke is heading. */
  lastEffectUv: THREE.Vector2 | null = null
  /**
   * Faces already filled during the current Fill Face drag. Dragging across a
   * model streams the same triangle for many pointer samples, and each fill is
   * a full render pass plus a history entry — so each face is filled once per
   * drag, and the whole drag is one undo step.
   */
  fillDragFaces: Set<number> | null = null
  stencilTexture: THREE.Texture | null = null
  /** Active stencil-transform drag (Transform Stencil mode), in client pixels. */
  stencilDrag: { lastX: number; lastY: number } | null = null
  occlusionPass: OcclusionDepthPass | undefined
  brushTexture: THREE.Texture | null = null
  /** Per-channel maps of the active material set (see materialSets.ts), loaded
   * alongside brushTexture so a stroke can feed each channel its own source. */
  channelMaps: ChannelMaps = {}
  brushTipTexture: THREE.Texture | null = null
  textureLoader = new THREE.TextureLoader()
  wireframeMeshes: THREE.LineSegments[] = []
  wireframeVisible = false
  highlightMesh: THREE.LineSegments | undefined
  selectionFillMesh: THREE.Mesh | undefined
  projectorPreviewMesh: THREE.Mesh | undefined
  hoverFillMesh: THREE.Mesh | undefined
  /** Local-space positions, 9 floats per triangle, in the same order as SurfaceHit.faceIndex — built once per model so the highlight overlay can slice out selected triangles without recomputing toNonIndexed(). */
  facePositions: Float32Array | undefined
  /** Parallel per-triangle UVs (6 floats/triangle), same order as facePositions — feeds the projector preview mesh. */
  faceUVs: Float32Array | undefined
  /** Parallel per-triangle normals (9 floats/triangle) — lets the projector preview take the scene lighting. */
  faceNormals: Float32Array | undefined

  resizeDrag: { shift: boolean; lastX: number; lastY: number } | null = null
  ctrlFaceSelecting = false
  ctrlFaceDeselecting = false
  lineStartHit: SurfaceHit | null = null
  currentHit: SurfaceHit | null = null
  lineGuideMesh: THREE.Line | null = null

  lastClientX = window.innerWidth / 2
  lastClientY = window.innerHeight / 2

  /** Cached flipped/premultiplied copy behind getPreviewTexture, keyed by source. */
  previewTextureSource: THREE.Texture | null = null
  previewTextureClone: THREE.Texture | null = null

  /**
   * Which piece is being painted, and which one the cursor is over. Shown as a
   * viewport badge because the layers panel alone doesn't answer the question
   * an artist asks mid-stroke: "is this click going to land on the head or the
   * body?" Null while the model has a single piece — nothing to disambiguate.
   */
  pieceHud: () => { active: string; hover: string | null } | null
  setPieceHud: (v: { active: string; hover: string | null } | null) => void

  /** True while the Face UV Projector preview is showing on the selected faces — drives the top-bar "not applied yet" badge. */
  projectorPreviewActive: () => boolean
  setProjectorPreviewActive: (v: boolean) => void

  eyedropperPreview: () => { visible: boolean; x: number; y: number; color: string }
  setEyedropperPreview: (
    update:
      | { visible: boolean; x: number; y: number; color: string }
      | ((prev: { visible: boolean; x: number; y: number; color: string }) => {
          visible: boolean
          x: number
          y: number
          color: string
        })
  ) => void

  pieMenu: () => { x: number; y: number } | null
  setPieMenu: (v: { x: number; y: number } | null) => void

  /**
   * Stable listener references for the window-level pointermove/pointerup
   * pair that onPointerDown/onPointerUp attach and detach while a drag is in
   * progress. Created once here (not per call) so `removeEventListener` is
   * always removing the exact function `addEventListener` registered.
   */
  boundPointerMove: (e: PointerEvent) => void
  boundPointerUp: (e?: PointerEvent) => void

  constructor(props: ViewportProps) {
    this.props = props
    this.boundPointerMove = (e) => onPointerMove(this, e)
    this.boundPointerUp = (e) => onPointerUp(this, e)

    const [pieceHud, setPieceHud] = createSignal<{ active: string; hover: string | null } | null>(
      null
    )
    this.pieceHud = pieceHud
    this.setPieceHud = setPieceHud

    const [projectorPreviewActive, setProjectorPreviewActive] = createSignal(false)
    this.projectorPreviewActive = projectorPreviewActive
    this.setProjectorPreviewActive = setProjectorPreviewActive

    const [eyedropperPreview, setEyedropperPreview] = createSignal<{
      visible: boolean
      x: number
      y: number
      color: string
    }>({ visible: false, x: 0, y: 0, color: '#000000' })
    this.eyedropperPreview = eyedropperPreview
    this.setEyedropperPreview = setEyedropperPreview

    const [pieMenu, setPieMenu] = createSignal<{ x: number; y: number } | null>(null)
    this.pieMenu = pieMenu
    this.setPieMenu = setPieMenu
  }
}
