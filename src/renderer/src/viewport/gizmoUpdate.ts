import * as THREE from 'three'
import { brush, type ToolMode } from '../paint/brush'
import type { SurfaceHit } from './raycast'
import type { GizmoHandle } from './gizmos'
import type { ViewportRuntime } from './viewportRuntime'

/**
 * Live state `updateGizmo`/`updateHoverFace` need, read at call time via
 * getters (not snapshotted) since these fields are reassigned elsewhere in
 * the viewport as the model loads, the active piece changes, or textures load.
 */
export interface GizmoUpdateContext {
  getGizmoHandle: () => GizmoHandle | undefined
  /** Distance from the camera to the hit point, for reticle scaling. Undefined camera falls back to a fixed distance. */
  cameraDistanceTo: (point: THREE.Vector3) => number
  tool: () => ToolMode
  getHoverFaceMesh: () => THREE.LineSegments | undefined
  getHoverFillMesh: () => THREE.Mesh | undefined
  getFacePositions: () => Float32Array | undefined
  getBrushTipTexture: () => THREE.Texture | null
  getBrushTexture: () => THREE.Texture | null
  activeMesh: () => THREE.Mesh | undefined
  getMirroredHit: (hit: SurfaceHit) => SurfaceHit | null
  /**
   * World-space ring radius to draw instead of (ctx.radius ?? brush.radius()) — the 2D panel
   * sizes its dab in texels, so the matching 3D cursor has to be converted.
   */
  radius?: number
  /** Skip the symmetry mirror reticle (the 2D panel doesn't mirror). */
  noMirror?: boolean
}

/**
 * Builds a GizmoUpdateContext from a live ViewportRuntime, so callers don't
 * have to hand-write the getters each time. `getMirroredHit` is passed in
 * rather than imported to avoid a module cycle with viewportPointer.ts (which
 * both defines getMirroredHit and calls updateGizmo).
 */
export function makeGizmoUpdateContext(
  rt: ViewportRuntime,
  activeMesh: () => THREE.Mesh | undefined,
  getMirroredHit: (hit: SurfaceHit) => SurfaceHit | null
): GizmoUpdateContext {
  return {
    getGizmoHandle: () => rt.gizmoHandle,
    cameraDistanceTo: (point) =>
      rt.sceneHandle ? rt.sceneHandle.camera.position.distanceTo(point) : 2,
    tool: () => rt.props.tool(),
    getHoverFaceMesh: () => rt.hoverFaceMesh,
    getHoverFillMesh: () => rt.hoverFillMesh,
    getFacePositions: () => rt.facePositions,
    getBrushTipTexture: () => rt.brushTipTexture,
    getBrushTexture: () => rt.brushTexture,
    activeMesh,
    getMirroredHit
  }
}

/** Rebuilds the hover-triangle outline + fill for one face, or hides both when `faceIndex` is out of range. */
export function updateHoverFace(ctx: GizmoUpdateContext, faceIndex: number): void {
  const hoverFaceMesh = ctx.getHoverFaceMesh()
  const facePositions = ctx.getFacePositions()
  const hoverFillMesh = ctx.getHoverFillMesh()
  if (!hoverFaceMesh || !facePositions) {
    return
  }

  const base = faceIndex * 9
  if (base < 0 || base + 9 > facePositions.length) {
    hoverFaceMesh.visible = false
    if (hoverFillMesh) {
      hoverFillMesh.visible = false
    }
    return
  }

  const triangle = facePositions.subarray(base, base + 9)
  const [v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z] = triangle

  const outline = new Float32Array([
    v0x,
    v0y,
    v0z,
    v1x,
    v1y,
    v1z,
    v1x,
    v1y,
    v1z,
    v2x,
    v2y,
    v2z,
    v2x,
    v2y,
    v2z,
    v0x,
    v0y,
    v0z
  ])
  hoverFaceMesh.geometry.setAttribute('position', new THREE.BufferAttribute(outline, 3))
  hoverFaceMesh.geometry.attributes.position.needsUpdate = true
  hoverFaceMesh.visible = true

  // The triangle itself, tinted under the outline.
  if (hoverFillMesh) {
    hoverFillMesh.geometry.setAttribute('position', new THREE.BufferAttribute(triangle.slice(), 3))
    hoverFillMesh.geometry.attributes.position.needsUpdate = true
    hoverFillMesh.visible = true
  }
}

