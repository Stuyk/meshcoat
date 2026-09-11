import { createSignal } from 'solid-js'

export type ToolMode = 'brush' | 'stamp' | 'eraser' | 'fill' | 'eyedropper' | 'faceSelect'

const MIN_RADIUS = 0.01
const MAX_RADIUS = 5

const [radius, setRadiusRaw] = createSignal(0.2)
const [opacity, setOpacityRaw] = createSignal(1)
const [hardness, setHardnessRaw] = createSignal(0.6)
const [spacing, setSpacingRaw] = createSignal(0.25)
const [textureScale, setTextureScaleRaw] = createSignal(0.5)
const [color, setColor] = createSignal('#ffffff')
/** Selected texture-shelf image: tiles world-space under the brush tool, or is stamped whole under the stamp tool. */
const [texturePath, setTexturePathRaw] = createSignal<string | null>(null)
/**
 * Triangles picked by the Face Select tool (spec: select faces, click =
 * replace, shift+click = add/remove). Having any faces selected
 * automatically confines brush/stamp/eraser/fill to them — Esc (or
 * clearFaceSelection) drops back to painting the whole model.
 */
const [selectedFaces, setSelectedFacesRaw] = createSignal<ReadonlySet<number>>(new Set())

export function setTexturePath(path: string | null): void {
  setTexturePathRaw(path)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function setRadius(v: number): void {
  setRadiusRaw(clamp(v, MIN_RADIUS, MAX_RADIUS))
}

export function setOpacity(v: number): void {
  setOpacityRaw(clamp(v, 0, 1))
}

export function setHardness(v: number): void {
  setHardnessRaw(clamp(v, 0, 1))
}

/** Fraction of the brush radius the pointer must travel before the next stamp is applied (spec: Spacing). */
export function setSpacing(v: number): void {
  setSpacingRaw(clamp(v, 0.02, 2))
}

/** World units per texture repeat for the texture brush's world-space tiling. */
export function setTextureScale(v: number): void {
  setTextureScaleRaw(clamp(v, 0.01, 50))
}

/** Multiplicative step so '[' / ']' feel consistent at any current size (spec section 2). */
export function stepRadius(direction: 1 | -1): void {
  setRadius(radius() * (direction > 0 ? 1.1 : 1 / 1.1))
}

/** Replaces the selection with just this one face. */
export function selectOnlyFace(faceIndex: number): void {
  setSelectedFacesRaw(new Set([faceIndex]))
}

/** Adds a face to the selection. */
export function addFaceToSelection(faceIndex: number): void {
  const current = selectedFaces()
  if (current.has(faceIndex)) return
  const next = new Set<number>(current)
  next.add(faceIndex)
  setSelectedFacesRaw(next)
}

/** Removes a face from the selection. */
export function removeFaceFromSelection(faceIndex: number): void {
  const current = selectedFaces()
  if (!current.has(faceIndex)) return
  const next = new Set<number>(current)
  next.delete(faceIndex)
  setSelectedFacesRaw(next)
}

/** Adds/removes this face from the selection (spec: multi-select via shift+click). */
export function toggleFaceSelection(faceIndex: number): void {
  const next = new Set<number>(selectedFaces())
  if (next.has(faceIndex)) next.delete(faceIndex)
  else next.add(faceIndex)
  setSelectedFacesRaw(next)
}

export function clearFaceSelection(): void {
  setSelectedFacesRaw(new Set<number>())
}

export const brush = {
  radius,
  opacity,
  hardness,
  spacing,
  textureScale,
  color,
  setColor,
  texturePath,
  selectedFaces
}
