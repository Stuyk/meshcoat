import { createSignal, untrack } from 'solid-js'
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
  | 'faceProjector'
  | 'text'
export type BrushTextureMapping = 'uv' | 'triplanar' | 'tip'
/**
 * How the selected region repeats across a stroke.
 *   tile   — edge to edge, the crop as its own little pattern
 *   mirror — every other copy flips, so a non-tiling crop has no seam
 *   once   — a single copy, nothing outside it (decal / reveal painting)
 */
export type BrushTextureRepeat = 'tile' | 'mirror' | 'once'
/** 'whole' fills the whole model (or the active face selection); 'face' fills only the single face clicked. */
export type FillMode = 'whole' | 'face'

/**
 * Brush radius is in WORLD units, so its usable range depends entirely on how
 * big the model is: 0.01 is a fine detail brush on a character and wider than
 * the whole thing on a gemstone. The range (and the slider built from it) is
 * therefore expressed as a fraction of the model's radius, which the viewport
 * reports whenever a model loads.
 */
const [sceneScale, setSceneScaleRaw] = createSignal(1)
const MIN_RADIUS_FRACTION = 0.004
const MAX_RADIUS_FRACTION = 2

export function radiusRange(): { min: number; max: number } {
  const scale = sceneScale()
  return { min: scale * MIN_RADIUS_FRACTION, max: scale * MAX_RADIUS_FRACTION }
}

/**
 * Tells the brush how big the current model is. The radius is rescaled with it,
 * so loading a model a hundredth the size doesn't leave a brush that covers the
 * entire thing (and can't be dialled down, because the slider bottomed out).
 */
export function setSceneScale(modelRadius: number): void {
  const next = Math.max(modelRadius, 0.0001)
  const previous = untrack(sceneScale)
  setSceneScaleRaw(next)
  if (previous > 0) {
    setRadius(untrack(radius) * (next / previous))
  }
}

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
/**
 * Which part of the source texture the brush draws from — x/y offset and
 * width/height, all 0-1 in texture space, plus a rotation in degrees about the
 * crop's own centre. A texture sheet usually holds several usable details
 * (one plate of a trim sheet, a single scratch, one letter); this picks one out
 * mid-stroke instead of asking the artist to go and cut a new file.
 */
const [textureRegion, setTextureRegionRaw] = createSignal({ x: 0, y: 0, w: 1, h: 1, rotation: 0 })
/**
 * Face UV Projector: places the (cropped) texture on the current face
 * selection with its own offset/scale/rotation instead of starting at the
 * mesh's raw UV origin — TrenchBroom-style face texturing. Offset/scale are
 * in UV units (1 = one full image width/height); rotation in degrees.
 * Identity is a no-op, matching a plain fill of the selection.
 *
 * `fit` switches the meaning of that identity: instead of tiling the crop
 * across the mesh's raw UV at the shelf tiling scale, one copy of the crop is
 * stretched across the selection's UV bounding box — "put this image on this
 * face", which is what the tool is for. Offset/scale/rotation then nudge that
 * single copy around inside the selection. Off, the old raw-UV tiling
 * behaviour is unchanged.
 */
const [faceProjection, setFaceProjectionRaw] = createSignal({
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  fit: true
})
const [color, setColor] = createSignal('#ffffff')
/** Selected texture-shelf image: tiles world-space, maps surface UVs, or is stamped whole under the stamp tool. */
const [texturePath, setTexturePathRaw] = createSignal<string | null>(null)
/** Selected brush tip image / ABR alpha mask. */
const [tipTexturePath, setTipTexturePathRaw] = createSignal<string | null>(null)
/** Projection mapping mode for the brush tool: 'uv' (straightforward UV), 'triplanar' (world triplanar), or 'tip' (brush tip stamp). */
/**
 * Defaults to surface UV, not world triplanar: "paint the picture I picked onto
 * the surface I'm pointing at" is what an artist expects, and a world-aligned
 * projection instead slides the pattern under the brush as the model curves.
 * Triplanar stays available for dressing a whole model in a seamless material.
 */
