import { createSignal } from 'solid-js'

/**
 * Clone stamp tool state. The cloning itself happens in the paint shader (see
 * the uCloneMode block in paintShader.ts) and in viewportClone.ts.
 */

/** Clone from the active layer alone, or from everything visible (the flattened stack). */
export type CloneSample = 'layer' | 'all'

const [sample, setSample] = createSignal<CloneSample>('all')
/**
 * Aligned (the default in every image editor): the source moves with each
 * stroke, so successive strokes keep copying one continuous patch. Off, every
 * stroke starts again from the point that was Alt+clicked.
 */
const [aligned, setAligned] = createSignal(true)
const [hasSource, setHasSource] = createSignal(false)
/** Where the source sits on screen right now, in canvas CSS pixels — the crosshair. */
const [marker, setMarker] = createSignal<{ x: number; y: number } | null>(null)

export const clone = {
  sample,
  setSample,
  aligned,
  setAligned,
  hasSource,
  setHasSource,
  marker,
  setMarker
}
