import * as THREE from 'three'
import type { LoadedModel } from './modelLoader'
import type { SymmetryAxis } from '../paint/brush'

export interface GizmoHandle {
  group: THREE.Group
  brushRing: THREE.Mesh
  eyedropperReticle: THREE.Group
  bucketReticle: THREE.Group
  stampReticle: THREE.Group
  brushTipMesh: THREE.Mesh
  brushTipMaterial: THREE.ShaderMaterial
  stampPreviewMesh: THREE.Mesh
  stampPreviewMaterial: THREE.MeshBasicMaterial
  mirrorGroup: THREE.Group
  mirrorBrushRing: THREE.Mesh
  mirrorBrushTipMesh: THREE.Mesh
  mirrorStampPreviewMesh: THREE.Mesh
}

const brushOutlineVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const brushOutlineFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  uniform vec4 uRegion;
  uniform float uRegionRotation;
  varying vec2 vUv;

  /**
   * Same crop the paint shader applies (uTextureRegion there). The cursor is
   * only useful if it previews what the stroke will actually lay down — showing
   * the whole sheet while painting a cropped detail is worse than no preview,
   * because it aims the artist at the wrong thing.
   */
  vec2 regionUv(vec2 uv) {
    vec2 r = clamp(uv, 0.0, 1.0);
    if (uRegionRotation != 0.0) {
      float cr = cos(uRegionRotation);
      float sr = sin(uRegionRotation);
      vec2 c = r - 0.5;
      r = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) + 0.5;
    }
    return uRegion.xy + clamp(r, 0.0, 1.0) * uRegion.zw;
  }

  void main() {
    if (uHasTexture < 0.5) {
      discard;
    }
    vec2 uv = vUv;
    float centerAlpha = texture2D(uTexture, regionUv(uv)).a;

    // 4-sample cross edge detection for silhouette contour
    float off = 1.0 / 64.0;
    float aL = texture2D(uTexture, regionUv(uv - vec2(off, 0.0))).a;
    float aR = texture2D(uTexture, regionUv(uv + vec2(off, 0.0))).a;
    float aU = texture2D(uTexture, regionUv(uv - vec2(0.0, off))).a;
    float aD = texture2D(uTexture, regionUv(uv + vec2(0.0, off))).a;

    float edge = max(abs(centerAlpha - aL), max(abs(centerAlpha - aR), max(abs(centerAlpha - aU), abs(centerAlpha - aD))));
    float isEdge = smoothstep(0.06, 0.35, edge);

    // Outline color: vibrant cyan/sky blue with bright white edge
    vec4 outline = vec4(0.22, 0.74, 0.98, 0.95);
    // Interior fill: subtle semi-transparent ghost imprint of the brush
    vec4 fill = vec4(0.23, 0.51, 0.96, centerAlpha * 0.32);

    vec4 outColor = mix(fill, outline, isEdge);
    if (outColor.a < 0.02) discard;

    gl_FragColor = outColor;
  }
