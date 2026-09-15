import { type JSX } from 'solid-js'
import Kbd from './Kbd'

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'default' | 'accent'
  size?: 'xs' | 'sm' | 'md'
  disabled?: boolean
  onClick?: (e: MouseEvent) => void
  type?: 'button' | 'submit' | 'reset'
  title?: string
  shortcut?: string
  class?: string
  children?: JSX.Element
  active?: boolean
  icon?: JSX.Element
}

export default function Button(props: ButtonProps) {
  const variant = () => props.variant ?? 'secondary'
  const size = () => props.size ?? 'sm'

  const sizeClasses = {
    xs: 'h-6.5 px-2.5 text-xs gap-1.5',
    sm: 'h-7.5 px-3 text-xs gap-1.5',
    md: 'h-8.5 px-4 text-sm gap-2'
  }[size()]

  const variantClasses = () => {
    if (props.active) {
      return 'bg-[var(--accent-color)] text-[var(--accent-text)] font-semibold border-[var(--accent-color)] shadow-sm'
    }
    switch (variant()) {
      case 'primary':
        return 'bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] active:brightness-95 text-[var(--accent-text)] font-semibold border-transparent shadow-xs'
      case 'accent':
        return 'bg-[var(--accent-color)]/20 border border-[var(--accent-color)] text-[var(--text-main)] hover:bg-[var(--accent-color)]/30'
      case 'danger':
        return 'bg-red-600/80 hover:bg-red-600 active:bg-red-700 text-white border-red-500/40 shadow-xs'
      case 'outline':
        return 'bg-transparent border border-[var(--border-color)] hover:border-[var(--accent-color)] text-[var(--text-main)] hover:bg-white/5'
      case 'ghost':
        return 'bg-transparent hover:bg-white/10 active:bg-white/15 text-[var(--text-muted)] hover:text-[var(--text-main)] border-transparent'
      case 'default':
      case 'secondary':
      default:
        return 'bg-[var(--bg-panel)] hover:bg-[#38383e] active:bg-[#1e1e20] text-[var(--text-main)] border-[var(--border-color)] hover:border-[#42424a]'
    }
  }

  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      class={`dcc-bevel-button inline-flex items-center justify-center font-medium border transition-colors select-none focus:outline-none focus:ring-1 focus:ring-[var(--accent-color)] disabled:opacity-40 disabled:pointer-events-none cursor-pointer rounded-[var(--ui-radius)] ${sizeClasses} ${variantClasses()} ${props.class ?? ''}`}
    >
      {props.icon && <span class="shrink-0 flex items-center">{props.icon}</span>}
      {props.children}
      {props.shortcut && (
        <span class="ml-1.5">
          <Kbd size="xs">{props.shortcut}</Kbd>
        </span>
      )}
    </button>
  )
}
export { Button }
