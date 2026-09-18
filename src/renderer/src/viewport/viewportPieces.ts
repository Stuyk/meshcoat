import * as THREE from 'three'
import { brush, clearFaceSelection } from '../paint/brush'
import { LayerStack } from '../paint/layers'
import { DEFAULT_TEXTURE_SIZE } from '../paint/paintEngine'
import { createChannelViewMaterial } from '../paint/channelViewShader'
import { createFacePreviewMaterial } from '../paint/facePreviewShader'
import { CHANNEL_SPECS } from '../paint/channels'
import type { LoadedModel } from './modelLoader'
import type { PaintPiece, EmbeddedSlot } from './viewportTypes'
import { updateHighlight, updateProjectorPreview } from './viewportHighlight'
import type { ViewportRuntime } from './viewportRuntime'

export function clearCurrentModel(rt: ViewportRuntime): void {
  if (rt.currentModel && rt.sceneHandle) {
    rt.sceneHandle.scene.remove(rt.currentModel.root)
  }
  for (const wf of rt.wireframeMeshes) {
    wf.geometry.dispose()
    ;(wf.material as THREE.Material).dispose()
  }
  rt.wireframeMeshes = []
  rt.lastBrushDabPos = null
  rt.lastEffectUv = null
  rt.occlusionPass?.invalidate()
  for (const piece of rt.pieces) {
    piece.stack.dispose()
    piece.channelViewMaterial?.dispose()
    for (const overlay of [
      piece.highlightMesh,
      piece.hoverFaceMesh,
      piece.selectionFillMesh,
      piece.projectorPreviewMesh,
      piece.hoverFillMesh
    ]) {
      overlay.geometry.dispose()
      ;(overlay.material as THREE.Material).dispose()
      overlay.parent?.remove(overlay)
    }
  }
  rt.pieces = []
  rt.activePieceIndex = 0
  rt.layerStack = undefined
  rt.currentModel = undefined
  rt.isolateActivePiece = false
  rt.props.onIsolatePieceChanged?.(false)
  if (rt.activePieceBox) {
    rt.activePieceBox.visible = false
  }
  if (rt.hoverPieceBox) {
    rt.hoverPieceBox.visible = false
  }
  rt.setPieceHud(null)
  if (rt.symmetryGuide && rt.symmetryGuide.group.parent) {
    rt.symmetryGuide.group.parent.remove(rt.symmetryGuide.group)
    rt.symmetryGuide.group.visible = false
  }
  // Both overlays belong to a piece and were disposed with it above.
  rt.highlightMesh = undefined
  rt.selectionFillMesh = undefined
  rt.projectorPreviewMesh = undefined
  rt.hoverFaceMesh = undefined
  rt.hoverFillMesh = undefined
  rt.facePositions = undefined
  rt.faceUVs = undefined
  rt.faceNormals = undefined
  rt.previewTextureClone?.dispose()
  rt.previewTextureClone = null
  rt.previewTextureSource = null
  // A picked triangle index only means anything for the mesh it was picked
  // on — carrying it into a freshly loaded model could restrict painting
  // to an unrelated (or out-of-range) face.
  clearFaceSelection()
}

export function setupWireframe(rt: ViewportRuntime, model: LoadedModel): void {
  const material = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5 })
  rt.wireframeMeshes = model.meshes.map((mesh) => {
    const overlay = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), material)
    overlay.visible = rt.wireframeVisible
    overlay.renderOrder = 998
    mesh.add(overlay)
    return overlay
  })
}

export function setWireframeVisible(rt: ViewportRuntime, visible: boolean): void {
  rt.wireframeVisible = visible
  for (const wf of rt.wireframeMeshes) {
    wf.visible = visible
  }
}

/**
 * Swaps the mesh between the shaded PBR material and the isolated
 * channel-inspection material. The shaded material is parked, not rebuilt, so
 * switching back restores every map binding exactly as the layer stack left
 * it. Re-applied after every setupLayers so a reload keeps the chosen view.
 */
export function applyViewModeToPiece(rt: ViewportRuntime, piece: PaintPiece): void {
  if (rt.viewMode === 'material') {
    piece.mesh.material = piece.shadedMaterial
    return
  }

  const map = piece.stack.channelTexture(rt.viewMode)
  if (!map) {
    // Nothing painted in that channel yet — fall back to the shaded view
    // rather than showing a black model and looking broken.
    piece.mesh.material = piece.shadedMaterial
    return
  }
  if (!piece.channelViewMaterial) {
    piece.channelViewMaterial = createChannelViewMaterial()
  }
  const mat = piece.channelViewMaterial
  mat.uniforms.tMap.value = map
  mat.uniforms.uIsNormal.value = CHANNEL_SPECS[rt.viewMode].vector ? 1 : 0
  // Only the base-color composite is stored premultiplied; the data channels
  // are already resolved to straight values by the flatten pass.
  mat.uniforms.uPremultiplied.value = rt.viewMode === 'baseColor' ? 1 : 0
  piece.mesh.material = mat
}

