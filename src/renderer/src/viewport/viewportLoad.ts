import * as THREE from 'three'
import { brush } from '../paint/brush'
import { loadModel, createDefaultTestModel, type LoadedModel } from './modelLoader'
import type { StackSnapshot } from '../paint/layers'
import type { MeshCoatProject } from '../utils/projectSerializer'
import { createSymmetryGuide } from './gizmos'
import { snapToCanvasSize, probeImageSize, embeddedMapSize } from './textureSizing'
import {
  activeMesh,
  clearCurrentModel,
  frameModel,
  setActivePiece,
  setupLayers,
  setupWireframe
} from './viewportPieces'
import { applyPbrTexturesToPiece } from './viewportPbr'
import type { InitialPbrTextures, InitialTexturePayload, LoadOptions } from './viewportTypes'
import type { ViewportRuntime } from './viewportRuntime'

/**
 * Frames the active face selection, or the whole model when nothing is
 * selected. Selecting a handful of triangles and pressing F almost always
 * means "get me closer to those", not "show me the model again".
 *
 * The selection's bounds are built from the same local-space triangle buffer
 * the highlight overlay uses, then taken to world space through the piece's
 * matrix, so it works on a piece that carries its own transform.
 */
export function frameSelectionOrModel(rt: ViewportRuntime): void {
  const mesh = activeMesh(rt)
  const faces = brush.selectedFaces()
  const facePositions = rt.facePositions
  if (!rt.sceneHandle || !mesh || !facePositions || faces.size === 0) {
    frameWholeModel(rt)
    return
  }

  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  mesh.updateWorldMatrix(true, false)
  for (const face of faces) {
    const base = face * 9
    if (base < 0 || base + 9 > facePositions.length) {
      continue
    }
    for (let i = 0; i < 9; i += 3) {
      point
        .set(facePositions[base + i], facePositions[base + i + 1], facePositions[base + i + 2])
        .applyMatrix4(mesh.matrixWorld)
      box.expandByPoint(point)
    }
  }
  if (box.isEmpty()) {
    frameWholeModel(rt)
    return
  }

  const sphere = box.getBoundingSphere(new THREE.Sphere())
  // A single flat triangle has almost no radius, which would put the camera
  // inside it; keep a floor relative to the model so the framing stays usable.
  const floor = brush.sceneScale() * 0.05
  rt.sceneHandle.controls.focus(sphere.center, Math.max(sphere.radius, floor))
}

/** Falls back to framing the whole model, if one is loaded. */
function frameWholeModel(rt: ViewportRuntime): void {
  if (!rt.currentModel) {
    return
  }
  frameModel(rt, rt.currentModel)
}

/** True when `payload` addresses every piece with the same map set, rather than naming maps per piece. */
function isPerPiecePayload(
  payload: InitialTexturePayload
): payload is { mode: 'per-piece'; pieces: Record<string, InitialPbrTextures> } {
  return typeof payload === 'object' && 'mode' in payload && payload.mode === 'per-piece'
}

/** Normalizes any of the three initial-texture payload shapes into one shared map. Never called on a per-piece payload. */
function toSharedPbrTextures(payload: InitialTexturePayload): InitialPbrTextures {
  if (typeof payload === 'string') {
    return { baseColor: payload }
  }
  if ('mode' in payload && payload.mode === 'shared') {
    return payload.textures
  }
  return payload as InitialPbrTextures
}

/** First map in `maps` that resolves to a real image, snapped to a supported canvas size — or null if none load. */
async function probeNativeSize(maps: InitialPbrTextures): Promise<number | null> {
  for (const path of [maps.baseColor, maps.normal, maps.orm, maps.roughness, maps.metalness]) {
    if (!path) {
      continue
    }
    const px = await probeImageSize(path)
    if (px) {
      return snapToCanvasSize(px)
    }
  }
  return null
}

/**
 * Canvas size follows the artwork being imported, not the number in the
 * wizard: a piece whose maps are 2048 is painted at 2048. Measured BEFORE
 * the stacks exist, because a LayerStack's resolution is fixed at
 * construction. Starts from whatever the model's own embedded maps carry,
 * then lets `initialTextures` override per piece (or all at once for a
 * shared atlas).
 */
async function resolveSizeByName(
  model: LoadedModel,
  initialTextures: InitialTexturePayload | null | undefined
): Promise<Record<string, number>> {
  const sizeByName: Record<string, number> = {}
  for (const mesh of model.meshes) {
    const native = embeddedMapSize(mesh)
    if (native) {
      sizeByName[mesh.name] = native
    }
  }
  if (!initialTextures) {
    return sizeByName
  }

  if (isPerPiecePayload(initialTextures)) {
    for (const [name, maps] of Object.entries(initialTextures.pieces || {})) {
      const native = await probeNativeSize(maps)
      if (native) {
        sizeByName[name] = native
      }
    }
    return sizeByName
  }

  const native = await probeNativeSize(toSharedPbrTextures(initialTextures))
  if (!native) {
    return sizeByName
  }
  // A shared atlas is one image across every piece, so they all match it.
  for (const mesh of model.meshes) {
    sizeByName[mesh.name] = native
  }
  return sizeByName
}

/** Bakes `initialTextures` into every piece's background layer, per-piece or shared across all of them. */
async function applyInitialTextures(
  rt: ViewportRuntime,
  initialTextures: InitialTexturePayload
): Promise<void> {
  if (isPerPiecePayload(initialTextures)) {
    const pieceMap = initialTextures.pieces || {}
    for (let i = 0; i < rt.pieces.length; i++) {
      const piece = rt.pieces[i]
      const assigned =
        pieceMap[piece.name] || pieceMap[piece.name.toLowerCase()] || pieceMap[String(i)]
      if (!assigned) {
        continue
      }
      await applyPbrTexturesToPiece(rt, piece, assigned)
    }
    return
  }

  const sharedMap = toSharedPbrTextures(initialTextures)
  for (const piece of rt.pieces) {
    await applyPbrTexturesToPiece(rt, piece, sharedMap)
  }
}

