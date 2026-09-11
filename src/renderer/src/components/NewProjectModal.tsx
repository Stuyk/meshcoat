import { createSignal, onMount, onCleanup, Show, For } from 'solid-js'
import { XIcon, CubeIcon, FolderOpenIcon, CheckIcon } from './icons'
import { TEXTURE_SIZE_OPTIONS, DEFAULT_TEXTURE_SIZE, type TextureSize } from '../paint/paintEngine'

const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj']

const SIZE_DESCRIPTIONS: Record<TextureSize, { label: string; desc: string }> = {
  512: { label: 'Low-Res (512×512)', desc: 'Fastest performance, ideal for testing' },
  1024: { label: 'Standard (1024×1024)', desc: 'Balanced detail & speed (Recommended)' },
  2048: { label: 'High-Res (2048×2048)', desc: 'Crisp textures, detailed models' },
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

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && props.isOpen) {
      e.preventDefault()
      close()
    }
  }

  onMount(() => window.addEventListener('keydown', onKeyDown))
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  const filename = () => modelPath()?.split('/').pop() ?? ''

  return (
    <Show when={props.isOpen}>
      <div class="modal-backdrop" onClick={close}>
        <div class="modal-dialog new-project-dialog" onClick={(e) => e.stopPropagation()}>
          <header class="modal-header">
            <div class="modal-title-wrap">
              <CubeIcon size={18} class="text-blue-400" />
              <h2 class="modal-title">New Project</h2>
            </div>
            <button class="modal-close-btn" onClick={close} title="Close (Esc)">
              <XIcon size={16} />
            </button>
          </header>

          <div class="modal-body new-project-body">
            {/* Step 1: Model Selection */}
            <div class="wizard-section">
              <label class="wizard-section-title">
                <span class="step-num">1</span> Select 3D Model
              </label>

              <Show
                when={modelPath()}
                fallback={
                  <div class="wizard-dropzone" onClick={browse}>
                    <div class="wizard-dropzone-icon">
                      <FolderOpenIcon size={24} />
                    </div>
                    <div class="wizard-dropzone-text">
                      <span class="dropzone-headline">Choose a 3D model file</span>
                      <span class="dropzone-subline">Supports .glb, .gltf, and .obj formats with UVs</span>
                    </div>
                    <button class="btn-flat btn-primary" style={{ 'pointer-events': 'none' }}>
                      Browse Files
                    </button>
                  </div>
                }
              >
                <div class="selected-model-card">
                  <div class="model-card-icon">
                    <CubeIcon size={22} />
                  </div>
                  <div class="model-card-info">
                    <span class="model-card-filename">{filename()}</span>
                    <span class="model-card-path" title={modelPath()!}>{modelPath()}</span>
                  </div>
                  <button class="btn-flat btn-ghost" onClick={browse} disabled={importing()}>
                    Change
                  </button>
                </div>
              </Show>
            </div>

            {/* Step 2: Canvas Resolution */}
            <div class="wizard-section">
              <label class="wizard-section-title">
                <span class="step-num">2</span> Canvas Resolution
              </label>
              <span class="wizard-section-desc">
                Choose the paintable texture resolution. Higher resolutions provide more detail but use more memory.
              </span>

              <div class="resolution-cards-grid">
                <For each={TEXTURE_SIZE_OPTIONS}>
                  {(size) => {
                    const info = SIZE_DESCRIPTIONS[size]
                    const isSelected = () => textureSize() === size
                    return (
                      <div
                        class="resolution-card"
                        classList={{ selected: isSelected() }}
                        onClick={() => setTextureSize(size)}
                      >
                        <div class="res-card-header">
                          <span class="res-card-dim">{size} × {size}</span>
                          <Show when={isSelected()}>
                            <span class="res-check-icon"><CheckIcon size={14} /></span>
                          </Show>
                        </div>
                        <span class="res-card-desc">{info?.desc ?? ''}</span>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>

            {/* Error Message */}
            <Show when={error()}>
              <div class="wizard-error-banner">
                <span>{error()}</span>
              </div>
            </Show>
          </div>

          <footer class="modal-footer">
            <button class="btn-flat btn-ghost" onClick={close} disabled={importing()}>
              Cancel
            </button>
            <button
              class="btn-flat btn-primary"
              disabled={!modelPath() || importing()}
              onClick={runImport}
            >
              {importing() ? 'Loading Model...' : 'Create Project'}
            </button>
          </footer>
        </div>
      </div>
    </Show>
  )
}
