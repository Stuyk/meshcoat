import { Show, For, type JSX } from 'solid-js'
import { ChevronRightIcon } from '../icons'

export interface MenuItem {
  type?: 'item' | 'divider' | 'header'
  label?: string
  shortcut?: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
  submenu?: MenuItem[]
}

export interface DropdownMenuProps {
  isOpen: boolean
  onClose: () => void
  items: MenuItem[]
  align?: 'left' | 'right'
  class?: string
}

function MenuList(props: { items: MenuItem[]; onClose: () => void }) {
  return (
    <For each={props.items}>
      {(item) => {
        if (item.type === 'divider') {
          return <div class="my-1.5 border-t border-zinc-800/80" />
        }
        if (item.type === 'header') {
          return (
            <div class="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 select-none">
              {item.label}
            </div>
          )
        }

        const hasSubmenu = () => Boolean(item.submenu && item.submenu.length > 0)

        return (
          <div class="relative group/sub">
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (hasSubmenu()) return
                props.onClose()
                item.onClick?.()
              }}
              class={`flex items-center justify-between w-full h-8 px-3 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                item.danger
                  ? 'text-red-400 hover:bg-red-950/50 hover:text-red-300'
                  : 'text-zinc-200 hover:bg-blue-600 hover:text-white group'
              }`}
            >
              <div class="flex items-center gap-2.5 min-w-0 pr-3">
                {item.icon && (
                  <span class="text-zinc-400 group-hover:text-white shrink-0">
                    {item.icon({ size: 14 })}
                  </span>
                )}
                <span class="whitespace-nowrap font-medium text-zinc-200 group-hover:text-white">
                  {item.label}
                </span>
              </div>

              <Show
                when={hasSubmenu()}
                fallback={
                  <Show when={item.shortcut}>
                    <kbd class="ml-auto pl-5 font-mono text-[10px] text-zinc-400 group-hover:text-blue-100 whitespace-nowrap shrink-0">
                      {item.shortcut}
                    </kbd>
                  </Show>
                }
              >
                <ChevronRightIcon
                  size={13}
                  class="ml-auto pl-3 text-zinc-500 group-hover:text-white shrink-0"
                />
              </Show>
            </button>

            {/* Flyout Submenu */}
            <Show when={hasSubmenu()}>
              <div class="hidden group-hover/sub:block group-focus-within/sub:block absolute left-full top-0 -ml-1 pl-2 z-50">
                <div class="min-w-[210px] w-max max-w-[340px] p-1.5 bg-zinc-900/98 backdrop-blur-md border border-zinc-750/90 rounded-xl shadow-2xl shadow-black/80 select-none">
                  <MenuList items={item.submenu!} onClose={props.onClose} />
                </div>
              </div>
            </Show>
          </div>
        )
      }}
    </For>
  )
}

export default function DropdownMenu(props: DropdownMenuProps) {
  const alignClass = () => (props.align === 'right' ? 'right-0' : 'left-0')

  return (
    <Show when={props.isOpen}>
      {/* Invisible backdrop to capture clicks outside */}
      <div class="fixed inset-0 z-40" onClick={props.onClose} />

      <div
        class={`absolute top-full mt-1.5 ${alignClass()} z-50 min-w-[240px] w-max max-w-[360px] p-1.5 bg-zinc-900/98 backdrop-blur-md border border-zinc-750/90 rounded-xl shadow-2xl shadow-black/80 select-none animate-in fade-in zoom-in-95 duration-100 ${
          props.class ?? ''
        }`}
      >
        <MenuList items={props.items} onClose={props.onClose} />
      </div>
    </Show>
  )
}
