import * as THREE from 'three'

export interface SurfaceHit {
  /**
   * The mesh the ray actually landed on. A model with several pieces gives each
   * one its own layer stack and its own 0-1 UV square, so `uv`/`faceIndex` only
   * mean anything paired with the mesh they were picked from. Absent on hits
   * that are synthesized rather than picked (line interpolation, symmetry),
   * which always belong to the piece being painted.
   */
  mesh?: THREE.Mesh
  point: THREE.Vector3
  normal: THREE.Vector3
  uv: THREE.Vector2
  /** Triangle index within the hit mesh's geometry (post-toNonIndexed numbering — see uvMesh.ts's aFaceId). */
  faceIndex: number
}

const raycaster = new THREE.Raycaster()

/** Raycasts the pointer against the given meshes; returns world pos/normal/uv (spec section 4.2). */
export function raycastMeshes(
  ndcX: number,
  ndcY: number,
  camera: THREE.Camera,
  meshes: THREE.Mesh[]
): SurfaceHit | null {
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
  const hits = raycaster.intersectObjects(meshes, false)
  const hit = hits[0]
  if (!hit || !hit.face || !hit.uv || hit.faceIndex == null) {
    return null
  }

  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
  return {
    mesh: hit.object as THREE.Mesh,
    point: hit.point.clone(),
    normal,
    uv: hit.uv.clone(),
    faceIndex: hit.faceIndex
  }
}

export function screenToNdc(
  clientX: number,
  clientY: number,
  element: HTMLElement
): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  const x = ((clientX - rect.left) / rect.width) * 2 - 1
  const y = -((clientY - rect.top) / rect.height) * 2 + 1
  return { x, y }
}