/** Whichever texture the cursor's silhouette/outline shader should preview: a custom brush tip, or (stamp tool only) the shelf texture itself. */
function pickActiveTipTexture(
  brushTipTexture: THREE.Texture | null,
  brushTexture: THREE.Texture | null,
  tool: ToolMode,
  showStampColorPreview: boolean
): THREE.Texture | null {
  return brushTipTexture ?? (tool === 'stamp' && !showStampColorPreview ? brushTexture : null)
}

/**
 * Pushes the brush tip's texture, crop region and rotation into its shader
 * uniforms, and (for the stamp tool's full-color preview) crops the shelf
 * texture itself via its own offset/repeat — see the two comments inline for
 * why each path exists.
 */
function updateBrushTipUniforms(
  gizmoHandle: GizmoHandle,
  brushTipTexture: THREE.Texture | null,
  brushTexture: THREE.Texture | null,
  tool: ToolMode,
  showStampColorPreview: boolean
): void {
  const activeTipTex = pickActiveTipTexture(
    brushTipTexture,
    brushTexture,
    tool,
    showStampColorPreview
  )
  gizmoHandle.brushTipMaterial.uniforms.uTexture.value = activeTipTex
  gizmoHandle.brushTipMaterial.uniforms.uHasTexture.value = activeTipTex ? 1 : 0

  /**
   * Preview the crop, not the sheet. A brush tip is its own image and is
   * never cropped; the shelf texture is, so the region only applies when
   * the preview is showing that.
   */
  const region = brush.textureRegion()
  const previewsShelfTexture = activeTipTex === brushTexture && !brushTipTexture
  const tipRegion = gizmoHandle.brushTipMaterial.uniforms.uRegion.value as THREE.Vector4
  if (previewsShelfTexture) {
    // Same top-left to bottom-up flip the paint shader gets (see
    // PaintEngine.applyTextureRegion).
    tipRegion.set(region.x, 1 - region.y - region.h, region.w, region.h)
    gizmoHandle.brushTipMaterial.uniforms.uRegionRotation.value = (region.rotation * Math.PI) / 180
  } else {
    tipRegion.set(0, 0, 1, 1)
    gizmoHandle.brushTipMaterial.uniforms.uRegionRotation.value = 0
  }

  gizmoHandle.stampPreviewMaterial.map = showStampColorPreview ? brushTexture : null
  if (showStampColorPreview && brushTexture) {
    // three's built-in materials honour a texture's offset/repeat/rotation;
    // the paint shader samples raw coordinates and ignores them entirely,
    // so driving the preview through them crops the ghost without touching
    // what any stroke actually paints.
    brushTexture.center.set(0.5, 0.5)
    brushTexture.offset.set(region.x, 1 - region.y - region.h)
    brushTexture.repeat.set(region.w, region.h)
    brushTexture.rotation = (region.rotation * Math.PI) / 180
  } else if (brushTexture && brushTexture.repeat.x !== 1) {
    // Leave the texture as found once the ghost is gone: these fields are
    // shared state on the texture object, and a stale crop would show up
    // the next time any built-in material samples it.
    brushTexture.offset.set(0, 0)
    brushTexture.repeat.set(1, 1)
    brushTexture.rotation = 0
  }
  gizmoHandle.stampPreviewMaterial.needsUpdate = true

  const rotRad = (brush.brushRotation() * Math.PI) / 180
  gizmoHandle.brushTipMesh.rotation.z = rotRad
  gizmoHandle.mirrorBrushTipMesh.rotation.z = -rotRad
  gizmoHandle.stampPreviewMesh.rotation.z = rotRad
  gizmoHandle.mirrorStampPreviewMesh.rotation.z = -rotRad
  gizmoHandle.stampReticle.rotation.z = rotRad
}

/**
 * Everything off first, then the active tool's branch below switches on only
 * what it needs. Each branch used to re-list every mesh, so a tool that
 * forgot one inherited it from whatever was selected before — which is how
 * the fill bucket ended up wearing the brush's tip preview, scaled to a
 * brush radius that means nothing to it.
 */
