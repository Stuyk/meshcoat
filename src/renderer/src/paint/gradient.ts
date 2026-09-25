import { createSignal } from 'solid-js'
import { isValidHex, normalizeHex } from '../utils/colorUtils'

/**
 * Gradient tool state (issue #6): drag a line across the viewport and the
 * color ramp is projected onto whatever surface is visible under it.
 *
 * The ramp is rendered as a viewport-sized image and handed to the same
 * screen-space projection the stencil stamp uses (see stampStencil in
 * paintEngine.ts), so it inherits that pass's camera-visibility test, face
 * restriction and per-channel handling for free.
 */

export interface GradientStop {
  /** '#rrggbb' */
  color: string
  /** 0..1 */
  opacity: number
  /** 0..1 along the drag */
  position: number
}

export type GradientShape = 'linear' | 'radial'
/** Past the ends of the drag: keep the end colors, or leave the surface untouched. */
export type GradientEnds = 'extend' | 'clip'

const DEFAULT_STOPS: GradientStop[] = [
  { color: '#ffffff', opacity: 1, position: 0 },
  { color: '#000000', opacity: 1, position: 1 }
]

const [stops, setStopsRaw] = createSignal<GradientStop[]>(DEFAULT_STOPS)
const [shape, setShape] = createSignal<GradientShape>('linear')
const [ends, setEnds] = createSignal<GradientEnds>('extend')
/** The drag in progress, in canvas CSS pixels — drawn as a guide over the viewport. */
const [drag, setDrag] = createSignal<{ x0: number; y0: number; x1: number; y1: number } | null>(
  null
)

/** Keeps stops valid and ordered by position. */
export function normalizeStops(list: GradientStop[]): GradientStop[] {
  return list
    .filter((s) => isValidHex(s.color))
    .map((s) => ({
      color: normalizeHex(s.color),
      opacity: Math.min(1, Math.max(0, s.opacity)),
      position: Math.min(1, Math.max(0, s.position))
    }))
    .sort((a, b) => a.position - b.position)
}

export function setStops(list: GradientStop[]): void {
  const next = normalizeStops(list)
  if (next.length >= 1) {
    setStopsRaw(next)
  }
}

export function updateStop(index: number, patch: Partial<GradientStop>): void {
  const list = stops().slice()
  if (!list[index]) {
    return
  }
  list[index] = { ...list[index], ...patch }
  // Not re-sorted here: re-ordering under a slider being dragged would make
  // the handle jump to a different stop. Order is fixed at render time.
  setStopsRaw(list)
}

/** Adds a stop at the widest gap between existing stops. */
export function addStop(color: string): void {
  const list = normalizeStops(stops())
  let at = 0.5
  let widest = -1
  for (let i = 0; i < list.length - 1; i++) {
    const gap = list[i + 1].position - list[i].position
    if (gap > widest) {
      widest = gap
      at = (list[i].position + list[i + 1].position) / 2
    }
  }
  setStopsRaw([...list, { color, opacity: 1, position: at }])
}

export function removeStop(index: number): void {
  if (stops().length <= 1) {
    return
  }
  setStopsRaw(stops().filter((_, i) => i !== index))
}

export function reverseStops(): void {
  setStopsRaw(stops().map((s) => ({ ...s, position: 1 - s.position })))
}

/** CSS gradient for previews. */
export function cssGradient(list: GradientStop[] = stops()): string {
  const ordered = normalizeStops(list)
  const parts = ordered.map((s) => `${rgba(s.color, s.opacity)} ${Math.round(s.position * 100)}%`)
  return `linear-gradient(to right, ${parts.join(', ')})`
}

function rgba(hex: string, a: number): string {
  const n = parseInt(normalizeHex(hex).slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/**
 * Renders the gradient across a canvas the size of the viewport, from
 * (x0, y0) to (x1, y1) in canvas pixels. Linear ramps run along the drag and
 * are constant across it; radial ones grow from the start point out to the
 * drag length. With 'clip' ends, everything outside the ramp is transparent,
 * so the surface there keeps what it had.
 */
export function renderGradientCanvas(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  list: GradientStop[] = stops(),
  kind: GradientShape = shape(),
  endMode: GradientEnds = ends()
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return canvas
  }
  const ordered = normalizeStops(list)
  const length = Math.max(1, Math.hypot(x1 - x0, y1 - y0))
  const grad =
    kind === 'radial'
      ? ctx.createRadialGradient(x0, y0, 0, x0, y0, length)
      : ctx.createLinearGradient(x0, y0, x1, y1)
  for (const s of ordered) {
    grad.addColorStop(s.position, rgba(s.color, s.opacity))
  }
  ctx.fillStyle = grad

  if (endMode === 'extend') {
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas
  }

  // Clip to the ramp itself: a disc for radial, the band between the two
  // perpendiculars through the endpoints for linear.
  ctx.save()
  ctx.beginPath()
  if (kind === 'radial') {
    ctx.arc(x0, y0, length, 0, Math.PI * 2)
  } else {
    const dx = (x1 - x0) / length
    const dy = (y1 - y0) / length
    const far = Math.hypot(canvas.width, canvas.height) * 2
    // Perpendicular extent, long enough to cross the whole canvas.
    const px = -dy * far
    const py = dx * far
    ctx.moveTo(x0 + px, y0 + py)
    ctx.lineTo(x1 + px, y1 + py)
    ctx.lineTo(x1 - px, y1 - py)
    ctx.lineTo(x0 - px, y0 - py)
    ctx.closePath()
  }
  ctx.clip()
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.restore()
  return canvas
}

export const gradient = {
  stops,
  setStops,
  updateStop,
  addStop,
  removeStop,
  reverseStops,
  shape,
  setShape,
  ends,
  setEnds,
  drag,
  setDrag,
  cssGradient
}
