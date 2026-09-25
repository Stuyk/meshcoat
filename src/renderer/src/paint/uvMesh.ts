import * as THREE from 'three'
import { computeEdgeCurvature } from './edgeCurvature'

/**
 * Builds the UV-flattened representation of a mesh (spec section 4.1): a
 * clone whose vertex positions are replaced by their UV0 coordinates
 * (x=uv.x*2-1, y=uv.y*2-1, z=0), unwrapping the mesh flat into NDC space so
 * rasterizing it writes each triangle directly at its correct texel
 * location. World position/normal are kept as extra attributes (baked once
 * from the mesh's current world matrix) so the paint shader can compare
 * every texel against the brush hit without a separate bake pass.
 */
export function buildUvMesh(mesh: THREE.Mesh): THREE.Mesh {
  // Bake world-space attributes off mesh.matrixWorld, which is only kept
  // current by the render loop — force it up to date now so painting works
  // even before the first frame has rendered (e.g. right after model import).
  mesh.updateWorldMatrix(true, false)

  // Expand to non-indexed first: a welded OBJ can share one vertex index
  // across triangles that belong to different UV islands. Flattening with
  // that shared index reuses a single UV for corners that actually need
  // different ones, producing degenerate/overlapping slivers at island
  // seams — the source of the black seam-line artifact. Giving every
  // triangle corner its own unshared vertex/UV fixes it.
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const uv = source.attributes.uv
  if (!uv) {
    throw new Error('Mesh is missing UV0 — cannot build paint target')
  }

  const geometry = new THREE.BufferGeometry()

  const vertexCount = uv.count
  const flatPositions = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    flatPositions[i * 3] = uv.getX(i) * 2 - 1
    flatPositions[i * 3 + 1] = uv.getY(i) * 2 - 1
    flatPositions[i * 3 + 2] = 0
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(flatPositions, 3))
  geometry.setAttribute('uv', uv.clone())

  const worldPos = new Float32Array(vertexCount * 3)
  const worldNormal = new Float32Array(vertexCount * 3)
  const p = new THREE.Vector3()
  const positionAttr = source.attributes.position

  for (let i = 0; i < vertexCount; i++) {
    p.fromBufferAttribute(positionAttr, i).applyMatrix4(mesh.matrixWorld)
    worldPos[i * 3] = p.x
    worldPos[i * 3 + 1] = p.y
    worldPos[i * 3 + 2] = p.z
  }

  // Flat per-triangle face normal (from the actual triangle's world
  // positions), not the imported per-vertex normal. A welded mesh can share
  // one smoothed normal across a hard edge; interpolating that across the
  // triangle sweeps through directions that fail the paint shader's facing
  // test (paintShader.ts) for a thin band near every edge, showing up as an
  // unpainted line tracing every face. A flat face normal is constant across
  // the triangle, so the facing test is either fully on or fully off there —
  // no half-painted edge band.
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()
  for (let i = 0; i + 2 < vertexCount; i += 3) {
    a.set(worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2])
    b.set(worldPos[(i + 1) * 3], worldPos[(i + 1) * 3 + 1], worldPos[(i + 1) * 3 + 2])
    c.set(worldPos[(i + 2) * 3], worldPos[(i + 2) * 3 + 1], worldPos[(i + 2) * 3 + 2])
    faceNormal.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize()
    for (let corner = 0; corner < 3; corner++) {
      const vi = i + corner
      worldNormal[vi * 3] = faceNormal.x
      worldNormal[vi * 3 + 1] = faceNormal.y
      worldNormal[vi * 3 + 2] = faceNormal.z
    }
  }

  // Per-face world-space UV tangent frame, needed by the normal-map paint
  // channel: a dab computes its bump direction in the *brush's* tangent frame
  // (which follows the cursor and rotates with the stroke), but a tangent-space
  // normal map has to be stored in the *mesh's* UV frame or the lighting reads
  // it as pointing somewhere else entirely.
  //
  // Derived here from the triangle's own world positions and UVs rather than
  // read off geometry.attributes.tangent: computeTangents() only runs for
  // indexed geometry (see modelLoader.ts) and throws on non-indexed, while this
  // works for every mesh that has UVs at all — which is already a hard
  // requirement above. Constant per triangle, matching the flat face normal
  // convention used for aWorldNormal for the same reason.
  const faceTangent = new Float32Array(vertexCount * 3)
  const faceBitangent = new Float32Array(vertexCount * 3)
  {
    const e1 = new THREE.Vector3()
    const e2 = new THREE.Vector3()
    const t = new THREE.Vector3()
    const bt = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (let i = 0; i + 2 < vertexCount; i += 3) {
      a.set(worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2])
      b.set(worldPos[(i + 1) * 3], worldPos[(i + 1) * 3 + 1], worldPos[(i + 1) * 3 + 2])
      c.set(worldPos[(i + 2) * 3], worldPos[(i + 2) * 3 + 1], worldPos[(i + 2) * 3 + 2])
      e1.subVectors(b, a)
      e2.subVectors(c, a)
      const du1 = uv.getX(i + 1) - uv.getX(i)
      const dv1 = uv.getY(i + 1) - uv.getY(i)
      const du2 = uv.getX(i + 2) - uv.getX(i)
      const dv2 = uv.getY(i + 2) - uv.getY(i)
      const det = du1 * dv2 - du2 * dv1
      n.set(worldNormal[i * 3], worldNormal[i * 3 + 1], worldNormal[i * 3 + 2])
      if (Math.abs(det) < 1e-12) {
        // Degenerate UVs (a zero-area island): any stable frame will do — the
        // texels of such a triangle cover no area to look wrong in.
        const up = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
        t.crossVectors(up, n).normalize()
      } else {
        const r = 1 / det
        t.copy(e1)
          .multiplyScalar(dv2 * r)
          .addScaledVector(e2, -dv1 * r)
        // Gram-Schmidt against the face normal, then normalize.
        t.addScaledVector(n, -n.dot(t))
        if (t.lengthSq() < 1e-18) {
          const up = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
          t.crossVectors(up, n)
        }
        t.normalize()
      }
      bt.crossVectors(n, t).normalize()
      for (let corner = 0; corner < 3; corner++) {
        const vi = i + corner
        faceTangent[vi * 3] = t.x
        faceTangent[vi * 3 + 1] = t.y
        faceTangent[vi * 3 + 2] = t.z
        faceBitangent[vi * 3] = bt.x
        faceBitangent[vi * 3 + 1] = bt.y
        faceBitangent[vi * 3 + 2] = bt.z
      }
    }
  }
  geometry.setAttribute('aSurfaceTangent', new THREE.BufferAttribute(faceTangent, 3))
  geometry.setAttribute('aSurfaceBitangent', new THREE.BufferAttribute(faceBitangent, 3))

  // One id per triangle (repeated across its 3 corners), matching the raycast
  // hit's faceIndex against the same (post-toNonIndexed) mesh — lets the paint
  // shader restrict a stroke or fill to a single picked face (spec: face
  // selection / paint-within-face).
  const faceId = new Float32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    faceId[i] = Math.floor(i / 3)
  }
  geometry.setAttribute('aFaceId', new THREE.BufferAttribute(faceId, 1))

  // 1.0 on every vertex of a selected triangle, 0.0 elsewhere — PaintEngine
  // rewrites this per stroke/fill from the current face selection so the
  // shader can mask by it directly instead of comparing ids per-fragment
  // (which only supports one face at a time).
  geometry.setAttribute('aSelected', new THREE.BufferAttribute(new Float32Array(vertexCount), 1))

  geometry.setAttribute('aWorldPosition', new THREE.BufferAttribute(worldPos, 3))
  geometry.setAttribute('aWorldNormal', new THREE.BufferAttribute(worldNormal, 3))

  const triangleCount = Math.floor(vertexCount / 3)
  const { edgeDistances, edgeCurvatures, edgeConcavities } = computeEdgeCurvature(
    worldPos,
    triangleCount
  )
  geometry.setAttribute('aEdgeDist', new THREE.BufferAttribute(edgeDistances, 3))
  geometry.setAttribute('aEdgeCurvature', new THREE.BufferAttribute(edgeCurvatures, 3))
  geometry.setAttribute('aEdgeConcavity', new THREE.BufferAttribute(edgeConcavities, 3))

  const flatMesh = new THREE.Mesh(geometry)
  flatMesh.frustumCulled = false
  return flatMesh
}

