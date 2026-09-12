import { type JSX } from 'solid-js'

export interface IconButtonProps {
  active?: boolean
  disabled?: boolean
  onClick?: (e: MouseEvent) => void
  type?: 'button' | 'submit' | 'reset'
  title?: string
  shortcut?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  variant?: 'default' | 'ghost' | 'primary'
  class?: string
  children: JSX.Element
}

const SIZE_CLASSES = {
  xs: 'w-6 h-6 rounded text-xs',
  sm: 'w-8 h-8 rounded-md text-xs',
  md: 'w-9 h-9 rounded-md text-sm',
  lg: 'w-10 h-10 rounded-lg text-base'
}

export default function IconButton(props: IconButtonProps) {
  const size = () => props.size ?? 'sm'
  const variant = () => props.variant ?? 'default'

  const baseStyle = () => {
    if (props.active) {
      return 'bg-blue-600/15 text-blue-400 border border-blue-500/40 shadow-xs shadow-blue-950/20'
    }
    if (variant() === 'primary') {
      return 'bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700 border border-blue-500/50'
    }
    // Default flat desktop style: transparent by default, elevates on hover
    return 'bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 active:bg-zinc-800 border border-transparent hover:border-zinc-800'
  }

  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      class={`relative inline-flex items-center justify-center transition-all select-none disabled:opacity-40 disabled:pointer-events-none cursor-pointer active:scale-[0.95] ${
        SIZE_CLASSES[size()]
      } ${baseStyle()} ${props.class ?? ''}`}
    >
      {props.children}
      {props.shortcut && (
        <span class="absolute -bottom-1 -right-1 px-1 py-0 bg-zinc-900 border border-zinc-800 rounded text-[9px] font-mono font-medium text-zinc-500 select-none pointer-events-none">
          {props.shortcut}
        </span>
      )}
    </button>
  )
}
