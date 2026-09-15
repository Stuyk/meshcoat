import { For, type JSX } from 'solid-js'
import { ChevronDownIcon } from '../icons'

export interface SelectOption<T = string | number> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectProps<T = string | number> {
  value: T
  onChange: (value: T) => void
  options?: SelectOption<T>[]
  size?: 'xs' | 'sm' | 'md'
  disabled?: boolean
  title?: string
  class?: string
  children?: JSX.Element
}

const SIZE_CLASSES = {
  xs: 'h-6.5 pl-2.5 pr-6.5 text-[11px]',
  sm: 'h-7.5 pl-3 pr-7.5 text-xs',
  md: 'h-8.5 pl-3.5 pr-8 text-sm'
}

export default function Select<T extends string | number>(props: SelectProps<T>) {
  const size = () => props.size ?? 'sm'

  return (
    <div class={`relative inline-flex items-center ${props.class ?? ''}`}>
      <select
        value={props.value}
        disabled={props.disabled}
        title={props.title}
        onChange={(e) => props.onChange(e.currentTarget.value as unknown as T)}
        class={`w-full appearance-none rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-main)] outline-hidden focus:border-[var(--accent-color)] focus:ring-1 focus:ring-[var(--accent-color)] cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none hover:border-white/30 ${
          SIZE_CLASSES[size()]
        }`}
      >
        {props.children ?? (
          <For each={props.options}>
            {(opt) => (
              <option value={opt.value} disabled={opt.disabled} class="bg-[#242426] text-[#e8e8ea]">
                {opt.label}
              </option>
            )}
          </For>
        )}
      </select>

      <span class="absolute right-2 pointer-events-none text-[var(--text-muted)] flex items-center">
        <ChevronDownIcon size={12} />
      </span>
    </div>
  )
}
export { Select }
