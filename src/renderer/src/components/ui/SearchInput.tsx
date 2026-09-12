import { Show } from 'solid-js'
import { SearchIcon, XIcon } from '../icons'

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
      <span class="absolute left-2.5 text-zinc-500 pointer-events-none flex items-center">
        <SearchIcon size={14} />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder ?? 'Search...'}
        autofocus={props.autoFocus}
        class="w-full h-8 pl-8 pr-8 bg-zinc-900 border border-zinc-750/70 rounded-md text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
      />
      <Show when={props.value}>
        <button
          type="button"
          onClick={() => {
            props.onInput('')
            inputRef?.focus()
          }}
          class="absolute right-2 p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          title="Clear search"
        >
          <XIcon size={13} />
        </button>
      </Show>
      <Show when={!props.value && props.shortcut}>
        <kbd class="absolute right-2 px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-500 pointer-events-none">
          {props.shortcut}
        </kbd>
      </Show>
    </div>
  )
}
