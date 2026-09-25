import * as THREE from 'three'
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
  setTextureScale,
  recordRecentTexture,
  applyPressure,
  hasPressure
} from '../paint/brush'
import {
  stencil,
  setStencilCenter,
  setStencilScale,
  setStencilRotation,
  setStencilTransforming
} from '../paint/stencil'
import type {
  FillOptions,
  OcclusionParams,
  StencilParams,
  PaintEngine,
  StrokeParams
} from '../paint/paintEngine'
import { OcclusionDepthPass } from '../paint/occlusionDepth'
import { findUvIslandFaces } from '../paint/uvMesh'
import {
  activeMesh,
  occluderMeshes,
  stampOccluderMeshes,
  pieceIndexForMesh,
  setActivePiece,
  setWireframeVisible,
  updatePieceOutlines
} from './viewportPieces'
import { faceProjectionOptions, wholeUvProjectionOptions } from './viewportHighlight'
import { frameSelectionOrModel } from './viewportLoad'
import { updateGizmo, makeGizmoUpdateContext } from './gizmoUpdate'
import type { ViewportRuntime } from './viewportRuntime'

/**
 * The mirrored hit for Symmetry Mode: reflects `hit` across the model's
 * symmetry plane and re-raycasts around that point to land on the actual
 * surface (a plain reflection can miss the mesh on a non-planar model).
 */
