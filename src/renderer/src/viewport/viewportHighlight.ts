import * as THREE from 'three'
import { brush } from '../paint/brush'
import type { FaceProjectionOptions } from '../paint/paintEngine'
import { createFacePreviewMaterial } from '../paint/facePreviewShader'
import { activeMesh } from './viewportPieces'
import type { ViewportRuntime } from './viewportRuntime'

/** Rebuilds the selection outline — draws ONLY perimeter boundary edges with depth test. */
export function updateHighlight(rt: ViewportRuntime): void {
  const highlightMesh = rt.highlightMesh
  const facePositions = rt.facePositions
  if (!highlightMesh || !facePositions) {
    return
  }
  const faces = brush.selectedFaces()

  // Wash first: one triangle per selected face, rebuilt from the same set the
  // boundary-edge pass below walks.
  const selectionFillMesh = rt.selectionFillMesh
  if (selectionFillMesh) {
    const fill = new Float32Array(faces.size * 9)
    let at = 0
    for (const face of faces) {
      const base = face * 9
      if (base < 0 || base + 9 > facePositions.length) {
        continue
      }
      fill.set(facePositions.subarray(base, base + 9), at)
      at += 9
    }
    selectionFillMesh.geometry.setAttribute('position', new THREE.BufferAttribute(fill, 3))
    selectionFillMesh.geometry.attributes.position.needsUpdate = true
    selectionFillMesh.visible = faces.size > 0
  }

  if (faces.size === 0) {
    highlightMesh.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(0), 3)
    )
    highlightMesh.geometry.attributes.position.needsUpdate = true
    return
  }

  // Map each undirected edge to count and coordinates.
  // Quantize vertex coordinates to 4 decimals to weld co-located vertices across shared edges.
  const edgeMap = new Map<
    string,
    { count: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
  >()

  const toKey = (x: number, y: number, z: number): string =>
    `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`

  const addEdge = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ): void => {
    const k0 = toKey(x0, y0, z0)
    const k1 = toKey(x1, y1, z1)
    if (k0 === k1) {
      return
    } // degenerate zero-length edge
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
    if (base < 0 || base + 9 > facePositions.length) {
      continue
    }
    const v0x = facePositions[base],
      v0y = facePositions[base + 1],
      v0z = facePositions[base + 2]
    const v1x = facePositions[base + 3],
      v1y = facePositions[base + 4],
      v1z = facePositions[base + 5]
    const v2x = facePositions[base + 6],
      v2y = facePositions[base + 7],
      v2z = facePositions[base + 8]

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
  const finalCoords =
    boundaryCoords.length === 0 && faces.size > 0
      ? Array.from(edgeMap.values()).flatMap((e) => [e.x0, e.y0, e.z0, e.x1, e.y1, e.z1])
      : boundaryCoords

  const out = new Float32Array(finalCoords)
  highlightMesh.geometry.setAttribute('position', new THREE.BufferAttribute(out, 3))
  highlightMesh.geometry.attributes.position.needsUpdate = true
}

/**
 * Live preview of the Face UV Projector: shows, on the selected faces
 * themselves, exactly what "Apply to Selection" would bake — the shelf
 * texture under the current crop region AND projector offset/scale/rotation
 * combined (see facePreviewShader.ts, which mirrors the fill branch of
 * paintShader.ts). Rebuilt whenever the selection changes; its uniforms are
 * refreshed independently whenever the texture/region/projection change.
 */
