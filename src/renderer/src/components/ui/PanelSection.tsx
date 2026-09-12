import { createSignal, Show, type JSX } from 'solid-js'
import { ChevronDownIcon } from '../icons'

export interface PanelSectionProps {
  title: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  badge?: string | number
  defaultOpen?: boolean
  collapsible?: boolean
  actions?: JSX.Element
  class?: string
  children: JSX.Element
}

export default function PanelSection(props: PanelSectionProps) {
  const [isOpen, setIsOpen] = createSignal(props.defaultOpen ?? true)
  const isCollapsible = () => props.collapsible ?? true

  return (
    <div class={`flex flex-col border-b border-zinc-800/80 last:border-b-0 ${props.class ?? ''}`}>
      <div
        class={`flex items-center justify-between px-3.5 py-2.5 bg-zinc-900/50 hover:bg-zinc-850/60 select-none transition-colors ${
          isCollapsible() ? 'cursor-pointer' : ''
        }`}
        onClick={() => isCollapsible() && setIsOpen((v) => !v)}
      >
        <div class="flex items-center gap-2 text-xs font-semibold tracking-tight text-zinc-200">
          {props.icon && (
            <span class="text-zinc-400">
              {props.icon({ size: 14 })}
            </span>
          )}
          <span>{props.title}</span>
          {props.badge !== undefined && (
            <span class="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-[10px] font-mono font-medium text-zinc-400">
              {props.badge}
            </span>
          )}
        </div>

        <div class="flex items-center gap-1.5">
          <Show when={props.actions}>
            <div class="flex items-center" onClick={(e) => e.stopPropagation()}>{props.actions}</div>
          </Show>
          {isCollapsible() && (
            <span
              class={`text-zinc-400 transition-transform duration-150 pointer-events-none ${
                isOpen() ? '' : '-rotate-90'
              }`}
            >
              <ChevronDownIcon size={14} />
            </span>
          )}
        </div>
      </div>

      <Show when={isOpen()}>
        <div class="p-3.5 space-y-3.5 text-xs text-zinc-300 animate-in fade-in-50 duration-100">
          {props.children}
        </div>
      </Show>
    </div>
  )
}
