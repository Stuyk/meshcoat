import { Show } from 'solid-js'
import { SearchIcon, XIcon } from '../icons'
import Kbd from './Kbd'

export interface SearchInputProps {
  value: string
  onInput: (value: string) => void
  placeholder?: string
  shortcut?: string
  class?: string
  autoFocus?: boolean
}

export default function SearchInput(props: SearchInputProps) {
  let inputRef: HTMLInputElement | undefined

  return (
    <div class={`relative flex items-center w-full ${props.class ?? ''}`}>
      <span class="absolute left-2 text-[var(--text-muted)] pointer-events-none flex items-center">
        <SearchIcon size={12} />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder ?? 'Search...'}
        autofocus={props.autoFocus}
        class="w-full h-7 pl-7 pr-7 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-[var(--ui-radius)] text-[11px] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)] focus:ring-1 focus:ring-[var(--accent-color)] transition-colors"
      />
      <Show when={props.value}>
        <button
          type="button"
          onClick={() => {
            props.onInput('')
            inputRef?.focus()
          }}
          class="absolute right-1.5 p-0.5 rounded-[2px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/10 transition-colors cursor-pointer"
          title="Clear search"
        >
          <XIcon size={11} />
        </button>
      </Show>
      <Show when={!props.value && props.shortcut}>
        <div class="absolute right-1.5 pointer-events-none">
          <Kbd size="xs">{props.shortcut}</Kbd>
        </div>
      </Show>
    </div>
  )
}
export { SearchInput }
