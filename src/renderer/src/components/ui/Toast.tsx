import { Show } from 'solid-js'
import { XIcon } from '../icons'

export interface ToastData {
  id: number
  text: string
  type: 'info' | 'success' | 'warning' | 'error'
}

export interface ToastProps {
  toast: ToastData | null
  onClose: () => void
}

const TYPE_CONFIG = {
  info: {
    border: 'border-blue-500/40',
    dot: 'bg-blue-400',
    bg: 'bg-zinc-900/95'
  },
  success: {
    border: 'border-emerald-500/40',
    dot: 'bg-emerald-400',
    bg: 'bg-zinc-900/95'
  },
  warning: {
    border: 'border-amber-500/40',
    dot: 'bg-amber-400',
    bg: 'bg-zinc-900/95'
  },
  error: {
    border: 'border-red-500/40',
    dot: 'bg-red-400',
    bg: 'bg-zinc-900/95'
  }
}

export default function Toast(props: ToastProps) {
  return (
    <Show when={props.toast}>
      {(t) => {
        const config = () => TYPE_CONFIG[t().type] ?? TYPE_CONFIG.info
        return (
          <div
            class={`fixed bottom-10 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2.5 px-3.5 py-2 rounded-lg border shadow-xl shadow-black/60 backdrop-blur-sm text-xs text-zinc-100 select-none animate-in fade-in slide-in-from-bottom-3 duration-150 cursor-pointer ${
              config().bg
            } ${config().border}`}
            onClick={props.onClose}
          >
            <span class={`w-2 h-2 rounded-full ${config().dot}`} />
            <span class="font-medium">{t().text}</span>
            <button
              type="button"
              class="ml-1 p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                props.onClose()
              }}
              title="Dismiss"
            >
              <XIcon size={12} />
            </button>
          </div>
        )
      }}
    </Show>
  )
}
