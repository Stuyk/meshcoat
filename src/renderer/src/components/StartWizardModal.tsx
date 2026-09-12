import { createSignal, createEffect, Show, For } from 'solid-js'
import { Modal, Button, Badge } from './ui'
import {
  CubeIcon,
  FolderOpenIcon,
  AppIcon,
  SparklesIcon,
  ClockIcon,
  RefreshCwIcon,
  XIcon,
  ImagesIcon,
  LayersIcon
} from './icons'
import { DEFAULT_TEXTURE_SIZE, type TextureSize } from '../paint/paintEngine'

type RecentEntry = Awaited<ReturnType<typeof window.api.getRecentProjects>>[number]

const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

const SIZE_DESCRIPTIONS: Record<TextureSize, { label: string; desc: string }> = {
  512: { label: '512×512', desc: 'Fastest preview' },
  1024: { label: '1024×1024', desc: 'Standard' },
  2048: { label: '2048×2048', desc: 'High-Res (Recommended)' },
  4096: { label: '4096×4096', desc: 'Ultra 4K production' },
  8192: { label: '8192×8192', desc: 'Extreme 8K detail' }
}

export interface StartWizardModalProps {
  isOpen: boolean
  onClose: () => void
  onStartScratch: (textureSize: TextureSize) => Promise<void>
  onOpenModel: (modelPath: string, textureSize: TextureSize, initialTexturePath?: string | null) => Promise<void>
  onOpenProjectFile: (filePath: string) => Promise<void>
  onRestoreRecovery: (recoveryData: string) => Promise<void>
}

