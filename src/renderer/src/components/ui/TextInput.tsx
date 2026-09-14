import { Show, type JSX } from 'solid-js'
import { XIcon } from '../icons'

export interface TextInputProps {
  value: string
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onKeyDown?: (e: KeyboardEvent) => void
  placeholder?: string
  size?: 'xs' | 'sm' | 'md'
  mono?: boolean
  disabled?: boolean
  readOnly?: boolean
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  prefix?: string
  suffix?: JSX.Element
  clearable?: boolean
  autoFocus?: boolean
  autofocus?: boolean
  maxLength?: number
  spellcheck?: boolean
  class?: string
}

const SIZE_CLASSES = {
  xs: 'h-6 px-2 text-xs',
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm'
}

export default function TextInput(props: TextInputProps) {
  let inputRef: HTMLInputElement | undefined
  const size = () => props.size ?? 'sm'

  return (
    <div
      class={`relative flex items-center w-full bg-zinc-950/70 border border-zinc-800 rounded-md transition-colors focus-within:border-blue-500/80 focus-within:ring-1 focus-within:ring-blue-500/40 ${
        props.disabled ? 'opacity-40 pointer-events-none' : ''
      } ${props.class ?? ''}`}
    >
      <Show when={props.icon}>
        <span class="pl-2.5 text-zinc-500 pointer-events-none flex items-center shrink-0">
          {props.icon!({ size: size() === 'xs' ? 12 : 14 })}
        </span>
      </Show>

      <Show when={props.prefix}>
        <span class="pl-2.5 font-mono text-zinc-500 select-none text-xs shrink-0">
          {props.prefix}
        </span>
      </Show>

      <input
        ref={inputRef}
        type="text"
        value={props.value}
        disabled={props.disabled}
        readOnly={props.readOnly}
        maxLength={props.maxLength}
        spellcheck={props.spellcheck ?? false}
        placeholder={props.placeholder}
        autofocus={props.autoFocus ?? props.autofocus}
        onInput={(e) => props.onInput?.(e.currentTarget.value)}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
        onKeyDown={props.onKeyDown}
        class={`w-full bg-transparent text-zinc-100 placeholder-zinc-500 outline-hidden ${
          props.mono ? 'font-mono' : ''
        } ${SIZE_CLASSES[size()]}`}
      />

      <Show when={props.clearable && props.value && !props.disabled && !props.readOnly}>
        <button
          type="button"
          onClick={() => {
            props.onInput?.('')
            props.onChange?.('')
            inputRef?.focus()
          }}
          class="pr-2 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
          title="Clear"
        >
          <XIcon size={12} />
        </button>
      </Show>

      <Show when={props.suffix}>
        <div class="pr-2 shrink-0 flex items-center">{props.suffix}</div>
      </Show>
    </div>
  )
}
