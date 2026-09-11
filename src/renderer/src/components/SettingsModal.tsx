import { onMount, onCleanup, Show } from 'solid-js'
import { XIcon, SettingsIcon } from './icons'

export default function SettingsModal(props: { isOpen: boolean; onClose: () => void }) {
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && props.isOpen) {
      e.preventDefault()
      props.onClose()
    }
  }

  onMount(() => window.addEventListener('keydown', onKeyDown))
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  return (
    <Show when={props.isOpen}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <div class="modal-dialog settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
          <header class="modal-header">
            <div class="modal-title-wrap">
              <SettingsIcon size={17} class="text-blue-400" />
              <h2 class="modal-title">Settings</h2>
            </div>
            <button class="modal-close-btn" onClick={props.onClose} title="Close (Esc)">
              <XIcon size={16} />
            </button>
          </header>

          <div class="modal-body settings-body">
            <div class="settings-section">
              <div class="settings-row">
                <div class="settings-row-text">
                  <span class="settings-row-title">Nothing to configure yet</span>
                  <span class="settings-row-desc">Preferences will appear here as the paint tools come online.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
