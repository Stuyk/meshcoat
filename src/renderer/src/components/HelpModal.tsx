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
                    <div class="shortcut-keys"><kbd>MMB</kbd> / <kbd>Alt</kbd>+<kbd>LMB</kbd></div>
                    <span class="shortcut-action">Orbit 3D view</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Shift</kbd>+<kbd>MMB</kbd> / <kbd>Alt</kbd>+<kbd>MMB</kbd></div>
                    <span class="shortcut-action">Pan 3D view</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Wheel</kbd> / <kbd>Alt</kbd>+<kbd>RMB</kbd></div>
                    <span class="shortcut-action">Zoom in / out</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>F</kbd> / <kbd>Home</kbd></div>
                    <span class="shortcut-action">Frame model in viewport</span>
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
                  <h3>Tools & Painting</h3>
                </div>
                <div class="shortcut-rows">
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>1</kbd> / <kbd>B</kbd></div>
                    <span class="shortcut-action">Brush tool</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>L</kbd></div>
                    <span class="shortcut-action">Line tool (click & drag straight lines on surface)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>2</kbd> / <kbd>E</kbd></div>
                    <span class="shortcut-action">Eraser tool (erases color, or conceals mask)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>3</kbd> / <kbd>T</kbd></div>
                    <span class="shortcut-action">Stamp decal tool (square reticle)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>4</kbd> / <kbd>G</kbd></div>
                    <span class="shortcut-action">Fill bucket (color or texture)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>5</kbd> / <kbd>I</kbd></div>
                    <span class="shortcut-action">Eyedropper color picker</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>6</kbd> / <kbd>V</kbd></div>
                    <span class="shortcut-action">Face selection tool</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>X</kbd></div>
                    <span class="shortcut-action">Swap B/W on mask, or toggle Solid Color</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>[</kbd> <kbd>]</kbd> / <kbd>Shift</kbd>+Wheel</div>
                    <span class="shortcut-action">Step brush radius or fill scale</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys">RMB+Drag X</div>
                    <span class="shortcut-action">Interactive brush radius</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Shift</kbd>+RMB+Drag</div>
                    <span class="shortcut-action">Adjust opacity & hardness</span>
                  </div>
                </div>
              </div>

              <div class="help-card">
                <div class="help-card-header">
                  <KeyboardIcon size={16} class="text-emerald-400" />
                  <h3>Face Selection & Edit</h3>
                </div>
                <div class="shortcut-rows">
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>A</kbd></div>
                    <span class="shortcut-action">Select all faces</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>D</kbd> / <kbd>Esc</kbd></div>
                    <span class="shortcut-action">Deselect all faces</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>I</kbd></div>
                    <span class="shortcut-action">Invert face selection</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+Drag</div>
                    <span class="shortcut-action">Paint-select faces (any tool)</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+Drag</div>
                    <span class="shortcut-action">Deselect painted faces</span>
                  </div>
                  <div class="shortcut-row">
                    <div class="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></div>
                    <span class="shortcut-action">Undo / Redo</span>
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
