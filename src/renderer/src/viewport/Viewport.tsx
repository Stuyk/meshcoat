import { onMount, onCleanup, createEffect } from 'solid-js'
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
  clearFaceSelection,
  type ToolMode
} from '../paint/brush'
import { LayerStack } from '../paint/layers'
import { renderTargetToPngDataUrl } from '../paint/exportTexture'

export interface ViewportHandle {
  loadFromUrl: (url: string, extension: string, textureSize?: number) => Promise<void>
  focusModel: () => void
  getLayerStack: () => LayerStack | undefined
  exportBaseColorPng: () => string | undefined
  setLightingMode: (mode: LightingMode) => void
  setWireframeVisible: (visible: boolean) => void
}

function createGizmo(): THREE.Group {
  const group = new THREE.Group()
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
  )
  group.add(ring)
  group.visible = false
  group.renderOrder = 999
  return group
}

export default function Viewport(props: {
  tool: () => ToolMode
  onReady?: (handle: ViewportHandle) => void
  onMissingUv?: (names: string[]) => void
  onLayersChanged?: () => void
  onWireframeChanged?: (visible: boolean) => void
}) {
  let canvasRef: HTMLCanvasElement | undefined
  let sceneHandle: SceneHandle | undefined
  let currentModel: LoadedModel | undefined
  let layerStack: LayerStack | undefined
  let gizmo: THREE.Group | undefined
  let rafId = 0
  let painting = false
  let lastStampPos: THREE.Vector3 | null = null
  let brushTexture: THREE.Texture | null = null
  const textureLoader = new THREE.TextureLoader()
  let wireframeMeshes: THREE.LineSegments[] = []
  let wireframeVisible = false
  let highlightMesh: THREE.LineSegments | undefined
  /** Local-space positions, 9 floats per triangle, in the same order as SurfaceHit.faceIndex — built once per model so the highlight overlay can slice out selected triangles without recomputing toNonIndexed(). */
  let facePositions: Float32Array | undefined

  let resizeDrag: { shift: boolean; lastX: number; lastY: number } | null = null
  let ctrlFaceSelecting = false
  let ctrlFaceDeselecting = false

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
    if (highlightMesh) {
      highlightMesh.geometry.dispose()
      ;(highlightMesh.material as THREE.Material).dispose()
      highlightMesh.parent?.remove(highlightMesh)
      highlightMesh = undefined
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
    const highlightMaterial = new THREE.LineBasicMaterial({ color: 0x22ffcc, depthTest: false, linewidth: 2 })
    highlightMesh = new THREE.LineSegments(highlightGeometry, highlightMaterial)
    highlightMesh.renderOrder = 997
    highlightMesh.frustumCulled = false
    mesh.add(highlightMesh)
    updateHighlight()
  }

  /** Rebuilds the selection outline (spec: highlight, not fill) — 3 edges per selected triangle. */
  function updateHighlight(): void {
    if (!highlightMesh || !facePositions) return
    const faces = brush.selectedFaces()
    // 3 edges/triangle, 2 verts/edge, 3 floats/vert
    const out = new Float32Array(faces.size * 3 * 2 * 3)
    let i = 0
    for (const face of faces) {
      const base = face * 9
      if (base < 0 || base + 9 > facePositions.length) continue
      const v0x = facePositions[base], v0y = facePositions[base + 1], v0z = facePositions[base + 2]
      const v1x = facePositions[base + 3], v1y = facePositions[base + 4], v1z = facePositions[base + 5]
      const v2x = facePositions[base + 6], v2y = facePositions[base + 7], v2z = facePositions[base + 8]
      const o = i * 18
      out.set([v0x, v0y, v0z, v1x, v1y, v1z, v1x, v1y, v1z, v2x, v2y, v2z, v2x, v2y, v2z, v0x, v0y, v0z], o)
      i++
    }
    highlightMesh.geometry.setAttribute('position', new THREE.BufferAttribute(out.subarray(0, i * 18), 3))
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
    if (model.missingUv.length > 0) props.onMissingUv?.(model.missingUv)
  }

  function updateGizmo(hit: SurfaceHit | null): void {
    if (!gizmo) return
    if (!hit) {
      gizmo.visible = false
      return
    }
    gizmo.visible = true
    gizmo.position.copy(hit.point)
    gizmo.scale.setScalar(brush.radius())
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal)
    gizmo.quaternion.copy(quat)
  }

  function hitFromEvent(e: PointerEvent): SurfaceHit | null {
    if (!canvasRef || !sceneHandle || !currentModel) return null
    const { x, y } = screenToNdc(e.clientX, e.clientY, canvasRef)
    return raycastMeshes(x, y, sceneHandle.camera, currentModel.meshes)
  }

  function applyToolAt(hit: SurfaceHit, additive = false): void {
    const layer = layerStack?.active
    if (!layerStack || !layer) return
    const tool = props.tool()
    // Any selected faces automatically confine painting/filling to them —
    // no separate toggle to remember to flip.
    const selection = brush.selectedFaces()
    const restrictFaces = selection.size > 0 ? selection : null
    if (tool === 'faceSelect') {
      if (additive) toggleFaceSelection(hit.faceIndex)
      else selectOnlyFace(hit.faceIndex)
    } else if (tool === 'brush' || tool === 'stamp' || tool === 'eraser') {
      const engine = layer.engine
      engine.paintStroke(hit, {
        radius: brush.radius(),
        hardness: brush.hardness(),
        opacity: brush.opacity(),
        color: tool === 'eraser' ? engine.baseColor : new THREE.Color(brush.color()),
        alpha: tool === 'eraser' ? engine.baseAlpha : 1,
        brushTexture: tool === 'eraser' ? null : brushTexture,
        textureScale: brush.textureScale(),
        stampMode: tool === 'stamp',
        restrictFaces
      })
      layerStack.recomposite()
      lastStampPos = hit.point.clone()
    } else if (tool === 'fill') {
      if (restrictFaces && restrictFaces.size > 0) {
        layerStack.fillActiveFaces(restrictFaces, new THREE.Color(brush.color()))
      } else {
        layer.engine.fill(new THREE.Color(brush.color()))
        layerStack.recomposite()
      }
    } else if (tool === 'eyedropper') {
      const sampled = layerStack.sampleAt(hit.uv)
      brush.setColor(`#${sampled.getHexString()}`)
    }
  }

  function onPointerMove(e: PointerEvent): void {
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
    if (e.altKey) return
    const hit = hitFromEvent(e)
    updateGizmo(hit)

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
    if (tool === 'brush' || tool === 'stamp' || tool === 'eraser') {
      // Discrete applications at spacing intervals (spec: brush Spacing)
      // instead of painting every pointer sample, which would blend into a
      // smear rather than a repeated pass.
      const minDist = brush.radius() * brush.spacing()
      if (lastStampPos && hit.point.distanceTo(lastStampPos) < minDist) return
    }
    applyToolAt(hit, e.shiftKey)
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.altKey) return
    const isCtrl = e.ctrlKey || e.metaKey
    const isFaceSelectTool = props.tool() === 'faceSelect'

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
      painting = true
      lastStampPos = null
      applyToolAt(hit, e.shiftKey)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }
  }

  function onPointerUp(): void {
    resizeDrag = null
    ctrlFaceSelecting = false
    ctrlFaceDeselecting = false
    if (painting) props.onLayersChanged?.()
    painting = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key.toLowerCase() === 'f' && currentModel) {
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

    gizmo = createGizmo()
    sceneHandle.scene.add(gizmo)

    const testModel = createDefaultTestModel()
    currentModel = testModel
    sceneHandle.scene.add(testModel.root)
    frameModel(testModel)
    setupLayers(testModel)
    setupWireframe(testModel)

    window.addEventListener('keydown', onKeyDown)
    canvasRef.addEventListener('pointermove', onPointerMove)
    canvasRef.addEventListener('pointerdown', onPointerDown)
    canvasRef.addEventListener('pointerleave', () => updateGizmo(null))

    props.onReady?.({
      loadFromUrl,
      focusModel: () => currentModel && frameModel(currentModel),
      getLayerStack: () => layerStack,
      exportBaseColorPng: () => {
        if (!sceneHandle || !layerStack) return undefined
        return renderTargetToPngDataUrl(sceneHandle.renderer, layerStack.compositeTarget)
      },
      setLightingMode: (mode) => sceneHandle?.setLightingMode(mode),
      setWireframeVisible
    })

    const animate = (): void => {
      rafId = requestAnimationFrame(animate)
      if (sceneHandle) sceneHandle.renderer.render(sceneHandle.scene, sceneHandle.camera)
    }
    animate()
  })

  createEffect(() => {
    // keep gizmo scale live while hovering and adjusting radius via [ ] or drag
    brush.radius()
    if (gizmo && gizmo.visible) gizmo.scale.setScalar(brush.radius())
  })

  createEffect(() => {
    brush.selectedFaces()
    updateHighlight()
  })

  createEffect(() => {
    const path = brush.texturePath()
    if (!path) {
      brushTexture = null
      return
    }
    textureLoader.load(window.api.assetUrl(path), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      brushTexture = texture
    })
  })

  onCleanup(() => {
    cancelAnimationFrame(rafId)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    canvasRef?.removeEventListener('pointermove', onPointerMove)
    canvasRef?.removeEventListener('pointerdown', onPointerDown)
    layerStack?.dispose()
    sceneHandle?.dispose()
  })

  return <canvas ref={canvasRef} class="viewport-canvas" />
}
