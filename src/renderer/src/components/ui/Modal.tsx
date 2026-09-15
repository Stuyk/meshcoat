import { onMount, onCleanup, Show, type JSX } from 'solid-js'
import { XIcon } from '../icons'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  icon?: (props: { size?: number; class?: string }) => JSX.Element
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  children: JSX.Element
  footer?: JSX.Element
}

const SIZE_CLASSES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl'
}

export default function Modal(props: ModalProps) {
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && props.isOpen) {
      e.preventDefault()
      props.onClose()
    }
  }

  onMount(() => window.addEventListener('keydown', onKeyDown))
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  const sizeClass = () => SIZE_CLASSES[props.size ?? 'md']

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-[2px] animate-in fade-in duration-100"
        onClick={props.onClose}
      >
        <div
          class={`flex flex-col w-full ${sizeClass()} max-h-[90vh] bg-[var(--bg-panel)] border border-[var(--border-color)] rounded-[var(--ui-radius)] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-100`}
          onClick={(e) => e.stopPropagation()}
        >
          <header class="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] select-none">
            <div class="flex items-center gap-2">
              {props.icon && (
                <div class="text-[var(--accent-color)] flex items-center">{props.icon({ size: 16 })}</div>
              )}
              <h2 class="text-xs font-bold text-[var(--text-main)] tracking-tight uppercase">{props.title}</h2>
            </div>
            <button
              type="button"
              class="p-1 rounded-[2px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/10 transition-colors cursor-pointer"
              onClick={props.onClose}
              title="Close (Esc)"
            >
              <XIcon size={14} />
            </button>
          </header>

          <div class="flex-1 overflow-y-auto dcc-scroll p-4 space-y-3.5 text-xs text-[var(--text-main)]">
            {props.children}
          </div>

          {props.footer && (
            <footer class="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[var(--border-color)] bg-[var(--bg-panel-header)]/60 select-none">
              {props.footer}
            </footer>
          )}
        </div>
      </div>
    </Show>
  )
}
export { Modal }
