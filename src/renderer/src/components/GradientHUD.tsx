import { For, Show, type JSX } from 'solid-js'
import { brush } from '../paint/brush'
import { gradient } from '../paint/gradient'
import { colorLibrary } from '../paint/colorLibrary'
import { normalizeHex } from '../utils/colorUtils'
import { PlusIcon, RefreshCwIcon, Trash2Icon } from './icons'
import { Button, IconButton, Label, SegmentedControl, Slider } from './ui'

/**
 * Gradient tool settings (issue #6): the color stops, the ramp shape and what
 * happens past its ends. Drag in the viewport to apply; Shift snaps to 45°.
 */
export default function GradientHUD(): JSX.Element {
  const ordered = (): { stop: ReturnType<typeof gradient.stops>[number]; index: number }[] =>
    gradient
      .stops()
      .map((stop, index) => ({ stop, index }))
      .sort((a, b) => a.stop.position - b.stop.position)

  return (
    <div class="flex flex-col gap-3 p-3 text-xs">
      {/* Preview strip over a checkerboard, so transparent stops read as such */}
      <div class="h-6 rounded-md border border-zinc-700 overflow-hidden checkerboard-bg">
        <div class="w-full h-full" style={{ background: gradient.cssGradient() }} />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <SegmentedControl
          size="xs"
          options={[
            { value: 'linear', label: 'Linear', title: 'Ramp along the dragged line' },
            { value: 'radial', label: 'Radial', title: 'Ramp outward from where you press' }
          ]}
          value={gradient.shape()}
          onChange={gradient.setShape}
          class="w-full justify-between"
        />
        <SegmentedControl
          size="xs"
          options={[
            {
              value: 'extend',
              label: 'Extend',
              title: 'Past the ends, keep painting the end colors'
            },
            {
              value: 'clip',
              label: 'Clip',
              title: 'Past the ends, leave the surface untouched'
            }
          ]}
          value={gradient.ends()}
          onChange={gradient.setEnds}
          class="w-full justify-between"
        />
      </div>

      <div class="flex items-center justify-between">
        <Label uppercase badge={gradient.stops().length}>
          Stops
        </Label>
        <div class="flex items-center gap-1">
          <IconButton size="xs" onClick={gradient.reverseStops} tooltip="Reverse direction">
            <RefreshCwIcon size={12} />
          </IconButton>
          <Button
            variant="outline"
            size="xs"
            class="h-6 px-2 text-[11px]"
            onClick={() => gradient.addStop(normalizeHex(brush.color()))}
            title="Add a stop in the current paint color"
          >
            <PlusIcon size={11} />
            <span>Add</span>
          </Button>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <For each={ordered()}>
          {({ stop, index }) => (
            <div class="flex flex-col gap-1.5 p-2 rounded-md bg-zinc-950/60 border border-zinc-800">
              <div class="flex items-center gap-2">
                <label
                  class="relative w-7 h-7 shrink-0 rounded border border-white/25 overflow-hidden cursor-pointer checkerboard-bg"
                  title="Stop color — click for the system color dialog"
                >
                  <span
                    class="absolute inset-0"
                    style={{ 'background-color': stop.color, opacity: stop.opacity }}
                  />
                  <input
                    type="color"
                    class="absolute inset-0 opacity-0 cursor-pointer"
                    value={stop.color}
                    onInput={(e) => gradient.updateStop(index, { color: e.currentTarget.value })}
                  />
                </label>
                <button
                  type="button"
                  class="px-1.5 h-6 rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-300 hover:text-white cursor-pointer"
                  title="Set this stop to the current paint color"
                  onClick={() => gradient.updateStop(index, { color: normalizeHex(brush.color()) })}
                >
                  Use paint
                </button>
                <span class="ml-auto font-mono text-[10px] text-zinc-400">
                  {stop.color.toUpperCase()}
                </span>
                <IconButton
                  size="xs"
                  onClick={() => gradient.removeStop(index)}
                  disabled={gradient.stops().length <= 1}
                  tooltip="Remove stop"
                >
                  <Trash2Icon size={12} />
                </IconButton>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <Slider
                  label="Position"
                  value={stop.position}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => gradient.updateStop(index, { position: v })}
                />
                <Slider
                  label="Opacity"
                  value={stop.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => gradient.updateStop(index, { opacity: v })}
                />
              </div>
            </div>
          )}
        </For>
      </div>

      {/* One-click stops from the artist's own colors */}
      <Show when={colorLibrary.savedSwatches().length > 0}>
        <div class="flex flex-col gap-1">
          <span class="text-[10px] text-zinc-500">Click a saved color to add it as a stop</span>
          <div class="grid grid-cols-12 gap-1">
            <For each={colorLibrary.savedSwatches().slice(0, 24)}>
              {(col) => (
                <button
                  type="button"
                  class="w-full aspect-square rounded-full border border-white/20 hover:scale-110 transition-transform cursor-pointer"
                  style={{ 'background-color': col }}
                  title={`Add ${col.toUpperCase()} as a stop`}
                  onClick={() => gradient.addStop(col)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>

      <p class="text-[10px] text-zinc-500 leading-normal">
        Drag across the model to apply. Shift snaps to 45°. Uses the brush opacity, and stays inside
        any face selection.
      </p>
    </div>
  )
}
