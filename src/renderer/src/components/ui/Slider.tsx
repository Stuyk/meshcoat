import { For, type JSX } from 'solid-js'

export interface SliderPreset {
  label: string
  value: number
}

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  displayValue?: (value: number) => string
  presets?: SliderPreset[]
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  disabled?: boolean
  class?: string
}

export default function Slider(props: SliderProps) {
  const formattedValue = () => {
    if (props.displayValue) return props.displayValue(props.value)
    if (props.unit) return `${props.value}${props.unit}`
    return String(props.value)
  }

  return (
    <div class={`flex flex-col gap-1.5 select-none ${props.class ?? ''}`}>
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-1.5 text-zinc-300 font-medium">
          {props.icon && (
            <span class="text-zinc-400">
              {props.icon({ size: 13 })}
            </span>
          )}
          <span>{props.label}</span>
        </div>
        <span class="font-mono text-zinc-400 bg-zinc-800/80 px-1.5 py-0.5 rounded border border-zinc-700/50 text-[11px] tabular-nums">
          {formattedValue()}
        </span>
      </div>

      <div class="relative flex items-center">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          disabled={props.disabled}
          onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
          class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:opacity-40"
        />
      </div>

      {props.presets && props.presets.length > 0 && (
        <div class="flex items-center gap-1 mt-0.5">
          <For each={props.presets}>
            {(preset) => {
              const isSelected = () => Math.abs(props.value - preset.value) < 0.001
              return (
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => props.onChange(preset.value)}
                  class={`px-1.5 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                    isSelected()
                      ? 'bg-blue-600/30 text-blue-300 border-blue-500/50'
                      : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-zinc-750/50'
                  }`}
                >
                  {preset.label}
                </button>
              )
            }}
          </For>
        </div>
      )}
    </div>
  )
}
