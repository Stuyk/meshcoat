import { For, createSignal, onCleanup, type JSX } from 'solid-js'

export interface SliderPreset {
  label: string
  value: number
}

export interface SliderProps {
  label?: string
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
  showValue?: boolean
  title?: string
}

export default function Slider(props: SliderProps) {
  const [isDragging, setIsDragging] = createSignal(false)
  let trackRef: HTMLDivElement | undefined

  const step = () => props.step ?? 0.01

  const percentage = () => {
    const range = props.max - props.min
    if (range === 0) return 0
    return Math.min(100, Math.max(0, ((props.value - props.min) / range) * 100))
  }

  const formattedValue = () => {
    if (props.displayValue) {
      return props.displayValue(props.value)
    }
    if (props.unit) {
      return `${props.value}${props.unit}`
    }
    return String(props.value)
  }

  const updateFromPosition = (clientX: number) => {
    if (!trackRef || props.disabled) return
    const rect = trackRef.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const val = props.min + ratio * (props.max - props.min)
    const stp = step()
    const stepped = Math.round(val / stp) * stp
    const decimals = stp.toString().split('.')[1]?.length ?? 2
    const rounded = Number(stepped.toFixed(Math.min(4, decimals)))
    const clamped = Math.min(props.max, Math.max(props.min, rounded))
    props.onChange(clamped)
  }

  const handleMouseDown = (e: MouseEvent) => {
    if (props.disabled) return
    setIsDragging(true)
    updateFromPosition(e.clientX)

    const onMouseMove = (moveEvent: MouseEvent) => {
      updateFromPosition(moveEvent.clientX)
    }

    const onMouseUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  onCleanup(() => {
    setIsDragging(false)
  })

  const defaultTooltip = () => props.title ?? (props.label ? `${props.label}: ${formattedValue()}` : undefined)

  return (
    <div
      title={defaultTooltip()}
      class={`flex flex-col gap-1.5 select-none ${props.disabled ? 'opacity-40 pointer-events-none' : ''} ${props.class ?? ''}`}
    >
      {(props.label || props.showValue !== false) && (
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-1.5 text-[var(--text-main)] font-medium">
            {props.icon && <span class="text-[var(--text-muted)]">{props.icon({ size: 14 })}</span>}
            {props.label && <span>{props.label}</span>}
          </div>
          <span class="font-mono text-[var(--accent-color)] text-[11px] tabular-nums font-bold bg-[var(--bg-input)] px-2 py-0.5 rounded-[2px] border border-[var(--border-color)]">
            {formattedValue()}
          </span>
        </div>
      )}

      <div
        ref={trackRef}
        class="h-5 flex items-center cursor-pointer relative group"
        onMouseDown={handleMouseDown}
        title={defaultTooltip()}
      >
        <div class="w-full h-2 bg-[var(--bg-input)] border border-[var(--border-color)] relative rounded-[3px] overflow-hidden">
          <div
            class="h-full bg-[var(--accent-color)] group-hover:brightness-110 transition-all"
            style={{ width: `${percentage()}%` }}
          />
        </div>
        <div
          class="absolute w-3 h-4.5 border border-black/50 shadow-sm top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-[2px] group-hover:scale-110 transition-transform"
          style={{
            left: `${percentage()}%`,
            background: isDragging() ? 'var(--accent-color)' : '#e8e8ea'
          }}
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
                  title={`Set ${props.label ?? 'value'} to ${preset.label}`}
                  class={`px-2 py-0.5 text-[10px] font-mono font-medium rounded-[2px] border transition-colors cursor-pointer ${
                    isSelected()
                      ? 'bg-[var(--accent-color)] text-[var(--accent-text)] border-[var(--accent-color)] font-bold'
                      : 'bg-[var(--bg-panel)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5 border-[var(--border-color)]'
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
export { Slider }
