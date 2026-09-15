import { Show, type JSX } from 'solid-js'
import { CheckIcon } from '../icons'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: JSX.Element
  description?: string
  subtext?: string
  disabled?: boolean
  class?: string
}

export default function Checkbox(props: CheckboxProps) {
  return (
    <label
      class={`inline-flex items-start gap-2 select-none cursor-pointer group ${
        props.disabled ? 'opacity-40 pointer-events-none' : ''
      } ${props.class ?? ''}`}
    >
      <div class="relative flex items-center justify-center mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
          class="sr-only"
        />
        <div
          class={`w-3.5 h-3.5 rounded-[var(--ui-radius)] border transition-all flex items-center justify-center ${
            props.checked
              ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--accent-text)] shadow-xs'
              : 'bg-[var(--bg-input)] border-[var(--border-color)] group-hover:border-white/30'
          }`}
        >
          <Show when={props.checked}>
            <CheckIcon size={10} class="stroke-[3]" />
          </Show>
        </div>
      </div>

      {(props.label || props.description) && (
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-main)]">
            {props.label}
            <Show when={props.subtext}>
              <span class="text-[9px] text-[var(--text-muted)] font-mono font-normal">{props.subtext}</span>
            </Show>
          </div>
          <Show when={props.description}>
            <span class="text-[10px] text-[var(--text-muted)] leading-normal">{props.description}</span>
          </Show>
        </div>
      )}
    </label>
  )
}
export { Checkbox }
