import { createSignal } from 'solid-js'
import * as THREE from 'three'
import type { EffectMode } from './effectShader'
import type { ChannelPayload, PaintChannel } from './channels'
import { paintableChannels, type MaterialSet } from './materialSets'

export type ToolMode =
  | 'brush'
  | 'line'
  | 'stamp'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'faceSelect'
  | 'effect'
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

// --- Material channels (PBR) ---
//
// A stroke writes every *enabled* channel at once, Substance-style: gold is one
// brush that lays down a yellow base color, 0.1 roughness and 1.0 metalness in
// the same pass, not three separate passes the artist has to keep in register.
//
// Base color alone is enabled by default, so a flat-texture project behaves —
// and costs — exactly as it did before any of this existed.
const [channelEnabled, setChannelEnabledRaw] = createSignal<Record<PaintChannel, boolean>>({
  baseColor: true,
  roughness: false,
  metalness: false,
  normal: false
})
/** 0 = mirror-gloss, 1 = fully matte. */
const [roughnessValue, setRoughnessValueRaw] = createSignal(0.5)
/** 0 = dielectric (plastic, wood, paint), 1 = raw metal. Values between are physically meaningless. */
const [metalnessValue, setMetalnessValueRaw] = createSignal(0)
/** Normal-map relief strength; negative engraves the dab instead of embossing it. */
const [normalStrength, setNormalStrengthRaw] = createSignal(1)

/**
 * The material set (a grouped PBR texture set — see materialSets.ts) the brush
 * is painting with, or null when painting flat dialled-in values.
 *
 * A set supplies a *map* per channel; the sliders stay live and scale what the
 * map says (map x slider), so "this rock, a bit glossier" is one slider away
 * rather than a different set of files.
 */
const [materialSet, setMaterialSetRaw] = createSignal<MaterialSet | null>(null)

/**
 * Selects (or clears) the active material set. Selecting one switches on
 * exactly the channels it can actually supply — picking a set whose author
 * shipped no metalness map should not leave the brush writing a metalness
 * number that came from nowhere — and points the existing shelf-texture path at
 * its base-color map so tinting, tiling and masking keep working unchanged.
 */
export function setMaterialSet(set: MaterialSet | null): void {
  setMaterialSetRaw(set)
  if (!set) {
    setTexturePathRaw(null)
    return
  }
  const supplied = paintableChannels(set)
  setChannelEnabledRaw((prev) => {
    const next = { ...prev }
    for (const channel of PAINT_CHANNELS_ALL) next[channel] = supplied.includes(channel)
    // Base color always stays on. Some packs ship a format the app can't decode
    // (a .tga albedo alongside .png data maps) or no albedo at all; with the
    // channel switched off, a stroke would write only roughness and normal and
    // look — reasonably — like nothing happened. With it on, the set's own
    // colour map is used when there is one and the current paint colour when
    // there isn't, so a stroke always marks.
    next.baseColor = true
    return next
  })
  // With a set, the sliders are multipliers over what the map says, so they
  // reset to neutral — a leftover 0.5 would silently halve the material's
  // roughness the moment it is picked.
  if (set.maps.roughness) setRoughnessValueRaw(1)
  if (set.maps.metalness) setMetalnessValueRaw(1)
  if (set.maps.normal) setNormalStrengthRaw(1)
  setTexturePathRaw(set.maps.baseColor ?? null)
  // A set carries its own color; a stale tint would recolour every map.
  setColor('#ffffff')
}

/** Local copy of the channel list — brush.ts must not import from channels.ts at runtime. */
const PAINT_CHANNELS_ALL: PaintChannel[] = ['baseColor', 'roughness', 'metalness', 'normal']

/** True when the active set supplies a map for this channel. */
export function setSuppliesChannel(channel: PaintChannel): boolean {
  const set = materialSet()
  return !!set && !!set.maps[channel]
}

export function setChannelEnabled(channel: PaintChannel, enabled: boolean): void {
  setChannelEnabledRaw((prev) => {
    const next = { ...prev, [channel]: enabled }
    // Something has to be painted. Turning off the last enabled channel would
    // leave a brush that silently does nothing on every stroke.
    if (!next.baseColor && !next.roughness && !next.metalness && !next.normal) return prev
    return next
  })
}

export function toggleChannel(channel: PaintChannel): void {
  setChannelEnabled(channel, !channelEnabled()[channel])
}

export function setRoughnessValue(v: number): void {
  setRoughnessValueRaw(clamp(v, 0, 1))
}

export function setMetalnessValue(v: number): void {
  setMetalnessValueRaw(clamp(v, 0, 1))
}

export function setNormalStrength(v: number): void {
  setNormalStrengthRaw(clamp(v, -4, 4))
}

/** True when the brush writes anything beyond base color. */
export function pbrChannelsActive(): boolean {
  const c = channelEnabled()
  return c.roughness || c.metalness || c.normal
}

/**
 * The payload for one stroke, built from the enabled channels and their current
 * values. `baseColorOverride` is how the eraser and mask painting supply their
 * own color/alpha without disturbing the brush's own color.
 */
