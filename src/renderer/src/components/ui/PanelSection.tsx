import { createSignal, Show, type JSX } from 'solid-js'
import { ChevronDownIcon } from '../icons'

export interface PanelSectionProps {
  title: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  badge?: string | number
  summary?: string | null
  defaultOpen?: boolean
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  actions?: JSX.Element
  class?: string
  children: JSX.Element
}

export default function PanelSection(props: PanelSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(props.defaultOpen ?? true)
  const isCollapsible = (): boolean => props.collapsible ?? true
  const isOpen = (): boolean => (props.open !== undefined ? props.open : uncontrolledOpen())

  function toggle(): void {
    if (!isCollapsible()) {
      return
    }
    if (props.onToggle) {
      props.onToggle()
    } else {
      setUncontrolledOpen((v) => !v)
    }
  }

  return (
    <div
      class={`m-2 rounded-[var(--ui-radius)] border overflow-hidden transition-colors ${
        isOpen()
          ? 'border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm'
          : 'border-[var(--border-color)] bg-[var(--bg-panel)]/60 hover:border-white/20'
      } ${props.class ?? ''}`}
    >
      <div
        class={`flex items-center gap-2 h-8 pl-2.5 pr-2 select-none transition-colors ${
          isCollapsible() ? 'cursor-pointer' : ''
        } ${
          isOpen()
            ? 'bg-[var(--bg-panel-header)] border-l-2 border-l-[var(--accent-color)]'
            : 'bg-[var(--bg-panel-header)]/80 border-l-2 border-l-transparent hover:bg-[var(--bg-panel-header)]'
        }`}
        onClick={toggle}
      >
        {isCollapsible() && (
          <span
            class={`text-[var(--text-muted)] transition-transform duration-150 pointer-events-none ${
              isOpen() ? '' : '-rotate-90'
            }`}
          >
            <ChevronDownIcon size={13} />
          </span>
        )}
        {props.icon && <span class="text-[var(--accent-color)] shrink-0">{props.icon({ size: 14 })}</span>}
        <span class="text-xs font-bold uppercase tracking-wider text-[var(--text-main)] truncate">{props.title}</span>
        {props.badge !== undefined && (
          <span class="px-1.5 py-0.2 rounded-[2px] bg-[var(--bg-input)] border border-[var(--border-color)] text-[10px] font-mono font-medium text-[var(--text-muted)]">
            {props.badge}
          </span>
        )}

        <div class="ml-auto flex items-center gap-1.5">
          <Show when={props.summary}>
            <span class="text-[11px] text-[var(--text-muted)] truncate max-w-[120px] font-mono">
              {props.summary}
            </span>
          </Show>
          <Show when={props.actions}>
            <div
              class="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {props.actions}
            </div>
          </Show>
        </div>
      </div>

      <Show when={isOpen()}>
        <div class="p-2.5 space-y-2.5 border-t border-[var(--border-color)] bg-[var(--bg-panel)]/40 text-xs">
          {props.children}
        </div>
      </Show>
    </div>
  )
}
export { PanelSection }