`

export function createGizmo(): GizmoHandle {
  const group = new THREE.Group()

  const brushRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false
    })
  )
  group.add(brushRing)

  const eyedropperReticle = new THREE.Group()
  const eyeOuterRing = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.88, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false
    })
  )
  const eyeCenterDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.18, 16),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false
    })
  )
  const eyeCrosshairGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.4, 0, 0),
    new THREE.Vector3(-0.95, 0, 0),
    new THREE.Vector3(0.95, 0, 0),
    new THREE.Vector3(1.4, 0, 0),
    new THREE.Vector3(0, -1.4, 0),
    new THREE.Vector3(0, -0.95, 0),
    new THREE.Vector3(0, 0.95, 0),
    new THREE.Vector3(0, 1.4, 0)
  ])
  const eyeCrosshair = new THREE.LineSegments(
    eyeCrosshairGeom,
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })
  )
  eyedropperReticle.add(eyeOuterRing, eyeCenterDot, eyeCrosshair)
  eyedropperReticle.visible = false
  group.add(eyedropperReticle)

  const bucketReticle = new THREE.Group()
  const bucketOuterRing = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 0.96, 32),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false
    })
  )
  const bucketInnerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.48, 32),
    new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false
    })
  )
  const bucketCrosshairGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.4, 0, 0),
    new THREE.Vector3(-1.0, 0, 0),
    new THREE.Vector3(1.0, 0, 0),
    new THREE.Vector3(1.4, 0, 0),
    new THREE.Vector3(0, -1.4, 0),
    new THREE.Vector3(0, -1.0, 0),
    new THREE.Vector3(0, 1.0, 0),
    new THREE.Vector3(0, 1.4, 0)
  ])
  const bucketCrosshair = new THREE.LineSegments(
    bucketCrosshairGeom,
    new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false })
  )
  bucketReticle.add(bucketOuterRing, bucketInnerRing, bucketCrosshair)
  bucketReticle.visible = false
  group.add(bucketReticle)

  const stampReticle = new THREE.Group()
  const stampFrameGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1, -1, 0),
    new THREE.Vector3(1, -1, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(-1, 1, 0),
    new THREE.Vector3(-1, -1, 0)
  ])
  const stampFrame = new THREE.Line(
    stampFrameGeom,
    new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false })
  )
  const stampArrowGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.3, 0.6, 0),
    new THREE.Vector3(0, 0.95, 0),
    new THREE.Vector3(0.3, 0.6, 0),
    new THREE.Vector3(0, 0.95, 0),
    new THREE.Vector3(0, 0.2, 0)
  ])
  const stampArrow = new THREE.Line(
    stampArrowGeom,
    new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false })
  )
  const stampCrosshairGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.2, 0, 0),
    new THREE.Vector3(0.2, 0, 0),
    new THREE.Vector3(0, -0.2, 0),
    new THREE.Vector3(0, 0.2, 0)
  ])
  const stampCrosshair = new THREE.LineSegments(
    stampCrosshairGeom,
    new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false })
  )
  stampReticle.add(stampFrame, stampArrow, stampCrosshair)
  stampReticle.visible = false
  group.add(stampReticle)

  const brushTipMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: null },
      uHasTexture: { value: 0 },
      uRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      uRegionRotation: { value: 0 }
    },
    vertexShader: brushOutlineVertexShader,
    fragmentShader: brushOutlineFragmentShader,
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide
  })
  const brushTipGeom = new THREE.PlaneGeometry(2, 2)
  const brushTipMesh = new THREE.Mesh(brushTipGeom, brushTipMaterial)

  const brushTipBoundsGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1, -1, 0),
    new THREE.Vector3(1, -1, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(-1, 1, 0),
    new THREE.Vector3(-1, -1, 0)
  ])
  const brushTipBounds = new THREE.Line(
    brushTipBoundsGeom,
    new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
      depthTest: false
    })
  )
  brushTipMesh.add(brushTipBounds)
  brushTipMesh.visible = false
  group.add(brushTipMesh)

  // Full-color decal (not just an outline) showing what the selected shelf
  // texture will actually look like when stamped, so aiming/rotating doesn't
  // require a guess-and-check placement.
  const stampPreviewMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
    opacity: 0.85
  })
  const stampPreviewMesh = new THREE.Mesh(brushTipGeom, stampPreviewMaterial)
  stampPreviewMesh.visible = false
  group.add(stampPreviewMesh)

  group.visible = false
  group.renderOrder = 999

  const mirrorGroup = new THREE.Group()
  const mirrorBrushRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false
    })
  )
  const mirrorBrushTipMesh = new THREE.Mesh(brushTipGeom, brushTipMaterial)
  const mirrorBrushTipBounds = new THREE.Line(
    brushTipBoundsGeom,
    new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.35,
      depthTest: false
    })
  )
  mirrorBrushTipMesh.add(mirrorBrushTipBounds)
  const mirrorStampPreviewMesh = new THREE.Mesh(brushTipGeom, stampPreviewMaterial)
  mirrorStampPreviewMesh.visible = false
  mirrorGroup.add(mirrorBrushRing, mirrorBrushTipMesh, mirrorStampPreviewMesh)
  mirrorBrushTipMesh.visible = false
  mirrorGroup.visible = false
  mirrorGroup.renderOrder = 999

  return {
    group,
    brushRing,
    eyedropperReticle,
    bucketReticle,
    stampReticle,
    brushTipMesh,
    stampPreviewMesh,
    stampPreviewMaterial,
    brushTipMaterial,
    mirrorGroup,
    mirrorBrushRing,
    mirrorBrushTipMesh,
    mirrorStampPreviewMesh
  }
}

export interface SymmetryGuideHandle {
  group: THREE.Group
  update: (axis: SymmetryAxis, model: LoadedModel | undefined, mesh?: THREE.Mesh) => void
  dispose: () => void
}

export function createSymmetryGuide(): SymmetryGuideHandle {
  const group = new THREE.Group()
  group.name = 'SymmetryGuidePlane'
  group.visible = false
  group.renderOrder = 992

  const wallGeom = new THREE.PlaneGeometry(1, 1, 8, 8)
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x06b6d4,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true
  })
  const wallMesh = new THREE.Mesh(wallGeom, wallMat)
  group.add(wallMesh)

  const borderGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
    new THREE.Vector3(-0.5, -0.5, 0)
  ])
  const borderMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  })
  const borderLine = new THREE.Line(borderGeom, borderMat)
  group.add(borderLine)

  const crossGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0, 0),
    new THREE.Vector3(0.5, 0, 0),
    new THREE.Vector3(0, -0.5, 0),
    new THREE.Vector3(0, 0.5, 0)
  ])
  const crossMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.5,
    depthWrite: false
  })
  const crossLine = new THREE.LineSegments(crossGeom, crossMat)
  group.add(crossLine)

  // Subtle grid lines inside the plane, to sell the "big wall" depth illusion
  const innerGridGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.25, 0),
    new THREE.Vector3(0.5, -0.25, 0),
    new THREE.Vector3(-0.5, 0.25, 0),
    new THREE.Vector3(0.5, 0.25, 0),
    new THREE.Vector3(-0.25, -0.5, 0),
    new THREE.Vector3(-0.25, 0.5, 0),
    new THREE.Vector3(0.25, -0.5, 0),
    new THREE.Vector3(0.25, 0.5, 0)
  ])
  const innerGridMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  })
  const innerGridLine = new THREE.LineSegments(innerGridGeom, innerGridMat)
  group.add(innerGridLine)

  function update(
    axis: SymmetryAxis,
    model: LoadedModel | undefined,
    meshOverride?: THREE.Mesh
  ): void {
    if (axis === 'off' || !model || model.meshes.length === 0) {
      group.visible = false
      return
    }

    // Sized around the piece being painted, since that's what the mirror acts on.
    const mesh = meshOverride ?? model.meshes[0]
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox()
    }
    const bbox = mesh.geometry.boundingBox
    if (!bbox) {
      group.visible = false
      return
    }

    const size = new THREE.Vector3()
    bbox.getSize(size)
    const center = new THREE.Vector3()
    bbox.getCenter(center)

    // Make the plane large enough to comfortably pass through and frame the entire mesh
    const maxDim = Math.max(size.x, size.y, size.z, 0.8)
    const wallSpan = maxDim * 1.6
    group.scale.set(wallSpan, wallSpan, 1)

    if (axis === 'x') {
      // Perpendicular to X axis (YZ plane) through X = 0
      group.position.set(0, center.y, center.z)
      group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
      wallMat.color.setHex(0x06b6d4)
      borderMat.color.setHex(0x38bdf8)
      crossMat.color.setHex(0x38bdf8)
      innerGridMat.color.setHex(0x38bdf8)
    } else if (axis === 'y') {
      // Perpendicular to Y axis (XZ plane) through Y = 0
      group.position.set(center.x, 0, center.z)
      group.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
      wallMat.color.setHex(0x10b981)
      borderMat.color.setHex(0x34d399)
      crossMat.color.setHex(0x34d399)
      innerGridMat.color.setHex(0x34d399)
    } else if (axis === 'z') {
      // Perpendicular to Z axis (XY plane) through Z = 0
      group.position.set(center.x, center.y, 0)
      group.quaternion.identity()
      wallMat.color.setHex(0xa855f7)
      borderMat.color.setHex(0xc084fc)
      crossMat.color.setHex(0xc084fc)
      innerGridMat.color.setHex(0xc084fc)
    }

    group.visible = true
  }

  function dispose(): void {
    wallGeom.dispose()
    wallMat.dispose()
    borderGeom.dispose()
    borderMat.dispose()
    crossGeom.dispose()
    crossMat.dispose()
    innerGridGeom.dispose()
    innerGridMat.dispose()
  }

  return { group, update, dispose }
}