const [textureMapping, setTextureMappingRaw] = createSignal<BrushTextureMapping>('uv')
const [textureRepeat, setTextureRepeatRaw] = createSignal<BrushTextureRepeat>('tile')
/**
 * Tiling scale remembered per placement, because the number means a different
 * thing in each: repeats across the UV square for Surface, repeats per world
 * unit for World, one copy per dab for Cursor. Carrying a world value (often
 * well under 1) into Surface stretches a single copy over the whole unwrap,
 * which reads as "tiling is broken".
 */
const scaleByMapping: Record<BrushTextureMapping, number> = { uv: 4, triplanar: 8, tip: 1 }
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
    for (const channel of PAINT_CHANNELS_ALL) {
      next[channel] = supplied.includes(channel)
    }
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
  if (set.maps.roughness) {
    setRoughnessValueRaw(1)
  }
  if (set.maps.metalness) {
    setMetalnessValueRaw(1)
  }
  if (set.maps.normal) {
    setNormalStrengthRaw(1)
  }
  setTexturePathRaw(set.maps.baseColor ?? null)
  setTextureRegionRaw({ x: 0, y: 0, w: 1, h: 1, rotation: 0 })
  setFaceProjectionRaw({
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    fit: faceProjection().fit
  })
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
    if (!next.baseColor && !next.roughness && !next.metalness && !next.normal) {
      return prev
    }
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
  if (enabled.roughness) {
    payload.roughness = roughnessValue()
  }
  if (enabled.metalness) {
    payload.metalness = metalnessValue()
  }
  if (enabled.normal) {
    payload.normal = normalStrength()
  }
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

export const symmetryX = (): boolean => symmetryAxis() === 'x'
export const symmetryEnabled = (): boolean => symmetryAxis() !== 'off'

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
  // Pasted textures are data URLs — a handful of them is megabytes of base64,
  // which blows localStorage's quota and would take the whole recents list
  // down with it. They live in pastedTextures (session-only) instead.
  if (path.startsWith('data:') || path.startsWith('blob:')) {
    return
  }
  setRecentTextures((prev) => {
    const next = [path, ...prev.filter((p) => p !== path)]
    try {
      localStorage.setItem('slip_recent_textures', JSON.stringify(next))
    } catch {
      // Recent-textures list is a convenience — a full/blocked localStorage
      // just means it won't persist across sessions this time.
    }
    return next
  })
}

/**
 * Textures pasted from the system clipboard rather than loaded from a folder.
 *
 * They are PNG data URLs, which every consumer already handles (toAssetUrl
 * passes data: through untouched), so a paste is usable as a brush/fill/stamp
 * texture immediately with nothing written to disk. Deliberately session-only
 * and capped: this is the "grab a 64x64 tile out of a reference image and get
 * it onto the model now" workflow (PSX-style texturing lives on it), not an
 * asset library. Anything worth keeping gets exported or saved to a folder.
 */
export interface PastedTexture {
  /** PNG data URL — doubles as the texture's identity everywhere a path is expected. */
  url: string
  name: string
  width: number
  height: number
}

const MAX_PASTED_TEXTURES = 24

const [pastedTextures, setPastedTexturesRaw] = createSignal<PastedTexture[]>([])

/**
 * Adds a clipboard image to the Pasted shelf and returns it. An identical
 * paste (same bytes) is moved back to the front rather than duplicated — the
 * usual cause is pasting twice because the first one wasn't noticed.
 */
export function addPastedTexture(image: {
  dataUrl: string
  width: number
  height: number
}): PastedTexture {
  const existing = untrack(pastedTextures).find((t) => t.url === image.dataUrl)
  if (existing) {
    setPastedTexturesRaw((prev) => [existing, ...prev.filter((t) => t !== existing)])
    return existing
  }
  const used = untrack(pastedTextures)
  // Numbered by how many have been pasted this session, not by list position,
  // so removing one doesn't renumber the others out from under the artist.
  let n = used.length + 1
  while (used.some((t) => t.name === `Pasted ${n}`)) {
    n++
  }
  const entry: PastedTexture = {
    url: image.dataUrl,
    name: `Pasted ${n}`,
    width: image.width,
    height: image.height
  }
  setPastedTexturesRaw((prev) => [entry, ...prev].slice(0, MAX_PASTED_TEXTURES))
  return entry
}