function resetGizmoVisibility(gizmoHandle: GizmoHandle): void {
  gizmoHandle.brushRing.visible = false
  gizmoHandle.brushTipMesh.visible = false
  gizmoHandle.stampPreviewMesh.visible = false
  gizmoHandle.stampReticle.visible = false
  gizmoHandle.bucketReticle.visible = false
  gizmoHandle.eyedropperReticle.visible = false
}

/** Shows the right reticle/tip for the active tool, and updates the hover-face outline for the tools that use one instead. */
function applyToolVisibility(
  ctx: GizmoUpdateContext,
  gizmoHandle: GizmoHandle,
  hit: SurfaceHit,
  tool: ToolMode,
  hasTip: boolean,
  showStampColorPreview: boolean,
  reticleScale: number
): void {
  const hoverFaceMesh = ctx.getHoverFaceMesh()
  const hoverFillMesh = ctx.getHoverFillMesh()
  const hideHoverFace = (): void => {
    if (hoverFaceMesh) {
      hoverFaceMesh.visible = false
    }
    if (hoverFillMesh) {
      hoverFillMesh.visible = false
    }
  }
  const updateHoverForActivePieceOnly = (): void => {
    if (hoverFaceMesh) {
      updateHoverFace(ctx, hit.mesh === ctx.activeMesh() ? hit.faceIndex : -1)
    }
  }

  if (tool === 'brush' || tool === 'eraser' || tool === 'line' || tool === 'effect') {
    gizmoHandle.group.visible = true
    gizmoHandle.eyedropperReticle.visible = false
    gizmoHandle.bucketReticle.visible = false
    gizmoHandle.stampReticle.visible = false
    if (hasTip) {
      gizmoHandle.brushRing.visible = false
      gizmoHandle.brushTipMesh.visible = true
      gizmoHandle.brushTipMesh.scale.setScalar(ctx.radius ?? brush.radius())
    } else {
      gizmoHandle.brushTipMesh.visible = false
      gizmoHandle.brushRing.visible = true
      gizmoHandle.brushRing.scale.setScalar(ctx.radius ?? brush.radius())
    }
    gizmoHandle.stampPreviewMesh.visible = false
    hideHoverFace()
  } else if (tool === 'stamp') {
    gizmoHandle.group.visible = true
    gizmoHandle.eyedropperReticle.visible = false
    gizmoHandle.bucketReticle.visible = false
    gizmoHandle.stampPreviewMesh.visible = showStampColorPreview
    if (showStampColorPreview) {
      gizmoHandle.stampReticle.visible = true
      gizmoHandle.stampReticle.scale.setScalar(ctx.radius ?? brush.radius())
      gizmoHandle.stampPreviewMesh.scale.setScalar(ctx.radius ?? brush.radius())
      gizmoHandle.brushTipMesh.visible = false
      gizmoHandle.brushRing.visible = false
    } else if (hasTip) {
      gizmoHandle.stampReticle.visible = false
      gizmoHandle.brushRing.visible = false
      gizmoHandle.brushTipMesh.visible = true
      gizmoHandle.brushTipMesh.scale.setScalar(ctx.radius ?? brush.radius())
    } else {
      gizmoHandle.stampReticle.visible = false
      gizmoHandle.brushTipMesh.visible = false
      gizmoHandle.brushRing.visible = true
      gizmoHandle.brushRing.scale.setScalar(ctx.radius ?? brush.radius())
    }
    hideHoverFace()
  } else if (tool === 'eyedropper') {
    gizmoHandle.group.visible = true
    gizmoHandle.brushRing.visible = false
    gizmoHandle.eyedropperReticle.visible = true
    gizmoHandle.eyedropperReticle.scale.setScalar(reticleScale)
    gizmoHandle.bucketReticle.visible = false
    gizmoHandle.stampReticle.visible = false
    gizmoHandle.stampPreviewMesh.visible = false
    hideHoverFace()
  } else if (tool === 'fill') {
    // No 3D reticle: the bucket already has a mouse cursor of its own (see
    // .tool-fill in index.css) and the face outline shows what a click would
    // affect. A ring floating at the hit point on top of both was a third
    // cursor for a tool that has no footprint to indicate.
    gizmoHandle.group.visible = false
    updateHoverForActivePieceOnly()
  } else if (tool === 'faceSelect' || tool === 'faceProjector' || tool === 'text') {
    gizmoHandle.stampPreviewMesh.visible = false
    gizmoHandle.group.visible = false
    updateHoverForActivePieceOnly()
  }
}

