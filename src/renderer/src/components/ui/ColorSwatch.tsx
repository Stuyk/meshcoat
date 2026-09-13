import { Show } from 'solid-js'
import { XIcon } from '../icons'

export interface ColorSwatchProps {
  color: string
  active?: boolean
  label?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  rounded?: 'full' | 'md'
  onClick?: (e: MouseEvent) => void
  onContextMenu?: (e: MouseEvent) => void
  onRemove?: (e: MouseEvent) => void
  title?: string
  class?: string
}

const SIZE_CLASSES = {
  xs: 'w-4 h-4',
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-8 h-8'
}

export default function ColorSwatch(props: ColorSwatchProps) {
  const sizeClass = () => (props.size ? SIZE_CLASSES[props.size] : 'w-full aspect-square')
  const roundedClass = () => (props.rounded === 'md' ? 'rounded-md' : 'rounded-full')

  return (
    <button
      type="button"
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      title={props.title ?? props.label ?? props.color.toUpperCase()}
      class={`group relative border transition-all cursor-pointer select-none ${sizeClass()} ${roundedClass()} ${
        props.active
          ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-950 border-white scale-110 z-10 shadow-xs'
          : 'border-white/15 hover:scale-110 hover:border-white/40'
      } ${props.class ?? ''}`}
      style={{ 'background-color': props.color }}
    >
      <Show when={props.onRemove}>
        <span
          onClick={(e) => {
            e.stopPropagation()
            props.onRemove?.(e)
          }}
          title="Remove swatch"
          class="opacity-0 group-hover:opacity-100 absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50 flex items-center justify-center transition-opacity shadow-xs cursor-pointer z-20"
        >
          <XIcon size={9} />
        </span>
      </Show>
    </button>
  )
}
