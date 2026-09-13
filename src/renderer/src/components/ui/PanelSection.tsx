import { createSignal, Show, type JSX } from 'solid-js'
import { ChevronDownIcon } from '../icons'

export interface PanelSectionProps {
  title: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  badge?: string | number
  /** Short live state shown in the header, e.g. the current mode or value. */
  summary?: string | null
  defaultOpen?: boolean
  collapsible?: boolean
  /** Controlled open state. Omit to let the section manage its own. */
  open?: boolean
  onToggle?: () => void
  actions?: JSX.Element
  class?: string
  children: JSX.Element
}

/**
 * One collapsible section, drawn as a self-contained card.
 *
 * Sections used to be flush rows separated by a single hairline on a shared
 * background, which left an expanded body running straight into the next
 * header — with several open at once there was no telling where one ended. The
 * card treatment (gap between sections, a solid header bar with an accent edge,
 * and a body set darker than both) makes each section's extent obvious without
 * having to read the chevrons.
 */
export default function PanelSection(props: PanelSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(props.defaultOpen ?? true)
  const isCollapsible = (): boolean => props.collapsible ?? true
  const isOpen = (): boolean => (props.open !== undefined ? props.open : uncontrolledOpen())

  function toggle(): void {
    if (!isCollapsible()) return
    if (props.onToggle) props.onToggle()
    else setUncontrolledOpen((v) => !v)
  }

  return (
    <div
      class={`m-2 rounded-lg border overflow-hidden transition-colors ${
        isOpen()
          ? 'border-zinc-700 bg-zinc-900 shadow-lg shadow-black/30'
          : 'border-zinc-850 bg-zinc-900/40 hover:border-zinc-750'
      } ${props.class ?? ''}`}
    >
      <div
        class={`flex items-center gap-2 h-9 pl-2 pr-1.5 select-none transition-colors ${
          isCollapsible() ? 'cursor-pointer' : ''
        } ${
          isOpen()
            ? // An open section's header is its title bar: solid, with an accent
              // edge, so the body below reads as belonging to it.
              'bg-zinc-850 border-l-2 border-l-blue-500'
            : 'border-l-2 border-l-transparent hover:bg-zinc-850/60'
        }`}
        onClick={toggle}
      >
        {isCollapsible() && (
          <span
            class={`text-zinc-500 transition-transform duration-150 pointer-events-none ${
              isOpen() ? '' : '-rotate-90'
            }`}
          >
            <ChevronDownIcon size={12} />
          </span>
        )}
        {props.icon && <span class="text-blue-400 shrink-0">{props.icon({ size: 13 })}</span>}
        <span class="text-xs font-medium tracking-tight text-zinc-100">{props.title}</span>
        {props.badge !== undefined && (
          <span class="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-[10px] font-mono font-medium text-zinc-400">
            {props.badge}
          </span>
        )}

        <div class="ml-auto flex items-center gap-1.5">
          <Show when={props.summary}>
            <span class="text-[10px] text-zinc-500 truncate max-w-[110px]">{props.summary}</span>
          </Show>
          <Show when={props.actions}>
            <div class="flex items-center" onClick={(e) => e.stopPropagation()}>
              {props.actions}
            </div>
          </Show>
        </div>
      </div>

      <Show when={isOpen()}>
        {/* Inset body: darker than the header and the column behind it, which is
            what makes the section's extent obvious at a glance. */}
        <div class="px-3 py-3 space-y-3.5 bg-zinc-950/60 border-t border-zinc-800 text-xs text-zinc-300 animate-in fade-in-50 duration-100">
          {props.children}
        </div>
      </Show>
    </div>
  )
}
