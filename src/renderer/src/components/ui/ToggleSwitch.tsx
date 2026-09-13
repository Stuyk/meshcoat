import { Show, type JSX } from 'solid-js'

export interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: JSX.Element
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  description?: string
  disabled?: boolean
  title?: string
  class?: string
}

export default function ToggleSwitch(props: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      title={props.title}
      onClick={() => props.onChange(!props.checked)}
      class={`flex items-center justify-between w-full p-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none disabled:opacity-40 disabled:pointer-events-none ${
        props.checked
          ? 'bg-blue-600/15 border-blue-500/50 text-blue-300'
          : 'bg-zinc-950/40 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700'
      } ${props.class ?? ''}`}
    >
      <div class="flex items-center gap-2 min-w-0 pr-2">
        <Show when={props.icon}>
          <span class="text-blue-400 shrink-0">
            {props.icon!({ size: 14 })}
          </span>
        </Show>
        <div class="flex flex-col text-left min-w-0">
          <span class="truncate">{props.label}</span>
          <Show when={props.description}>
            <span class="text-[10px] text-zinc-500 font-normal leading-tight mt-0.5">{props.description}</span>
          </Show>
        </div>
      </div>

      <div
        class={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 p-0.5 ${
          props.checked ? 'bg-blue-600' : 'bg-zinc-800 border border-zinc-700'
        }`}
      >
        <div
          class={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
            props.checked ? 'translate-x-3.5' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  )
}