export function updateProjectorPreview(rt: ViewportRuntime): void {
  const projectorPreviewMesh = rt.projectorPreviewMesh
  const facePositions = rt.facePositions
  const faceUVs = rt.faceUVs
  const faceNormals = rt.faceNormals
  if (!projectorPreviewMesh || !facePositions || !faceUVs || !faceNormals) {
    return
  }
  const faces = brush.selectedFaces()
  // Its own tool, not folded into Face Select or Fill: those tools' click
  // behavior (paint, or start a fill drag) conflicts with "click a face to
  // preview & place a texture on it" — see the toolbar button's comment.
  const tool = rt.props.tool()
  const visible =
    (tool === 'faceProjector' || tool === 'text') && faces.size > 0 && !!brush.texturePath()

  rt.setProjectorPreviewActive(visible)

  if (!visible) {
    projectorPreviewMesh.visible = false
    // A plain wash reads fine on its own; once a preview is available it
    // would otherwise double up with (and dull) the actual texture.
    if (rt.selectionFillMesh) {
      rt.selectionFillMesh.visible = faces.size > 0
    }
    return
  }

  const positions = new Float32Array(faces.size * 9)
  const uvs = new Float32Array(faces.size * 6)
  const normals = new Float32Array(faces.size * 9)
  let atPos = 0
  let atUv = 0
  for (const face of faces) {
    const posBase = face * 9
    const uvBase = face * 6
    if (posBase < 0 || posBase + 9 > facePositions.length) {
      continue
    }
    if (uvBase < 0 || uvBase + 6 > faceUVs.length) {
      continue
    }
    if (posBase + 9 > faceNormals.length) {
      continue
    }
    positions.set(facePositions.subarray(posBase, posBase + 9), atPos)
    uvs.set(faceUVs.subarray(uvBase, uvBase + 6), atUv)
    // Normals share the triangle layout of positions (3 floats x 3 verts).
    normals.set(faceNormals.subarray(posBase, posBase + 9), atPos)
    atPos += 9
    atUv += 6
  }
  projectorPreviewMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  projectorPreviewMesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  projectorPreviewMesh.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  projectorPreviewMesh.geometry.attributes.position.needsUpdate = true
  projectorPreviewMesh.geometry.attributes.uv.needsUpdate = true
  projectorPreviewMesh.geometry.attributes.normal.needsUpdate = true
  projectorPreviewMesh.visible = true
  // The wash would otherwise tint straight over the textured preview.
  if (rt.selectionFillMesh) {
    rt.selectionFillMesh.visible = false
  }

  updateProjectorPreviewUniforms(rt)
}

/**
 * A selected face is often tiny on screen relative to the whole texture, so
 * the GPU's own minification picks a heavily-downsampled mip level for it —
 * averaged down to a single dark-ish blob on a busy/dark source texture,
 * which is what read as "the preview is nearly pitch black" even after
 * fixing the alpha/tone-mapping/z-fight issues above. A cloned, mipmap-less
 * copy of the same image forces full-resolution sampling instead, so the
 * preview always reads at the texture's real color regardless of how small
 * the selection is on screen. Cloned (not mutated in place) because
 * `brushTexture` is shared with every other paint tool, which still wants
 * normal mipmapping.
 */
export function getPreviewTexture(
  rt: ViewportRuntime,
  source: THREE.Texture | null
): THREE.Texture | null {
  if (!source) {
    rt.previewTextureClone?.dispose()
    rt.previewTextureSource = null
    rt.previewTextureClone = null
    return null
  }
  if (rt.previewTextureSource === source && rt.previewTextureClone) {
    return rt.previewTextureClone
  }
  rt.previewTextureClone?.dispose()
  rt.previewTextureSource = source
  rt.previewTextureClone = source.clone()
  rt.previewTextureClone.generateMipmaps = false
  rt.previewTextureClone.minFilter = THREE.LinearFilter
  rt.previewTextureClone.needsUpdate = true
  return rt.previewTextureClone
}

/**
 * UV-space bounding box of a face selection — the box the projector's "Fit
 * to selection" mode stretches one copy of the crop across. Returns null
 * when the selection has no area in UV (a degenerate unwrap), which the
 * shader treats as "not fitting" rather than dividing by ~zero.
 */
