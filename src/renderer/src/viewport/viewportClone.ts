import * as THREE from 'three'
import { clone } from '../paint/clone'
import type { CloneParams } from '../paint/paintEngine'
import { raycastMeshes, screenToNdc, type SurfaceHit } from './raycast'
import { activeMesh, stampOccluderMeshes } from './viewportPieces'
import type { ViewportRuntime } from './viewportRuntime'

/**
 * Clone stamp, viewport side.
 *
 * Cloning is done in screen space, the way Substance and Mari do it: the brush
 * paints whatever is on screen at a fixed offset from the cursor. That is what
 * lets it copy across a UV seam or from one island to another, which is most
 * of what a clone tool is for on a 3D model — a texture-space offset would run
 * off the edge of the island it started on.
 *
 * At stroke start the scene is rendered once into a screen-sized UV buffer:
 * for every viewport pixel, the UV of the painted piece's texel under it (or
 * nothing, where another piece or the background is in front). The pixels to
 * clone from are copied at the same moment, so a stroke never picks up its own
 * paint and smears it forward.
 */

const uvMaterial = new THREE.ShaderMaterial({
  uniforms: { uOwn: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOwn;
    varying vec2 vUv;
    void main() { gl_FragColor = vec4(vUv, 0.0, uOwn); }
  `,
  side: THREE.DoubleSide
})
/** Other pieces still take part, so they hide what is behind them, but never count as a source. */
const occluderMaterial = uvMaterial.clone()
occluderMaterial.uniforms.uOwn.value = 0

/** Sets the source to the surface under an Alt+click. */
export function setCloneSource(rt: ViewportRuntime, hit: SurfaceHit): void {
  rt.cloneSource = hit.point.clone()
  clone.setHasSource(true)
  updateCloneMarker(rt)
}

export function clearCloneSource(rt: ViewportRuntime): void {
  rt.cloneSource = null
  clone.setHasSource(false)
  clone.setMarker(null)
}

function projectToCanvas(
  rt: ViewportRuntime,
  point: THREE.Vector3
): { x: number; y: number } | null {
  if (!rt.sceneHandle || !rt.canvasRef) {
    return null
  }
  const ndc = point.clone().project(rt.sceneHandle.camera)
  if (ndc.z < -1 || ndc.z > 1) {
    return null
  }
  const rect = rt.canvasRef.getBoundingClientRect()
  return { x: (ndc.x * 0.5 + 0.5) * rect.width, y: (1 - (ndc.y * 0.5 + 0.5)) * rect.height }
}

/**
 * Moves the crosshair: during a stroke it trails the cursor by the stroke's
 * offset; between strokes it sits on the source point itself.
 */
export function updateCloneMarker(rt: ViewportRuntime, cursor?: { x: number; y: number }): void {
  if (rt.cloneStroke && cursor) {
    const o = rt.cloneStroke.offset
    clone.setMarker({ x: cursor.x - o.x, y: cursor.y - o.y })
    return
  }
  clone.setMarker(rt.cloneSource ? projectToCanvas(rt, rt.cloneSource) : null)
}

/**
 * Prepares a clone stroke starting at `cursor` (canvas CSS px). Returns false
 * — and the stroke should not start — when there is no source yet.
 */
export function beginCloneStroke(rt: ViewportRuntime, cursor: { x: number; y: number }): boolean {
  const stack = rt.layerStack
  const layer = stack?.active
  const mesh = activeMesh(rt)
  if (!rt.cloneSource || !stack || !layer || !mesh || !rt.sceneHandle || !rt.canvasRef) {
    return false
  }
  const sourcePix = projectToCanvas(rt, rt.cloneSource)
  if (!sourcePix) {
    rt.props.onToast?.('The clone source is off screen — Alt+click a new one', 'warning')
    return false
  }
  const renderer = rt.sceneHandle.renderer
  const camera = rt.sceneHandle.camera
  const rect = rt.canvasRef.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))

  // Float, because an 8-bit UV can only address 256 texels across the sheet.
  // Nearest, because blending two UVs at a silhouette edge lands on a texel
  // belonging to neither surface.
  if (!rt.cloneUvBuffer || rt.cloneUvBuffer.width !== width || rt.cloneUvBuffer.height !== height) {
    rt.cloneUvBuffer?.dispose()
    rt.cloneUvBuffer = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true
    })
  }
  const scene = new THREE.Scene()
  for (const m of stampOccluderMeshes(rt)) {
    const proxy = new THREE.Mesh(m.geometry, m === mesh ? uvMaterial : occluderMaterial)
    proxy.matrixAutoUpdate = false
    proxy.matrix.copy(m.matrixWorld)
    proxy.frustumCulled = false
    scene.add(proxy)
  }
  const prevTarget = renderer.getRenderTarget()
  const prevClear = new THREE.Color()
  renderer.getClearColor(prevClear)
  const prevClearAlpha = renderer.getClearAlpha()
  const prevAutoClear = renderer.autoClear
  renderer.autoClear = true
  renderer.setClearColor(0x000000, 0)
  renderer.setRenderTarget(rt.cloneUvBuffer)
  renderer.render(scene, camera)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevClear, prevClearAlpha)
  renderer.autoClear = prevAutoClear

  rt.cloneSourceSnapshot?.dispose()
  rt.cloneSourceSnapshot = layer.engine.snapshotOf(
    clone.sample() === 'all' && !layer.isMask ? stack.texture : layer.engine.texture
  )
  rt.cloneStroke = {
    offset: new THREE.Vector2(cursor.x - sourcePix.x, cursor.y - sourcePix.y),
    viewProjMatrix: new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    ),
    canvasWidth: rect.width,
    canvasHeight: rect.height,
    lastCursor: cursor
  }
  updateCloneMarker(rt, cursor)
  return true
}

/** This stroke's clone parameters for the paint pass, or null outside a clone stroke. */
export function cloneParamsFor(rt: ViewportRuntime): CloneParams | null {
  const s = rt.cloneStroke
  if (!s || !rt.cloneUvBuffer || !rt.cloneSourceSnapshot) {
    return null
  }
  return {
    uvBuffer: rt.cloneUvBuffer.texture,
    source: rt.cloneSourceSnapshot.texture,
    offset: s.offset,
    canvasWidth: s.canvasWidth,
    canvasHeight: s.canvasHeight,
    viewProjMatrix: s.viewProjMatrix
  }
}

/**
 * Ends a clone stroke. Aligned mode moves the source to wherever the stroke
 * finished copying from, so the next stroke carries on from the same patch —
 * kept as a surface point rather than a screen offset, which is what lets it
 * survive an orbit between strokes.
 */
export function endCloneStroke(rt: ViewportRuntime): void {
  const s = rt.cloneStroke
  rt.cloneStroke = null
  rt.cloneSourceSnapshot?.dispose()
  rt.cloneSourceSnapshot = null
  if (s && clone.aligned() && rt.canvasRef && rt.sceneHandle) {
    const mesh = activeMesh(rt)
    const rect = rt.canvasRef.getBoundingClientRect()
    const ndc = screenToNdc(
      rect.left + s.lastCursor.x - s.offset.x,
      rect.top + s.lastCursor.y - s.offset.y,
      rt.canvasRef
    )
    const hit = mesh ? raycastMeshes(ndc.x, ndc.y, rt.sceneHandle.camera, [mesh]) : null
    if (hit) {
      rt.cloneSource = hit.point.clone()
    }
  }
  updateCloneMarker(rt)
}

/** Frees the screen-sized buffers once the clone tool is put down. */
export function releaseCloneBuffers(rt: ViewportRuntime): void {
  rt.cloneUvBuffer?.dispose()
  rt.cloneUvBuffer = null
  rt.cloneSourceSnapshot?.dispose()
  rt.cloneSourceSnapshot = null
}