/** Every piece stays in its own channel view, so the whole model reads the same. */
export function applyViewMode(rt: ViewportRuntime): void {
  for (const piece of rt.pieces) {
    applyViewModeToPiece(rt, piece)
  }
}

export function createPiece(
  rt: ViewportRuntime,
  mesh: THREE.Mesh,
  textureSize?: number
): PaintPiece {
  const stack = new LayerStack(rt.sceneHandle!.renderer, mesh, textureSize)

  // Pieces of an imported model routinely SHARE one material instance (both
  // OBJ and glTF do this whenever the parts were exported with the same
  // material). Each piece binds its own composite and channel maps, so
  // binding onto a shared instance means the last piece built wins and every
  // other piece renders someone else's texture — which reads as "painting
  // does nothing". A private clone per piece is what makes each texture set
  // actually independent.
  const source = mesh.material
  const slots = (Array.isArray(source) ? source : [source]) as THREE.MeshStandardMaterial[]
  const base = slots[0]
  const material = base.clone()
  material.name = `${mesh.name || 'Piece'}_Material`
  // Collapsed to one material on purpose: a piece is one texture set, and
  // every slot's artwork is baked into it below. three renders a grouped
  // geometry with a single (non-array) material perfectly well.
  mesh.material = material

  /**
   * A GLB from Blender carries its textures inside the file, already bound to
   * the material. Binding the layer stack replaces those maps with this
   * stack's own composites, so without capturing them first the model's
   * artwork disappears the moment it loads and comes back as flat grey.
   *
   * Each material SLOT is captured separately with the faces it covers. A
   * Blender object with a body material and a trim material is one mesh with
   * two slots; keeping only the first (what this used to do) drops the trim's
   * texture entirely and paints its faces with the body's.
   *
   * flipY is left as each loader set it, which is only safe because nothing
   * samples these maps today — they are captured for import diagnostics. UVs
   * are normalized to a bottom-left origin at import (modelLoader.ts), so a
   * GLTFLoader-supplied map (flipY cleared for glTF's top-down origin) would
   * need flipY set again before it could be re-bound to the material.
   */
  const groups = mesh.geometry.groups
  const embedded: EmbeddedSlot[] = slots.map((slot, slotIndex) => {
    const maps: EmbeddedSlot['maps'] = {}
    if (slot?.map) {
      maps.baseColor = slot.map
    }
    if (slot?.roughnessMap) {
      maps.roughness = slot.roughnessMap
    }
    if (slot?.metalnessMap) {
      maps.metalness = slot.metalnessMap
    }
    if (slot?.normalMap) {
      maps.normal = slot.normalMap
    }

    let faces: Set<number> | null = null
    if (slots.length > 1 && groups.length > 0) {
      faces = new Set<number>()
      for (const group of groups) {
        if ((group.materialIndex ?? 0) !== slotIndex) {
          continue
        }
        // Groups are expressed in index-buffer elements; three vertices per
        // triangle, and triangle numbering is what faceIndex counts in.
        const first = Math.floor(group.start / 3)
        const count = Math.floor(group.count / 3)
        for (let i = 0; i < count; i++) {
          faces.add(first + i)
        }
      }
    }

    return { maps, color: slot?.color ? slot.color.clone() : null, faces }
  })

  // The stack binds every channel it has (and re-binds when a new one first
  // appears mid-session), rather than the viewport wiring up base color once.
  stack.bindMaterial(material)

  // Same non-indexed expansion PaintEngine's uvMesh uses (see uvMesh.ts) —
  // keeps triangle numbering identical to SurfaceHit.faceIndex so the
  // highlight overlay lines up with what's actually selected for painting.
  const nonIndexed = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const piecePositions = (
    nonIndexed.attributes.position as THREE.BufferAttribute
  ).array.slice() as Float32Array
  const pieceUVs = (nonIndexed.attributes.uv as THREE.BufferAttribute).array.slice() as Float32Array
  // The model's own (usually smooth) normals, not recomputed flat ones: the
  // projector preview mesh is a copy of a handful of the model's triangles,
  // and faceted shading on top of a smooth-shaded surface reads as a seam.
  if (!nonIndexed.attributes.normal) {
    nonIndexed.computeVertexNormals()
  }
  const pieceNormals = (
    nonIndexed.attributes.normal as THREE.BufferAttribute
  ).array.slice() as Float32Array

  const highlightGeometry = new THREE.BufferGeometry()
  highlightGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
  const highlightMaterial = new THREE.LineBasicMaterial({
    color: 0xffd166, // Bright amber: a 1px line has to carry on its own
    // A hairline is the thinnest thing on screen and loses every contest with
    // the texture under it; drawing it without the depth test keeps the whole
    // outline at full strength instead of dropping in and out along curvature.
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })
  const pieceHighlight = new THREE.LineSegments(highlightGeometry, highlightMaterial)
  pieceHighlight.renderOrder = 999
  pieceHighlight.frustumCulled = false
  mesh.add(pieceHighlight)

  /**
   * Translucent wash over the selected faces, under the outline.
   *
   * WebGL can't draw a line thicker than one pixel, so an outline alone is
   * all the emphasis a selection can get — and against a painted texture that
   * is very little. Tinting the faces themselves is what actually makes a
   * selection readable at a glance, with the outline giving it a crisp edge.
   */
  const selectionFillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })
  const pieceSelectionFill = new THREE.Mesh(new THREE.BufferGeometry(), selectionFillMaterial)
  pieceSelectionFill.geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(0), 3)
  )
  pieceSelectionFill.renderOrder = 997
  pieceSelectionFill.frustumCulled = false
  mesh.add(pieceSelectionFill)

  /**
   * Live preview of a Face UV Projector fill: same selected triangles as
   * pieceSelectionFill, but textured with the shelf texture under the
   * current crop region + projector offset/scale/rotation — see
   * facePreviewShader.ts. Sits above the flat wash so the artist sees
   * exactly what Apply will bake before committing.
   */
  const pieceProjectorPreview = new THREE.Mesh(
    new THREE.BufferGeometry(),
    createFacePreviewMaterial()
  )
  pieceProjectorPreview.geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(0), 3)
  )
  pieceProjectorPreview.geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array(0), 2)
  )
  pieceProjectorPreview.geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array(0), 3)
  )
  pieceProjectorPreview.renderOrder = 997.5
  pieceProjectorPreview.frustumCulled = false
  pieceProjectorPreview.visible = false
  mesh.add(pieceProjectorPreview)

  const hoverFaceGeometry = new THREE.BufferGeometry()
  hoverFaceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
  const hoverFaceMaterial = new THREE.LineBasicMaterial({
    color: 0x7df9ff, // Bright cyan hover indicator for bucket & face select
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 1,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  })
  const hoverFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x7df9ff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  })
  const pieceHoverFill = new THREE.Mesh(new THREE.BufferGeometry(), hoverFillMaterial)
  pieceHoverFill.geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(0), 3)
  )
  pieceHoverFill.renderOrder = 998
  pieceHoverFill.frustumCulled = false
  pieceHoverFill.visible = false
  mesh.add(pieceHoverFill)

  const pieceHover = new THREE.LineSegments(hoverFaceGeometry, hoverFaceMaterial)
  pieceHover.renderOrder = 999
  pieceHover.frustumCulled = false
  pieceHover.visible = false
  mesh.add(pieceHover)

  const piece: PaintPiece = {
    mesh,
    name: mesh.name || 'Piece',
    stack,
    embedded,
    facePositions: piecePositions,
    faceUVs: pieceUVs,
    faceNormals: pieceNormals,
    highlightMesh: pieceHighlight,
    selectionFillMesh: pieceSelectionFill,
    projectorPreviewMesh: pieceProjectorPreview,
    hoverFaceMesh: pieceHover,
    hoverFillMesh: pieceHoverFill,
    shadedMaterial: material
  }
  applyViewModeToPiece(rt, piece)
  return piece
}

