import * as THREE from 'three'

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
  // Every piece becomes its own texture set, and the UI addresses them by name —
  // an unnamed mesh (common in OBJ exports) still needs something to point at.
  meshes.forEach((mesh, i) => {
    if (!mesh.name) mesh.name = `Piece ${i + 1}`
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

  // Dynamically imported so GLTFLoader/OBJLoader (Draco/KTX2/meshopt support
  // included) aren't parsed at boot — the default model never needs them,
  // only an actual file import does.
  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(fileUrl)
    root = gltf.scene
  } else if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
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
 * Standard Three.js BoxGeometry gives every face the identical 0..1 UV coordinates,
 * which makes painting any single face paint all 6 faces simultaneously.
 * Here we construct a custom non-overlapping 3x2 UV layout for the 6 faces.
 */
export function createUnwrappedBoxGeometry(size = 1): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(size, size, size)
  const uvs = new Float32Array(24 * 2)
  for (let face = 0; face < 6; face++) {
    const col = face % 3
    const row = Math.floor(face / 3)
    const uMin = col / 3
    const uMax = (col + 1) / 3
    const vMin = row / 2
    const vMax = (row + 1) / 2
    const base = face * 8
    uvs[base + 0] = uMin
    uvs[base + 1] = vMax
    uvs[base + 2] = uMax
    uvs[base + 3] = vMax
    uvs[base + 4] = uMin
    uvs[base + 5] = vMin
    uvs[base + 6] = uMax
    uvs[base + 7] = vMin
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.computeTangents()
  return geometry
}

export function createDefaultTestModel(primitive: 'sphere' | 'cube' = 'sphere'): LoadedModel {
  const geometry =
    primitive === 'cube' ? createUnwrappedBoxGeometry(1) : new THREE.SphereGeometry(0.6, 48, 32)
  geometry.computeTangents()
  const material = new THREE.MeshStandardMaterial({ color: 0x8888aa, roughness: 0.6, metalness: 0.1 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = primitive === 'cube' ? 0.5 : 0.6
  mesh.name = primitive === 'cube' ? 'TestCube' : 'TestSphere'
  return { root: mesh, meshes: [mesh], missingUv: [] }
}

