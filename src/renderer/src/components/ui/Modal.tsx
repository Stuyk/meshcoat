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
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px] animate-in fade-in duration-120"
        onClick={props.onClose}
      >
        <div
          class={`flex flex-col w-full ${sizeClass()} max-h-[90vh] bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl shadow-black/60 overflow-hidden animate-in zoom-in-95 duration-120`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <header class="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-850/60 select-none">
            <div class="flex items-center gap-2.5">
              {props.icon && (
                <div class="text-blue-400 flex items-center">
                  {props.icon({ size: 18 })}
                </div>
              )}
              <h2 class="text-sm font-semibold text-zinc-100 tracking-tight">
                {props.title}
              </h2>
            </div>
            <button
              type="button"
              class="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              onClick={props.onClose}
              title="Close (Esc)"
            >
              <XIcon size={16} />
            </button>
          </header>

          {/* Modal Body */}
          <div class="flex-1 overflow-y-auto p-5 space-y-4 text-sm text-zinc-300">
            {props.children}
          </div>

          {/* Modal Footer */}
          {props.footer && (
            <footer class="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-zinc-800 bg-zinc-900/60 select-none">
              {props.footer}
            </footer>
          )}
        </div>
      </div>
    </Show>
  )
}