export function getMirroredHit(rt: ViewportRuntime, hit: SurfaceHit): SurfaceHit | null {
  if (!rt.currentModel || rt.currentModel.meshes.length === 0) {
    return null
  }
  const axis = brush.symmetryAxis()
  if (axis === 'off') {
    return null
  }

  // Model root local space: mirror coordinate along selected axis
  const localPt = rt.currentModel.root.worldToLocal(hit.point.clone())
  if (axis === 'x') {
    localPt.x = -localPt.x
  } else if (axis === 'y') {
    localPt.y = -localPt.y
  } else if (axis === 'z') {
    localPt.z = -localPt.z
  }
  const mirroredWorldPt = rt.currentModel.root.localToWorld(localPt.clone())

  const rotMatrix = new THREE.Matrix3().getNormalMatrix(rt.currentModel.root.matrixWorld)
  const invRotMatrix = rotMatrix.clone().invert()
  const localNormal = hit.normal.clone().applyMatrix3(invRotMatrix).normalize()
  if (axis === 'x') {
    localNormal.x = -localNormal.x
  } else if (axis === 'y') {
    localNormal.y = -localNormal.y
  } else if (axis === 'z') {
    localNormal.z = -localNormal.z
  }
  const mirroredWorldNorm = localNormal.applyMatrix3(rotMatrix).normalize()

  // Raycast towards surface around the mirrored location
  const rayOrigin = mirroredWorldPt.clone().addScaledVector(mirroredWorldNorm, 0.25)
  const rayDir = mirroredWorldNorm.clone().negate()
  const raycaster = new THREE.Raycaster(rayOrigin, rayDir, 0.001, 0.5)
  // Only the piece being painted: the mirrored point can easily land on a
  // neighbouring piece, whose UVs address a completely different texture set.
  const mirrorTarget = activeMesh(rt)
  const hits = mirrorTarget ? raycaster.intersectObject(mirrorTarget, false) : []
  if (hits.length > 0) {
    const h0 = hits[0]
    return {
      mesh: h0.object as THREE.Mesh,
      point: h0.point,
      normal: h0.face
        ? h0.face.normal
            .clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(h0.object.matrixWorld))
            .normalize()
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

/** Builds the gizmoUpdate context for this runtime — shared by pointer moves and the mount-level effects that also need to call updateGizmo. */
export function buildGizmoCtx(rt: ViewportRuntime): ReturnType<typeof makeGizmoUpdateContext> {
  return makeGizmoUpdateContext(
    rt,
    () => activeMesh(rt),
    (hit) => getMirroredHit(rt, hit)
  )
}
const gizmoCtx = buildGizmoCtx

/** Resolves a Ctrl/face-select click into the right selection edit: deselect, add, or replace-with-just-this-face. */
function applyCtrlClickFaceSelection(
  faceIndex: number,
  deselecting: boolean,
  additive: boolean
): void {
  if (deselecting) {
    removeFaceFromSelection(faceIndex)
    return
  }
  if (additive) {
    addFaceToSelection(faceIndex)
    return
  }
  selectOnlyFace(faceIndex)
}

/** Applies a UV-island pick to the face selection: toggle each face when additive, otherwise replace the selection with just the island. */
function applyIslandSelection(island: number[], additive: boolean): void {
  if (additive) {
    for (const f of island) {
      toggleFaceSelection(f)
    }
    return
  }
  clearFaceSelection()
  for (const f of island) {
    addFaceToSelection(f)
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
export function hitFromEvent(rt: ViewportRuntime, e: PointerEvent): SurfaceHit | null {
  if (!rt.canvasRef || !rt.sceneHandle) {
    return null
  }
  const mesh = activeMesh(rt)
  if (!mesh) {
    return null
  }
  const { x, y } = screenToNdc(e.clientX, e.clientY, rt.canvasRef)
  return raycastMeshes(x, y, rt.sceneHandle.camera, [mesh])
}

/** Frontmost piece under the pointer, whichever it is — selection gestures only. */
export function pieceHitFromEvent(
  rt: ViewportRuntime,
  e: { clientX: number; clientY: number }
): SurfaceHit | null {
  if (!rt.canvasRef || !rt.sceneHandle || !rt.currentModel) {
    return null
  }
  const { x, y } = screenToNdc(e.clientX, e.clientY, rt.canvasRef)
  const visibleMeshes = rt.pieces.map((p) => p.mesh).filter((m) => m.visible)
  return raycastMeshes(x, y, rt.sceneHandle.camera, visibleMeshes)
}

/** Selects the piece under the pointer. Returns false if that's already the active one. */
export function selectPieceAt(
  rt: ViewportRuntime,
  e: { clientX: number; clientY: number }
): boolean {
  if (rt.pieces.length < 2) {
    return false
  }
  const picked = pieceHitFromEvent(rt, e)
  const index = pieceIndexForMesh(rt, picked?.mesh)
  if (index < 0 || index === rt.activePieceIndex) {
    return false
  }
  setActivePiece(rt, index)
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
export function strokeLineFrom(
  rt: ViewportRuntime,
  fromPoint: THREE.Vector3,
  toClientX: number,
  toClientY: number
): void {
  if (!rt.canvasRef || !rt.sceneHandle || !rt.currentModel) {
    return
  }
  const mesh = activeMesh(rt)
  const camera = rt.sceneHandle.camera
  const rect = rt.canvasRef.getBoundingClientRect()

  const ndc = fromPoint.clone().project(camera)
  const fromX = ((ndc.x + 1) / 2) * rect.width + rect.left
  const fromY = ((1 - ndc.y) / 2) * rect.height + rect.top

  const dx = toClientX - fromX
  const dy = toClientY - fromY
  const distPx = Math.hypot(dx, dy)
  if (distPx < 1) {
    return
  }

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
    const { x, y } = screenToNdc(px, py, rt.canvasRef)
    // Active piece only, for the same reason hitFromEvent is.
    const hit = mesh ? raycastMeshes(x, y, camera, [mesh]) : null
    // No event: an interpolated dab isn't a real pointer sample, so it paints
    // at full (non-pressure-scaled) strength, which is what a deliberate
    // straight line wants.
    if (hit) {
      applyToolAt(rt, hit)
    }
  }
}

/**
 * Everything `stampStencilNow` decided, for `slipDebug.stamp()`. Filled only
 * when a diagnostics object is passed in, so the normal stamp path costs
 * nothing (the depth readback in particular is expensive).
 */
export interface StampDiagnostics {
  [key: string]: unknown
}

/**
 * One-shot projection of the screen-space stencil onto the model (the
 * "stamp it on" action, as opposed to brushing through the stencil).
 *
 * The camera-visibility test is mandatory, so the depth pass is captured
 * here even though no brush dab is involved — without it a planar projection
 * reprints itself on the far side of the model.
 */
export function stampStencilNow(rt: ViewportRuntime, diag?: StampDiagnostics): boolean {
  const layer = rt.layerStack?.active
  if (!rt.layerStack || !layer || !rt.sceneHandle || !rt.canvasRef || !rt.currentModel) {
    if (diag) {
      diag.bail = 'no layer stack / active layer / scene / canvas / model'
    }
    return false
  }
  if (!rt.stencilTexture || !stencil.texturePath()) {
    if (diag) {
      diag.bail = 'no stencil texture loaded'
    }
    return false
  }
  if (rt.currentModel.meshes.length === 0) {
    if (diag) {
      diag.bail = 'model has no meshes'
    }
    return false
  }

  const camera = rt.sceneHandle.camera
  const rect = rt.canvasRef.getBoundingClientRect()
  const r = stencil.stencilRect(rect.width, rect.height)

  if (!rt.occlusionPass) {
    rt.occlusionPass = new OcclusionDepthPass()
  }
  rt.occlusionPass.capture(
    rt.sceneHandle.renderer,
    rt.sceneHandle.scene,
    camera,
    stampOccluderMeshes(rt)
  )

  // Derive the normal sign from whatever the stencil's own center is pointing
  // at, the same way a brush dab derives it from the face under the cursor —
  // an inverted-normal import would otherwise reject the entire projection.
  const centerNdc = screenToNdc(rect.left + r.centerX, rect.top + r.centerY, rt.canvasRef)
  const stampMesh = activeMesh(rt)
  const centerHit = stampMesh ? raycastMeshes(centerNdc.x, centerNdc.y, camera, [stampMesh]) : null
  const camPos = camera.getWorldPosition(new THREE.Vector3())
  const normalSign =
    centerHit && centerHit.normal.dot(camPos.clone().sub(centerHit.point)) < 0 ? -1 : 1

  const viewProjMatrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  )

  if (diag) {
    const occluders = stampOccluderMeshes(rt)
    diag.piece = { index: rt.activePieceIndex, name: rt.pieces[rt.activePieceIndex]?.name }
    diag.isolated = rt.isolateActivePiece
    diag.stampMeshVisible = stampMesh?.visible
    diag.occluders = occluders.map((m) => ({ name: m.name, visible: m.visible }))
    diag.canvas = { width: rect.width, height: rect.height }
    diag.rect = r
    diag.centerHit = centerHit
      ? { point: centerHit.point.toArray(), face: centerHit.faceIndex }
      : null
    diag.normalSign = normalSign
    diag.stencil = {
      useLuminance: stencil.stampUseLuminance(),
      invert: stencil.invert(),
      opacity: brush.opacity()
    }
    diag.restrictedFaces = brush.selectedFaces().size
    diag.depth = rt.occlusionPass.debugStats(rt.sceneHandle.renderer, camera.far)
  }

  rt.layerStack.history.record()
  layer.engine.stampStencil({
    stencil: {
      texture: rt.stencilTexture,
      rect: new THREE.Vector4(r.centerX, r.centerY, r.width, r.height),
      rotationRad: r.rotationRad,
      invert: stencil.invert(),
      hasAlpha: stencil.imageHasAlpha(),
      canvasWidth: rect.width,
      canvasHeight: rect.height,
      viewProjMatrix
    },
    occlusion: {
      depthTexture: rt.occlusionPass.depthTexture,
      texelSize: rt.occlusionPass.texelSize,
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
  rt.layerStack.recomposite()
  rt.props.onLayersChanged?.()
  return true
}

export function applyToolAt(
  rt: ViewportRuntime,
  hit: SurfaceHit,
  additive = false,
  event?: PointerEvent
): void {
  const layer = rt.layerStack?.active
  if (!rt.layerStack || !layer) {
    return
  }
  const tool = rt.props.tool()

  // Pieces are separate texture sets that usually reuse the same 0-1 UV
  // square, so a dab meant for one would overwrite unrelated islands on
  // another. Everything that writes pixels is confined to the active piece;
  // the eyedropper is the exception, since reading a color off any piece is
  // exactly what the artist means by clicking it.
  if (hit.mesh && hit.mesh !== activeMesh(rt)) {
    if (tool === 'eyedropper') {
      const other = rt.pieces[pieceIndexForMesh(rt, hit.mesh)]
      if (!other) {
        return
      }
      const sampled = other.stack.sampleAt(hit.uv)
      const hex = `#${sampled.getHexString().toUpperCase()}`
      brush.setColor(hex.toLowerCase())
      rt.setEyedropperPreview((prev) => ({ ...prev, color: hex }))
    }
    return
  }
  // Any selected faces automatically confine painting/filling to them —
  // no separate toggle to remember to flip.
  const selection = brush.selectedFaces()
  const restrictFaces = selection.size > 0 ? selection : null
  if (tool === 'faceSelect' || tool === 'faceProjector' || tool === 'text') {
    const islandMesh = activeMesh(rt)
    if (event?.altKey && islandMesh && hit.faceIndex >= 0) {
      const mesh = islandMesh
      const island = findUvIslandFaces(mesh.geometry, hit.faceIndex)
      applyIslandSelection(island, additive)
      return
    }
    if (additive) {
      toggleFaceSelection(hit.faceIndex)
    } else {
      selectOnlyFace(hit.faceIndex)
    }
  } else if (tool === 'brush' || tool === 'stamp' || tool === 'eraser') {
    const isMask = !!layer.isMask
    const engine = layer.engine

    // Depth map covers only the model meshes — the cursor gizmo sits right on
    // the hit point and the highlight/wireframe overlays are children of the
    // mesh itself, so any of them in the map would occlude the very surface
    // being painted (see occlusionDepth.ts).
    let occlusion: OcclusionParams | null = null
    if (rt.sceneHandle && rt.currentModel && rt.currentModel.meshes.length > 0) {
      if (!rt.occlusionPass) {
        rt.occlusionPass = new OcclusionDepthPass()
      }
      const camera = rt.sceneHandle.camera
      rt.occlusionPass.capture(
        rt.sceneHandle.renderer,
        rt.sceneHandle.scene,
        camera,
        occluderMeshes(rt)
      )
      const camPos = camera.getWorldPosition(new THREE.Vector3())
      // The face under the cursor is one the user can see, so its normal must
      // point back towards the camera. If it doesn't, this mesh's normals are
      // inverted and every camera-facing test has to flip with them.
      const normalSign = hit.normal.dot(camPos.clone().sub(hit.point)) < 0 ? -1 : 1
      occlusion = {
        depthTexture: rt.occlusionPass.depthTexture,
        texelSize: rt.occlusionPass.texelSize,
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
    if (rt.stencilTexture && stencil.stencilActive() && rt.canvasRef && rt.sceneHandle) {
      const rect = rt.canvasRef.getBoundingClientRect()
      const r = stencil.stencilRect(rect.width, rect.height)
      const camera = rt.sceneHandle.camera
      stencilParams = {
        texture: rt.stencilTexture,
        rect: new THREE.Vector4(r.centerX, r.centerY, r.width, r.height),
        rotationRad: r.rotationRad,
        invert: stencil.invert(),
        hasAlpha: stencil.imageHasAlpha(),
        canvasWidth: rect.width,
        canvasHeight: rect.height,
        viewProjMatrix: new THREE.Matrix4().multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse
        )
      }
    }

    const color = isMask
      ? tool === 'eraser'
        ? new THREE.Color(0x000000)
        : new THREE.Color(brush.color())
      : tool === 'eraser'
        ? engine.baseColor
        : new THREE.Color(brush.color())
    const alpha = isMask ? (tool === 'eraser' ? 1 : 1) : tool === 'eraser' ? engine.baseAlpha : 1
    const strokeTexture = isMask ? null : tool === 'eraser' ? null : rt.brushTexture
    const strokeTip = rt.brushTipTexture

    const baseAngle = (brush.brushRotation() * Math.PI) / 180
    let strokeAngle = baseAngle

    if (brush.angleFollowStroke() && rt.lastStampPos) {
      const moveVec = hit.point.clone().sub(rt.lastStampPos)
      if (moveVec.lengthSq() > 0.000001) {
        const up =
          Math.abs(hit.normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
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
      channelMaps: tool === 'eraser' || isMask ? undefined : rt.channelMaps,
      erase: tool === 'eraser',
      brushTexture: strokeTexture,
      brushTipTexture: strokeTip,
      textureScale: brush.textureScale(),
      textureRegion: brush.textureRegion(),
      textureRepeat: brush.textureRepeat(),
      stampMode: tool === 'stamp',
      textureMapping: brush.textureMapping(),
      restrictFaces,
      angle: strokeAngle,
      occlusion,
      stencil: stencilParams
    })

    if (brush.symmetryEnabled()) {
      const mirrored = getMirroredHit(rt, hit)
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
          channelMaps: tool === 'eraser' || isMask ? undefined : rt.channelMaps,
          erase: tool === 'eraser',
          brushTexture: strokeTexture,
          brushTipTexture: strokeTip,
          textureScale: brush.textureScale(),
          textureRegion: brush.textureRegion(),
          textureRepeat: brush.textureRepeat(),
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

    rt.layerStack.recomposite()
    rt.lastStampPos = hit.point.clone()
    rt.lastBrushDabPos = hit.point.clone()
  } else if (tool === 'effect') {
    // Reworks texels already on the layer, so it never touches color, texture
    // or alpha settings — only the dab footprint and the filter.
    const engine = layer.engine
    let occlusion: OcclusionParams | null = null
    if (rt.sceneHandle && rt.currentModel && rt.currentModel.meshes.length > 0) {
      if (!rt.occlusionPass) {
        rt.occlusionPass = new OcclusionDepthPass()
      }
      const camera = rt.sceneHandle.camera
      rt.occlusionPass.capture(
        rt.sceneHandle.renderer,
        rt.sceneHandle.scene,
        camera,
        occluderMeshes(rt)
      )
      const camPos = camera.getWorldPosition(new THREE.Vector3())
      const normalSign = hit.normal.dot(camPos.clone().sub(hit.point)) < 0 ? -1 : 1
      occlusion = {
        depthTexture: rt.occlusionPass.depthTexture,
        texelSize: rt.occlusionPass.texelSize,
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
    if (brush.effectMode() === 'smudge' && rt.lastEffectUv) {
      const delta = hit.uv.clone().sub(rt.lastEffectUv)
      if (delta.length() < 0.25) {
        smudgeDir = delta.multiplyScalar(brush.smudgeLength())
      }
    }

    let effectDabRadius = brush.radius()
    if (brush.sizeJitter() > 0) {
      effectDabRadius *= Math.max(0.1, 1 + (Math.random() - 0.5) * 2 * brush.sizeJitter())
    }
    effectDabRadius = applyPressure(effectDabRadius, event, brush.pressureRadius())

    const baseAngle = (brush.brushRotation() * Math.PI) / 180
    let strokeAngle = baseAngle
    if (brush.angleFollowStroke() && rt.lastStampPos) {
      const moveVec = hit.point.clone().sub(rt.lastStampPos)
      if (moveVec.lengthSq() > 0.000001) {
        const up =
          Math.abs(hit.normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
        const tangent = new THREE.Vector3().crossVectors(up, hit.normal).normalize()
        const bitangent = new THREE.Vector3().crossVectors(hit.normal, tangent).normalize()
        strokeAngle = Math.atan2(moveVec.dot(bitangent), moveVec.dot(tangent)) + baseAngle
      }
    }
    if (brush.angleJitter() > 0) {
      strokeAngle += (Math.random() - 0.5) * 2 * Math.PI * brush.angleJitter()
    }

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
      occlusion,
      brushTipTexture: rt.brushTipTexture,
      angle: strokeAngle
    })

    if (brush.symmetryEnabled()) {
      const mirrored = getMirroredHit(rt, hit)
      if (mirrored) {
        engine.applyEffect(mirrored, {
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
          occlusion,
          brushTipTexture: rt.brushTipTexture,
          angle: -strokeAngle
        })
      }
    }

    rt.layerStack.recomposite()
    rt.lastStampPos = hit.point.clone()
    rt.lastEffectUv = hit.uv.clone()
  } else if (tool === 'fill') {
    const isMask = !!layer.isMask
    const fillOpts: FillOptions = {
      color: new THREE.Color(brush.color()),
      alpha: isMask ? 1 : brush.opacity(),
      texture: isMask ? null : rt.brushTexture,
      scale: brush.textureScale(),
      textureRegion: brush.textureRegion(),
      textureRepeat: brush.textureRepeat(),
      channels: brush.buildChannelPayload({
        baseColor: { color: new THREE.Color(brush.color()), alpha: isMask ? 1 : brush.opacity() },
        baseColorOnly: isMask
      }),
      channelMaps: isMask ? undefined : rt.channelMaps
    }
    if (!isMask && rt.brushTexture && brush.texturePath()) {
      recordRecentTexture(brush.texturePath()!)
    }
    if (brush.fillMode() === 'face') {
      // One history entry for a whole drag: the first face records, the rest
      // of the faces the cursor crosses join that same undo step.
      const isDragContinuation = !!rt.fillDragFaces && rt.fillDragFaces.size > 1
      if (hit.faceIndex >= 0) {
        // Fit the crop to THIS face's own UV box. "Fill Face" means the picture
        // lands on the face you clicked; tiling the crop from the sheet's raw
        // origin instead put an arbitrary slice of the pattern there, which is
        // the same texture region reading completely differently from one face
        // to the next. The Placement control (Fit / Tile) is what chooses.
        const clicked = new Set([hit.faceIndex])
        rt.layerStack.fillActiveFaces(
          clicked,
          { ...fillOpts, projection: faceProjectionOptions(rt, clicked) },
          1,
          !isDragContinuation
        )
      }
    } else if (restrictFaces && restrictFaces.size > 0) {
      // Same treatment for a masked fill, and the same options the panel's
      // Fill button builds (see fillActive) — clicking in the viewport and
      // pressing the button have to mean the same thing.
      rt.layerStack.fillActiveFaces(restrictFaces, {
        ...fillOpts,
        projection: faceProjectionOptions(rt, restrictFaces)
      })
    } else {
      rt.layerStack.history.record()
      // No selection: the area is the whole UV square.
      layer.engine.fill({ ...fillOpts, projection: wholeUvProjectionOptions() })
      rt.layerStack.recomposite()
    }
  } else if (tool === 'eyedropper') {
    const sampled = rt.layerStack.sampleAt(hit.uv)
    const hex = `#${sampled.getHexString().toUpperCase()}`
    brush.setColor(hex.toLowerCase())
    rt.setEyedropperPreview((prev) => ({ ...prev, color: hex }))
  }
}

export function fillActive(rt: ViewportRuntime): void {
  const layer = rt.layerStack?.active
  if (!rt.layerStack || !layer) {
    return
  }
  const selection = brush.selectedFaces()
  const isMask = !!layer.isMask
  const fillOpts: FillOptions = {
    color: new THREE.Color(brush.color()),
    alpha: isMask ? 1 : brush.opacity(),
    texture: isMask ? null : rt.brushTexture,
    scale: brush.textureScale(),
    textureRegion: brush.textureRegion(),
    textureRepeat: brush.textureRepeat(),
    channels: brush.buildChannelPayload({
      baseColor: { color: new THREE.Color(brush.color()), alpha: isMask ? 1 : brush.opacity() },
      baseColorOnly: isMask
    }),
    channelMaps: isMask ? undefined : rt.channelMaps,
    // Fitted to the selection when there is one, otherwise to the whole UV
    // square — either way "Fill Area" means the area actually being filled.
    projection:
      selection.size > 0 ? faceProjectionOptions(rt, selection) : wholeUvProjectionOptions()
  }
  // The Text tool's texture is generated and changes on every keystroke —
  // parking those data URLs in the (persisted) Used shelf would fill it with
  // one-off junk.
  if (!isMask && rt.brushTexture && brush.texturePath() && rt.props.tool() !== 'text') {
    recordRecentTexture(brush.texturePath()!)
  }
  if (selection.size > 0) {
    rt.layerStack.fillActiveFaces(selection, fillOpts)
  } else {
    rt.layerStack.history.record()
    layer.engine.fill(fillOpts)
    rt.layerStack.recomposite()
  }
}

export function onPointerMove(rt: ViewportRuntime, e: PointerEvent): void {
  rt.lastClientX = e.clientX
  rt.lastClientY = e.clientY

  if (rt.stencilDrag && rt.canvasRef) {
    const rect = rt.canvasRef.getBoundingClientRect()
    const dx = (e.clientX - rt.stencilDrag.lastX) / rect.width
    const dy = (e.clientY - rt.stencilDrag.lastY) / rect.height
    rt.stencilDrag.lastX = e.clientX
    rt.stencilDrag.lastY = e.clientY
    setStencilCenter(stencil.centerX() + dx, stencil.centerY() + dy)
    return
  }

  if (rt.resizeDrag) {
    const dx = e.clientX - rt.resizeDrag.lastX
    const dy = e.clientY - rt.resizeDrag.lastY
    rt.resizeDrag.lastX = e.clientX
    rt.resizeDrag.lastY = e.clientY
    if (rt.resizeDrag.shift) {
      setOpacity(brush.opacity() + dy * -0.005)
      setHardness(brush.hardness() + dx * 0.005)
    } else {
      setRadius(brush.radius() * (1 + dx * 0.01))
    }
    return
  }
  if (
    e.altKey &&
    rt.props.tool() !== 'faceSelect' &&
    rt.props.tool() !== 'faceProjector' &&
    rt.props.tool() !== 'text'
  ) {
    if (rt.eyedropperPreview().visible) {
      rt.setEyedropperPreview((p) => ({ ...p, visible: false }))
    }
    return
  }
  const hit = hitFromEvent(rt, e)
  updateGizmo(gizmoCtx(rt), hit)
  // The badge/outline answer "what would a double-click select?", so they
  // follow the frontmost piece, not the one being painted.
  if (rt.pieces.length > 1) {
    updatePieceOutlines(rt, pieceHitFromEvent(rt, e)?.mesh ?? null)
  }
  if (hit) {
    rt.currentHit = hit
  }

  if (rt.painting && rt.props.tool() === 'line') {
    if (hit && rt.lineStartHit && rt.lineGuideMesh) {
      const pos = rt.lineGuideMesh.geometry.attributes.position as THREE.BufferAttribute
      pos.setXYZ(0, rt.lineStartHit.point.x, rt.lineStartHit.point.y, rt.lineStartHit.point.z)
      pos.setXYZ(1, hit.point.x, hit.point.y, hit.point.z)
      pos.needsUpdate = true
      rt.lineGuideMesh.visible = true
    }
    return
  }

  // Eyedropper Live Preview Floating Callout (left side of cursor)
  if (rt.props.tool() === 'eyedropper') {
    if (hit && rt.layerStack) {
      const sampled = rt.layerStack.sampleAt(hit.uv)
      const hex = `#${sampled.getHexString().toUpperCase()}`
      const boxWidth = 95
      const boxHeight = 28
      let posX = e.clientX - boxWidth - 16
      let posY = e.clientY - boxHeight / 2
      // Flip to right side if too close to screen left edge
      if (posX < 10) {
        posX = e.clientX + 24
      }
      posY = Math.max(10, Math.min(window.innerHeight - boxHeight - 10, posY))

      rt.setEyedropperPreview({
        visible: true,
        x: posX,
        y: posY,
        color: hex
      })
    } else {
      if (rt.eyedropperPreview().visible) {
        rt.setEyedropperPreview((prev) => ({ ...prev, visible: false }))
      }
    }
  } else if (rt.eyedropperPreview().visible) {
    rt.setEyedropperPreview((prev) => ({ ...prev, visible: false }))
  }

  if (rt.ctrlFaceSelecting) {
    if (hit && hit.mesh === activeMesh(rt)) {
      if (rt.ctrlFaceDeselecting) {
        removeFaceFromSelection(hit.faceIndex)
      } else {
        addFaceToSelection(hit.faceIndex)
      }
    }
    return
  }

  if (!rt.painting || !hit) {
    return
  }

  const tool = rt.props.tool()

  // Fill Face paints faces the way a brush paints texels: drag across the
  // model and every triangle the cursor crosses is filled.
  if (tool === 'fill' && brush.fillMode() === 'face' && rt.fillDragFaces) {
    if (hit.faceIndex >= 0 && !rt.fillDragFaces.has(hit.faceIndex)) {
      rt.fillDragFaces.add(hit.faceIndex)
      applyToolAt(rt, hit, false, e)
    }
    return
  }
  if (tool === 'fill' || tool === 'eyedropper' || tool === 'line') {
    return
  }
  if (tool === 'brush' || tool === 'stamp' || tool === 'eraser' || tool === 'effect') {
    // Discrete applications at spacing intervals (spec: brush Spacing)
    // instead of painting every pointer sample, which would blend into a
    // smear rather than a repeated pass.
    // Spacing follows the pressure-adjusted radius, so a light (thin) part of
    // a tapered stroke lays dabs closer together instead of leaving gaps
    // sized for the full-pressure brush.
    const minDist = applyPressure(brush.radius(), e, brush.pressureRadius()) * brush.spacing()
    if (rt.lastStampPos && hit.point.distanceTo(rt.lastStampPos) < minDist) {
      return
    }
  }
  applyToolAt(rt, hit, e.shiftKey, e)
}

export function onPointerDown(rt: ViewportRuntime, e: PointerEvent): void {
  // Transform Stencil mode owns the viewport outright: while it's on, drags
  // position the stencil sheet and nothing paints. It's modal rather than
  // modifier-driven because every viewport modifier is already taken, and
  // positioning a stencil is a one-off act followed by many strokes.
  if (stencil.transforming() && stencil.stencilActive() && e.button === 0) {
    e.preventDefault()
    e.stopImmediatePropagation()
    rt.stencilDrag = { lastX: e.clientX, lastY: e.clientY }
    window.addEventListener('pointermove', rt.boundPointerMove)
    window.addEventListener('pointerup', rt.boundPointerUp)
    return
  }

  const isCtrl = e.ctrlKey || e.metaKey
  const isFaceSelectTool =
    rt.props.tool() === 'faceSelect' ||
    rt.props.tool() === 'faceProjector' ||
    rt.props.tool() === 'text'

  // Connected UV Island Selection: In Face Select mode (or holding Ctrl), Alt + Click
  if ((isFaceSelectTool || isCtrl) && e.altKey && e.button === 0) {
    const hit = hitFromEvent(rt, e)
    // Face indices address one piece's geometry, so an island pick on any
    // other piece would select unrelated triangles here.
    if (hit?.mesh && hit.mesh === activeMesh(rt) && hit.faceIndex >= 0) {
      e.preventDefault()
      e.stopImmediatePropagation()
      const mesh = hit.mesh
      const island = findUvIslandFaces(mesh.geometry, hit.faceIndex)
      applyIslandSelection(island, e.shiftKey)
      return
    }
  }

  if (e.altKey || e.button === 1) {
    return
  }

  // Face Select uses shift+click for multi-select, so it can't also use
  // shift+drag for the brush-size gesture below — right-click resize still
  // applies to every other tool unless holding Ctrl.
  // The bucket has no radius to drag, so right-drag stays a plain context
  // gesture there rather than silently changing a number nothing reads.
  if (e.button === 2 && !isFaceSelectTool && !isCtrl && rt.props.tool() !== 'fill') {
    e.preventDefault()
    rt.resizeDrag = { shift: e.shiftKey, lastX: e.clientX, lastY: e.clientY }
    window.addEventListener('pointermove', rt.boundPointerMove)
    window.addEventListener('pointerup', rt.boundPointerUp)
    return
  }
  if (e.button === 0) {
    const hit = hitFromEvent(rt, e)

    if (isCtrl || isFaceSelectTool) {
      e.preventDefault()
      rt.ctrlFaceSelecting = true
      rt.ctrlFaceDeselecting = e.shiftKey
      if (hit) {
        applyCtrlClickFaceSelection(hit.faceIndex, rt.ctrlFaceDeselecting, isCtrl || e.shiftKey)
      }
      window.addEventListener('pointermove', rt.boundPointerMove)
      window.addEventListener('pointerup', rt.boundPointerUp)
      return
    }

    if (!hit) {
      return
    }

    if (rt.props.tool() === 'line') {
      rt.layerStack?.history.record()
      rt.painting = true
      rt.lineStartHit = hit
      rt.currentHit = hit
      if (rt.lineGuideMesh) {
        const pos = rt.lineGuideMesh.geometry.attributes.position as THREE.BufferAttribute
        pos.setXYZ(0, hit.point.x, hit.point.y, hit.point.z)
        pos.setXYZ(1, hit.point.x, hit.point.y, hit.point.z)
        pos.needsUpdate = true
        rt.lineGuideMesh.visible = true
      }
      window.addEventListener('pointermove', rt.boundPointerMove)
      window.addEventListener('pointerup', rt.boundPointerUp)
      return
    }

    const tool = rt.props.tool()
    if (tool === 'fill' && brush.fillMode() === 'face') {
      // The first face goes down via applyToolAt below; the set tracks it so
      // the same triangle isn't refilled on every pointer sample after it.
      rt.fillDragFaces = new Set(hit.faceIndex >= 0 ? [hit.faceIndex] : [])
    }
    if (tool === 'effect') {
      rt.layerStack?.history.record()
      // Smudge direction is meaningless across a pen lift — a fresh stroke
      // must not drag color from wherever the last one ended.
      rt.lastEffectUv = null
    }
    if (tool === 'brush' || tool === 'stamp' || tool === 'eraser') {
      rt.layerStack?.history.record()
      if (tool !== 'eraser' && !rt.layerStack?.active?.isMask && brush.texturePath()) {
        recordRecentTexture(brush.texturePath()!)
      }
    }
    rt.painting = true
    rt.lastStampPos = null
    // Shift + click: connect the previous dab to this one with a straight
    // line and skip the plain dab, since strokeLineFrom already ends on the
    // clicked point.
    if (
      e.shiftKey &&
      rt.lastBrushDabPos &&
      (tool === 'brush' || tool === 'stamp' || tool === 'eraser')
    ) {
      strokeLineFrom(rt, rt.lastBrushDabPos, e.clientX, e.clientY)
    } else if (hasPressure(e) && e.pressure <= 0) {
      // Many tablets report pressure 0 on the contact event itself and only
      // send real readings from the first pointermove. Painting that sample
      // would either stamp a full-strength dab (if it were treated as "no
      // sensor") or a minimum-strength one — neither is what the artist
      // pressed. Skip it; lastStampPos is null, so the next move paints
      // immediately with a real reading and the stroke still starts on touch.
    } else {
      applyToolAt(rt, hit, e.shiftKey, e)
    }
    window.addEventListener('pointermove', rt.boundPointerMove)
    window.addEventListener('pointerup', rt.boundPointerUp)
  }
}

export function onDblClick(rt: ViewportRuntime, e: MouseEvent): void {
  const isFaceSelectTool =
    rt.props.tool() === 'faceSelect' ||
    rt.props.tool() === 'faceProjector' ||
    rt.props.tool() === 'text'
  const isCtrl = e.ctrlKey || e.metaKey
  if ((isFaceSelectTool || isCtrl) && rt.currentModel && rt.currentModel.meshes.length > 0) {
    const hit = hitFromEvent(rt, e as unknown as PointerEvent)
    if (hit?.mesh && hit.mesh === activeMesh(rt) && hit.faceIndex >= 0) {
      const mesh = hit.mesh
      const island = findUvIslandFaces(mesh.geometry, hit.faceIndex)
      applyIslandSelection(island, e.shiftKey)
    }
    return
  }

  // Plain double-click picks the piece under the cursor. Deliberately a
  // double-click: a single click has to stay a paint stroke, or painting near
  // any overlapping part would keep jumping to the neighbour instead.
  selectPieceAt(rt, e)
}

/** Paints one interpolated step of a committed line stroke, plus its symmetry mirror when enabled. */
function paintLineStep(
  rt: ViewportRuntime,
  engine: PaintEngine,
  hitObj: SurfaceHit,
  options: StrokeParams
): void {
  engine.paintStroke(hitObj, options)
  if (!brush.symmetryEnabled()) {
    return
  }
  const mirrored = getMirroredHit(rt, hitObj)
  if (!mirrored) {
    return
  }
  engine.paintStroke(mirrored, options)
}

/**
 * Bakes the Line tool's drag into a run of evenly-spaced dabs between
 * `rt.lineStartHit` and `endHit`. No-op if the active layer or the line's
 * start point disappeared mid-drag.
 */
function commitLineStroke(rt: ViewportRuntime, endHit: SurfaceHit): void {
  if (!rt.lineStartHit || !rt.layerStack) {
    return
  }
  const layer = rt.layerStack.active
  if (!layer) {
    return
  }
  const lineStartHit = rt.lineStartHit

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
  const strokeTexture = isMask ? null : rt.brushTexture
  const strokeTip = rt.brushTipTexture
  if (strokeTexture && brush.texturePath()) {
    recordRecentTexture(brush.texturePath()!)
  }
  const selection = brush.selectedFaces()
  const options: StrokeParams = {
    radius: brush.radius(),
    hardness: brush.hardness(),
    opacity: brush.opacity(),
    color: strokeColor,
    alpha: strokeAlpha,
    channels: lineChannels,
    channelMaps: isMask ? undefined : rt.channelMaps,
    brushTexture: strokeTexture,
    brushTipTexture: strokeTip,
    textureScale: brush.textureScale(),
    textureRegion: brush.textureRegion(),
    textureRepeat: brush.textureRepeat(),
    stampMode: false,
    textureMapping: brush.textureMapping(),
    restrictFaces: selection.size > 0 ? selection : null
  }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const point = new THREE.Vector3().lerpVectors(lineStartHit.point, endHit.point, t)
    const normal = new THREE.Vector3()
      .lerpVectors(lineStartHit.normal, endHit.normal, t)
      .normalize()
    const uv = new THREE.Vector2().lerpVectors(lineStartHit.uv, endHit.uv, t)
    const faceIndex = t < 0.5 ? lineStartHit.faceIndex : endHit.faceIndex
    paintLineStep(rt, engine, { point, normal, uv, faceIndex }, options)
  }

  rt.layerStack.recomposite()
  rt.props.onLayersChanged?.()
}

export function onPointerUp(rt: ViewportRuntime, e?: PointerEvent): void {
  rt.stencilDrag = null
  rt.resizeDrag = null
  rt.ctrlFaceSelecting = false
  rt.ctrlFaceDeselecting = false
  if (rt.lineGuideMesh) {
    rt.lineGuideMesh.visible = false
  }

  if (rt.painting && rt.props.tool() === 'line') {
    rt.painting = false
    const endHit = (e ? hitFromEvent(rt, e) : null) || rt.currentHit
    if (endHit) {
      commitLineStroke(rt, endHit)
    }
    rt.lineStartHit = null
    rt.currentHit = null
    window.removeEventListener('pointermove', rt.boundPointerMove)
    window.removeEventListener('pointerup', rt.boundPointerUp)
    return
  }

  rt.fillDragFaces = null
  if (rt.painting) {
    rt.props.onLayersChanged?.()
  }
  rt.painting = false
  window.removeEventListener('pointermove', rt.boundPointerMove)
  window.removeEventListener('pointerup', rt.boundPointerUp)
}

export function onWheel(rt: ViewportRuntime, e: WheelEvent): void {
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
    if (rt.props.tool() === 'fill' || (rt.props.tool() === 'brush' && brush.texturePath())) {
      const delta = e.deltaY < 0 ? 0.25 : -0.25
      setTextureScale(
        Math.max(0, Math.min(16, parseFloat((brush.textureScale() + delta).toFixed(2))))
      )
    } else {
      stepRadius(e.deltaY < 0 ? 1 : -1)
    }
  }
}

export function onKeyDown(rt: ViewportRuntime, e: KeyboardEvent): void {
  const activeEl = document.activeElement
  const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')
  if (isInput) {
    return
  }

  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault()
    if (rt.pieMenu()) {
      rt.setPieMenu(null)
    } else {
      rt.setPieMenu({ x: rt.lastClientX, y: rt.lastClientY })
    }
    return
  }

  if (e.key === 'Escape') {
    if (stencil.transforming()) {
      e.preventDefault()
      setStencilTransforming(false)
      return
    }
    if (rt.pieMenu()) {
      e.preventDefault()
      rt.setPieMenu(null)
      return
    }
  }

  // Tab / Shift+Tab step through the model's pieces — the keyboard route to
  // a piece that's buried inside another and awkward to click.
  if (e.key === 'Tab' && rt.pieces.length > 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    const step = e.shiftKey ? -1 : 1
    setActivePiece(rt, (rt.activePieceIndex + step + rt.pieces.length) % rt.pieces.length)
    return
  }

  if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    const delta = e.shiftKey ? -15 : 15
    brush.setBrushRotation(brush.brushRotation() + delta)
    return
  }

  if ((e.key.toLowerCase() === 'f' || e.key === 'Home') && rt.currentModel) {
    frameSelectionOrModel(rt)
  } else if (e.key === '[') {
    stepRadius(-1)
  } else if (e.key === ']') {
    stepRadius(1)
  } else if (e.key.toLowerCase() === 'w') {
    setWireframeVisible(rt, !rt.wireframeVisible)
    rt.props.onWireframeChanged?.(rt.wireframeVisible)
  }
}
