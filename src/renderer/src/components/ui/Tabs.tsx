import { For, type JSX } from 'solid-js'

export interface TabItem {
  id: string
  label: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
}

export interface TabsProps {
  items: TabItem[]
  activeId: string
  onChange: (id: string) => void
  variant?: 'underline' | 'pill' | 'workstation'
  class?: string
}

export function Tabs(props: TabsProps) {
  const variant = () => props.variant || 'workstation'

  return (
    <div class={`flex items-center gap-1 select-none overflow-x-auto dcc-scroll ${props.class || ''}`}>
      <For each={props.items}>
        {(tab) => {
          const isActive = () => props.activeId === tab.id

          if (variant() === 'underline') {
            return (
              <button
                type="button"
                onClick={() => props.onChange(tab.id)}
                class={`h-7 px-3 text-[11px] font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  isActive()
                    ? 'border-[var(--accent-color)] text-[var(--accent-color)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {tab.icon && tab.icon({ size: 13 })}
                <span>{tab.label}</span>
              </button>
            )
          }

          if (variant() === 'pill') {
            return (
              <button
                type="button"
                onClick={() => props.onChange(tab.id)}
                class={`px-2.5 py-1 text-[11px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap rounded-[var(--ui-radius)] cursor-pointer ${
                  isActive()
                    ? 'bg-[var(--accent-color)] text-[var(--accent-text)] font-semibold'
                    : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-main)]'
                }`}
              >
                {tab.icon && tab.icon({ size: 12 })}
                <span>{tab.label}</span>
              </button>
            )
          }

          return (
            <button
              type="button"
              onClick={() => props.onChange(tab.id)}
              class={`h-6 px-2.5 text-[10px] uppercase font-bold tracking-wider transition-colors flex items-center gap-1 whitespace-nowrap border-t border-x cursor-pointer ${
                isActive()
                  ? 'bg-[var(--bg-panel)] text-[var(--text-main)] border-[var(--border-color)] border-b-transparent shadow-sm'
                  : 'bg-black/20 text-[var(--text-muted)] border-transparent hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              style={{
                'border-top-left-radius': 'var(--ui-radius)',
                'border-top-right-radius': 'var(--ui-radius)'
              }}
            >
              {tab.icon && tab.icon({ size: 11 })}
              <span>{tab.label}</span>
            </button>
          )
        }}
      </For>
    </div>
  )
}
export default Tabs
