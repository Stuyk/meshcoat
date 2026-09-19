import * as THREE from 'three'

export interface NavCubeHandle {
  renderer: THREE.WebGLRenderer
  render: (mainCamera: THREE.Camera) => void
  resize: (size: number) => void
  /**
   * The face under a point on the cube's canvas, as the world direction from
   * the orbit target to where the camera should sit to look at that side —
   * or null when the click missed the cube.
   */
  pickFace: (clientX: number, clientY: number) => THREE.Vector3 | null
  dispose: () => void
}

const FACE_LABELS = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK']

function makeFaceTexture(label: string): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#3f3f46'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#71717a'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, size - 6, size - 6)
  ctx.fillStyle = '#e4e4e7'
  ctx.font = 'bold 34px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, size / 2, size / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Small orbiting nav cube for the viewport's top-right corner (Blender/Max
 * "view cube" style). Rendered with its own tiny scene/camera/renderer into a
 * dedicated canvas, so it never touches the main scene graph.
 */
export function createNavCube(canvas: HTMLCanvasElement, size: number): NavCubeHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(size, size, false)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10)
  camera.position.set(0, 0, 4)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 1.2))
  const key = new THREE.DirectionalLight(0xffffff, 0.6)
  key.position.set(1, 2, 3)
  scene.add(key)

  const materials = FACE_LABELS.map(
    (label) => new THREE.MeshBasicMaterial({ map: makeFaceTexture(label) })
  )
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), materials)
  scene.add(cube)

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x18181b })
  )
  cube.add(edges)

  const inverseQuat = new THREE.Quaternion()
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()

  return {
    renderer,
    render: (mainCamera: THREE.Camera) => {
      inverseQuat.copy(mainCamera.quaternion).invert()
      cube.quaternion.copy(inverseQuat)
      renderer.render(scene, camera)
    },
    resize: (newSize: number) => {
      renderer.setSize(newSize, newSize, false)
    },
    pickFace: (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(cube, false)[0]
      // The cube carries the inverse camera rotation, so a face's normal in
      // the cube's own (unrotated) space is exactly the world direction the
      // camera looks from when that face is square to the screen.
      return hit?.face ? hit.face.normal.clone() : null
    },
    dispose: () => {
      materials.forEach((m) => {
        m.map?.dispose()
        m.dispose()
      })
      cube.geometry.dispose()
      edges.geometry.dispose()
      ;(edges.material as THREE.Material).dispose()
      renderer.dispose()
    }
  }
}
