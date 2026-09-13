import { createSignal, Show, For } from 'solid-js'
import { Modal, Button } from './ui'
import { CubeIcon, FolderOpenIcon, CheckIcon, AppIcon } from './icons'
import { TEXTURE_SIZE_OPTIONS, DEFAULT_TEXTURE_SIZE, type TextureSize } from '../paint/paintEngine'

const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'blend']

const SIZE_DESCRIPTIONS: Record<TextureSize, { label: string; desc: string }> = {
  512: { label: 'Low-Res (512×512)', desc: 'Fastest performance, ideal for testing' },
  1024: { label: 'Standard (1024×1024)', desc: 'Balanced detail & speed' },
  2048: { label: 'High-Res (2048×2048)', desc: 'Crisp textures, detailed models (Recommended)' },
  4096: { label: 'Ultra 4K (4096×4096)', desc: 'Maximum sharpness for production assets' },
  8192: { label: 'Ultra 8K (8192×8192)', desc: 'Extreme detail, requires high VRAM' }
}

export default function NewProjectModal(props: {
  isOpen: boolean
  onClose: () => void
  onImport: (path: string, textureSize: TextureSize) => Promise<void>
}) {
  const [modelPath, setModelPath] = createSignal<string | null>(null)
  const [textureSize, setTextureSize] = createSignal<TextureSize>(DEFAULT_TEXTURE_SIZE)
  const [importing, setImporting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  function reset(): void {
    setModelPath(null)
    setTextureSize(DEFAULT_TEXTURE_SIZE)
    setImporting(false)
    setError(null)
  }

  function close(): void {
    if (importing()) return
    reset()
    props.onClose()
  }

  async function browse(): Promise<void> {
    const paths = await window.api.openFileDialog({ filters: [{ name: 'Models', extensions: MODEL_EXTENSIONS }] })
    const path = paths?.[0]
    if (path) {
      setModelPath(path)
      setError(null)
    }
  }

  async function runImport(): Promise<void> {
    const path = modelPath()
    if (!path) return
    setImporting(true)
    setError(null)
    try {
      await props.onImport(path, textureSize())
      reset()
      props.onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setImporting(false)
    }
  }

  const filename = () => modelPath()?.split('/').pop() ?? ''

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={close}
      title="New Project"
      icon={(p) => <AppIcon size={p.size} />}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={importing()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!modelPath() || importing()}
            onClick={runImport}
          >
            {importing() ? 'Loading Model...' : 'Create Project'}
          </Button>
        </>
      }
    >
      {/* Step 1: Model Selection */}
      <div class="space-y-2">
        <label class="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <span class="w-5 h-5 rounded-md bg-blue-600/30 text-blue-400 flex items-center justify-center text-[11px] font-mono">
            1
          </span>
          Select 3D Model
        </label>

        <Show
          when={modelPath()}
          fallback={
            <div
              onClick={browse}
              class="flex flex-col items-center justify-center p-6 border-2 border-dashed border-zinc-700 hover:border-blue-500/70 rounded-xl bg-zinc-950/40 hover:bg-zinc-850/40 transition-all cursor-pointer group"
            >
              <div class="p-3 rounded-md bg-zinc-800/80 text-zinc-400 group-hover:text-blue-400 group-hover:scale-105 transition-all mb-3">
                <FolderOpenIcon size={24} />
              </div>
              <span class="text-xs font-semibold text-zinc-200 mb-1">
                Choose a 3D model file
              </span>
              <span class="text-[11px] text-zinc-500 mb-3">
                Supports .glb, .gltf, .obj, and .blend formats with UVs
              </span>
              <Button variant="primary" size="xs">
                Browse Files
              </Button>
            </div>
          }
        >
          <div class="flex items-center justify-between p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl">
            <div class="flex items-center gap-3 min-w-0">
              <div class="p-2 rounded-lg bg-blue-600/20 text-blue-400 flex-shrink-0">
                <CubeIcon size={20} />
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold text-zinc-100 truncate">
                  {filename()}
                </span>
                <span class="text-[11px] text-zinc-500 font-mono truncate" title={modelPath()!}>
                  {modelPath()}
                </span>
              </div>
            </div>
            <Button variant="ghost" size="xs" onClick={browse} disabled={importing()}>
              Change
            </Button>
          </div>
        </Show>
      </div>

      {/* Step 2: Canvas Resolution */}
      <div class="space-y-2 pt-2">
        <div class="flex flex-col">
          <label class="flex items-center gap-2 text-xs font-semibold text-zinc-200">
            <span class="w-5 h-5 rounded-md bg-blue-600/30 text-blue-400 flex items-center justify-center text-[11px] font-mono">
              2
            </span>
            Canvas Resolution
          </label>
          <span class="text-[11px] text-zinc-500 ml-7">
            Choose the paintable texture resolution. Higher resolutions provide more detail but use more VRAM.
          </span>
        </div>

        <div class="grid grid-cols-1 gap-2 pt-1">
          <For each={TEXTURE_SIZE_OPTIONS}>
            {(size) => {
              const info = SIZE_DESCRIPTIONS[size]
              const isSelected = () => textureSize() === size
              return (
                <div
                  onClick={() => setTextureSize(size)}
                  class={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                    isSelected()
                      ? 'bg-blue-600/10 border-blue-500/60 text-zinc-100 shadow-xs'
                      : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                  }`}
                >
                  <div class="flex flex-col">
                    <div class="flex items-center gap-2 font-mono text-xs font-semibold text-zinc-200">
                      <span>{size} × {size}</span>
                      {size === 2048 && (
                        <span class="px-1.5 py-0.2 rounded bg-blue-950 border border-blue-800/80 text-[10px] text-blue-300 font-sans font-normal">
                          Recommended
                        </span>
                      )}
                    </div>
                    <span class="text-[11px] text-zinc-500 mt-0.5">
                      {info?.desc ?? ''}
                    </span>
                  </div>
                  <Show when={isSelected()}>
                    <div class="w-5 h-5 rounded-md bg-blue-600 text-white flex items-center justify-center">
                      <CheckIcon size={12} />
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>

      {/* Error Banner */}
      <Show when={error()}>
        <div class="p-3 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-300">
          {error()}
        </div>
      </Show>
    </Modal>
  )
}
