import { Show, type JSX } from 'solid-js'

export interface BadgeProps {
  variant?: 'default' | 'primary' | 'accent' | 'amber' | 'success' | 'danger' | 'outline' | 'purple'
  size?: 'xs' | 'sm'
  dot?: boolean
  class?: string
  children: JSX.Element
}

const VARIANT_CLASSES = {
  default: 'bg-[var(--bg-input)] text-[var(--text-muted)] border-[var(--border-color)]',
  primary: 'bg-[var(--accent-color)]/20 text-[var(--accent-color)] border-[var(--accent-color)]/40',
  accent: 'bg-[var(--accent-color)] text-[var(--accent-text)] border-[var(--accent-color)] font-bold',
  amber: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  success: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  danger: 'bg-red-950/60 text-red-300 border-red-800/60',
  outline: 'bg-transparent text-[var(--text-muted)] border-[var(--border-color)]',
  purple: 'bg-purple-950/60 text-purple-300 border-purple-800/60'
}

const DOT_CLASSES = {
  default: 'bg-[var(--text-muted)]',
  primary: 'bg-[var(--accent-color)]',
  accent: 'bg-white',
  amber: 'bg-amber-400',
  success: 'bg-emerald-400',
  danger: 'bg-red-400',
  outline: 'bg-[var(--text-muted)]',
  purple: 'bg-purple-400'
}

export default function Badge(props: BadgeProps) {
  const variant = () => props.variant ?? 'default'
  const size = () =>
    props.size === 'xs' ? 'text-[9px] px-1.5 py-0.2 h-4 font-mono' : 'text-[10px] px-2 py-0.5 h-5 font-mono'

  return (
    <span
      class={`inline-flex items-center gap-1.5 font-medium border rounded-[var(--ui-radius)] select-none ${size()} ${
        VARIANT_CLASSES[variant()]
      } ${props.class ?? ''}`}
    >
      <Show when={props.dot}>
        <span class={`w-1.5 h-1.5 rounded-full ${DOT_CLASSES[variant()]}`} />
      </Show>
      {props.children}
    </span>
  )
}
export { Badge }
