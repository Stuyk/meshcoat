import { onMount, onCleanup, Show } from 'solid-js'
import { XIcon, HelpCircleIcon, KeyboardIcon } from './icons'

export default function HelpModal(props: { isOpen: boolean; onClose: () => void }) {
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && props.isOpen) {
      e.preventDefault()
      props.onClose()
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown)
  })

  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <Show when={props.isOpen}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <div class="modal-dialog help-dialog" onClick={(e) => e.stopPropagation()}>
          <header class="modal-header">
            <div class="modal-title-wrap">
              <HelpCircleIcon size={18} class="text-blue-400" />
              <h2 class="modal-title">Quick Guide & Hotkeys</h2>
            </div>
            <button class="modal-close-btn" onClick={props.onClose} title="Close guide (Esc)">
              <XIcon size={16} />
            </button>
          </header>

          <div class="modal-body help-body">
            <div class="help-sections-grid">
              <div class="help-card">
                <div class="help-card-header">
                  <KeyboardIcon size={16} class="text-blue-400" />
                  <h3>Viewport & Camera</h3>
                </div>
                <div class="shortcut-rows">
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Alt</kbd>+<kbd>LMB</kbd></div>
                    <span class="shortcut-action">Orbit (or MMB)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Alt</kbd>+<kbd>MMB</kbd></div>
                    <span class="shortcut-action">Pan (or Shift+MMB)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Alt</kbd>+<kbd>RMB</kbd></div>
                    <span class="shortcut-action">Zoom (or wheel)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>F</kbd></div>
                    <span class="shortcut-action">Focus selection / frame model</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>W</kbd></div>
                    <span class="shortcut-action">Toggle wireframe overlay</span>
                  </div>
                </div>
              </div>

              <div class="help-card">
                <div class="help-card-header">
                  <KeyboardIcon size={16} class="text-amber-400" />
                  <h3>Brush & Tools</h3>
                </div>
                <div class="shortcut-rows">
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>B</kbd></div>
                    <span class="shortcut-action">Brush</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>T</kbd></div>
                    <span class="shortcut-action">Stamp (place selected texture as a decal)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>E</kbd></div>
                    <span class="shortcut-action">Eraser</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>G</kbd></div>
                    <span class="shortcut-action">Fill bucket</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>I</kbd></div>
                    <span class="shortcut-action">Eyedropper</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>V</kbd></div>
                    <span class="shortcut-action">Face selection tool</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+Click / Drag</div>
                    <span class="shortcut-action">Select & highlight faces (any tool)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+Drag</div>
                    <span class="shortcut-action">Deselect faces</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Esc</kbd></div>
                    <span class="shortcut-action">Clear face selection</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>[</kbd> <kbd>]</kbd></div>
                    <span class="shortcut-action">Decrease / increase brush radius</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys">RMB+Drag X</div>
                    <span class="shortcut-action">Resize brush radius</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Shift</kbd>+RMB+Drag Y</div>
                    <span class="shortcut-action">Adjust opacity / hardness</span>
                  </div>
                </div>
              </div>

              <div class="help-card">
                <div class="help-card-header">
                  <KeyboardIcon size={16} class="text-emerald-400" />
                  <h3>File & Edit</h3>
                </div>
                <div class="shortcut-rows">
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Z</kbd></div>
                    <span class="shortcut-action">Undo</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Y</kbd></div>
                    <span class="shortcut-action">Redo</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>?</kbd></div>
                    <span class="shortcut-action">Toggle this guide</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <footer class="modal-footer">
            <span class="modal-hint">Press <kbd>Esc</kbd> or click outside to dismiss</span>
            <button class="btn-flat btn-primary" onClick={props.onClose}>
              Got It
            </button>
          </footer>
        </div>
      </div>
    </Show>
  )
}
