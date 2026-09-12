import * as THREE from 'three'

export interface EdgeCurvatureData {
  edgeDistances: Float32Array
  /** Convex (outward ridge) curvature per edge — what chips and wears. */
  edgeCurvatures: Float32Array
  /**
   * Concave (inward valley) curvature per edge — the exact inverse population
   * of edgeCurvatures. These are the interior folds and corners where dirt,
   * grime and ambient shadow collect, and where wear never happens. An edge is
   * in exactly one of the two sets, so a given edge is non-zero in one array
   * and zero in the other.
   */
  edgeConcavities: Float32Array
}

/**
 * Quantizes a 3D coordinate to weld co-located vertices across shared edges,
 * regardless of UV splits or split vertex normals.
 */
function vertexKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`
}

/**
 * Computes the perpendicular distance from point P to the infinite line through A and B.
 */
function pointToSegmentDistance(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const crossX = apy * abz - apz * aby
  const crossY = apz * abx - apx * abz
  const crossZ = apx * aby - apy * abx
  const crossLen = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ)
  const abLen = Math.sqrt(abx * abx + aby * aby + abz * abz)
  return abLen > 1e-7 ? crossLen / abLen : 0
}

/**
 * Analyzes non-indexed mesh geometry and generates:
 * 1. aEdgeDist (3 floats per vertex): perpendicular distance from the vertex to each of the 3 triangle edges in world space.
 * 2. aEdgeCurvature (3 floats per vertex): the convex curvature scalar [0, 1] of each of the 3 triangle edges.
 * 3. aEdgeConcavity (3 floats per vertex): the concave counterpart, for cavity/crevice dirt.
 */
export function computeEdgeCurvature(
  worldPositions: Float32Array,
  triangleCount: number
): EdgeCurvatureData {
  const edgeMap = new Map<string, {
    faceIndices: number[]
    v0: [number, number, number]
    v1: [number, number, number]
  }>()

  const faceNormals: THREE.Vector3[] = new Array(triangleCount)
  const faceCentroids: THREE.Vector3[] = new Array(triangleCount)

  // 1. Compute face normals, centroids, and build undirected edge map
  for (let f = 0; f < triangleCount; f++) {
    const base = f * 9
    const p0 = new THREE.Vector3(worldPositions[base], worldPositions[base + 1], worldPositions[base + 2])
    const p1 = new THREE.Vector3(worldPositions[base + 3], worldPositions[base + 4], worldPositions[base + 5])
    const p2 = new THREE.Vector3(worldPositions[base + 6], worldPositions[base + 7], worldPositions[base + 8])

    const cb = new THREE.Vector3().subVectors(p2, p1)
    const ab = new THREE.Vector3().subVectors(p0, p1)
    const normal = new THREE.Vector3().crossVectors(cb, ab).normalize()
    faceNormals[f] = normal

    const centroid = new THREE.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3)
    faceCentroids[f] = centroid

    // 3 edges per triangle: (p1, p2) opp p0, (p2, p0) opp p1, (p0, p1) opp p2
    const verts: [THREE.Vector3, THREE.Vector3][] = [
      [p1, p2],
      [p2, p0],
      [p0, p1]
    ]

    for (let e = 0; e < 3; e++) {
      const [va, vb] = verts[e]
      const ka = vertexKey(va.x, va.y, va.z)
      const kb = vertexKey(vb.x, vb.y, vb.z)
      if (ka === kb) continue
      const edgeKey = ka < kb ? `${ka}_${kb}` : `${kb}_${ka}`

      let entry = edgeMap.get(edgeKey)
      if (!entry) {
        entry = { faceIndices: [], v0: [va.x, va.y, va.z], v1: [vb.x, vb.y, vb.z] }
        edgeMap.set(edgeKey, entry)
      }
      entry.faceIndices.push(f)
    }
  }

  // 2. Evaluate curvature for each unique edge in edgeMap
  const edgeCurvatureMap = new Map<string, number>()
  const edgeConcavityMap = new Map<string, number>()
  for (const [key, entry] of edgeMap.entries()) {
    if (entry.faceIndices.length === 2) {
      const fA = entry.faceIndices[0]
      const fB = entry.faceIndices[1]
      const nA = faceNormals[fA]
      const nB = faceNormals[fB]
      const cA = faceCentroids[fA]
      const cB = faceCentroids[fB]

      // Angle between normals
      const dot = Math.max(-1, Math.min(1, nA.dot(nB)))

      // Convexity test: vector from centroid A to centroid B
      // For a convex ridge, the outward normal of face A points away from centroid B:
      // (cB - cA) . nA < 0 indicates convex folding.
      const toNeighbor = new THREE.Vector3().subVectors(cB, cA)
      const isConvex = toNeighbor.dot(nA) < 0.0001

      // Curvature scalar: 0 when flat (dot=1), 1 when 90° (dot=0), up to 2 for sharp acute angles.
      // The same magnitude describes both folds; only which way the fold turns differs.
      const curvature = Math.max(0, 1.0 - dot)

      if (isConvex) {
        edgeCurvatureMap.set(key, curvature)
        edgeConcavityMap.set(key, 0)
      } else {
        // Concave crease/valley — wear doesn't chip concave interior corners,
        // but this is exactly where dirt, grime and ambient shadow collect.
        edgeCurvatureMap.set(key, 0)
        edgeConcavityMap.set(key, curvature)
      }
    } else if (entry.faceIndices.length === 1) {
      // Mesh boundary edge / open border — treated as exposed ridge, never a
      // crevice: an open border has no interior fold for dirt to gather in.
      edgeCurvatureMap.set(key, 1.0)
      edgeConcavityMap.set(key, 0)
    } else {
      edgeCurvatureMap.set(key, 0)
      edgeConcavityMap.set(key, 0)
    }
  }

  // 3. Build vertex attributes for triangle distances and edge curvatures
  const vertexCount = triangleCount * 3
  const edgeDistances = new Float32Array(vertexCount * 3)
  const edgeCurvatures = new Float32Array(vertexCount * 3)
  const edgeConcavities = new Float32Array(vertexCount * 3)

  for (let f = 0; f < triangleCount; f++) {
    const base = f * 9
    const p0x = worldPositions[base], p0y = worldPositions[base + 1], p0z = worldPositions[base + 2]
    const p1x = worldPositions[base + 3], p1y = worldPositions[base + 4], p1z = worldPositions[base + 5]
    const p2x = worldPositions[base + 6], p2y = worldPositions[base + 7], p2z = worldPositions[base + 8]

    // Triangle altitudes (height from vertex to opposite edge):
    const h0 = pointToSegmentDistance(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z)
    const h1 = pointToSegmentDistance(p1x, p1y, p1z, p2x, p2y, p2z, p0x, p0y, p0z)
    const h2 = pointToSegmentDistance(p2x, p2y, p2z, p0x, p0y, p0z, p1x, p1y, p1z)

    // Keys for 3 edges:
    const k0 = vertexKey(p0x, p0y, p0z)
    const k1 = vertexKey(p1x, p1y, p1z)
    const k2 = vertexKey(p2x, p2y, p2z)

    const keyE0 = k1 < k2 ? `${k1}_${k2}` : `${k2}_${k1}` // Opposite p0
    const keyE1 = k2 < k0 ? `${k2}_${k0}` : `${k0}_${k2}` // Opposite p1
    const keyE2 = k0 < k1 ? `${k0}_${k1}` : `${k1}_${k0}` // Opposite p2

    const c0 = edgeCurvatureMap.get(keyE0) ?? 0
    const c1 = edgeCurvatureMap.get(keyE1) ?? 0
    const c2 = edgeCurvatureMap.get(keyE2) ?? 0

    const k0c = edgeConcavityMap.get(keyE0) ?? 0
    const k1c = edgeConcavityMap.get(keyE1) ?? 0
    const k2c = edgeConcavityMap.get(keyE2) ?? 0

    // Vertex 0 (opposite edge 0): distance to edge 0 is h0, to edge 1 is 0, to edge 2 is 0
    const v0Offset = (f * 3) * 3
    edgeDistances[v0Offset] = h0
    edgeDistances[v0Offset + 1] = 0
    edgeDistances[v0Offset + 2] = 0
    edgeCurvatures[v0Offset] = c0
    edgeCurvatures[v0Offset + 1] = c1
    edgeCurvatures[v0Offset + 2] = c2
    edgeConcavities[v0Offset] = k0c
    edgeConcavities[v0Offset + 1] = k1c
    edgeConcavities[v0Offset + 2] = k2c

    // Vertex 1 (opposite edge 1): distance to edge 1 is h1
    const v1Offset = (f * 3 + 1) * 3
    edgeDistances[v1Offset] = 0
    edgeDistances[v1Offset + 1] = h1
    edgeDistances[v1Offset + 2] = 0
    edgeCurvatures[v1Offset] = c0
    edgeCurvatures[v1Offset + 1] = c1
    edgeCurvatures[v1Offset + 2] = c2
    edgeConcavities[v1Offset] = k0c
    edgeConcavities[v1Offset + 1] = k1c
    edgeConcavities[v1Offset + 2] = k2c

    // Vertex 2 (opposite edge 2): distance to edge 2 is h2
    const v2Offset = (f * 3 + 2) * 3
    edgeDistances[v2Offset] = 0
    edgeDistances[v2Offset + 1] = 0
    edgeDistances[v2Offset + 2] = h2
    edgeCurvatures[v2Offset] = c0
    edgeCurvatures[v2Offset + 1] = c1
    edgeCurvatures[v2Offset + 2] = c2
    edgeConcavities[v2Offset] = k0c
    edgeConcavities[v2Offset + 1] = k1c
    edgeConcavities[v2Offset + 2] = k2c
  }

  return { edgeDistances, edgeCurvatures, edgeConcavities }
}
