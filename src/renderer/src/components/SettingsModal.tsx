import { Modal } from './ui'
import { SettingsIcon } from './icons'

export default function SettingsModal(props: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Settings"
      icon={(p) => <SettingsIcon size={p.size} class="text-blue-400" />}
      size="md"
    >
      <div class="p-6 text-center border border-zinc-800/80 rounded-xl bg-zinc-950/40">
        <div class="inline-flex p-3 rounded-md bg-zinc-800/60 text-zinc-400 mb-3">
          <SettingsIcon size={24} />
        </div>
        <h3 class="text-xs font-semibold text-zinc-200 mb-1">
          Preferences & Configuration
        </h3>
        <p class="text-[11px] text-zinc-500 max-w-sm mx-auto">
          Application settings and hotkey customizations will appear here as tool features expand.
        </p>
      </div>
    </Modal>
  )
}
