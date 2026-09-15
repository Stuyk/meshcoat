import { createSignal, type JSX } from 'solid-js'

export interface TooltipProps {
  content: string
  shortcut?: string
  children: JSX.Element
  position?: 'top' | 'bottom' | 'left' | 'right'
  class?: string
}

export function Tooltip(props: TooltipProps) {
  const [visible, setVisible] = createSignal(false)
  const pos = () => props.position || 'top'

  const posClasses = () => ({
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5'
  }[pos()])

  return (
    <div
      class={`relative inline-flex ${props.class || ''}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {props.children}

      {visible() && (
        <div
          class={`absolute z-50 pointer-events-none whitespace-nowrap bg-[#1a1a1c]/95 border border-[var(--border-color)] text-[var(--text-main)] text-[10px] px-2 py-1 rounded-[var(--ui-radius)] shadow-xl backdrop-blur flex items-center gap-1.5 ${posClasses()}`}
        >
          <span>{props.content}</span>
          {props.shortcut && (
            <kbd class="px-1 py-0.2 bg-white/10 rounded-[2px] text-[9px] font-mono text-[var(--accent-color)]">
              {props.shortcut}
            </kbd>
          )}
        </div>
      )}
    </div>
  )
}
export default Tooltip
