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
  prefix?: string | JSX.Element
  suffix?: JSX.Element
  clearable?: boolean
  autoFocus?: boolean
  autofocus?: boolean
  maxLength?: number
  spellcheck?: boolean
  class?: string
}

const SIZE_CLASSES = {
  xs: 'h-6.5 px-2.5 text-[11px]',
  sm: 'h-7.5 px-3 text-xs',
  md: 'h-8.5 px-3.5 text-sm'
}

export default function TextInput(props: TextInputProps) {
  let inputRef: HTMLInputElement | undefined
  const size = () => props.size ?? 'sm'

  return (
    <div
      class={`relative flex items-center w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-[var(--ui-radius)] transition-colors focus-within:border-[var(--accent-color)] focus-within:ring-1 focus-within:ring-[var(--accent-color)] ${
        props.disabled ? 'opacity-40 pointer-events-none' : ''
      } ${props.class ?? ''}`}
    >
      <Show when={props.icon}>
        <span class="pl-2.5 text-[var(--text-muted)] pointer-events-none flex items-center shrink-0">
          {props.icon!({ size: size() === 'xs' ? 12 : 14 })}
        </span>
      </Show>

      <Show when={props.prefix}>
        <span class="pl-2.5 font-mono text-[var(--text-muted)] select-none text-[11px] shrink-0">
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
        autofocus={props.autoFocus ?? props.autofocus}
        placeholder={props.placeholder}
        onInput={(e) => props.onInput?.(e.currentTarget.value)}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
        onKeyDown={props.onKeyDown}
        class={`w-full bg-transparent text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none border-none ${
          props.mono ? 'font-mono' : ''
        } ${SIZE_CLASSES[size()]}`}
      />

      <Show when={props.clearable && props.value}>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            props.onInput?.('')
            props.onChange?.('')
            inputRef?.focus()
          }}
          class="mr-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer p-0.5"
          title="Clear text"
        >
          <XIcon size={13} />
        </button>
      </Show>

      <Show when={props.suffix}>
        <span class="pr-2.5 flex items-center shrink-0">{props.suffix}</span>
      </Show>
    </div>
  )
}
export { TextInput }