/** Drops one pasted texture, deselecting it first if the brush is holding it. */
export function removePastedTexture(url: string): void {
  if (untrack(texturePath) === url) {
    setTexturePath(null)
  }
  setPastedTexturesRaw((prev) => prev.filter((t) => t.url !== url))
}

export function clearPastedTextures(): void {
  const current = untrack(texturePath)
  if (current && untrack(pastedTextures).some((t) => t.url === current)) {
    setTexturePath(null)
  }
  setPastedTexturesRaw([])
}

/** Display name for a pasted texture, or null if the path isn't one. */
export function pastedTextureName(url: string): string | null {
  return pastedTextures().find((t) => t.url === url)?.name ?? null
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
export function applyPressure(
  value: number,
  event: PointerEvent | undefined,
  enabled: boolean
): number {
  if (!enabled || !hasPressure(event)) {
    return value
  }
  const floor = pressureMin()
  return value * (floor + (1 - floor) * clamp(event!.pressure, 0, 1))
}

/** True when this pointer sample comes from a device that reports real pressure. */
export function hasPressure(event: PointerEvent | undefined): boolean {
  return !!event && (event.pointerType === 'pen' || event.pointerType === 'touch')
}

export function setTextureMapping(mode: BrushTextureMapping): void {
  const previous = untrack(textureMapping)
  if (previous !== mode) {
    scaleByMapping[previous] = untrack(textureScale)
    setTextureMappingRaw(mode)
    setTextureScaleRaw(scaleByMapping[mode])
    return
  }
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
const [selectedFaces, setSelectedFacesSignal] = createSignal<ReadonlySet<number>>(new Set())

/**
 * Hides the selection outline/wash without dropping the selection — for fine
 * work in a color close to the highlight's. Any change to the selection turns
 * it back on, so a selection can never silently outlive the moment the artist
 * chose to hide it.
 */
const [selectionHighlightHidden, setSelectionHighlightHiddenRaw] = createSignal(false)

export function setSelectionHighlightHidden(v: boolean): void {
  setSelectionHighlightHiddenRaw(v && selectedFaces().size > 0)
}

function setSelectedFacesRaw(next: ReadonlySet<number>): void {
  setSelectionHighlightHiddenRaw(false)
  setSelectedFacesSignal(next)
}

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
  // A crop is meaningful only for the image it was drawn on — carrying one
  // across to a different texture would silently paint a corner of it.
  setTextureRegionRaw({ x: 0, y: 0, w: 1, h: 1, rotation: 0 })
  // Same reasoning for the face projector's placement — a stale offset/scale
  // dialled in for one texture shouldn't silently apply to the next.
  setFaceProjectionRaw({
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    fit: faceProjection().fit
  })
  // Note: recordRecentTexture() is deliberately NOT called here — the "Used"
  // shelf tab tracks textures actually applied by a stroke/fill, not merely
  // browsed/selected. See applyToolAt/fillActive in Viewport.tsx.
  if (path && resetColor) {
    setColor('#ffffff')
  }
}

/**
 * Points the brush at a texture the app generated rather than one the artist
 * picked — currently the Text tool's rasterized string.
 *
 * Unlike setTexturePath this leaves the crop, the projector placement and the
 * paint color alone: the texture is regenerated on every keystroke, and
 * resetting the placement each time would throw away the offset/scale the
 * artist just dialled in.
 */
export function setGeneratedTexturePath(path: string | null): void {
  setMaterialSetRaw(null)
  setTexturePathRaw(path)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function setRadius(v: number): void {
  const { min, max } = radiusRange()
  setRadiusRaw(clamp(v, min, max))
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
export function setTextureRepeat(mode: BrushTextureRepeat): void {
  setTextureRepeatRaw(mode)
}

export function setTextureRegion(region: {
  x?: number
  y?: number
  w?: number
  h?: number
  rotation?: number
}): void {
  const current = textureRegion()
  // A zero-area crop would sample a single texel across the whole stroke, so
  // the size floor is small but never zero.
  const w = clamp(region.w ?? current.w, 0.01, 1)
  const h = clamp(region.h ?? current.h, 0.01, 1)
  setTextureRegionRaw({
    // Kept inside the image: an offset past 1 - size would sample off the edge,
    // which clamps to a smear of the border texels.
    x: clamp(region.x ?? current.x, 0, 1 - w),
    y: clamp(region.y ?? current.y, 0, 1 - h),
    w,
    h,
    rotation: region.rotation ?? current.rotation
  })
}

/** Back to the whole image. */
export function resetTextureRegion(): void {
  setTextureRegionRaw({ x: 0, y: 0, w: 1, h: 1, rotation: 0 })
}

export function setFaceProjection(next: {
  offsetX?: number
  offsetY?: number
  scaleX?: number
  scaleY?: number
  rotation?: number
  fit?: boolean
}): void {
  const current = faceProjection()
  setFaceProjectionRaw({
    fit: next.fit ?? current.fit,
    offsetX: next.offsetX ?? current.offsetX,
    offsetY: next.offsetY ?? current.offsetY,
    // A zero-or-negative scale would collapse the projection to nothing (or
    // flip it in a way the sliders don't expect); floor it just above zero.
    scaleX: Math.max(next.scaleX ?? current.scaleX, 0.01),
    scaleY: Math.max(next.scaleY ?? current.scaleY, 0.01),
    rotation: next.rotation ?? current.rotation
  })
}

/** Back to identity: no offset, unit scale, no rotation. */
export function resetFaceProjection(): void {
  setFaceProjectionRaw({
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    fit: faceProjection().fit
  })
}

/** True when only part of the source texture is in use. */
export function hasTextureRegion(): boolean {
  const r = textureRegion()
  return r.x !== 0 || r.y !== 0 || r.w !== 1 || r.h !== 1 || r.rotation !== 0
}

export function setTextureScale(v: number): void {
  const next = clamp(v, 0, 50)
  setTextureScaleRaw(next)
  // untrack: this setter is called from inside effects (choosing a material set
  // picks a scale). A tracked read here would make those effects depend on the
  // scale itself, so every slider drag would re-run them and they would set the
  // scale straight back — the slider would appear frozen.
  scaleByMapping[untrack(textureMapping)] = next
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
  if (current.has(faceIndex)) {
    return
  }
  const next = new Set<number>(current)
  next.add(faceIndex)
  setSelectedFacesRaw(next)
}

/** Removes a face from the selection. */
export function removeFaceFromSelection(faceIndex: number): void {
  const current = selectedFaces()
  if (!current.has(faceIndex)) {
    return
  }
  const next = new Set<number>(current)
  next.delete(faceIndex)
  setSelectedFacesRaw(next)
}

/** Adds/removes this face from the selection (spec: multi-select via shift+click). */
export function toggleFaceSelection(faceIndex: number): void {
  const next = new Set<number>(selectedFaces())
  if (next.has(faceIndex)) {
    next.delete(faceIndex)
  } else {
    next.add(faceIndex)
  }
  setSelectedFacesRaw(next)
}

export function selectAllFaces(totalFaces: number): void {
  const next = new Set<number>()
  for (let i = 0; i < totalFaces; i++) {
    next.add(i)
  }
  setSelectedFacesRaw(next)
}

export function invertFaceSelection(totalFaces: number): void {
  const current = selectedFaces()
  const next = new Set<number>()
  for (let i = 0; i < totalFaces; i++) {
    if (!current.has(i)) {
      next.add(i)
    }
  }
  setSelectedFacesRaw(next)
}

/** Replaces the selection wholesale, e.g. when recalling a saved selection group. */
export function setSelectedFaces(faces: Iterable<number>): void {
  setSelectedFacesRaw(new Set<number>(faces))
}

export function clearFaceSelection(): void {
  setSelectedFacesRaw(new Set<number>())
}

export const brush = {
  radius,
  sceneScale,
  setSceneScale,
  radiusRange,
  opacity,
  hardness,
  spacing,
  projectorDepth,
  setProjectorDepth,
  maxAngle,
  setMaxAngle,
  textureScale,
  setTextureScale,
  textureRegion,
  setTextureRegion,
  textureRepeat,
  setTextureRepeat,
  resetTextureRegion,
  hasTextureRegion,
  faceProjection,
  setFaceProjection,
  resetFaceProjection,
  color,
  setColor,
  texturePath,
  tipTexturePath,
  setTipTexturePath,
  selectedFaces,
  selectionHighlightHidden,
  setSelectionHighlightHidden,
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
  pastedTextures,
  pastedTextureName,
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
