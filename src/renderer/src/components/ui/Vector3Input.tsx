import { createSignal } from 'solid-js'
import { NumberInput } from './NumberInput'
import { Lock, Unlock } from 'lucide-solid'

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Vector3InputProps {
  label?: string
  value: Vector3
  onChange?: (val: Vector3) => void
  step?: number
  unit?: string
  allowLock?: boolean
  class?: string
}

export function Vector3Input(props: Vector3InputProps) {
  const [locked, setLocked] = createSignal(false)

  const updateAxis = (axis: 'x' | 'y' | 'z', newVal: number) => {
    if (locked()) {
      const currentAxisVal = props.value[axis]
      const ratio = currentAxisVal !== 0 ? newVal / currentAxisVal : 1
      props.onChange?.({
        x: Number((props.value.x * ratio).toFixed(3)),
        y: Number((props.value.y * ratio).toFixed(3)),
        z: Number((props.value.z * ratio).toFixed(3))
      })
    } else {
      props.onChange?.({
        ...props.value,
        [axis]: newVal
      })
    }
  }

  return (
    <div class={`space-y-1 select-none ${props.class || ''}`}>
      <div class="flex items-center justify-between text-[9px] text-[var(--text-muted)] font-mono uppercase">
        <span>{props.label || 'Vector3'}</span>
        {props.allowLock && (
          <button
            type="button"
            class={`p-0.5 hover:text-white transition-colors ${locked() ? 'text-[var(--accent-color)]' : 'text-gray-500'}`}
            onClick={() => setLocked(!locked())}
            title={locked() ? 'Locked aspect ratio' : 'Unlocked axes'}
          >
            {locked() ? <Lock size={10} /> : <Unlock size={10} />}
          </button>
        )}
      </div>

      <div class="grid grid-cols-3 gap-1">
        <NumberInput
          prefix="X"
          prefixColor="#ef4444"
          value={props.value.x}
          onChange={(v) => updateAxis('x', v)}
          step={props.step ?? 0.1}
          unit={props.unit}
        />
        <NumberInput
          prefix="Y"
          prefixColor="#22c55e"
          value={props.value.y}
          onChange={(v) => updateAxis('y', v)}
          step={props.step ?? 0.1}
          unit={props.unit}
        />
        <NumberInput
          prefix="Z"
          prefixColor="#3b82f6"
          value={props.value.z}
          onChange={(v) => updateAxis('z', v)}
          step={props.step ?? 0.1}
          unit={props.unit}
        />
      </div>
    </div>
  )
}
export default Vector3Input
