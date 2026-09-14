import { type JSX } from 'solid-js'
import Kbd from './Kbd'

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'xs' | 'sm' | 'md'
  disabled?: boolean
  onClick?: (e: MouseEvent) => void
  type?: 'button' | 'submit' | 'reset'
  title?: string
  shortcut?: string
  class?: string
  children: JSX.Element
}

const VARIANT_CLASSES = {
  primary:
    'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white border-blue-500/80 shadow-xs',
  secondary: 'bg-zinc-850 hover:bg-zinc-800 active:bg-zinc-750 text-zinc-100 border-zinc-700/80',
  ghost:
    'bg-transparent hover:bg-zinc-850 active:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border-transparent hover:border-zinc-800',
  danger: 'bg-red-600/90 hover:bg-red-600 active:bg-red-700 text-white border-red-500/40',
  outline: 'bg-transparent hover:bg-zinc-850 text-zinc-300 border-zinc-700'
}

const SIZE_CLASSES = {
  xs: 'h-6 px-2 text-xs gap-1 rounded',
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md'
}

export default function Button(props: ButtonProps) {
  const variant = () => props.variant ?? 'secondary'
  const size = () => props.size ?? 'sm'

  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      class={`inline-flex items-center justify-center font-medium border transition-all select-none disabled:opacity-40 disabled:pointer-events-none cursor-pointer active:scale-[0.98] ${
        VARIANT_CLASSES[variant()]
      } ${SIZE_CLASSES[size()]} ${props.class ?? ''}`}
    >
      {props.children}
      {props.shortcut && (
        <span class="ml-1.5">
          <Kbd size="xs">{props.shortcut}</Kbd>
        </span>
      )}
    </button>
  )
}