export function buildChannelPayload(options?: {
  baseColor?: { color: THREE.Color; alpha: number }
  /** Skip the PBR channels entirely (mask layers are grayscale coverage only). */
  baseColorOnly?: boolean
}): ChannelPayload {
  const enabled = channelEnabled()
  const payload: ChannelPayload = {}
  if (options?.baseColorOnly) {
    payload.baseColor = options.baseColor ?? { color: new THREE.Color(color()), alpha: 1 }
    return payload
  }
  if (enabled.baseColor || options?.baseColor) {
    payload.baseColor = options?.baseColor ?? { color: new THREE.Color(color()), alpha: 1 }
  }
  if (enabled.roughness) payload.roughness = roughnessValue()
  if (enabled.metalness) payload.metalness = metalnessValue()
  if (enabled.normal) payload.normal = normalStrength()
  return payload
}


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
/** Map stylus pressure onto brush radius (tapered strokes). */
const [pressureRadius, setPressureRadiusRaw] = createSignal(true)
/** Map stylus pressure onto brush opacity (natural feathering/blending). */
const [pressureOpacity, setPressureOpacityRaw] = createSignal(true)
/**
 * Radius/opacity floor at zero pressure, as a fraction of the slider value.
 * Never 0: a stylus that reports very low pressure at the start of a stroke
 * would otherwise lay down nothing at all and the stroke would appear to drop
 * its first dabs.
 */
const [pressureMin, setPressureMinRaw] = createSignal(0.15)

// --- Effect brush (blur / sharpen / smudge / pixelate) ---
const [effectMode, setEffectModeRaw] = createSignal<EffectMode>('blur')
/** How far toward the filtered result each dab moves. */
const [effectStrength, setEffectStrengthRaw] = createSignal(0.6)
/** Blur / sharpen kernel radius, in texels of the layer being edited. */
const [effectRadius, setEffectRadiusRaw] = createSignal(3)
/** Pixelate block size, in texels. */
const [pixelSize, setPixelSizeRaw] = createSignal(16)
/**
 * How far a smudge drags color, as a fraction of the distance the pointer moved
 * across the surface. Above ~1 the brush would pull from beyond where it has
 * actually been and the smear detaches from the stroke.
 */
const [smudgeLength, setSmudgeLengthRaw] = createSignal(0.6)

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

export function setPressureRadius(enabled: boolean): void {
  setPressureRadiusRaw(enabled)
}

export function setPressureOpacity(enabled: boolean): void {
  setPressureOpacityRaw(enabled)
}

export function setEffectMode(mode: EffectMode): void {
  setEffectModeRaw(mode)
}

export function setEffectStrength(v: number): void {
  setEffectStrengthRaw(clamp(v, 0.01, 1))
}

export function setEffectRadius(v: number): void {
  setEffectRadiusRaw(clamp(v, 1, 32))
}

export function setPixelSize(v: number): void {
  setPixelSizeRaw(clamp(v, 2, 256))
}

export function setSmudgeLength(v: number): void {
  setSmudgeLengthRaw(clamp(v, 0.05, 1))
}

export function setPressureMin(v: number): void {
  setPressureMinRaw(clamp(v, 0, 1))
}

/**
 * Scales a brush value by stylus pressure, floored at `pressureMin` so a light
 * touch still marks.
 *
 * Gating is on `pointerType`, NOT on the pressure value. A mouse reports a
 * constant 0.5 while a button is held, so an earlier value-based heuristic
 * ("0.5 and 0 mean no sensor") also threw away a pen's genuine 0.5 and its
 * zero-pressure first contact — which is exactly why the first dab of a pen
 * stroke came out at full size and opacity. `pointerType === 'pen'` is the
 * device's own answer to that question and needs no guessing.
 */
export function applyPressure(value: number, event: PointerEvent | undefined, enabled: boolean): number {
  if (!enabled || !hasPressure(event)) return value
  const floor = pressureMin()
  return value * (floor + (1 - floor) * clamp(event!.pressure, 0, 1))
}

/** True when this pointer sample comes from a device that reports real pressure. */
export function hasPressure(event: PointerEvent | undefined): boolean {
  return !!event && (event.pointerType === 'pen' || event.pointerType === 'touch')
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
  // Picking a loose image is a different intent from painting with a set —
  // leaving the set selected would keep feeding its roughness and normal maps
  // under a stamp the artist chose for its color alone.
  setMaterialSetRaw(null)
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
  setTextureScale,
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
  setSizeJitter,
  pressureRadius,
  setPressureRadius,
  pressureOpacity,
  setPressureOpacity,
  pressureMin,
  setPressureMin,
  effectMode,
  setEffectMode,
  effectStrength,
  setEffectStrength,
  effectRadius,
  setEffectRadius,
  pixelSize,
  setPixelSize,
  smudgeLength,
  setSmudgeLength,
  channelEnabled,
  setChannelEnabled,
  toggleChannel,
  roughnessValue,
  setRoughnessValue,
  metalnessValue,
  setMetalnessValue,
  normalStrength,
  setNormalStrength,
  pbrChannelsActive,
  buildChannelPayload,
  materialSet,
  setMaterialSet,
  setSuppliesChannel
}
