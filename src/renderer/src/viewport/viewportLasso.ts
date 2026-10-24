import * as THREE from 'three'
import {
  lasso,
  renderLassoCanvas,
  createPixelSelectionOverlayMaterial,
  type LassoMode
} from '../paint/pixelSelection'
import { OcclusionDepthPass } from '../paint/occlusionDepth'
import { raycastMeshes, screenToNdc } from './raycast'
import { activeMesh, stampOccluderMeshes } from './viewportPieces'
import type { ViewportRuntime } from './viewportRuntime'

/**
 * Lasso tool, viewport side: collecting the path, closing it, and baking it
 * into the active piece's pixel selection (see pixelSelection.ts for why the
 * shape is baked rather than kept in screen space).
 *
 * Freehand: drag a path, release to close it; a click without a drag clears
 * the selection. Polygon: click to place corners, then double-click, press
 * Enter, or click the first corner to close; Escape abandons the path.
 * Shift adds to the selection and Ctrl subtracts from it, decided when the
 * path starts.
 */

/** Closing on the first corner: how near (CSS px) a click has to land. */
const CLOSE_RADIUS = 8
/** Freehand samples closer together than this add nothing but cost. */
const MIN_STEP = 2

function canvasPoint(
  rt: ViewportRuntime,
  e: { clientX: number; clientY: number }
): { x: number; y: number } {
  const r = rt.canvasRef!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function modeFor(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): LassoMode {
  if (e.ctrlKey || e.metaKey) {
    return 'subtract'
  }
  return e.shiftKey ? 'add' : 'replace'
}

export function lassoPointerDown(rt: ViewportRuntime, e: PointerEvent): void {
  if (!rt.canvasRef) {
    return
  }
  e.preventDefault()
  const p = canvasPoint(rt, e)
  if (lasso.shape() === 'polygon') {
    const path = lasso.path()
    if (!path) {
      lasso.setPathMode(modeFor(e))
      // Corner, plus the rubber-band point that follows the cursor.
      lasso.setPath([p, { ...p }])
      return
    }
    const corners = path.slice(0, -1)
    const first = corners[0]
    if (corners.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= CLOSE_RADIUS) {
      closeLasso(rt)
      return
    }
    lasso.setPath([...corners, p, { ...p }])
    return
  }
  lasso.setPathMode(modeFor(e))
  lasso.setPath([p])
  rt.lassoDragging = true
  window.addEventListener('pointermove', rt.boundPointerMove)
  window.addEventListener('pointerup', rt.boundPointerUp)
}

/** Returns true when the lasso consumed the move. */
export function lassoPointerMove(rt: ViewportRuntime, e: PointerEvent): boolean {
  const path = lasso.path()
  if (!path || !rt.canvasRef) {
    return false
  }
  if (rt.lassoDragging) {
    const samples = e.getCoalescedEvents?.() ?? []
    const next = path.slice()
    for (const sample of samples.length ? samples : [e]) {
      const p = canvasPoint(rt, sample)
      const last = next[next.length - 1]
      if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) {
        next.push(p)
      }
    }
    if (next.length !== path.length) {
      lasso.setPath(next)
    }
    return true
  }
  if (lasso.shape() === 'polygon') {
    lasso.setPath([...path.slice(0, -1), canvasPoint(rt, e)])
    return true
  }
  return false
}

/** Returns true when the lasso consumed the release. */
export function lassoPointerUp(rt: ViewportRuntime): boolean {
  if (!rt.lassoDragging) {
    return false
  }
  rt.lassoDragging = false
  window.removeEventListener('pointermove', rt.boundPointerMove)
  window.removeEventListener('pointerup', rt.boundPointerUp)
  const path = lasso.path() ?? []
  if (path.length < 3 && lasso.pathMode() === 'replace') {
    // A plain click: deselect, as in every image editor.
    lasso.setPath(null)
    clearPixelSelection(rt)
    return true
  }
  closeLasso(rt)
  return true
}