/** The mesh currently receiving strokes, or undefined before a model loads. */
export function activeMesh(rt: ViewportRuntime): THREE.Mesh | undefined {
  return rt.pieces[rt.activePieceIndex]?.mesh
}

/**
 * The meshes the depth pass treats as occluders.
 *
 * ONLY the piece being painted. The pass exists to stop a dab wrapping onto
 * the far side of the surface being aimed at; including the other pieces
 * turns every overlapping part into a stencil that blocks paint, and pieces
 * routinely interpenetrate or sit as coincident shells — a strap over a
 * torso, an eye inside a socket — which rejects the whole stroke and looks
 * exactly like painting is broken.
 */
export function occluderMeshes(rt: ViewportRuntime): THREE.Mesh[] {
  const mesh = activeMesh(rt)
  return mesh ? [mesh] : []
}

/** The named piece's stack, or the active one when no index is given. */
export function stackFor(rt: ViewportRuntime, pieceIndex?: number): LayerStack | undefined {
  return pieceIndex == null ? rt.layerStack : rt.pieces[pieceIndex]?.stack
}

export function pieceIndexForMesh(rt: ViewportRuntime, mesh: THREE.Mesh | undefined): number {
  if (!mesh) {
    return -1
  }
  return rt.pieces.findIndex((p) => p.mesh === mesh)
}

