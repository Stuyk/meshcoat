import * as THREE from 'three'

export interface NavCubeHandle {
  render: (mainCamera: THREE.Camera) => void
  /**
   * The face under a point on the cube's element, as the world direction from
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
 * "view cube" style). It has its own tiny scene and camera, so it never touches
 * the main scene graph, but it draws with the viewport's renderer into the
 * patch of the main canvas under `host` (a plain element that only takes the
 * pointer) — a second WebGL context just for a 108px cube cost a whole extra
 * GPU context, drawing buffer and copy of every shader it compiled.
 */
export function createNavCube(renderer: THREE.WebGLRenderer, host: HTMLElement): NavCubeHandle {
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10)
  camera.position.set(0, 0, 4)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 1.2))
  const key = new THREE.DirectionalLight(0xffffff, 0.6)
  key.position.set(1, 2, 3)
  scene.add(key)

  // toneMapped off: the viewport renderer runs ACES, and the cube's flat UI
  // colours should come out exactly as drawn.
  const materials = FACE_LABELS.map(
    (label) => new THREE.MeshBasicMaterial({ map: makeFaceTexture(label), toneMapped: false })
  )
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), materials)
  scene.add(cube)

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x18181b, toneMapped: false })
  )
  cube.add(edges)

  const inverseQuat = new THREE.Quaternion()
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const savedViewport = new THREE.Vector4()

  return {
    render: (mainCamera: THREE.Camera) => {
      const canvasRect = renderer.domElement.getBoundingClientRect()
      const rect = host.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        return
      }
      inverseQuat.copy(mainCamera.quaternion).invert()
      cube.quaternion.copy(inverseQuat)
      // Viewport/scissor are in CSS pixels from the canvas's bottom-left.
      const x = rect.left - canvasRect.left
      const y = canvasRect.bottom - rect.bottom
      renderer.getViewport(savedViewport)
      const prevAutoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.setScissorTest(true)
      renderer.setScissor(x, y, rect.width, rect.height)
      renderer.setViewport(x, y, rect.width, rect.height)
      // Depth only: the cube floats over whatever the viewport drew there.
      renderer.clearDepth()
      renderer.render(scene, camera)
      renderer.setScissorTest(false)
      renderer.setViewport(savedViewport)
      renderer.autoClear = prevAutoClear
    },
    pickFace: (clientX: number, clientY: number) => {
      const rect = host.getBoundingClientRect()
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
    }
  }
}
