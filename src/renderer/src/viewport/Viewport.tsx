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
  type FillOptions,
  type EdgeWearParams,
  type OcclusionParams,
  type StencilParams
} from '../paint/paintEngine'
import { OcclusionDepthPass } from '../paint/occlusionDepth'
import { renderTargetToPngDataUrl } from '../paint/exportTexture'
import { toAssetUrl } from '../utils/assetUrl'
import { findUvIslandFaces } from '../paint/uvMesh'
import type { MeshCoatProject } from '../utils/projectSerializer'
import RadialPieMenu from '../components/RadialPieMenu'

export interface ViewportHandle {
  loadFromUrl: (
    url: string,
    extension: string,
    textureSize?: number,
    initialTextureUrl?: string | null
  ) => Promise<void>
  loadDefaultModel: (textureSize?: number) => Promise<void>
  loadProject: (project: MeshCoatProject, snapshot: StackSnapshot) => Promise<void>
  focusModel: () => void
  getLayerStack: () => LayerStack | undefined
  exportBaseColorPng: () => string | undefined
  setLightingMode: (mode: LightingMode) => void
  setWireframeVisible: (visible: boolean) => void
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
  update: (axis: SymmetryAxis, model: LoadedModel | undefined) => void
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

  function update(axis: SymmetryAxis, model: LoadedModel | undefined): void {
    if (axis === 'off' || !model || model.meshes.length === 0) {
      group.visible = false
      return
    }

    const mesh = model.meshes[0]
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
}) {
  let canvasRef: HTMLCanvasElement | undefined
  let sceneHandle: SceneHandle | undefined
  let currentModel: LoadedModel | undefined
  let layerStack: LayerStack | undefined
  let gizmoHandle: GizmoHandle | undefined
  let hoverFaceMesh: THREE.LineSegments | undefined
  let symmetryGuide: SymmetryGuideHandle | undefined
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
    const hits = raycaster.intersectObjects(currentModel.meshes, false)
    if (hits.length > 0) {
      const h0 = hits[0]
      return {
        point: h0.point,
        normal: h0.face
          ? h0.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(h0.object.matrixWorld)).normalize()
          : mirroredWorldNorm,
        uv: h0.uv ? h0.uv.clone() : hit.uv.clone(),
        faceIndex: h0.faceIndex ?? -1
      }
    }
    return {
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
    layerStack?.dispose()
    layerStack = undefined
    currentModel = undefined
    if (symmetryGuide && symmetryGuide.group.parent) {
      symmetryGuide.group.parent.remove(symmetryGuide.group)
      symmetryGuide.group.visible = false
    }
    if (highlightMesh) {
      highlightMesh.geometry.dispose()
      ;(highlightMesh.material as THREE.Material).dispose()
      highlightMesh.parent?.remove(highlightMesh)
      highlightMesh = undefined
    }
    if (hoverFaceMesh) {
      hoverFaceMesh.geometry.dispose()
      ;(hoverFaceMesh.material as THREE.Material).dispose()
      hoverFaceMesh.parent?.remove(hoverFaceMesh)
      hoverFaceMesh = undefined
    }
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

  function setupLayers(model: LoadedModel, textureSize?: number): void {
    if (!sceneHandle) return
    const mesh = model.meshes[0]
    if (!mesh) return
    layerStack = new LayerStack(sceneHandle.renderer, mesh, textureSize)
    const material = mesh.material as THREE.MeshStandardMaterial
    material.map = layerStack.texture
    material.needsUpdate = true
    props.onLayersChanged?.()

    // Same non-indexed expansion PaintEngine's uvMesh uses (see uvMesh.ts) —
    // keeps triangle numbering identical to SurfaceHit.faceIndex so the
    // highlight overlay lines up with what's actually selected for painting.
    const nonIndexed = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    facePositions = (nonIndexed.attributes.position as THREE.BufferAttribute).array.slice() as Float32Array

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
    highlightMesh = new THREE.LineSegments(highlightGeometry, highlightMaterial)
    highlightMesh.renderOrder = 999
    highlightMesh.frustumCulled = false
    mesh.add(highlightMesh)
    updateHighlight()

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
    hoverFaceMesh = new THREE.LineSegments(hoverFaceGeometry, hoverFaceMaterial)
    hoverFaceMesh.renderOrder = 998
    hoverFaceMesh.frustumCulled = false
    hoverFaceMesh.visible = false
    mesh.add(hoverFaceMesh)
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
  }

  async function loadFromUrl(
    url: string,
    extension: string,
    textureSize?: number,
    initialTextureUrl?: string | null
  ): Promise<void> {
    if (!sceneHandle) return
    const model = await loadModel(url, extension)
    if (model.meshes.length > 1) {
      const names = model.meshes.map((m) => m.name || '(unnamed)').join(', ')
      throw new Error(
        `This model has ${model.meshes.length} separate objects (${names}) — only the first gets a paintable ` +
          'texture right now, and separate parts almost always share overlapping UVs, which corrupts painting ' +
          'across the whole model. Join all parts into a single mesh before exporting: in Blender, select every ' +
          'part, press Ctrl+J to join, then in Edit Mode select all (A) and run Mesh > Merge > By Distance to weld ' +
          'the seams (skipping this leaves hairline gaps that show up as thin black cracks along old part edges), ' +
          'give it one clean UV unwrap, then save a new copy and export as .obj/.glb.'
      )
    }
    clearCurrentModel()
    currentModel = model
    sceneHandle.scene.add(model.root)
    frameModel(model)
    setupLayers(model, textureSize)
    setupWireframe(model)
    if (!symmetryGuide) symmetryGuide = createSymmetryGuide()
    model.root.add(symmetryGuide.group)
    symmetryGuide.update(brush.symmetryAxis(), model)

    if (initialTextureUrl && layerStack && layerStack.layers.length > 0) {
      try {
        const texLoader = new THREE.TextureLoader()
        const tex = await texLoader.loadAsync(initialTextureUrl)
        tex.colorSpace = THREE.SRGBColorSpace
        const baseLayer = layerStack.layers[0]
        baseLayer.engine.fill({ texture: tex })
        layerStack.recomposite()
        props.onLayersChanged?.()
      } catch (err) {
        console.error('Failed to load initial image texture:', err)
      }
    }

    if (model.missingUv.length > 0) props.onMissingUv?.(model.missingUv)
  }

  async function loadDefaultModel(textureSize?: number): Promise<void> {
    if (!sceneHandle) return
    const model = createDefaultTestModel()
    clearCurrentModel()
    currentModel = model
    sceneHandle.scene.add(model.root)
    frameModel(model)
    setupLayers(model, textureSize)
    setupWireframe(model)
    if (!symmetryGuide) symmetryGuide = createSymmetryGuide()
    model.root.add(symmetryGuide.group)
    symmetryGuide.update(brush.symmetryAxis(), model)
    props.onLayersChanged?.()
  }

  async function loadProject(project: MeshCoatProject, snapshot: StackSnapshot): Promise<void> {
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
    setupLayers(model, project.textureSize)
    setupWireframe(model)
    if (!symmetryGuide) symmetryGuide = createSymmetryGuide()
    model.root.add(symmetryGuide.group)
    symmetryGuide.update(brush.symmetryAxis(), model)

    if (layerStack) {
      layerStack.restoreState(snapshot)
    }
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
      if (hoverFaceMesh) updateHoverFace(hit.faceIndex)
    } else if (tool === 'faceSelect') {
      gizmoHandle.stampPreviewMesh.visible = false
      gizmoHandle.group.visible = false
      if (hoverFaceMesh) updateHoverFace(hit.faceIndex)
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

  function hitFromEvent(e: PointerEvent): SurfaceHit | null {
    if (!canvasRef || !sceneHandle || !currentModel) return null
    const { x, y } = screenToNdc(e.clientX, e.clientY, canvasRef)
    return raycastMeshes(x, y, sceneHandle.camera, currentModel.meshes)
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
      const hit = raycastMeshes(x, y, camera, currentModel.meshes)
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
    occlusionPass.capture(sceneHandle.renderer, sceneHandle.scene, camera, currentModel.meshes)

    // Derive the normal sign from whatever the stencil's own center is pointing
    // at, the same way a brush dab derives it from the face under the cursor —
    // an inverted-normal import would otherwise reject the entire projection.
    const centerNdc = screenToNdc(rect.left + r.centerX, rect.top + r.centerY, canvasRef)
    const centerHit = raycastMeshes(centerNdc.x, centerNdc.y, camera, currentModel.meshes)
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
      restrictFaces: brush.selectedFaces().size > 0 ? brush.selectedFaces() : null
    })
    layerStack.recomposite()
    props.onLayersChanged?.()
    return true
  }

  function applyToolAt(hit: SurfaceHit, additive = false, event?: PointerEvent): void {
    const layer = layerStack?.active
    if (!layerStack || !layer) return
    const tool = props.tool()
    // Any selected faces automatically confine painting/filling to them —
    // no separate toggle to remember to flip.
    const selection = brush.selectedFaces()
    const restrictFaces = selection.size > 0 ? selection : null
    if (tool === 'faceSelect') {
      if (event?.altKey && currentModel && currentModel.meshes.length > 0 && hit.faceIndex >= 0) {
        const mesh = currentModel.meshes[0]
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
        occlusionPass.capture(sceneHandle.renderer, sceneHandle.scene, camera, currentModel.meshes)
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

      engine.paintStroke(hit, {
        radius: strokeRadius,
        hardness: brush.hardness(),
        opacity: strokeOpacity,
        projectorDepth: brush.projectorDepth(),
        maxAngle: brush.maxAngle(),
        color,
        alpha,
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
        occlusionPass.capture(sceneHandle.renderer, sceneHandle.scene, camera, currentModel.meshes)
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
        scale: brush.textureScale()
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
      scale: brush.textureScale()
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
      if (hit) {
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
      if (hit && currentModel && currentModel.meshes.length > 0 && hit.faceIndex >= 0) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const mesh = currentModel.meshes[0]
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
      if (hit && hit.faceIndex >= 0) {
        const mesh = currentModel.meshes[0]
        const island = findUvIslandFaces(mesh.geometry, hit.faceIndex)
        if (e.shiftKey) {
          for (const f of island) toggleFaceSelection(f)
        } else {
          clearFaceSelection()
          for (const f of island) addFaceToSelection(f)
        }
      }
    }
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

          const strokeColor = isMask ? new THREE.Color(brush.color()) : new THREE.Color(brush.color())
          const strokeAlpha = 1
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
    symmetryGuide.update(brush.symmetryAxis(), testModel)

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
      setEyedropperPreview((prev) => ({ ...prev, visible: false }))
    })

    const handle: ViewportHandle = {
      loadFromUrl,
      loadDefaultModel,
      loadProject,
      focusModel: () => currentModel && frameModel(currentModel),
      getLayerStack: () => layerStack,
      exportBaseColorPng: () => {
        if (!sceneHandle || !layerStack) return undefined
        return renderTargetToPngDataUrl(sceneHandle.renderer, layerStack.compositeTarget)
      },
      setLightingMode: (mode) => sceneHandle?.setLightingMode(mode),
      setWireframeVisible,
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
    textureLoader.load(toAssetUrl(path), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      brushTexture = texture
      if (currentHit) updateGizmo(currentHit)
    })
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
    layerStack?.dispose()
    sceneHandle?.dispose()
  })

  createEffect(() => {
    const axis = brush.symmetryAxis()
    if (symmetryGuide && currentModel) {
      symmetryGuide.update(axis, currentModel)
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