/** Closes and bakes the polygon in progress (double-click / Enter). */
export function closeLasso(rt: ViewportRuntime): void {
  const path = lasso.path()
  lasso.setPath(null)
  if (!path) {
    return
  }
  // In polygon mode the last point is the rubber band, and a double-click
  // leaves duplicate corners behind; drop both before measuring.
  const raw = lasso.shape() === 'polygon' && !rt.lassoDragging ? path.slice(0, -1) : path
  const points = raw.filter(
    (p, i) => i === 0 || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) >= 1
  )
  if (points.length < 3) {
    return
  }
  bakeLasso(rt, points, lasso.pathMode())
}

export function cancelLasso(rt: ViewportRuntime): boolean {
  if (!lasso.path()) {
    return false
  }
  lasso.setPath(null)
  if (rt.lassoDragging) {
    rt.lassoDragging = false
    window.removeEventListener('pointermove', rt.boundPointerMove)
    window.removeEventListener('pointerup', rt.boundPointerUp)
  }
  return true
}

function bakeLasso(
  rt: ViewportRuntime,
  points: { x: number; y: number }[],
  mode: LassoMode
): boolean {
  const stack = rt.layerStack
  const mesh = activeMesh(rt)
  if (!stack || !mesh || !rt.sceneHandle || !rt.canvasRef) {
    return false
  }
  const camera = rt.sceneHandle.camera
  const rect = rt.canvasRef.getBoundingClientRect()

  rt.occlusionPass ??= new OcclusionDepthPass()
  rt.occlusionPass.capture(
    rt.sceneHandle.renderer,
    rt.sceneHandle.scene,
    camera,
    stampOccluderMeshes(rt)
  )

  // Normal sign from whatever the middle of the shape sits on, the way the
  // stencil stamp takes it from its center — an inverted-normal import would
  // otherwise reject the whole selection as back-facing.
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length
  const ndc = screenToNdc(rect.left + cx, rect.top + cy, rt.canvasRef)
  const centerHit = raycastMeshes(ndc.x, ndc.y, camera, [mesh])
  const camPos = camera.getWorldPosition(new THREE.Vector3())
  const normalSign =
    centerHit && centerHit.normal.dot(camPos.clone().sub(centerHit.point)) < 0 ? -1 : 1
  const viewProjMatrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  )

  const texture = new THREE.CanvasTexture(renderLassoCanvas(rect.width, rect.height, points))
  texture.colorSpace = THREE.NoColorSpace
  try {
    stack.applyLasso({
      screenMask: texture,
      mode,
      occlusion: {
        depthTexture: rt.occlusionPass.depthTexture,
        texelSize: rt.occlusionPass.texelSize,
        viewProjMatrix,
        viewMatrix: camera.matrixWorldInverse.clone(),
        cameraPosition: camPos,
        normalSign,
        near: camera.near,
        far: camera.far
      }
    })
  } finally {
    texture.dispose()
  }
  syncPixelSelection(rt)
  return true
}

export function clearPixelSelection(rt: ViewportRuntime): void {
  rt.layerStack?.clearPixelSelection()
  syncPixelSelection(rt)
}

export function invertPixelSelection(rt: ViewportRuntime): void {
  rt.layerStack?.invertPixelSelection()
  syncPixelSelection(rt)
}

const overlays = new WeakMap<THREE.Mesh, THREE.Mesh>()

/**
 * Brings the on-model highlight and the UI flag in line with the active
 * piece's selection. Called after every selection change and piece switch;
 * only the active piece shows its highlight, since only it can be painted.
 */
export function syncPixelSelection(rt: ViewportRuntime): void {
  const active = rt.pieces[rt.activePieceIndex]
  for (const piece of rt.pieces) {
    const selection = piece === active ? piece.stack.pixelSelection : null
    let overlay = overlays.get(piece.mesh)
    if (!selection) {
      if (overlay) {
        overlay.visible = false
      }
      continue
    }
    if (!overlay) {
      overlay = new THREE.Mesh(piece.mesh.geometry, createPixelSelectionOverlayMaterial(selection))
      overlay.renderOrder = 996
      overlay.frustumCulled = false
      piece.mesh.add(overlay)
      overlays.set(piece.mesh, overlay)
    }
    // The selection ping-pongs between two targets, so its texture changes on
    // every bake.
    ;(overlay.material as THREE.ShaderMaterial).uniforms.tSel.value = selection
    overlay.visible = true
  }
  lasso.setHasSelection(!!active?.stack.pixelSelection)
}
