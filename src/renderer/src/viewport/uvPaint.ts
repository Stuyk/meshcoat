import * as THREE from 'three'
import { brush, applyPressure, selectOnlyFace, toggleFaceSelection } from '../paint/brush'
import { getUvLocator } from '../paint/uvLocator'
import { renderTextureToImageData } from '../paint/thumbnail'
import type { SurfaceHit } from './raycast'
import type { ViewportRuntime } from './viewportRuntime'
import { activeMesh } from './viewportPieces'
import { applyToolAt } from './viewportPointer'

/**
 * Drives the ordinary paint tools from the 2D UV panel.
 *
 * Every tool already paints from a SurfaceHit, so the panel only has to turn
 * a texture-space point into one (see uvLocator.ts) and then follow the same
 * down / move (with dab spacing) / up sequence the 3D viewport does. The one
 * difference is `rt.uvPaintMode`, which switches off the camera-visibility
 * test and the screen-space stencil — neither means anything without a camera.
 */

const FACE_TOOLS = new Set(['faceSelect', 'faceProjector', 'text'])
const STROKE_TOOLS = new Set(['brush', 'stamp', 'eraser', 'effect'])

let stroking = false

/** The surface point under a UV on the active piece, or null over empty sheet. */
export function uvHitAt(rt: ViewportRuntime, u: number, v: number): SurfaceHit | null {
  const mesh = activeMesh(rt)
  if (!mesh) {
    return null
  }
  const locator = getUvLocator(mesh.geometry)
  const loc = locator?.locate(u, v)
  if (!loc) {
    return null
  }
  mesh.updateWorldMatrix(true, false)
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const nrm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined

  const corners = loc.vertices.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i))
  const point = new THREE.Vector3()
  corners.forEach((c, k) => point.addScaledVector(c, loc.bary[k]))
  point.applyMatrix4(mesh.matrixWorld)

  const normal = new THREE.Vector3()
  if (nrm) {
    loc.vertices.forEach((i, k) =>
      normal.addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, i), loc.bary[k])
    )
  }
  if (normal.lengthSq() < 1e-12) {
    normal.crossVectors(corners[1].clone().sub(corners[0]), corners[2].clone().sub(corners[0]))
  }
  normal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize()

  return { mesh, point, normal, uv: new THREE.Vector2(u, v), faceIndex: loc.face }
}

function applyFromUv(rt: ViewportRuntime, hit: SurfaceHit, e: PointerEvent): void {
  rt.uvPaintMode = true
  try {
    applyToolAt(rt, hit, e.shiftKey, e)
  } finally {
    rt.uvPaintMode = false
    rt.uvDab = null
  }
}

/**
 * Stroke tools paint a texture-space dab (see brushMask.ts), so they don't
 * need a real surface point under the cursor — a stroke keeps going across the
 * empty gutter between islands, like it would in any 2D app. The hit's
 * "point" is the UV itself, which is what dab spacing and follow-stroke
 * rotation then measure in.
 */
function sheetHit(rt: ViewportRuntime, u: number, v: number): SurfaceHit {
  return {
    mesh: activeMesh(rt),
    point: new THREE.Vector3(u, v, 0),
    normal: new THREE.Vector3(0, 0, 1),
    uv: new THREE.Vector2(u, v),
    faceIndex: -1
  }
}

/** Texture-space radius (1 = sheet width) of a dab `radiusPx` texels across the active piece. */
function uvRadius(rt: ViewportRuntime, radiusPx: number): number {
  const size = rt.layerStack?.textureSize ?? 2048
  return Math.max(0.5, radiusPx) / size
}

let lastDabUv: THREE.Vector2 | null = null
/** The 3D viewport's own stroke memory, parked while the panel borrows those fields. */
let saved3d: { lastStampPos: THREE.Vector3 | null; lastBrushDabPos: THREE.Vector3 | null } | null =
  null

function dabAt(rt: ViewportRuntime, u: number, v: number, radiusPx: number, e: PointerEvent): void {
  rt.uvDab = { uv: new THREE.Vector2(u, v), radius: uvRadius(rt, radiusPx) }
  applyFromUv(rt, sheetHit(rt, u, v), e)
  lastDabUv = new THREE.Vector2(u, v)
}

