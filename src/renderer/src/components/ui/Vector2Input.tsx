import { NumberInput } from './NumberInput'

export interface Vector2 {
  x: number
  y: number
}

export interface Vector2InputProps {
  label?: string
  value: Vector2
  onChange?: (val: Vector2) => void
  step?: number
  unit?: string
  class?: string
}

export function Vector2Input(props: Vector2InputProps) {
  const updateAxis = (axis: 'x' | 'y', val: number) => {
    props.onChange?.({
      ...props.value,
      [axis]: val
    })
  }

  return (
    <div class={`space-y-1 select-none ${props.class || ''}`}>
      {props.label && (
        <span class="text-[9px] text-[var(--text-muted)] font-mono uppercase block">
          {props.label}
        </span>
      )}
      <div class="grid grid-cols-2 gap-1">
        <NumberInput
          prefix="U"
          prefixColor="#ef4444"
          value={props.value.x}
          onChange={(v) => updateAxis('x', v)}
          step={props.step ?? 0.05}
          unit={props.unit}
        />
        <NumberInput
          prefix="V"
          prefixColor="#22c55e"
          value={props.value.y}
          onChange={(v) => updateAxis('y', v)}
          step={props.step ?? 0.05}
          unit={props.unit}
        />
      </div>
    </div>
  )
}
export default Vector2Input
