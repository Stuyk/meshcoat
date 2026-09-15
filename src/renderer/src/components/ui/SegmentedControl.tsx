import { For, type JSX } from 'solid-js'

export interface SegmentOption<T> {
  value: T
  label?: string
  title?: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
}

export interface SegmentedControlProps<T> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'xs' | 'sm' | 'md'
  class?: string
}

const ITEM_SIZE_CLASSES = {
  xs: 'h-6 px-2 gap-1 text-[11px]',
  sm: 'h-7 px-3 gap-1.5 text-xs',
  md: 'h-8 px-3.5 gap-2 text-sm'
}

export default function SegmentedControl<T extends string | number>(
  props: SegmentedControlProps<T>
) {
  const size = () => props.size ?? 'sm'

  return (
    <div
      class={`inline-flex items-center bg-[var(--bg-input)] p-0.5 border border-[var(--border-color)] rounded-[var(--ui-radius)] gap-0.5 select-none ${
        props.class ?? ''
      }`}
    >
      <For each={props.options}>
        {(opt) => {
          const isSelected = () => props.value === opt.value
          return (
            <button
              type="button"
              title={opt.title ?? opt.label}
              onClick={() => props.onChange(opt.value)}
              class={`flex-1 inline-flex items-center justify-center font-medium transition-all cursor-pointer whitespace-nowrap rounded-[2px] ${
                ITEM_SIZE_CLASSES[size()]
              } ${
                isSelected()
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)] font-semibold shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
            >
              {opt.icon && opt.icon({ size: size() === 'xs' ? 12 : 14 })}
              {opt.label && <span>{opt.label}</span>}
            </button>
          )
        }}
      </For>
    </div>
  )
}
export { SegmentedControl }