/**
 * Enforces mesh visibility based on `isolateActivePiece`.
 * When isolated, all pieces except the active piece (and any non-piece meshes)
 * are hidden.
 */
export function applyPieceVisibility(rt: ViewportRuntime): void {
  if (!rt.currentModel) {
    return
  }
  for (let i = 0; i < rt.pieces.length; i++) {
    rt.pieces[i].mesh.visible = !rt.isolateActivePiece || i === rt.activePieceIndex
  }
  for (const mesh of rt.currentModel.meshes) {
    if (!rt.pieces.some((p) => p.mesh === mesh)) {
      mesh.visible = !rt.isolateActivePiece
    }
  }
}

/**
 * Draws the amber box around the active piece and the dimmer one around a
 * hovered inactive piece, and refreshes the badge. Both boxes are world-space
 * Box3Helpers rather than a material tint, so nothing about how the piece is
 * shaded (or which channel view is up) has to change to show selection.
 */
export function updatePieceOutlines(rt: ViewportRuntime, hoverMesh?: THREE.Mesh | null): void {
  if (!rt.sceneHandle) {
    return
  }
  const multi = rt.pieces.length > 1
  const active = rt.pieces[rt.activePieceIndex]

  if (!multi || !active) {
    if (rt.activePieceBox) {
      rt.activePieceBox.visible = false
    }
    if (rt.hoverPieceBox) {
      rt.hoverPieceBox.visible = false
    }
    rt.setPieceHud(null)
    return
  }

  if (rt.isolateActivePiece) {
    if (rt.activePieceBox) {
      rt.activePieceBox.visible = false
    }
    if (rt.hoverPieceBox) {
      rt.hoverPieceBox.visible = false
    }
    rt.setPieceHud({ active: active.name, hover: null })
    return
  }

  if (!rt.activePieceBox) {
    rt.activePieceBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffaa00))
    ;(rt.activePieceBox.material as THREE.LineBasicMaterial).transparent = true
    ;(rt.activePieceBox.material as THREE.LineBasicMaterial).opacity = 0.75
    rt.activePieceBox.renderOrder = 997
    rt.sceneHandle.scene.add(rt.activePieceBox)
  }
  rt.activePieceBox.box.setFromObject(active.mesh)
  rt.activePieceBox.visible = true

  const hoverPiece =
    hoverMesh && hoverMesh !== active.mesh ? rt.pieces[pieceIndexForMesh(rt, hoverMesh)] : undefined
  if (!rt.hoverPieceBox) {
    rt.hoverPieceBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x38bdf8))
    ;(rt.hoverPieceBox.material as THREE.LineBasicMaterial).transparent = true
    ;(rt.hoverPieceBox.material as THREE.LineBasicMaterial).opacity = 0.4
    rt.hoverPieceBox.renderOrder = 996
    rt.sceneHandle.scene.add(rt.hoverPieceBox)
  }
  if (hoverPiece) {
    rt.hoverPieceBox.box.setFromObject(hoverPiece.mesh)
    rt.hoverPieceBox.visible = true
  } else {
    rt.hoverPieceBox.visible = false
  }

  rt.setPieceHud({ active: active.name, hover: hoverPiece?.name ?? null })
}

/**
 * Points every "current piece" variable at `index`. The paint paths, the
 * layers panel and undo all read those, so this one swap is what switching
 * texture sets means.
 */
