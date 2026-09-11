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
  type ToolMode,
  type SymmetryAxis
} from '../paint/brush'
import { LayerStack } from '../paint/layers'
import { type FillOptions, type EdgeWearParams } from '../paint/paintEngine'
import { renderTargetToPngDataUrl } from '../paint/exportTexture'
import { toAssetUrl } from '../utils/assetUrl'
import { findUvIslandFaces } from '../paint/uvMesh'
import RadialPieMenu from '../components/RadialPieMenu'

export interface ViewportHandle {
  loadFromUrl: (url: string, extension: string, textureSize?: number) => Promise<void>
  focusModel: () => void
  getLayerStack: () => LayerStack | undefined
  exportBaseColorPng: () => string | undefined
  setLightingMode: (mode: LightingMode) => void
  setWireframeVisible: (visible: boolean) => void
  fillActive: () => void
  selectAllFaces: () => void
  invertFaceSelection: () => void
  getTotalFaces: () => number
  previewEdgeWear: (options: EdgeWearParams) => void
  cancelEdgeWearPreview: () => void
  commitEdgeWear: (options: EdgeWearParams, asNewLayer?: boolean) => void
}

interface GizmoHandle {
  group: THREE.Group
  brushRing: THREE.Mesh
  eyedropperReticle: THREE.Group
  bucketReticle: THREE.Group
  stampReticle: THREE.Group
  brushTipMesh: THREE.Mesh
  brushTipMaterial: THREE.ShaderMaterial
  mirrorGroup: THREE.Group
  mirrorBrushRing: THREE.Mesh
  mirrorBrushTipMesh: THREE.Mesh
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
  mirrorGroup.add(mirrorBrushRing, mirrorBrushTipMesh)
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
    brushTipMaterial,
    mirrorGroup,
    mirrorBrushRing,
    mirrorBrushTipMesh
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

