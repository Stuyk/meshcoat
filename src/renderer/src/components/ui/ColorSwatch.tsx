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
  const roundedClass = () => (props.rounded === 'full' ? 'rounded-full' : 'rounded-[4px]')

  return (
    <button
      type="button"
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      title={props.title ?? props.label ?? props.color.toUpperCase()}
      class={`group relative border transition-all cursor-pointer select-none ${sizeClass()} ${roundedClass()} ${
        props.active
          ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-950 border-white scale-105 z-10 shadow-sm'
          : 'border-white/20 hover:scale-105 hover:border-white/50 hover:z-10 shadow-inner'
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
          class="opacity-0 group-hover:opacity-100 absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-black/85 border border-white/30 text-zinc-300 hover:text-white hover:bg-red-600 hover:border-red-600 flex items-center justify-center transition-all shadow-xs cursor-pointer z-20"
        >
          <XIcon size={8} />
        </span>
      </Show>
    </button>
  )
}