/** Per-geometry island id for every triangle, built on first pick. */
const islandCache = new WeakMap<THREE.BufferGeometry, Int32Array>()

function findRoot(parent: Int32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]]
    x = parent[x]
  }
  return x
}

/**
 * Labels every triangle with a UV island id. Two triangles belong to the same
 * island when they share an EDGE whose endpoints match in both position and
 * UV — a seam (same position, different UV) splits islands, and so does two
 * islands merely touching at a corner or overlapping in UV space (mirrored
 * halves), which a shared-UV-coordinate test would wrongly weld together.
 *
 * Triangle numbering follows SurfaceHit.faceIndex: the index buffer's order
 * for indexed geometry (what the display mesh usually is), vertex order
 * otherwise.
 */
function buildIslandIds(geometry: THREE.BufferGeometry): Int32Array | null {
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!uvAttr || !posAttr) {
    return null
  }
  const index = geometry.index
  const faceCount = Math.floor((index ? index.count : posAttr.count) / 3)
  const vertexOf = (corner: number): number => (index ? index.getX(corner) : corner)

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  const size = geometry.boundingBox!.getSize(new THREE.Vector3())
  const posScale = 1e5 / Math.max(size.x, size.y, size.z, 1e-6)
  const uvScale = 1e5

  // One key per distinct (position, uv) corner, so welded and unwelded
  // meshes behave the same.
  const vertexKey = new Map<string, number>()
  const cornerId = (v: number): number => {
    const key =
      `${Math.round(posAttr.getX(v) * posScale)},${Math.round(posAttr.getY(v) * posScale)},` +
      `${Math.round(posAttr.getZ(v) * posScale)}|` +
      `${Math.round(uvAttr.getX(v) * uvScale)},${Math.round(uvAttr.getY(v) * uvScale)}`
    let id = vertexKey.get(key)
    if (id === undefined) {
      id = vertexKey.size
      vertexKey.set(key, id)
    }
    return id
  }

  const parent = new Int32Array(faceCount)
  for (let f = 0; f < faceCount; f++) {
    parent[f] = f
  }
  const edgeOwner = new Map<string, number>()
  for (let f = 0; f < faceCount; f++) {
    const ids = [cornerId(vertexOf(f * 3)), cornerId(vertexOf(f * 3 + 1)), cornerId(vertexOf(f * 3 + 2))]
    for (let k = 0; k < 3; k++) {
      const a = ids[k]
      const b = ids[(k + 1) % 3]
      if (a === b) {
        continue
      }
      const edge = a < b ? `${a}_${b}` : `${b}_${a}`
      const other = edgeOwner.get(edge)
      if (other === undefined) {
        edgeOwner.set(edge, f)
        continue
      }
      const ra = findRoot(parent, f)
      const rb = findRoot(parent, other)
      if (ra !== rb) {
        parent[ra] = rb
      }
    }
  }
  for (let f = 0; f < faceCount; f++) {
    parent[f] = findRoot(parent, f)
  }
  return parent
}

/**
 * Computes all face indices belonging to the same contiguous UV island as startFaceIndex.
 */
export function findUvIslandFaces(
  geometry: THREE.BufferGeometry,
  startFaceIndex: number
): number[] {
  let ids = islandCache.get(geometry)
  if (!ids) {
    const built = buildIslandIds(geometry)
    if (!built) {
      return [startFaceIndex]
    }
    ids = built
    islandCache.set(geometry, ids)
  }
  if (startFaceIndex < 0 || startFaceIndex >= ids.length) {
    return [startFaceIndex]
  }
  const target = ids[startFaceIndex]
  const island: number[] = []
  for (let f = 0; f < ids.length; f++) {
    if (ids[f] === target) {
      island.push(f)
    }
  }
  return island
}