export default function StartWizardModal(props: StartWizardModalProps) {
  const [modelPath, setModelPath] = createSignal<string | null>(null)
  const [initialTexturePath, setInitialTexturePath] = createSignal<string | null>(null)
  const [textureSize, setTextureSize] = createSignal<TextureSize>(DEFAULT_TEXTURE_SIZE)
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [recents, setRecents] = createSignal<RecentEntry[]>([])
  const [recoveryData, setRecoveryData] = createSignal<{ data: string; timestamp: number; name?: string; layers?: number } | null>(null)

  // Fetch recent projects and check for auto-recovery on open
  createEffect(() => {
    if (props.isOpen) {
      void refreshRecents()
      void checkRecovery()
    }
  })

  async function refreshRecents(): Promise<void> {
    try {
      const items = await window.api.getRecentProjects()
      setRecents(items || [])
    } catch {}
  }

  async function checkRecovery(): Promise<void> {
    try {
      const rec = await window.api.loadRecovery()
      if (rec && rec.data) {
        try {
          const parsed = JSON.parse(rec.data)
          setRecoveryData({
            data: rec.data,
            timestamp: rec.timestamp,
            name: parsed.name || parsed.modelName || 'Untitled Project',
            layers: Array.isArray(parsed.layers) ? parsed.layers.length : undefined
          })
        } catch {
          setRecoveryData(null)
        }
      } else {
        setRecoveryData(null)
      }
    } catch {
      setRecoveryData(null)
    }
  }

  function resetForm(): void {
    setModelPath(null)
    setInitialTexturePath(null)
    setTextureSize(DEFAULT_TEXTURE_SIZE)
    setIsLoading(false)
    setError(null)
  }

  function handleUserClose(): void {
    if (isLoading()) return
    resetForm()
    props.onClose()
  }

  function finishAndClose(): void {
    resetForm()
    props.onClose()
  }

  async function browseModel(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: '3D Models', extensions: MODEL_EXTENSIONS }]
    })
    const path = paths?.[0]
    if (path) {
      setModelPath(path)
      setError(null)
    }
  }

  async function browseInitialTexture(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
    })
    const path = paths?.[0]
    if (path) {
      setInitialTexturePath(path)
      setError(null)
    }
  }

  async function browseProjectFile(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat', 'json'] }]
    })
    const path = paths?.[0]
    if (path) {
      setIsLoading(true)
      setError(null)
      try {
        await props.onOpenProjectFile(path)
        finishAndClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      }
    }
  }

  async function handleStartScratch(): Promise<void> {
    setIsLoading(true)
    setError(null)
    try {
      await props.onStartScratch(textureSize())
      finishAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsLoading(false)
    }
  }

  async function handleOpenModel(): Promise<void> {
    const path = modelPath()
    if (!path) return
    setIsLoading(true)
    setError(null)
    try {
      await props.onOpenModel(path, textureSize(), initialTexturePath())
      finishAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsLoading(false)
    }
  }

  async function handleRestoreRecovery(): Promise<void> {
    const rec = recoveryData()
    if (!rec) return
    setIsLoading(true)
    setError(null)
    try {
      await props.onRestoreRecovery(rec.data)
      finishAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsLoading(false)
    }
  }

  async function handleDiscardRecovery(): Promise<void> {
    await window.api.clearRecovery()
    setRecoveryData(null)
  }

  async function handleClearRecents(): Promise<void> {
    await window.api.clearRecentProjects()
    setRecents([])
  }

  const modelFilename = () => modelPath()?.split(/[/\\]/).pop() ?? ''
  const textureFilename = () => initialTexturePath()?.split(/[/\\]/).pop() ?? ''

  const formatTimeAgo = (time: number): string => {
    const diff = Math.max(0, Date.now() - time)
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleUserClose}
      title="Welcome to MeshCoat"
      icon={(p) => <AppIcon size={p.size} />}
      size="xl"
      footer={
        <div class="flex items-center justify-between w-full">
          <Button variant="ghost" onClick={browseProjectFile} disabled={isLoading()}>
            <FolderOpenIcon size={14} />
            <span>Open .meshcoat File...</span>
          </Button>
          <div class="flex items-center gap-2">
            <Button variant="ghost" onClick={handleUserClose} disabled={isLoading()}>
              Close
            </Button>
            <Show when={modelPath()}>
              <Button variant="primary" onClick={handleOpenModel} disabled={isLoading()}>
                {isLoading() ? 'Importing...' : 'Import Model & Start'}
              </Button>
            </Show>
          </div>
        </div>
      }
    >
      <div class="flex flex-col gap-5">
        {/* Error Alert */}
        <Show when={error()}>
          <div class="p-3 bg-red-950/50 border border-red-800 rounded-lg text-xs text-red-300 flex items-center justify-between">
            <span>{error()}</span>
            <button type="button" onClick={() => setError(null)} class="text-red-400 hover:text-red-200">
              <XIcon size={14} />
            </button>
          </div>
        </Show>

        {/* 1. Auto-Recovery Banner (if unsaved backup exists) */}
        <Show when={recoveryData()}>
          <div class="p-3.5 bg-amber-950/40 border border-amber-800/80 rounded-xl flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                <RefreshCwIcon size={20} />
              </div>
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-semibold text-amber-200 truncate">
                    Unsaved Session Found: {recoveryData()?.name}
                  </span>
                  <Badge variant="amber" size="xs">
                    Autosave
                  </Badge>
                </div>
                <span class="text-[11px] text-zinc-400">
                  {recoveryData()?.layers !== undefined ? `${recoveryData()?.layers} layer(s) • ` : ''}
                  Saved {formatTimeAgo(recoveryData()!.timestamp)}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="xs" onClick={handleDiscardRecovery}>
                Discard
              </Button>
              <Button variant="primary" size="xs" onClick={handleRestoreRecovery} disabled={isLoading()}>
                Restore Session
              </Button>
            </div>
          </div>
        </Show>

        {/* 2. Main Grid: Left = Create / Import; Right = Recents */}
        <div class="grid grid-cols-1 md:grid-cols-5 gap-5">
          {/* Left Column: Quick Actions & Model Setup (3 cols) */}
          <div class="md:col-span-3 flex flex-col gap-4">
            {/* Quick Start from Scratch Card */}
            <div
              onClick={handleStartScratch}
              class="flex items-center justify-between p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40 hover:bg-zinc-850/50 hover:border-zinc-700 transition-all cursor-pointer group"
            >
              <div class="flex items-center gap-3">
                <div class="p-2.5 rounded-lg bg-blue-600/20 text-blue-400 group-hover:scale-105 transition-transform">
                  <SparklesIcon size={18} />
                </div>
                <div class="flex flex-col">
                  <span class="text-xs font-semibold text-zinc-200 group-hover:text-white">
                    Start From Scratch
                  </span>
                  <span class="text-[11px] text-zinc-500">
                    Instant default sphere model, ready to paint immediately
                  </span>
                </div>
              </div>
              <Button
                variant="secondary"
                size="xs"
                disabled={isLoading()}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleStartScratch()
                }}
              >
                {isLoading() ? 'Starting...' : 'Start'}
              </Button>
            </div>

            {/* Model & Texture Import Form */}
            <div class="flex flex-col gap-3 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <span class="text-xs font-semibold text-zinc-200">Load 3D Model & Textures</span>

              {/* Step 1: 3D Model */}
              <div class="flex flex-col gap-1.5">
                <label class="text-[11px] font-medium text-zinc-400">1. 3D Model (.glb, .gltf, .obj)</label>
                <Show
                  when={modelPath()}
                  fallback={
                    <button
                      type="button"
                      onClick={browseModel}
                      class="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-zinc-700 hover:border-blue-500/80 bg-zinc-950/40 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer"
                    >
                      <CubeIcon size={14} class="text-blue-400" />
                      <span>Choose 3D Model File...</span>
                    </button>
                  }
                >
                  <div class="flex items-center justify-between p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                    <div class="flex items-center gap-2 min-w-0">
                      <CubeIcon size={14} class="text-blue-400 shrink-0" />
                      <span class="text-xs font-semibold text-zinc-200 truncate">{modelFilename()}</span>
                    </div>
                    <Button variant="ghost" size="xs" onClick={browseModel}>
                      Change
                    </Button>
                  </div>
                </Show>
              </div>

              {/* Step 2: Optional Base Texture Image */}
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <label class="text-[11px] font-medium text-zinc-400">
                    2. Initial Texture Map <span class="text-zinc-500">(Optional)</span>
                  </label>
                  <Show when={initialTexturePath()}>
                    <button
                      type="button"
                      onClick={() => setInitialTexturePath(null)}
                      class="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  </Show>
                </div>
                <Show
                  when={initialTexturePath()}
                  fallback={
                    <button
                      type="button"
                      onClick={browseInitialTexture}
                      class="flex items-center justify-center gap-2 p-2.5 rounded-lg border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/30 text-xs text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
                    >
                      <ImagesIcon size={14} class="text-zinc-500" />
                      <span>Choose Base Color Texture (.png, .jpg)...</span>
                    </button>
                  }
                >
                  <div class="flex items-center justify-between p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                    <div class="flex items-center gap-2 min-w-0">
                      <ImagesIcon size={14} class="text-emerald-400 shrink-0" />
                      <span class="text-xs font-medium text-zinc-200 truncate">{textureFilename()}</span>
                    </div>
                    <Button variant="ghost" size="xs" onClick={browseInitialTexture}>
                      Change
                    </Button>
                  </div>
                </Show>
              </div>

              {/* Step 3: Texture Canvas Resolution */}
              <div class="flex flex-col gap-1.5 pt-1">
                <label class="text-[11px] font-medium text-zinc-400">3. Canvas Resolution</label>
                <div class="grid grid-cols-4 gap-1.5">
                  {([512, 1024, 2048, 4096] as TextureSize[]).map((sz) => {
                    const isSelected = () => textureSize() === sz
                    return (
                      <button
                        type="button"
                        onClick={() => setTextureSize(sz)}
                        class={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all cursor-pointer ${
                          isSelected()
                            ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-semibold'
                            : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/40'
                        }`}
                      >
                        <span class="text-xs font-mono">{SIZE_DESCRIPTIONS[sz].label}</span>
                        <span class="text-[9px] text-zinc-500 truncate">{SIZE_DESCRIPTIONS[sz].desc}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Action Button to Import & Start */}
              <div class="pt-1">
                <Button
                  variant="primary"
                  onClick={handleOpenModel}
                  disabled={!modelPath() || isLoading()}
                  class="w-full justify-center h-9 text-xs font-semibold"
                >
                  <CubeIcon size={14} />
                  <span>{isLoading() ? 'Importing Model...' : 'Import 3D Model & Start'}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Right Column: Recent Files (2 cols) */}
          <div class="md:col-span-2 flex flex-col gap-2 p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                <ClockIcon size={13} class="text-zinc-500" />
                <span>Recent Files</span>
              </div>
              <Show when={recents().length > 0}>
                <button
                  type="button"
                  onClick={handleClearRecents}
                  title="Clear recent projects list"
                  class="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  Clear
                </button>
              </Show>
            </div>

            {/* Recents List */}
            <div class="flex flex-col gap-1 overflow-y-auto max-h-[300px] pr-1">
              <Show
                when={recents().length > 0}
                fallback={
                  <div class="py-8 text-center text-xs text-zinc-500 italic">
                    No recent files
                  </div>
                }
              >
                <For each={recents()}>
                  {(item) => {
                    const filename = item.name || item.projectPath.split(/[/\\]/).pop() || 'Untitled'
                    const isProject = item.type === 'project' || item.projectPath.endsWith('.meshcoat')
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsLoading(true)
                          try {
                            if (isProject) {
                              await props.onOpenProjectFile(item.projectPath)
                            } else {
                              await props.onOpenModel(item.projectPath, DEFAULT_TEXTURE_SIZE)
                            }
                            finishAndClose()
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err))
                            setIsLoading(false)
                          }
                        }}
                        class="flex items-center justify-between p-2 rounded-lg bg-zinc-950/40 hover:bg-zinc-850/60 border border-zinc-850 hover:border-zinc-750 transition-all text-left group cursor-pointer"
                      >
                        <div class="flex items-center gap-2 min-w-0">
                          {isProject ? (
                            <LayersIcon size={14} class="text-purple-400 shrink-0" />
                          ) : (
                            <CubeIcon size={14} class="text-blue-400 shrink-0" />
                          )}
                          <div class="flex flex-col min-w-0">
                            <span class="text-xs font-medium text-zinc-200 group-hover:text-white truncate">
                              {filename}
                            </span>
                            <span class="text-[10px] text-zinc-500 truncate" title={item.projectPath}>
                              {item.projectPath}
                            </span>
                          </div>
                        </div>
                        <span class="text-[10px] text-zinc-500 shrink-0 ml-2 font-mono">
                          {formatTimeAgo(item.openedAt)}
                        </span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