export function selectionUvBounds(
  rt: ViewportRuntime,
  faces: ReadonlySet<number>
): { x: number; y: number; w: number; h: number } | null {
  const faceUVs = rt.faceUVs
  if (!faceUVs || faces.size === 0) {
    return null
  }
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const face of faces) {
    const base = face * 6
    if (base < 0 || base + 6 > faceUVs.length) {
      continue
    }
    for (let i = 0; i < 6; i += 2) {
      const u = faceUVs[base + i]
      const v = faceUVs[base + i + 1]
      if (u < minU) {
        minU = u
      }
      if (u > maxU) {
        maxU = u
      }
      if (v < minV) {
        minV = v
      }
      if (v > maxV) {
        maxV = v
      }
    }
  }
  const w = maxU - minU
  const h = maxV - minV
  if (!isFinite(w) || !isFinite(h) || w < 1e-6 || h < 1e-6) {
    return null
  }
  return { x: minU, y: minV, w, h }
}

/** The projector transform plus the fit box for the faces it will land on. */
export function faceProjectionOptions(
  rt: ViewportRuntime,
  faces: ReadonlySet<number>
): FaceProjectionOptions {
  const proj = brush.faceProjection()
  const fitRect = proj.fit ? (selectionUvBounds(rt, faces) ?? undefined) : undefined
  if (!fitRect) {
    return { ...proj, fitRect: undefined }
  }
  // The shader scales the UV, so a bigger number there means the texture
  // covers MORE uv and therefore looks smaller. That inversion is invisible
  // in tile mode (where the slider reads as "how much UV per copy") but
  // backwards in fit mode, where the artist is sizing a single visible decal.
  // Invert here so "Scale X up" makes the decal bigger.
  // Offset has the same inversion for the same reason: it shifts the UV the
  // texture is read from, so a positive value slides the image the other way.
  return {
    ...proj,
    offsetX: -proj.offsetX,
    offsetY: -proj.offsetY,
    scaleX: 1 / Math.max(proj.scaleX, 0.01),
    scaleY: 1 / Math.max(proj.scaleY, 0.01),
    fitRect
  }
}

/** Pushes texture + crop-region + projector-transform state into the preview material, without touching geometry. */
export function updateProjectorPreviewUniforms(rt: ViewportRuntime): void {
  const projectorPreviewMesh = rt.projectorPreviewMesh
  if (!projectorPreviewMesh) {
    return
  }
  const material = projectorPreviewMesh.material as ReturnType<typeof createFacePreviewMaterial>
  const u = material.uniforms
  material.setPreviewTexture(getPreviewTexture(rt, rt.brushTexture))
  u.uFillScale.value = brush.textureScale()

  // The preview sits directly on top of the model's own faces, so it has to
  // shade with the same PBR response — otherwise a glossy surface gets a
  // matte patch (or vice versa) exactly where the artist is judging the fill.
  const target = activeMesh(rt)
  const shaded = (Array.isArray(target?.material) ? target.material[0] : target?.material) as
    THREE.MeshStandardMaterial | undefined
  if (shaded) {
    material.roughness = shaded.roughness
    material.metalness = shaded.metalness
    material.envMapIntensity = shaded.envMapIntensity
  }

  const region = brush.textureRegion()
  u.uTextureRegion.value.set(region.x, 1 - region.y - region.h, region.w, region.h)
  u.uTextureRegionRotation.value = (region.rotation * Math.PI) / 180

  const proj = faceProjectionOptions(rt, brush.selectedFaces())
  u.uProjOffset.value.set(proj.offsetX, proj.offsetY)
  u.uProjScale.value.set(proj.scaleX, proj.scaleY)
  u.uProjRotation.value = (proj.rotation * Math.PI) / 180
  // Same guard as the bake path: fit without a usable box falls back to tiling.
  u.uFillFit.value = proj.fitRect ? 1 : 0
  if (proj.fitRect) {
    u.uFitRect.value.set(proj.fitRect.x, proj.fitRect.y, proj.fitRect.w, proj.fitRect.h)
  }

  const repeat = brush.textureRepeat()
  u.uRepeatMode.value = repeat === 'once' ? 2 : repeat === 'mirror' ? 1 : 0
}
