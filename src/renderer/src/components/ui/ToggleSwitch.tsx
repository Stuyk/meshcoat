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
      class={`flex items-center justify-between w-full p-2 rounded-[var(--ui-radius)] border text-[11px] font-medium transition-colors cursor-pointer select-none disabled:opacity-40 disabled:pointer-events-none ${
        props.checked
          ? 'bg-[var(--accent-color)]/15 border-[var(--accent-color)]/50 text-[var(--text-main)]'
          : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-white/30'
      } ${props.class ?? ''}`}
    >
      <div class="flex items-center gap-2 min-w-0 pr-2">
        <Show when={props.icon}>
          <span class="text-[var(--accent-color)] shrink-0">{props.icon!({ size: 13 })}</span>
        </Show>
        <div class="flex flex-col text-left min-w-0">
          <span class="truncate">{props.label}</span>
          <Show when={props.description}>
            <span class="text-[9px] text-[var(--text-muted)] font-normal leading-tight mt-0.5">
              {props.description}
            </span>
          </Show>
        </div>
      </div>

      <div
        class={`relative w-7 h-4 rounded-full transition-colors shrink-0 p-0.5 ${
          props.checked ? 'bg-[var(--accent-color)]' : 'bg-[#18181a] border border-[var(--border-color)]'
        }`}
      >
        <div
          class={`w-3 h-3 rounded-full bg-white transition-transform ${
            props.checked ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  )
}
export { ToggleSwitch }