/** Mirrors the gizmo across the symmetry plane, or hides it when symmetry is off, no mirror hit exists, or the tool has no footprint (fill/select). */
function updateMirrorReticle(
  ctx: GizmoUpdateContext,
  gizmoHandle: GizmoHandle,
  hit: SurfaceHit,
  tool: ToolMode,
  hasTip: boolean,
  showStampColorPreview: boolean
): void {
  const mirrorableTool =
    tool === 'brush' ||
    tool === 'eraser' ||
    tool === 'line' ||
    tool === 'stamp' ||
    tool === 'effect'
  const mirroredHit = brush.symmetryEnabled() && mirrorableTool ? ctx.getMirroredHit(hit) : null
  if (!mirroredHit) {
    gizmoHandle.mirrorGroup.visible = false
    return
  }

  gizmoHandle.mirrorGroup.position.copy(mirroredHit.point)
  gizmoHandle.mirrorGroup.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    mirroredHit.normal
  )
  gizmoHandle.mirrorGroup.visible = true

  if (showStampColorPreview) {
    gizmoHandle.mirrorBrushRing.visible = false
    gizmoHandle.mirrorBrushTipMesh.visible = false
    gizmoHandle.mirrorStampPreviewMesh.visible = true
    gizmoHandle.mirrorStampPreviewMesh.scale.setScalar(ctx.radius ?? brush.radius())
  } else if (hasTip) {
    gizmoHandle.mirrorBrushRing.visible = false
    gizmoHandle.mirrorBrushTipMesh.visible = true
    gizmoHandle.mirrorStampPreviewMesh.visible = false
    gizmoHandle.mirrorBrushTipMesh.scale.setScalar(ctx.radius ?? brush.radius())
  } else {
    gizmoHandle.mirrorBrushTipMesh.visible = false
    gizmoHandle.mirrorStampPreviewMesh.visible = false
    gizmoHandle.mirrorBrushRing.visible = true
    gizmoHandle.mirrorBrushRing.scale.setScalar(ctx.radius ?? brush.radius())
  }
}

/** Repositions the cursor gizmo onto `hit` and shows whichever reticle/tip the active tool wants; hides everything when there's no hit. */
export function updateGizmo(ctx: GizmoUpdateContext, hit: SurfaceHit | null): void {
  const gizmoHandle = ctx.getGizmoHandle()
  if (!gizmoHandle) {
    return
  }
  const tool = ctx.tool()

  if (!hit) {
    gizmoHandle.group.visible = false
    gizmoHandle.mirrorGroup.visible = false
    if (ctx.getHoverFaceMesh()) {
      ctx.getHoverFaceMesh()!.visible = false
    }
    if (ctx.getHoverFillMesh()) {
      ctx.getHoverFillMesh()!.visible = false
    }
    return
  }

  gizmoHandle.group.position.copy(hit.point)
  gizmoHandle.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal)

  const reticleScale = Math.max(0.02, ctx.cameraDistanceTo(hit.point) * 0.035)
  const brushTipTexture = ctx.getBrushTipTexture()
  const brushTexture = ctx.getBrushTexture()
  const hasTip = !!brushTipTexture || (tool === 'stamp' && !!brushTexture)
  // Stamp tool with a shelf texture (not a custom ABR alpha tip) gets a
  // real full-color preview instead of the blue alpha-silhouette outline —
  // a decal image's actual colors are the whole point of aiming a stamp.
  const showStampColorPreview = tool === 'stamp' && !brushTipTexture && !!brushTexture

  updateBrushTipUniforms(gizmoHandle, brushTipTexture, brushTexture, tool, showStampColorPreview)
  resetGizmoVisibility(gizmoHandle)
  applyToolVisibility(ctx, gizmoHandle, hit, tool, hasTip, showStampColorPreview, reticleScale)
  if (ctx.noMirror) {
    gizmoHandle.mirrorGroup.visible = false
    return
  }
  updateMirrorReticle(ctx, gizmoHandle, hit, tool, hasTip, showStampColorPreview)
}
