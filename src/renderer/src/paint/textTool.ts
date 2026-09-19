import { createMemo, createSignal } from 'solid-js'
import {
  DEFAULT_TEXT_OPTIONS,
  renderTextTexture,
  type TextTexture,
  type TextTextureOptions
} from './textTexture'

/**
 * State for the Text tool. The rendered texture is derived, so every edit —
 * a keystroke, a font change, a nudge of the outline — re-rasterizes and the
 * projector preview on the model updates with it.
 */
const [options, setOptionsRaw] = createSignal<TextTextureOptions>({ ...DEFAULT_TEXT_OPTIONS })

const texture = createMemo<TextTexture | null>(() => renderTextTexture(options()))

export function setTextOptions(patch: Partial<TextTextureOptions>): void {
  setOptionsRaw((prev) => ({ ...prev, ...patch }))
}

export function resetTextOptions(): void {
  setOptionsRaw({ ...DEFAULT_TEXT_OPTIONS })
}

export const textTool = {
  options,
  texture,
  /** Data URL of the current text, or null when the box is empty. */
  dataUrl: (): string | null => texture()?.dataUrl ?? null
}
