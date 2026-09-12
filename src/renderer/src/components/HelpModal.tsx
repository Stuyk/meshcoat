import { Modal, Button } from './ui'
import { HelpCircleIcon, KeyboardIcon } from './icons'

export default function HelpModal(props: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Quick Guide & Hotkeys"
      icon={(p) => <HelpCircleIcon size={p.size} class="text-blue-400" />}
      size="xl"
      footer={
        <div class="flex items-center justify-between w-full">
          <span class="text-[11px] text-zinc-500">
            Press <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono">Esc</kbd> or click outside to dismiss
          </span>
          <Button variant="primary" onClick={props.onClose}>
            Got It
          </Button>
        </div>
      }
    >
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Section 1: Viewport & Camera */}
        <div class="p-3.5 bg-zinc-950/60 border border-zinc-800/80 rounded-xl flex flex-col gap-2.5">
          <div class="flex items-center gap-2 text-xs font-semibold text-zinc-200 border-b border-zinc-800/80 pb-2">
            <KeyboardIcon size={15} class="text-blue-400" />
            <h3>Viewport & Camera</h3>
          </div>
          <div class="space-y-2 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">MMB</kbd>
                <span class="text-zinc-500">/</span>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Alt</kbd>+<kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">LMB</kbd>
              </div>
              <span class="text-zinc-400 text-right">Orbit 3D view</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Shift</kbd>+<kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">MMB</kbd>
              </div>
              <span class="text-zinc-400 text-right">Pan 3D view</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Wheel</kbd>
              </div>
              <span class="text-zinc-400 text-right">Zoom in / out</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">F</kbd>
              </div>
              <span class="text-zinc-400 text-right">Frame model</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">W</kbd>
              </div>
              <span class="text-zinc-400 text-right">Toggle wireframe</span>
            </div>
          </div>
        </div>

        {/* Section 2: Tools & Painting */}
        <div class="p-3.5 bg-zinc-950/60 border border-zinc-800/80 rounded-xl flex flex-col gap-2.5">
          <div class="flex items-center gap-2 text-xs font-semibold text-zinc-200 border-b border-zinc-800/80 pb-2">
            <KeyboardIcon size={15} class="text-amber-400" />
            <h3>Tools & Painting</h3>
          </div>
          <div class="space-y-2 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">1</kbd>
                <span class="text-zinc-500">/</span>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">B</kbd>
              </div>
              <span class="text-zinc-400 text-right">Brush tool</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">L</kbd>
              </div>
              <span class="text-zinc-400 text-right">Line tool</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">2</kbd>
                <span class="text-zinc-500">/</span>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">E</kbd>
              </div>
              <span class="text-zinc-400 text-right">Eraser</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">3</kbd>
                <span class="text-zinc-500">/</span>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">T</kbd>
              </div>
              <span class="text-zinc-400 text-right">Stamp decal</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">4</kbd>
                <span class="text-zinc-500">/</span>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">G</kbd>
              </div>
              <span class="text-zinc-400 text-right">Fill bucket</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">5</kbd>
                <span class="text-zinc-500">/</span>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">I</kbd>
              </div>
              <span class="text-zinc-400 text-right">Eyedropper</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">7</kbd>
                <span class="text-zinc-500">/</span>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">U</kbd>
              </div>
              <span class="text-zinc-400 text-right">Effects brush (cycle)</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">S</kbd>
              </div>
              <span class="text-zinc-400 text-right">Screen Stencil</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">X</kbd>
              </div>
              <span class="text-zinc-400 text-right">Swap B/W or Solid Color</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">[</kbd>
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">]</kbd>
              </div>
              <span class="text-zinc-400 text-right">Step brush radius</span>
            </div>
          </div>
        </div>

        {/* Section 3: Face Selection & Edit */}
        <div class="p-3.5 bg-zinc-950/60 border border-zinc-800/80 rounded-xl flex flex-col gap-2.5">
          <div class="flex items-center gap-2 text-xs font-semibold text-zinc-200 border-b border-zinc-800/80 pb-2">
            <KeyboardIcon size={15} class="text-emerald-400" />
            <h3>Face Selection & Edit</h3>
          </div>
          <div class="space-y-2 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Ctrl</kbd>+<kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">A</kbd>
              </div>
              <span class="text-zinc-400 text-right">Select all faces</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Ctrl</kbd>+<kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">D</kbd>
              </div>
              <span class="text-zinc-400 text-right">Deselect all</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Ctrl</kbd>+<kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">I</kbd>
              </div>
              <span class="text-zinc-400 text-right">Invert face selection</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Ctrl</kbd>+Drag
              </div>
              <span class="text-zinc-400 text-right">Paint-select faces</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Ctrl</kbd>+<kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Z</kbd>
              </div>
              <span class="text-zinc-400 text-right">Undo</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Ctrl</kbd>+<kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Y</kbd>
              </div>
              <span class="text-zinc-400 text-right">Redo</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 font-mono text-[11px]">
                <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">?</kbd>
              </div>
              <span class="text-zinc-400 text-right">Toggle this guide</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
