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
  xs: 'h-6 pl-2 pr-6 text-[11px]',
  sm: 'h-8 pl-2.5 pr-7 text-xs',
  md: 'h-9 pl-3 pr-8 text-sm'
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
        class={`w-full appearance-none rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200 outline-hidden focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/40 cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none hover:border-zinc-700 ${
          SIZE_CLASSES[size()]
        }`}
      >
        {props.children ?? (
          <For each={props.options}>
            {(opt) => (
              <option value={opt.value} disabled={opt.disabled} class="bg-zinc-900 text-zinc-200">
                {opt.label}
              </option>
            )}
          </For>
        )}
      </select>
      <span class="absolute right-2 pointer-events-none text-zinc-500 flex items-center">
        <ChevronDownIcon size={size() === 'xs' ? 11 : 13} />
      </span>
    </div>
  )
}
