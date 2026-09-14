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

const SIZE_CLASSES = {
  xs: 'p-0.5 text-xs',
  sm: 'p-0.5 text-xs',
  md: 'p-1 text-sm'
}

const ITEM_SIZE_CLASSES = {
  xs: 'h-6 px-2 gap-1 text-[11px]',
  sm: 'h-7 px-2.5 gap-1.5 text-xs',
  md: 'h-8 px-3 gap-2 text-xs'
}

export default function SegmentedControl<T extends string | number>(
  props: SegmentedControlProps<T>
) {
  const size = () => props.size ?? 'sm'

  return (
    <div
      class={`inline-flex items-center bg-zinc-900 border border-zinc-750/70 rounded-lg select-none ${
        SIZE_CLASSES[size()]
      } ${props.class ?? ''}`}
    >
      <For each={props.options}>
        {(opt) => {
          const isSelected = () => props.value === opt.value
          return (
            <button
              type="button"
              title={opt.title ?? opt.label}
              onClick={() => props.onChange(opt.value)}
              class={`flex-1 inline-flex items-center justify-center font-medium rounded-md transition-all cursor-pointer whitespace-nowrap ${
                ITEM_SIZE_CLASSES[size()]
              } ${
                isSelected()
                  ? 'bg-zinc-800 text-zinc-100 shadow-xs border border-zinc-650/80 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
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
