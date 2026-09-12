import * as THREE from 'three'

/**
 * Renders the scene's depth from the paint camera into an offscreen target so
 * paintShader.ts can reject fragments that aren't actually visible from that
 * camera (e.g. a face directly behind the one under the brush) — the same
 * technique as a shadow map, but testing camera visibility instead of light
 * visibility. Reuses the existing scene/camera (via `overrideMaterial`)
 * rather than re-adding meshes to a temporary scene, which would reparent
 * them out of the real one.
 */
const DEPTH_TARGET_SIZE = 1024

export class OcclusionDepthPass {
  private target: THREE.WebGLRenderTarget
  private overrideMaterial = new THREE.MeshBasicMaterial()

  constructor() {
    this.target = new THREE.WebGLRenderTarget(DEPTH_TARGET_SIZE, DEPTH_TARGET_SIZE, {
      depthBuffer: true
    })
    this.target.depthTexture = new THREE.DepthTexture(DEPTH_TARGET_SIZE, DEPTH_TARGET_SIZE)
    this.target.depthTexture.type = THREE.UnsignedIntType
  }

  get depthTexture(): THREE.DepthTexture {
    return this.target.depthTexture!
  }

  /** Captures current camera-space depth of `scene` into the depth texture. */
  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const prevTarget = renderer.getRenderTarget()
    const prevOverride = scene.overrideMaterial
    scene.overrideMaterial = this.overrideMaterial
    renderer.setRenderTarget(this.target)
    renderer.render(scene, camera)
    renderer.setRenderTarget(prevTarget)
    scene.overrideMaterial = prevOverride
  }

  dispose(): void {
    this.target.dispose()
    this.overrideMaterial.dispose()
  }
}
