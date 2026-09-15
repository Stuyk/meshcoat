import { createSignal, createMemo, mergeProps, onCleanup } from 'solid-js'

export interface NumberInputProps {
  value: number
  onChange?: (val: number) => void
  min?: number
  max?: number
  step?: number
  precision?: number
  prefix?: string
  prefixColor?: string
  label?: string
  class?: string
  unit?: string
  title?: string
}

export function NumberInput(rawProps: NumberInputProps) {
  const props = mergeProps(
    {
      min: -Infinity,
      max: Infinity,
      step: 0.1,
      precision: 2,
      prefix: '',
      prefixColor: ''
    },
    rawProps
  )

  const [isEditing, setIsEditing] = createSignal(false)
  const [inputValue, setInputValue] = createSignal(String(props.value))
  const [isDragging, setIsDragging] = createSignal(false)

  let inputRef: HTMLInputElement | undefined
  let startX = 0
  let startVal = 0

  const formattedValue = createMemo(() => {
    return props.value.toFixed(props.precision)
  })

  const handleMouseDown = (e: MouseEvent) => {
    if (isEditing()) return
    startX = e.clientX
    startVal = props.value
    setIsDragging(true)

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const multiplier = moveEvent.shiftKey ? 0.1 : moveEvent.altKey ? 10 : 1
      const change = delta * (props.step * multiplier)
      let next = startVal + change
      if (next < props.min) next = props.min
      if (next > props.max) next = props.max
      const rounded = Number(next.toFixed(props.precision))
      if (props.onChange) {
        props.onChange(rounded)
      }
    }

    const onMouseUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleDoubleClick = () => {
    setInputValue(String(props.value))
    setIsEditing(true)
    setTimeout(() => {
      inputRef?.focus()
      inputRef?.select()
    }, 10)
  }

  const commitEdit = () => {
    setIsEditing(false)
    const parsed = parseFloat(inputValue())
    if (!isNaN(parsed)) {
      const clamped = Math.min(props.max, Math.max(props.min, parsed))
      const rounded = Number(clamped.toFixed(props.precision))
      if (props.onChange) {
        props.onChange(rounded)
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitEdit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  onCleanup(() => {
    setIsDragging(false)
  })

  const tooltip = () =>
    rawProps.title ??
    (rawProps.label
      ? `${rawProps.label}: ${formattedValue()}${props.unit ? ` ${props.unit}` : ''} (Click & drag to scrub, double click to type)`
      : `${formattedValue()}${props.unit ? ` ${props.unit}` : ''} (Click & drag to scrub, double click to type)`)

  return (
    <div
      title={tooltip()}
      class={`group relative flex items-center h-7 bg-[var(--bg-input)] border border-[var(--border-color)] hover:border-white/30 text-[var(--text-main)] text-xs font-mono transition-colors select-none ${
        isDragging()
          ? 'cursor-ew-resize border-[var(--accent-color)] ring-1 ring-[var(--accent-color)]'
          : 'cursor-ew-resize'
      } ${props.class || ''}`}
      style={{
        'border-radius': 'var(--ui-radius)'
      }}
      onMouseDown={handleMouseDown}
      onDblClick={handleDoubleClick}
    >
      {props.prefix && (
        <span
          class="px-2 font-bold text-[10px] select-none shrink-0"
          style={{
            color: props.prefixColor || 'var(--text-muted)'
          }}
        >
          {props.prefix}
        </span>
      )}

      {isEditing() ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue()}
          onInput={(e) => setInputValue(e.currentTarget.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          class="w-full h-full bg-transparent px-1.5 font-mono text-xs text-white focus:outline-none cursor-text"
        />
      ) : (
        <div class="flex-1 px-1.5 flex items-center justify-between overflow-hidden">
          <span class="truncate">{formattedValue()}</span>
          {props.unit && <span class="text-[10px] text-[var(--text-muted)] ml-1">{props.unit}</span>}
        </div>
      )}

      <div class="absolute bottom-0 left-0 right-0 h-[1.5px] bg-white/5 group-hover:bg-[var(--accent-color)]/50 transition-colors" />
    </div>
  )
}
export default NumberInput