export function uvPointerDown(
  rt: ViewportRuntime,
  u: number,
  v: number,
  e: PointerEvent,
  radiusPx: number
): void {
  const tool = rt.props.tool()
  if (!rt.layerStack || tool === 'line') {
    return
  }
  if (STROKE_TOOLS.has(tool)) {
    rt.layerStack.history.record()
    saved3d = { lastStampPos: rt.lastStampPos, lastBrushDabPos: rt.lastBrushDabPos }
    rt.lastStampPos = null
    rt.lastEffectUv = null
    stroking = true
    dabAt(rt, u, v, radiusPx, e)
    return
  }

  const hit = uvHitAt(rt, u, v)
  if (!hit) {
    return
  }
  if (FACE_TOOLS.has(tool)) {
    if (e.shiftKey) {
      toggleFaceSelection(hit.faceIndex)
    } else {
      selectOnlyFace(hit.faceIndex)
    }
    return
  }
  if (tool === 'fill' && brush.fillMode() === 'face') {
    rt.fillDragFaces = new Set([hit.faceIndex])
  }
  stroking = true
  applyFromUv(rt, hit, e)
}

export function uvPointerMove(
  rt: ViewportRuntime,
  u: number,
  v: number,
  e: PointerEvent,
  radiusPx: number
): void {
  if (!stroking) {
    return
  }
  const tool = rt.props.tool()
  if (tool === 'fill' && brush.fillMode() === 'face' && rt.fillDragFaces) {
    const hit = uvHitAt(rt, u, v)
    if (hit && !rt.fillDragFaces.has(hit.faceIndex)) {
      rt.fillDragFaces.add(hit.faceIndex)
      applyFromUv(rt, hit, e)
    }
    return
  }
  if (!STROKE_TOOLS.has(tool) || !lastDabUv) {
    return
  }
  // Dabs at a fixed spacing along the path, measured on the sheet, so a fast
  // flick is a continuous line rather than a row of dots.
  const step = Math.max(
    uvRadius(rt, applyPressure(radiusPx, e, brush.pressureRadius())) * brush.spacing(),
    0.25 / (rt.layerStack?.textureSize ?? 2048)
  )
  const target = new THREE.Vector2(u, v)
  let dist = target.distanceTo(lastDabUv)
  // Guard against a pathological step count (tiny brush, huge jump).
  let budget = 512
  while (dist >= step && budget-- > 0) {
    const next = lastDabUv.clone().lerp(target, step / dist)
    dabAt(rt, next.x, next.y, radiusPx, e)
    dist = target.distanceTo(lastDabUv)
  }
}

export function uvPointerUp(rt: ViewportRuntime): void {
  if (!stroking) {
    return
  }
  stroking = false
  lastDabUv = null
  rt.fillDragFaces = null
  if (saved3d) {
    rt.lastStampPos = saved3d.lastStampPos
    rt.lastBrushDabPos = saved3d.lastBrushDabPos
    saved3d = null
  }
  rt.props.onLayersChanged?.()
}

/** The surface under a UV, for the panel's hover readout. */
export function uvFaceAt(rt: ViewportRuntime, u: number, v: number): number | null {
  return uvHitAt(rt, u, v)?.faceIndex ?? null
}

/** Draws the active piece's composited base color into `ctx` at `size`². */
export function renderUvTexture(
  rt: ViewportRuntime,
  ctx: CanvasRenderingContext2D,
  size: number
): boolean {
  if (!rt.sceneHandle || !rt.layerStack) {
    return false
  }
  const image = renderTextureToImageData(rt.sceneHandle.renderer, rt.layerStack.texture, size)
  if (!image) {
    return false
  }
  ctx.putImageData(image, 0, 0)
  return true
}

/** The active piece's UV edges as a flat [u0, v0, u1, v1, ...] list, for the wireframe overlay. */
export function uvEdges(rt: ViewportRuntime): Float32Array | null {
  const mesh = activeMesh(rt)
  const uv = mesh?.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!mesh || !uv) {
    return null
  }
  const index = mesh.geometry.index
  const faceCount = Math.floor((index ? index.count : uv.count) / 3)
  const out = new Float32Array(faceCount * 12)
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const a = index ? index.getX(f * 3 + k) : f * 3 + k
      const b = index ? index.getX(f * 3 + ((k + 1) % 3)) : f * 3 + ((k + 1) % 3)
      const o = f * 12 + k * 4
      out[o] = uv.getX(a)
      out[o + 1] = uv.getY(a)
      out[o + 2] = uv.getX(b)
      out[o + 3] = uv.getY(b)
    }
  }
  return out
}
