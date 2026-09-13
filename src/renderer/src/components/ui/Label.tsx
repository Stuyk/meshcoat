import { Show, type JSX } from 'solid-js'

export interface LabelProps {
  children: JSX.Element
  uppercase?: boolean
  badge?: string | number
  description?: string
  actions?: JSX.Element
  htmlFor?: string
  class?: string
}

export default function Label(props: LabelProps) {
  const isUppercase = () => props.uppercase ?? false

  return (
    <div class={`flex flex-col gap-0.5 select-none ${props.class ?? ''}`}>
      <div class="flex items-center justify-between gap-2">
        <label
          for={props.htmlFor}
          class={`flex items-center gap-1.5 ${
            isUppercase()
              ? 'text-[11px] font-semibold text-zinc-400 uppercase tracking-wider'
              : 'text-xs font-medium text-zinc-200'
          }`}
        >
          <span>{props.children}</span>
          <Show when={props.badge !== undefined}>
            <span class="px-1.5 py-0.2 rounded bg-zinc-800 border border-zinc-700/60 font-mono text-[10px] text-zinc-400 font-normal">
              {props.badge}
            </span>
          </Show>
        </label>

        <Show when={props.actions}>
          <div class="flex items-center gap-1.5 text-[11px] text-zinc-400">
            {props.actions}
          </div>
        </Show>
      </div>

      <Show when={props.description}>
        <span class="text-[11px] text-zinc-500 leading-normal">
          {props.description}
        </span>
      </Show>
    </div>
  )
}