  async function loadFromUrl(url: string, extension: string, textureSize?: number): Promise<void> {
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
    if (model.missingUv.length > 0) props.onMissingUv?.(model.missingUv)
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

    if (gizmoHandle) {
      const activeTipTex = brushTipTexture ?? (tool === 'stamp' ? brushTexture : null)
      gizmoHandle.brushTipMaterial.uniforms.uTexture.value = activeTipTex
      gizmoHandle.brushTipMaterial.uniforms.uHasTexture.value = activeTipTex ? 1 : 0

      const rotRad = (brush.brushRotation() * Math.PI) / 180
      gizmoHandle.brushTipMesh.rotation.z = rotRad
      gizmoHandle.mirrorBrushTipMesh.rotation.z = -rotRad
    }

    if (tool === 'brush' || tool === 'eraser' || tool === 'line') {
      gizmoHandle.group.visible = true
      gizmoHandle.eyedropperReticle.visible = false
      gizmoHandle.bucketReticle.visible = false
      gizmoHandle.stampReticle.visible = false
      if (hasTip && tool !== 'eraser') {
        gizmoHandle.brushRing.visible = false
        gizmoHandle.brushTipMesh.visible = true
        gizmoHandle.brushTipMesh.scale.setScalar(brush.radius())
      } else {
        gizmoHandle.brushTipMesh.visible = false
        gizmoHandle.brushRing.visible = true
        gizmoHandle.brushRing.scale.setScalar(brush.radius())
      }
      if (hoverFaceMesh) hoverFaceMesh.visible = false
    } else if (tool === 'stamp') {
      gizmoHandle.group.visible = true
      gizmoHandle.brushRing.visible = false
      gizmoHandle.eyedropperReticle.visible = false
      gizmoHandle.bucketReticle.visible = false
      gizmoHandle.stampReticle.visible = true
      gizmoHandle.stampReticle.scale.setScalar(brush.radius())
      gizmoHandle.brushTipMesh.visible = hasTip
      if (hasTip) {
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
      if (hoverFaceMesh) hoverFaceMesh.visible = false
    } else if (tool === 'fill') {
      gizmoHandle.group.visible = true
      gizmoHandle.brushRing.visible = false
      gizmoHandle.eyedropperReticle.visible = false
      gizmoHandle.bucketReticle.visible = true
      gizmoHandle.bucketReticle.scale.setScalar(reticleScale)
      gizmoHandle.stampReticle.visible = false
      if (hoverFaceMesh) updateHoverFace(hit.faceIndex)
    } else if (tool === 'faceSelect') {
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

        if (hasTip && tool !== 'eraser') {
          gizmoHandle.mirrorBrushRing.visible = false
          gizmoHandle.mirrorBrushTipMesh.visible = true
          gizmoHandle.mirrorBrushTipMesh.scale.setScalar(brush.radius())
        } else {
          gizmoHandle.mirrorBrushTipMesh.visible = false
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

      engine.paintStroke(hit, {
        radius: strokeRadius,
        hardness: brush.hardness(),
        opacity: brush.opacity(),
        color,
        alpha,
        brushTexture: strokeTexture,
        brushTipTexture: strokeTip,
        textureScale: brush.textureScale(),
        stampMode: tool === 'stamp',
        textureMapping: brush.textureMapping(),
        restrictFaces,
        angle: strokeAngle
      })

      if (brush.symmetryEnabled()) {
        const mirrored = getMirroredHit(hit)
        if (mirrored) {
          engine.paintStroke(mirrored, {
            radius: strokeRadius,
            hardness: brush.hardness(),
            opacity: brush.opacity(),
            color,
            alpha,
            brushTexture: strokeTexture,
            brushTipTexture: strokeTip,
            textureScale: brush.textureScale(),
            stampMode: tool === 'stamp',
            textureMapping: brush.textureMapping(),
            restrictFaces,
            angle: -strokeAngle
          })
        }
      }

      layerStack.recomposite()
      lastStampPos = hit.point.clone()
    } else if (tool === 'fill') {
      const isMask = !!layer.isMask
      const fillOpts: FillOptions = {
        color: new THREE.Color(brush.color()),
        alpha: isMask ? 1 : brush.opacity(),
        texture: isMask ? null : brushTexture,
        scale: brush.textureScale()
      }
      if (restrictFaces && restrictFaces.size > 0) {
        layerStack.fillActiveFaces(restrictFaces, fillOpts)
      } else {
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
    if (selection.size > 0) {
      layerStack.fillActiveFaces(selection, fillOpts)
    } else {
      layer.engine.fill(fillOpts)
      layerStack.recomposite()
    }
  }

  function onPointerMove(e: PointerEvent): void {
    lastClientX = e.clientX
    lastClientY = e.clientY

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
    if (tool === 'brush' || tool === 'stamp' || tool === 'eraser') {
      // Discrete applications at spacing intervals (spec: brush Spacing)
      // instead of painting every pointer sample, which would blend into a
      // smear rather than a repeated pass.
      const minDist = brush.radius() * brush.spacing()
      if (lastStampPos && hit.point.distanceTo(lastStampPos) < minDist) return
    }
    applyToolAt(hit, e.shiftKey, e)
  }

  function onPointerDown(e: PointerEvent): void {
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

      painting = true
      lastStampPos = null
      applyToolAt(hit, e.shiftKey, e)
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
          const selection = brush.selectedFaces()
          const restrictFaces = selection.size > 0 ? selection : null

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
                restrictFaces
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
                  restrictFaces
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
    if (e.shiftKey) {
      e.preventDefault()
      if (props.tool() === 'fill') {
        const delta = e.deltaY < 0 ? 0.25 : -0.25
        setTextureScale(Math.max(0.1, parseFloat((brush.textureScale() + delta).toFixed(2))))
      } else {
        stepRadius(e.deltaY < 0 ? 1 : -1)
      }
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    const activeEl = document.activeElement
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')
    if (isInput) return

    if (e.code === 'Space' && !e.repeat && !pieMenu()) {
      e.preventDefault()
      setPieMenu({ x: lastClientX, y: lastClientY })
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

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space' && pieMenu()) {
      setPieMenu(null)
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

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
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
      previewEdgeWear: (options: EdgeWearParams) => {
        if (!layerStack) return
        layerStack.previewEdgeWear(options)
        props.onLayersChanged?.()
      },
      cancelEdgeWearPreview: () => {
        if (!layerStack) return
        layerStack.cancelEdgeWearPreview()
        props.onLayersChanged?.()
      },
      commitEdgeWear: (options: EdgeWearParams, asNewLayer = false) => {
        if (!layerStack) return
        layerStack.commitEdgeWear(options, asNewLayer)
        props.onLayersChanged?.()
      }
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
    }
    if (gizmoHandle && gizmoHandle.mirrorGroup.visible) {
      if (gizmoHandle.mirrorBrushRing.visible) {
        gizmoHandle.mirrorBrushRing.scale.setScalar(r)
      }
      if (gizmoHandle.mirrorBrushTipMesh.visible) {
        gizmoHandle.mirrorBrushTipMesh.scale.setScalar(r)
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
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
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
    }
  })

  return (
    <>
      <canvas ref={canvasRef} class={`viewport-canvas tool-${props.tool()}`} />
      <Show when={props.tool() === 'eyedropper' && eyedropperPreview().visible}>
        <div
          class="eyedropper-floating-preview"
          style={{
            left: `${eyedropperPreview().x}px`,
            top: `${eyedropperPreview().y}px`
          }}
        >
          <div
            class="eyedropper-preview-swatch"
            style={{ 'background-color': eyedropperPreview().color }}
          />
          <span class="eyedropper-preview-hex">{eyedropperPreview().color}</span>
        </div>
      </Show>
      <Show when={pieMenu()}>
        <RadialPieMenu
          x={pieMenu()!.x}
          y={pieMenu()!.y}
          activeTool={props.tool()}
          availableTextures={props.textures}
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
