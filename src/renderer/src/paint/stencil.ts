import { createSignal } from 'solid-js'

/**
 * Screen-space stencil (the Mari / Mudbox workflow).
 *
 * An image is pinned to the *viewport*, not to the model: it floats as a
 * semi-transparent sheet in screen space while the artist orbits and pans the
 * mesh underneath it, then brushes through it onto whatever surface is behind.
 * Because the projection is fixed to the screen rather than to the surface, a
 * photo or pattern lands undistorted regardless of how the geometry curves —
 * which is the thing the tangent-space Stamp tool fundamentally cannot do, and
 * why both tools exist.
 *
 * Geometry is stored in *canvas pixel* space so the DOM overlay the artist
 * sees and the paint shader that samples it are driven by identical numbers —
 * if these drifted apart, paint would land somewhere other than where the
 * stencil appears.
 */

const [texturePath, setTexturePathRaw] = createSignal<string | null>(null)
/**
 * Human-readable name for the loaded stencil. A file path carries its own name,
 * but a clipboard paste arrives as a data URL — showing the first 40 characters
 * of base64 in the panel header helps nobody.
 */
const [textureLabel, setTextureLabelRaw] = createSignal<string | null>(null)
/** Whether the stencil is currently enabled/visible on screen. Defaults to false until stencil tool is opened. */
const [visible, setVisibleRaw] = createSignal(false)
/** Center of the stencil, as a fraction of canvas width/height (0-1, origin top-left, CSS convention). */
const [centerX, setCenterXRaw] = createSignal(0.5)
const [centerY, setCenterYRaw] = createSignal(0.5)
/** Stencil width as a fraction of canvas width; height follows from the image's aspect ratio. */
const [scale, setScaleRaw] = createSignal(0.5)
const [rotation, setRotationRaw] = createSignal(0)
/** How strongly the overlay sheet is drawn — purely a viewing aid, never affects paint. */
const [displayOpacity, setDisplayOpacityRaw] = createSignal(0.55)
/** Paint through the stencil's dark areas instead of its light ones. */
const [invert, setInvertRaw] = createSignal(false)
/**
 * When true, dragging in the viewport moves/scales/rotates the stencil instead
 * of painting. Transform and paint are deliberately modal rather than sharing
 * a modifier: every modifier in the viewport is already spoken for, and an
 * artist positioning a stencil does it once and then paints many strokes.
 */
const [transforming, setTransformingRaw] = createSignal(false)
/**
 * How a stamp reads the stencil image. false = use the image's own colors and
 * alpha (a photo or logo decal); true = use its brightness as a mask and paint
 * the current brush color through it (plain black-and-white stencil artwork,
 * which is opaque everywhere and so would otherwise stamp as a solid rectangle).
 */
const [stampUseLuminance, setStampUseLuminanceRaw] = createSignal(false)
/** Natural pixel dimensions of the loaded image, for aspect ratio. */
const [imageAspect, setImageAspectRaw] = createSignal(1)

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function setStencilTexturePath(path: string | null, label?: string): void {
  setTexturePathRaw(path)
  setTextureLabelRaw(path ? (label ?? path.split(/[/\\]/).pop() ?? 'Stencil') : null)
  if (!path) {
    setTransformingRaw(false)
  }
}

export function setStencilCenter(x: number, y: number): void {
  // Allowed well past the canvas edge so a large stencil can be positioned
  // with only a corner of it overlapping the model.
  setCenterXRaw(clamp(x, -1, 2))
  setCenterYRaw(clamp(y, -1, 2))
}

export function setStencilScale(v: number): void {
  setScaleRaw(clamp(v, 0.05, 4))
}

export function setStencilRotation(deg: number): void {
  setRotationRaw(((deg % 360) + 360) % 360)
}

export function setStencilDisplayOpacity(v: number): void {
  setDisplayOpacityRaw(clamp(v, 0.05, 1))
}

export function setStencilInvert(v: boolean): void {
  setInvertRaw(v)
}

export function setStencilTransforming(v: boolean): void {
  setTransformingRaw(v)
}

export function setStencilVisible(v: boolean): void {
  setVisibleRaw(v)
  if (!v) {
    setTransformingRaw(false)
  }
}

export function setStencilStampUseLuminance(v: boolean): void {
  setStampUseLuminanceRaw(v)
}

export function setStencilImageAspect(v: number): void {
  setImageAspectRaw(v > 0 ? v : 1)
}

/** Recenters and resets the stencil to a sane default framing. */
export function resetStencilTransform(): void {
  setCenterXRaw(0.5)
  setCenterYRaw(0.5)
  setScaleRaw(0.5)
  setRotationRaw(0)
}

/** True when a stencil is loaded and visible and should gate painting. */
export const stencilActive = (): boolean => visible() && texturePath() !== null

/**
 * Stencil rectangle in canvas pixels — the single source of truth shared by the
 * DOM overlay and the paint shader.
 */
export function stencilRect(
  canvasWidth: number,
  canvasHeight: number
): {
  centerX: number
  centerY: number
  width: number
  height: number
  rotationRad: number
} {
  const width = scale() * canvasWidth
  return {
    centerX: centerX() * canvasWidth,
    centerY: centerY() * canvasHeight,
    width,
    height: width / imageAspect(),
    rotationRad: (rotation() * Math.PI) / 180
  }
}

export const stencil = {
  texturePath,
  textureLabel,
  setStencilTexturePath,
  visible,
  setStencilVisible,
  centerX,
  centerY,
  setStencilCenter,
  scale,
  setStencilScale,
  rotation,
  setStencilRotation,
  displayOpacity,
  setStencilDisplayOpacity,
  invert,
  setStencilInvert,
  stampUseLuminance,
  setStencilStampUseLuminance,
  transforming,
  setStencilTransforming,
  imageAspect,
  setStencilImageAspect,
  resetStencilTransform,
  stencilActive,
  stencilRect
}

/**
 * This module is a singleton store: every consumer holds a live binding to the
 * functions below. A partial hot update can leave some of them bound to an
 * older copy of the module, which surfaces as "brush.someSetter is not a
 * function" from code that is provably correct on disk. Accepting the update
 * and immediately invalidating turns any edit here into a full reload, which is
 * cheap and always consistent.
 */
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate())
}
