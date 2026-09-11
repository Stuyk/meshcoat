import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

export interface LoadedModel {
  root: THREE.Object3D
  meshes: THREE.Mesh[]
  missingUv: string[]
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh)
  })
  return meshes
}

/**
 * Validates UV0 presence per spec section 3, computing tangents (needed by
 * the normal-map paint channel) where missing. Meshes without UVs are
 * reported, not silently skipped, so the caller can flag/reject them.
 */
function processGeometry(meshes: THREE.Mesh[]): string[] {
  const missingUv: string[] = []
  for (const mesh of meshes) {
    const geometry = mesh.geometry
    if (!geometry.attributes.uv) {
      missingUv.push(mesh.name || '(unnamed mesh)')
      continue
    }
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals()
    }
    if (!geometry.attributes.tangent && geometry.index) {
      geometry.computeTangents()
    }
  }
  return missingUv
}

export async function loadModel(fileUrl: string, extension: string): Promise<LoadedModel> {
  const ext = extension.toLowerCase()
  let root: THREE.Object3D

  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(fileUrl)
    root = gltf.scene
  } else if (ext === 'obj') {
    const loader = new OBJLoader()
    root = await loader.loadAsync(fileUrl)
  } else {
    throw new Error(`Unsupported model format: .${ext}`)
  }

  const meshes = collectMeshes(root)
  const missingUv = processGeometry(meshes)
  return { root, meshes, missingUv }
}

/**
 * BoxGeometry is deliberately unsuitable here: three.js gives every face the
 * same 0-1 UV square (fine for a repeating crate texture, but overlapping
 * islands make per-texel world-position painting undefined — whichever face
 * rasterizes last into a shared texel wins). SphereGeometry's equirectangular
 * unwrap has no overlaps, so it's a valid stand-in for a real UV-unwrapped
 * import until one is provided.
 */
export function createDefaultTestModel(): LoadedModel {
  const geometry = new THREE.SphereGeometry(0.6, 48, 32)
  geometry.computeTangents()
  const material = new THREE.MeshStandardMaterial({ color: 0x8888aa, roughness: 0.6, metalness: 0.1 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = 0.6
  mesh.name = 'TestSphere'
  return { root: mesh, meshes: [mesh], missingUv: [] }
}