export function setActivePiece(rt: ViewportRuntime, index: number): void {
  if (index < 0 || index >= rt.pieces.length) {
    return
  }
  rt.activePieceIndex = index
  const piece = rt.pieces[index]
  rt.layerStack = piece.stack
  rt.facePositions = piece.facePositions
  rt.faceUVs = piece.faceUVs
  rt.faceNormals = piece.faceNormals
  rt.highlightMesh = piece.highlightMesh
  rt.selectionFillMesh = piece.selectionFillMesh
  rt.projectorPreviewMesh = piece.projectorPreviewMesh
  rt.hoverFaceMesh = piece.hoverFaceMesh
  rt.hoverFillMesh = piece.hoverFillMesh
  // Face indices are per-mesh, so a selection made on another piece would
  // restrict painting to unrelated (or out-of-range) triangles here.
  clearFaceSelection()
  for (const other of rt.pieces) {
    if (other !== piece) {
      other.hoverFaceMesh.visible = false
      other.hoverFillMesh.visible = false
    }
  }
  updateHighlight(rt)
  updateProjectorPreview(rt)
  if (rt.symmetryGuide && rt.currentModel) {
    rt.symmetryGuide.update(brush.symmetryAxis(), rt.currentModel, activeMesh(rt))
  }
  // The depth map is keyed on its occluder set, which just changed.
  rt.occlusionPass?.invalidate()
  applyPieceVisibility(rt)
  updatePieceOutlines(rt)
  // Only onPiecesChanged: switching piece redraws the layers panel but is not
  // an edit, so it must not mark the project dirty.
  rt.props.onPiecesChanged?.()
}

/**
 * Builds one texture set per mesh. Meshes without UV0 can't be painted at all
 * (modelLoader reports them) — they still render, they just get no stack.
 */
export function setupLayers(
  rt: ViewportRuntime,
  model: LoadedModel,
  textureSize?: number,
  /** Per-piece override by piece name, used when reopening a saved project. */
  sizeByName?: Record<string, number>
): void {
  if (!rt.sceneHandle) {
    return
  }
  // Shadows are only rendered by the showcase preset, but the flags are a
  // property of the model rather than the lighting — set once here so
  // switching preset needs no traversal.
  for (const mesh of model.meshes) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }

  const paintable = model.meshes.filter((mesh) => !!mesh.geometry.attributes.uv)

  /**
   * Every piece is a full texture set, and a texture set at 4096 costs
   * roughly 320 MB of GPU memory (composite + two scratch buffers + the
   * layer's own ping-pong pair, 64 MB each). Eight pieces at that size ask
   * for ~2.5 GB, which most GPUs refuse — and a render target that failed to
   * allocate doesn't throw, it just reads back as zeroes, so the model turns
   * black and every export comes out empty.
   *
   * Scale the per-piece resolution down until the whole model fits a sane
   * budget. One piece keeps whatever the artist picked.
   */
  const BUDGET_TEXELS = 4096 * 4096 * 4
  const fitSize = (requested: number): number => {
    let size = requested
    while (size > 512 && paintable.length * size * size > BUDGET_TEXELS) {
      size /= 2
    }
    return size
  }

  rt.pieces = paintable.map((mesh) => {
    const requested = sizeByName?.[mesh.name] ?? textureSize ?? DEFAULT_TEXTURE_SIZE
    const fitted = fitSize(requested)
    if (fitted !== requested) {
      console.warn(
        `[slip] ${paintable.length} paintable pieces at ${requested}px would exceed the GPU ` +
          `texture budget; "${mesh.name}" allocated at ${fitted}px instead.`
      )
    }
    return createPiece(rt, mesh, fitted)
  })
  rt.activePieceIndex = 0
  applyPieceVisibility(rt)
  if (rt.pieces.length > 0) {
    setActivePiece(rt, 0)
  }
  updatePieceOutlines(rt)
  rt.props.onPiecesChanged?.()
  rt.props.onLayersChanged?.()
}

export function frameModel(rt: ViewportRuntime, model: LoadedModel): void {
  if (!rt.sceneHandle) {
    return
  }
  const box = new THREE.Box3().setFromObject(model.root)
  if (box.isEmpty()) {
    return
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  rt.sceneHandle.controls.focus(sphere.center, sphere.radius || 1)
  // Brush radius is in world units, so the slider's usable range has to track
  // the model: 0.01 is a detail brush on a character and covers a gemstone
  // whole. The current radius rescales with it.
  brush.setSceneScale(sphere.radius || 1)
  // Same bounds drive the shadow camera and the ground plane the model's
  // shadow lands on — the plane sits at the model's lowest point, not at
  // y = 0, so a model authored off the origin still gets a contact shadow.
  rt.sceneHandle.fitShadows(sphere.center, sphere.radius || 1, box.min.y)
}
