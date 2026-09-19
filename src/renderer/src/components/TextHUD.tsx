import { Show, createSignal, lazy, Suspense, type JSX } from 'solid-js'
import { brush } from '../paint/brush'
import { textTool, setTextOptions, resetTextOptions } from '../paint/textTool'
import { RefreshCwIcon, FocusIcon, ChevronDownIcon } from './icons'
import { Button, Slider, SegmentedControl, ToggleSwitch, Label } from './ui'

const FontPickerModal = lazy(() => import('./FontPickerModal'))

export interface TextHUDProps {
  /** Rendered inside the tool panel dock rather than floating over the viewport. */
  docked?: boolean
  /** Bakes the text into the active layer across the current face selection. */
  onApply: () => void
}

/**
 * The Text tool: type a string, and it is rasterized to a transparent decal
 * that the Face UV Projector places on the selected faces. Placement (offset,
 * scale, rotation, fit/tile) lives in the projector panel, which is shown
 * alongside this one — the text itself is what's set here.
 *
 * Baked, not re-editable: once applied the glyphs are pixels in the layer, so
 * the way to change wording afterwards is to apply it to its own layer and
 * redo that layer.
 */
export default function TextHUD(props: TextHUDProps): JSX.Element {
  const [showFontPicker, setShowFontPicker] = createSignal(false)
  const opts = (): ReturnType<typeof textTool.options> => textTool.options()
  const hasSelection = (): boolean => brush.selectedFaces().size > 0
  const canApply = (): boolean => hasSelection() && !!textTool.dataUrl()

  return (
    <div
      class={
        props.docked
          ? 'w-full flex flex-col gap-2.5 select-none'
          : 'absolute bottom-4 right-[19.5rem] z-30 w-60 p-2.5 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-md shadow-2xl flex flex-col gap-2 select-none'
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      <textarea
        value={opts().text}
        onInput={(e) => setTextOptions({ text: e.currentTarget.value })}
        // Belt and braces: the app's shortcuts live on window, so a keystroke
        // that reaches it would also switch tools. Stopping here keeps typing
        // as typing even if this field ever loses focus mid-edit.
        onKeyDown={(e) => e.stopPropagation()}
        rows={2}
        spellcheck={false}
        placeholder="Type text..."
        class="w-full px-2 py-1.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-xs text-[var(--text-main)] outline-hidden focus:border-[var(--accent-color)] focus:ring-1 focus:ring-[var(--accent-color)] resize-y"
      />

      {/* Opens the picker rather than listing families inline: the row has to
          preview each face, and the real list is however many hundred the
          machine has. */}
      <button
        type="button"
        onClick={() => setShowFontPicker(true)}
        title="Choose a font"
        class="w-full h-7 px-2.5 flex items-center justify-between gap-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] hover:border-white/30 text-xs text-[var(--text-main)] cursor-pointer transition-colors"
      >
        <span class="truncate" style={{ 'font-family': `"${opts().fontFamily}"` }}>
          {opts().fontFamily}
        </span>
        <ChevronDownIcon size={13} class="text-[var(--text-muted)] shrink-0" />
      </button>

      <Suspense>
        <FontPickerModal
          isOpen={showFontPicker()}
          onClose={() => setShowFontPicker(false)}
          value={opts().fontFamily}
          sample={opts().text}
          onSelect={(family) => setTextOptions({ fontFamily: family })}
        />
      </Suspense>

      <div class="flex items-center gap-1.5">
        <SegmentedControl
          size="xs"
          class="flex-1"
          value={opts().align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' }
          ]}
          onChange={(v) => setTextOptions({ align: v as 'left' | 'center' | 'right' })}
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <ToggleSwitch
          checked={opts().bold}
          onChange={(v) => setTextOptions({ bold: v })}
          label="Bold"
        />
        <ToggleSwitch
          checked={opts().italic}
          onChange={(v) => setTextOptions({ italic: v })}
          label="Italic"
        />
      </div>

      {/* Font size is in texture pixels: it sets how crisp the glyphs are, not
          how big they land on the model — that's the projector's scale. */}
      <Slider
        label="Resolution"
        title="Glyph height in texture pixels — higher is crisper, placement size is set by the projector"
        value={opts().fontSize}
        min={32}
        max={512}
        step={8}
        onChange={(v) => setTextOptions({ fontSize: v })}
        displayValue={(v) => `${Math.round(v)}px`}
      />

      <div class="grid grid-cols-2 gap-2">
        <Slider
          label="Letter Spacing"
          value={opts().letterSpacing}
          min={-20}
          max={60}
          step={1}
          onChange={(v) => setTextOptions({ letterSpacing: v })}
          displayValue={(v) => `${Math.round(v)}`}
        />
        <Slider
          label="Line Height"
          value={opts().lineHeight}
          min={0.8}
          max={2.5}
          step={0.05}
          onChange={(v) => setTextOptions({ lineHeight: v })}
          displayValue={(v) => v.toFixed(2)}
        />
      </div>

      <div class="flex items-center gap-2">
        <Label uppercase>Fill</Label>
        <input
          type="color"
          value={opts().color}
          onInput={(e) => setTextOptions({ color: e.currentTarget.value })}
          class="w-7 h-6 rounded border border-[var(--border-color)] bg-transparent cursor-pointer"
          title="Text color"
        />
        <Label uppercase>Outline</Label>
        <input
          type="color"
          value={opts().outlineColor}
          onInput={(e) => setTextOptions({ outlineColor: e.currentTarget.value })}
          class="w-7 h-6 rounded border border-[var(--border-color)] bg-transparent cursor-pointer"
          title="Outline color"
        />
      </div>

      <Slider
        label="Outline Width"
        value={opts().outlineWidth}
        min={0}
        max={24}
        step={1}
        onChange={(v) => setTextOptions({ outlineWidth: v })}
        displayValue={(v) => (v === 0 ? 'Off' : `${Math.round(v)}px`)}
      />

      {/* Checkerboard behind it: the decal is transparent everywhere the
          glyphs aren't, and that's what lands on the model. */}
      <div class="w-full h-16 rounded-[var(--ui-radius)] border border-[var(--border-color)] checkerboard-bg flex items-center justify-center overflow-hidden">
        <Show
          when={textTool.dataUrl()}
          fallback={<span class="text-[10px] text-[var(--text-muted)]">Nothing to paint</span>}
        >
          <img
            src={textTool.dataUrl()!}
            alt="Text preview"
            class="max-w-full max-h-full object-contain"
            draggable={false}
          />
        </Show>
      </div>

      <p class="text-[10px] text-[var(--text-muted)] leading-snug">
        {hasSelection()
          ? `Applies to the ${brush.selectedFaces().size} selected face${brush.selectedFaces().size === 1 ? '' : 's'}. Place it with the Face UV Projector panel below.`
          : 'Click faces on the model to choose where the text goes.'}
      </p>

      <div class="flex items-center gap-1.5">
        <Button
          variant="primary"
          size="sm"
          class="flex-1"
          disabled={!canApply()}
          onClick={props.onApply}
        >
          <FocusIcon size={12} />
          Apply Text
        </Button>
        <Button variant="ghost" size="sm" onClick={resetTextOptions} title="Back to defaults">
          <RefreshCwIcon size={12} />
        </Button>
      </div>
    </div>
  )
}
