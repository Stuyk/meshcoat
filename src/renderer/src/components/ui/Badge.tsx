import { Show, type JSX } from 'solid-js'

export interface BadgeProps {
  variant?: 'default' | 'primary' | 'amber' | 'success' | 'danger' | 'outline'
  size?: 'xs' | 'sm'
  dot?: boolean
  class?: string
  children: JSX.Element
}

const VARIANT_CLASSES = {
  default: 'bg-zinc-800 text-zinc-300 border-zinc-700/60',
  primary: 'bg-blue-950/60 text-blue-300 border-blue-800/60',
  amber: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  success: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  danger: 'bg-red-950/60 text-red-300 border-red-800/60',
  outline: 'bg-transparent text-zinc-400 border-zinc-700'
}

const DOT_CLASSES = {
  default: 'bg-zinc-400',
  primary: 'bg-blue-400',
  amber: 'bg-amber-400',
  success: 'bg-emerald-400',
  danger: 'bg-red-400',
  outline: 'bg-zinc-400'
}

export default function Badge(props: BadgeProps) {
  const variant = () => props.variant ?? 'default'
  const size = () => (props.size === 'xs' ? 'text-[10px] px-1.5 py-0.2 h-4.5' : 'text-xs px-2 py-0.5 h-5.5')

  return (
    <span
      class={`inline-flex items-center gap-1.5 font-medium border rounded-md select-none ${size()} ${
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
