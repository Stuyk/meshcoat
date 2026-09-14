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

/**
 * Computes all face indices belonging to the same contiguous UV island as startFaceIndex.
 * Connects triangles that share vertex UV coordinates within a precision tolerance.
 */
export function findUvIslandFaces(
  geometry: THREE.BufferGeometry,
  startFaceIndex: number
): number[] {
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uvAttr) {
    return [startFaceIndex]
  }

  const totalFaces = Math.floor(uvAttr.count / 3)
  if (startFaceIndex < 0 || startFaceIndex >= totalFaces) {
    return [startFaceIndex]
  }

  // Map each quantized UV coordinate to face indices containing it
  const uvToFaces = new Map<string, number[]>()
  const uvKey = (u: number, v: number) => `${Math.round(u * 8000)}_${Math.round(v * 8000)}`

  for (let f = 0; f < totalFaces; f++) {
    const base = f * 3
    for (let k = 0; k < 3; k++) {
      const key = uvKey(uvAttr.getX(base + k), uvAttr.getY(base + k))
      let list = uvToFaces.get(key)
      if (!list) {
        list = []
        uvToFaces.set(key, list)
      }
      list.push(f)
    }
  }

  // Flood fill / BFS from startFaceIndex
  const island = new Set<number>([startFaceIndex])
  const queue: number[] = [startFaceIndex]

  const visitNeighbor = (n: number): void => {
    if (island.has(n)) {
      return
    }
    island.add(n)
    queue.push(n)
  }

  while (queue.length > 0) {
    const curr = queue.pop()!
    const base = curr * 3
    for (let k = 0; k < 3; k++) {
      const key = uvKey(uvAttr.getX(base + k), uvAttr.getY(base + k))
      const neighbors = uvToFaces.get(key)
      if (!neighbors) {
        continue
      }
      neighbors.forEach(visitNeighbor)
    }
  }

  return Array.from(island)
}
