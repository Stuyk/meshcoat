import * as THREE from 'three'
import { createSignal } from 'solid-js'
import {
  BRUSH_MASK_UNIFORMS_GLSL,
  BRUSH_MASK_GLSL,
  createBrushMaskUniforms,
  type BrushMaskUniforms
} from './brushMask'
import type { OcclusionParams } from './paintEngine'

/**
 * Lasso pixel selection.
 *
 * A face selection can only follow triangles; hard-surface masking needs a cut
 * that runs wherever the artist draws it — across the middle of a panel, along
 * a bevel. The lasso is drawn in screen space, but a screen-space shape only
 * means anything from the camera it was drawn from, so it is *baked* the moment
 * it closes: every texel of the active piece is projected through that camera,
 * tested against the shape, and the result is stored as a texture-space mask
 * (one channel, the piece's texture size). From then on it behaves like any
 * selection — orbit freely, and every paint operation stays inside it.
 *
 * The bake uses the brush's own camera-visibility test (see brushMask.ts), so a
 * lasso around the front of a model never selects the back of it, or anything
 * hidden behind another part.
 */

export type LassoMode = 'replace' | 'add' | 'subtract'

/** Freehand drags a path; polygon places a corner per click. */
export type LassoShape = 'freehand' | 'polygon'

export const LASSO_MODE_INDEX: Record<LassoMode, number> = { replace: 0, add: 1, subtract: 2 }

const [lassoShape, setLassoShape] = createSignal<LassoShape>('freehand')
/** The path being drawn, in canvas CSS pixels — drawn as a guide over the viewport. */
const [lassoPath, setLassoPath] = createSignal<{ x: number; y: number }[] | null>(null)
/** Mode of the path being drawn, so the guide can show add / subtract. */
const [lassoPathMode, setLassoPathMode] = createSignal<LassoMode>('replace')
/**
 * Whether the active piece has a pixel selection. Selections live on each
 * piece's PaintSurface; the viewport keeps this in step on every change and
 * piece switch so the UI can react without reaching into the GPU side.
 */
const [hasPixelSelection, setHasPixelSelection] = createSignal(false)

export const lasso = {
  shape: lassoShape,
  setShape: setLassoShape,
  path: lassoPath,
  setPath: setLassoPath,
  pathMode: lassoPathMode,
  setPathMode: setLassoPathMode,
  hasSelection: hasPixelSelection,
  setHasSelection: setHasPixelSelection
}

/**
 * Rasterizes a closed screen-space path into a canvas the size of the viewport
 * — white inside, black outside, antialiased edge. Uploaded as a texture, it is
 * what the bake pass samples at each texel's projected position.
 */
export function renderLassoCanvas(
  width: number,
  height: number,
  points: readonly { x: number; y: number }[]
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable for the lasso')
  }
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(canvas.width / width, canvas.height / height)
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
  ctx.fillStyle = '#fff'
  // Even-odd, so a path that crosses itself leaves its loops unselected the way
  // every image editor's lasso does.
  ctx.fill('evenodd')
  return canvas
}

export interface LassoBakeParams {
  /** From renderLassoCanvas — viewport-sized, white = inside. */
  screenMask: THREE.Texture
  mode: LassoMode
  occlusion: OcclusionParams
}

export interface LassoUniforms extends BrushMaskUniforms {
  uPrevSelection: THREE.IUniform<THREE.Texture | null>
  uHasPrev: THREE.IUniform<number>
  uScreenMask: THREE.IUniform<THREE.Texture | null>
  uMode: THREE.IUniform<number>
  /** 1 = ignore the lasso and write 1 - previous (Invert Selection). */
  uInvert: THREE.IUniform<number>
}

/** The bake pass: rasterizes the UV mesh, one fragment per texel of the piece. */
export function createLassoMaterial(): THREE.ShaderMaterial & { uniforms: LassoUniforms } {
  const uniforms: LassoUniforms = {
    ...createBrushMaskUniforms(),
    uPrevSelection: { value: null },
    uHasPrev: { value: 0 },
    uScreenMask: { value: null },
    uMode: { value: 0 },
    uInvert: { value: 0 }
  }
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    vertexShader: /* glsl */ `
      attribute vec3 aWorldPosition;
      attribute vec3 aWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      void main() {
        vWorldPosition = aWorldPosition;
        vWorldNormal = aWorldNormal;
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPrevSelection;
      uniform float uHasPrev;
      uniform sampler2D uScreenMask;
      uniform int uMode;
      uniform float uInvert;
${BRUSH_MASK_UNIFORMS_GLSL}
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
${BRUSH_MASK_GLSL}
      void main() {
        float prev = uHasPrev > 0.5 ? texture2D(uPrevSelection, vUv).r : 0.0;
        if (uInvert > 0.5) {
          gl_FragColor = vec4(vec3(1.0 - prev), 1.0);
          return;
        }
        float inside = 0.0;
        vec4 clip = uCameraViewProjMatrix * vec4(vWorldPosition, 1.0);
        if (clip.w > 0.0) {
          // The canvas texture is uploaded flipped, so its v already runs
          // bottom-up like NDC: the projected position samples it directly.
          vec2 screenUv = clip.xy / clip.w * 0.5 + 0.5;
          if (screenUv.x >= 0.0 && screenUv.x <= 1.0 && screenUv.y >= 0.0 && screenUv.y <= 1.0) {
            inside = texture2D(uScreenMask, screenUv).r;
          }
        }
        float falloff;
        float facingMask;
        float visibility;
        computeBrushMask(falloff, facingMask, visibility);
        inside *= visibility;

        float result = inside;
        if (uMode == 1) {
          result = max(prev, inside);
        } else if (uMode == 2) {
          result = prev * (1.0 - inside);
        }
        gl_FragColor = vec4(vec3(result), 1.0);
      }
    `,
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false
  }) as THREE.ShaderMaterial & { uniforms: LassoUniforms }
}

/**
 * On-model highlight of a pixel selection: a tint over the selected texels and
 * a bright line along its edge, drawn on a child of the piece's mesh. The edge
 * comes from the screen-space derivative of the mask, so it stays one pixel
 * wide at any zoom.
 */
export function createPixelSelectionOverlayMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { tSel: { value: texture } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSel;
      varying vec2 vUv;
      void main() {
        float s = texture2D(tSel, vUv).r;
        float edge = clamp(fwidth(s) * 1.5, 0.0, 1.0);
        float alpha = max(s * 0.22, edge * 0.9);
        if (alpha < 0.01) discard;
        vec3 tint = mix(vec3(1.0, 0.82, 0.4), vec3(1.0), edge);
        gl_FragColor = vec4(tint, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })
}