export async function loadFromUrl(
  rt: ViewportRuntime,
  url: string,
  extension: string,
  textureSize?: number,
  initialTextures?: InitialTexturePayload | null,
  options: LoadOptions = {}
): Promise<void> {
  if (!rt.sceneHandle) {
    return
  }
  const model = await loadModel(url, extension)
  // Forced: an empty map means every piece falls back to `textureSize`.
  const sizeByName = options.forceTextureSize
    ? {}
    : await resolveSizeByName(model, initialTextures)

  clearCurrentModel(rt)
  rt.currentModel = model
  rt.sceneHandle.scene.add(model.root)
  frameModel(rt, model)
  setupLayers(rt, model, textureSize, sizeByName)
  setupWireframe(rt, model)
  if (!rt.symmetryGuide) {
    rt.symmetryGuide = createSymmetryGuide()
  }
  model.root.add(rt.symmetryGuide.group)
  rt.symmetryGuide.update(brush.symmetryAxis(), model, activeMesh(rt))

  if (initialTextures && rt.pieces.length > 0) {
    try {
      await applyInitialTextures(rt, initialTextures)
      rt.props.onLayersChanged?.()
    } catch (err) {
      console.error('Failed to load initial PBR texture maps:', err)
    }
  }

  if (model.missingUv.length > 0) {
    rt.props.onMissingUv?.(model.missingUv)
  }
}

export async function loadDefaultModel(
  rt: ViewportRuntime,
  textureSize?: number,
  primitive: 'sphere' | 'cube' = 'sphere'
): Promise<void> {
  if (!rt.sceneHandle) {
    return
  }
  const model = createDefaultTestModel(primitive)
  clearCurrentModel(rt)
  rt.currentModel = model
  rt.sceneHandle.scene.add(model.root)
  frameModel(rt, model)
  setupLayers(rt, model, textureSize)
  setupWireframe(rt, model)
  if (!rt.symmetryGuide) {
    rt.symmetryGuide = createSymmetryGuide()
  }
  model.root.add(rt.symmetryGuide.group)
  rt.symmetryGuide.update(brush.symmetryAxis(), model, activeMesh(rt))
  rt.props.onLayersChanged?.()
}

export async function loadProject(
  rt: ViewportRuntime,
  project: MeshCoatProject,
  snapshots: StackSnapshot[],
  /**
   * Re-reading the same model after it was edited on disk: skip any cached
   * copy and leave the camera where the artist had it.
   */
  options: { reload?: boolean } = {}
): Promise<void> {
  if (!rt.sceneHandle) {
    return
  }
  let model: LoadedModel
  if (project.modelPath) {
    let modelPath = project.modelPath
    let ext = modelPath.split('.').pop() || 'glb'
    if (ext.toLowerCase() === 'blend') {
      const res = await window.api.convertBlendFile(modelPath)
      if (!res.success || !res.glbPath) {
        throw new Error(res.error || `Failed to convert ${modelPath} with Blender.`)
      }
      modelPath = res.glbPath
      ext = 'glb'
    }
    // The asset protocol ignores the query, so it only defeats caching.
    const url = window.api.assetUrl(modelPath) + (options.reload ? `?v=${Date.now()}` : '')
    model = await loadModel(url, ext)
  } else {
    model = createDefaultTestModel()
  }
  clearCurrentModel(rt)
  rt.currentModel = model
  rt.sceneHandle.scene.add(model.root)
  if (options.reload) {
    // frameModel also sizes shadows and the brush to the model; keep that
    // without moving the camera.
    const savedPos = rt.sceneHandle.camera.position.clone()
    const savedTarget = rt.sceneHandle.controls.target.clone()
    frameModel(rt, model)
    rt.sceneHandle.controls.setView(savedPos, savedTarget)
  } else {
    frameModel(rt, model)
  }
  const sizeByName: Record<string, number> = {}
  for (const saved of project.pieces ?? []) {
    if (saved.textureSize) {
      sizeByName[saved.name] = saved.textureSize
    }
  }
  setupLayers(rt, model, project.textureSize, sizeByName)
  setupWireframe(rt, model)
  if (!rt.symmetryGuide) {
    rt.symmetryGuide = createSymmetryGuide()
  }
  model.root.add(rt.symmetryGuide.group)
  rt.symmetryGuide.update(brush.symmetryAxis(), model, activeMesh(rt))

  // Saved pieces are matched by name first — a re-exported model can reorder
  // its objects, and restoring a head's layers onto a weapon is unrecoverable.
  // Position is the fallback for older files and for renamed pieces.
  const savedNames = project.pieces?.map((p) => p.name) ?? []
  const taken = new Set<number>()
  rt.pieces.forEach((piece, i) => {
    let saved = savedNames.findIndex((name, si) => name === piece.name && !taken.has(si))
    if (saved < 0 && !taken.has(i) && i < snapshots.length) {
      saved = i
    }
    if (saved < 0 || !snapshots[saved]) {
      return
    }
    taken.add(saved)
    piece.stack.restoreState(snapshots[saved])
  })
  setActivePiece(rt, Math.min(project.activePieceIndex ?? 0, Math.max(0, rt.pieces.length - 1)))
  rt.props.onLayersChanged?.()
}
