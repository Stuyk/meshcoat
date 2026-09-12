import { Show, For, type JSX } from 'solid-js'

export interface MenuItem {
  type?: 'item' | 'divider'
  label?: string
  shortcut?: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
}

export interface DropdownMenuProps {
  isOpen: boolean
  onClose: () => void
  items: MenuItem[]
  align?: 'left' | 'right'
  class?: string
}

export default function DropdownMenu(props: DropdownMenuProps) {
  const alignClass = () => (props.align === 'right' ? 'right-0' : 'left-0')

  return (
    <Show when={props.isOpen}>
      {/* Invisible backdrop to capture clicks outside */}
      <div class="fixed inset-0 z-40" onClick={props.onClose} />

      <div
        class={`absolute top-full mt-1 ${alignClass()} z-50 min-w-[210px] p-1 bg-zinc-900 border border-zinc-750/80 rounded-lg shadow-xl shadow-black/60 select-none animate-in fade-in zoom-in-95 duration-100 ${
          props.class ?? ''
        }`}
      >
        <For each={props.items}>
          {(item) => {
            if (item.type === 'divider') {
              return <div class="my-1 border-t border-zinc-800" />
            }
            return (
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  props.onClose()
                  item.onClick?.()
                }}
                class={`flex items-center justify-between w-full h-7 px-2.5 rounded text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                  item.danger
                    ? 'text-red-400 hover:bg-red-950/50 hover:text-red-300'
                    : 'text-zinc-200 hover:bg-blue-600 hover:text-white group'
                }`}
              >
                <div class="flex items-center gap-2">
                  {item.icon && (
                    <span class="text-zinc-400 group-hover:text-white">
                      {item.icon({ size: 14 })}
                    </span>
                  )}
                  <span>{item.label}</span>
                </div>
                {item.shortcut && (
                  <kbd class="ml-3 font-mono text-[10px] text-zinc-500 group-hover:text-blue-100">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
