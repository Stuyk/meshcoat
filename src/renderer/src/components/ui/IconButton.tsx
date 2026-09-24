import { type JSX } from 'solid-js'

export interface IconButtonProps {
  /**
   * This button is the ONE selected item of a mutually exclusive set (a tool).
   * Filled accent, because only one can be on at a time.
   */
  active?: boolean
  /**
   * This button is an independent on/off modifier that runs alongside whatever
   * is `active` (the screen stencil, a wizard). Deliberately a different look
   * from `active`: an outlined tint reads as "also on" rather than as a second
   * selected tool, which is what a shared style made it look like.
   */
  toggled?: boolean
  disabled?: boolean
  onClick?: (e: MouseEvent) => void
  type?: 'button' | 'submit' | 'reset'
  title?: string
  tooltip?: string
  shortcut?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  variant?: 'default' | 'ghost' | 'primary'
  class?: string
  children: JSX.Element
}

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-7.5 h-7.5 text-sm',
  md: 'w-9 h-9 text-base',
  lg: 'w-11 h-11 text-lg'
}

export default function IconButton(props: IconButtonProps) {
  const size = () => props.size ?? 'sm'
  const variant = () => props.variant ?? 'default'

  const baseStyle = () => {
    if (props.active) {
      return 'bg-[var(--accent-color)] text-[var(--accent-text)] border-[var(--accent-color)] font-bold shadow-sm'
    }
    if (props.toggled) {
      return 'bg-[var(--accent-color)]/15 border border-[var(--accent-color)]/70 text-[var(--accent-color)] hover:bg-[var(--accent-color)]/25'
    }
    if (variant() === 'primary') {
      return 'bg-[var(--accent-color)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)] border border-[var(--accent-color)] shadow-xs'
    }
    return 'bg-transparent border border-transparent hover:border-[var(--border-color)] hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-main)] active:bg-black/20'
  }

  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.tooltip ?? props.title}
      aria-pressed={props.toggled === undefined ? undefined : props.toggled}
      class={`dcc-bevel-button relative inline-flex items-center justify-center transition-all select-none disabled:opacity-40 disabled:pointer-events-none cursor-pointer rounded-[var(--ui-radius)] focus:outline-none ${
        SIZE_CLASSES[size()]
      } ${baseStyle()} ${props.class ?? ''}`}
    >
      {props.children}
      {props.shortcut && (
        <span class="absolute -bottom-1 -right-1 px-1 py-0 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-[2px] text-[9px] font-mono font-medium text-[var(--text-muted)] select-none pointer-events-none">
          {props.shortcut}
        </span>
      )}
    </button>
  )
}
export { IconButton }
