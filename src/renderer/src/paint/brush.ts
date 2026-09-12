import { createSignal } from 'solid-js'

export type ToolMode = 'brush' | 'line' | 'stamp' | 'eraser' | 'fill' | 'eyedropper' | 'faceSelect'
export type BrushTextureMapping = 'uv' | 'triplanar' | 'tip'
/** 'whole' fills the whole model (or the active face selection); 'face' fills only the single face clicked. */
export type FillMode = 'whole' | 'face'

const MIN_RADIUS = 0.01
const MAX_RADIUS = 5

const [radius, setRadiusRaw] = createSignal(0.2)
const [opacity, setOpacityRaw] = createSignal(1)
const [hardness, setHardnessRaw] = createSignal(0.6)
const [spacing, setSpacingRaw] = createSignal(0.25)
// Projector reach along the normal, as a fraction of the radius. 0.35 keeps a
// dab comfortably inside typical wall thickness while still wrapping a little
// over curvature and sharp edges.
const [projectorDepth, setProjectorDepthRaw] = createSignal(0.35)
const [maxAngle, setMaxAngleRaw] = createSignal(85)
const [textureScale, setTextureScaleRaw] = createSignal(8)
const [color, setColor] = createSignal('#ffffff')
/** Selected texture-shelf image: tiles world-space, maps surface UVs, or is stamped whole under the stamp tool. */
const [texturePath, setTexturePathRaw] = createSignal<string | null>(null)
/** Selected brush tip image / ABR alpha mask. */
const [tipTexturePath, setTipTexturePathRaw] = createSignal<string | null>(null)
/** Projection mapping mode for the brush tool: 'uv' (straightforward UV), 'triplanar' (world triplanar), or 'tip' (brush tip stamp). */
const [textureMapping, setTextureMappingRaw] = createSignal<BrushTextureMapping>('triplanar')
/** Fill tool mode: whole model/selection, or just the clicked face. */
const [fillMode, setFillModeRaw] = createSignal<FillMode>('face')

export type SymmetryAxis = 'off' | 'x' | 'y' | 'z'

/** Active symmetry painting axis ('off', 'x', 'y', 'z') in local model space. */
const [symmetryAxis, setSymmetryAxisRaw] = createSignal<SymmetryAxis>('off')

export function setSymmetryAxis(axis: SymmetryAxis): void {
  setSymmetryAxisRaw(axis)
}

export function setSymmetryX(enabled: boolean): void {
  setSymmetryAxisRaw(enabled ? 'x' : 'off')
}

export const symmetryX = () => symmetryAxis() === 'x'
export const symmetryEnabled = () => symmetryAxis() !== 'off'

/** Recent textures chosen by the user (persisted in localStorage). */
const [recentTextures, setRecentTextures] = createSignal<string[]>(
  (() => {
    try {
      const raw = localStorage.getItem('slip_recent_textures')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })()
)

export function recordRecentTexture(path: string): void {
  setRecentTextures((prev) => {
    const next = [path, ...prev.filter((p) => p !== path)].slice(0, 5)
    try {
      localStorage.setItem('slip_recent_textures', JSON.stringify(next))
    } catch {}
    return next
  })
}

/** Static brush rotation in degrees (0 - 360). */
const [brushRotation, setBrushRotationRaw] = createSignal(0)
/** Whether brush tip rotates dynamically to follow the pointer stroke direction. */
const [angleFollowStroke, setAngleFollowStrokeRaw] = createSignal(false)
/** Random angle jitter fraction (0 - 1). */
const [angleJitter, setAngleJitterRaw] = createSignal(0)
/** Random size jitter fraction (0 - 1). */
const [sizeJitter, setSizeJitterRaw] = createSignal(0)

export function setBrushRotation(deg: number): void {
  setBrushRotationRaw(((deg % 360) + 360) % 360)
}

export function setAngleFollowStroke(enabled: boolean): void {
  setAngleFollowStrokeRaw(enabled)
}

export function setAngleJitter(v: number): void {
  setAngleJitterRaw(clamp(v, 0, 1))
}

export function setSizeJitter(v: number): void {
  setSizeJitterRaw(clamp(v, 0, 1))
}

export function setTextureMapping(mode: BrushTextureMapping): void {
  setTextureMappingRaw(mode)
}

export function setFillMode(mode: FillMode): void {
  setFillModeRaw(mode)
}

export function setTipTexturePath(path: string | null): void {
  setTipTexturePathRaw(path)
}
/**
 * Triangles picked by the Face Select tool (spec: select faces, click =
 * replace, shift+click = add/remove). Having any faces selected
 * automatically confines brush/stamp/eraser/fill to them — Esc (or
 * clearFaceSelection) drops back to painting the whole model.
 */
const [selectedFaces, setSelectedFacesRaw] = createSignal<ReadonlySet<number>>(new Set())

/**
 * Selects a texture-shelf image for the brush. Resets paint color to white by
 * default so the texture doesn't take on a stale tint — pass `resetColor:
 * false` when the active layer is a mask, where color is an explicit
 * grayscale hide/reveal value and textures are never applied anyway.
 */
export function setTexturePath(path: string | null, resetColor = true): void {
  setTexturePathRaw(path)
  // Note: recordRecentTexture() is deliberately NOT called here — the "Used"
  // shelf tab tracks textures actually applied by a stroke/fill, not merely
  // browsed/selected. See applyToolAt/fillActive in Viewport.tsx.
  if (path && resetColor) setColor('#ffffff')
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
  setTextureScaleRaw(clamp(v, 0, 50))
}

/**
 * How far the brush projector reaches along the surface normal, as a fraction
 * of the radius. This is what stops paint reaching the far side of a thin
 * shell: the brush is a projector box, not a sphere, so a texel is only in
 * range if it sits within `radius * depth` of the brush's tangent plane. A
 * sphere of radius r unavoidably swallows anything within r of the hit point,
 * back faces included — which is why the old spherical falloff bled through
 * every wall thinner than the brush.
 */
export function setProjectorDepth(v: number): void {
  setProjectorDepthRaw(clamp(v, 0.02, 4))
}

/**
 * Widest angle (degrees) between the surface normal and the brush normal that
 * still takes paint. Below the cutoff the contribution ramps to zero rather
 * than stopping hard, so a stroke across a curved surface doesn't get a visible
 * ring where the cutoff lands.
 */
export function setMaxAngle(deg: number): void {
  setMaxAngleRaw(clamp(deg, 5, 180))
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

export function selectAllFaces(totalFaces: number): void {
  const next = new Set<number>()
  for (let i = 0; i < totalFaces; i++) next.add(i)
  setSelectedFacesRaw(next)
}

export function invertFaceSelection(totalFaces: number): void {
  const current = selectedFaces()
  const next = new Set<number>()
  for (let i = 0; i < totalFaces; i++) {
    if (!current.has(i)) next.add(i)
  }
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
  projectorDepth,
  setProjectorDepth,
  maxAngle,
  setMaxAngle,
  textureScale,
  color,
  setColor,
  texturePath,
  tipTexturePath,
  setTipTexturePath,
  selectedFaces,
  textureMapping,
  setTextureMapping,
  fillMode,
  setFillMode,
  symmetryAxis,
  setSymmetryAxis,
  symmetryEnabled,
  symmetryX,
  setSymmetryX,
  recentTextures,
  recordRecentTexture,
  brushRotation,
  setBrushRotation,
  angleFollowStroke,
  setAngleFollowStroke,
  angleJitter,
  setAngleJitter,
  sizeJitter,
  setSizeJitter
}
