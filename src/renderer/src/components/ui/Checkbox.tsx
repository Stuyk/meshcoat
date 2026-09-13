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
          class={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
            props.checked
              ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
              : 'bg-zinc-950/70 border-zinc-700/80 group-hover:border-zinc-500'
          }`}
        >
          <Show when={props.checked}>
            <CheckIcon size={12} class="stroke-[3]" />
          </Show>
        </div>
      </div>

      {(props.label || props.description) && (
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
            {props.label}
            <Show when={props.subtext}>
              <span class="text-[10px] text-zinc-500 font-mono font-normal">{props.subtext}</span>
            </Show>
          </div>
          <Show when={props.description}>
            <span class="text-[11px] text-zinc-400 leading-normal">{props.description}</span>
          </Show>
        </div>
      )}
    </label>
  )
}
