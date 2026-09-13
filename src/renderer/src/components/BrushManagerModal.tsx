import { createSignal, createMemo, Show, For } from 'solid-js'
import { Modal, Button, SearchInput, Label } from './ui'
import {
  brushPresets,
  type AbrBrushPreset
} from '../paint/brushPresets'
import {
  TrashIcon,
  UploadIcon,
  FolderOpenIcon,
  SparklesIcon,
  LayersPlusIcon
} from './icons'

export default function BrushManagerModal(props: {
  isOpen: boolean
  onClose: () => void
}) {
  let fileInputRef: HTMLInputElement | undefined
  const [selectedPackName, setSelectedPackName] = createSignal<string>('All')
  const [searchQuery, setSearchQuery] = createSignal<string>('')
  const [isDraggingOver, setIsDraggingOver] = createSignal(false)
  const [isImporting, setIsImporting] = createSignal(false)
  const [importStatus, setImportStatus] = createSignal<string | null>(null)

  // Filtered packs
  const packs = () => brushPresets.packs()

  // All brushes combined
  const allBrushes = createMemo(() => {
    const pList = packs()
    const res: AbrBrushPreset[] = []
    for (const p of pList) {
      res.push(...p.brushes)
    }
    return res
  })

  // Visible brushes based on selected pack and search query
  const visibleBrushes = createMemo(() => {
    const q = searchQuery().trim().toLowerCase()
    const pack = selectedPackName()

    let list = pack === 'All'
      ? allBrushes()
      : packs().find((p) => p.packName === pack)?.brushes ?? []

    if (q) {
      list = list.filter((b) => b.name.toLowerCase().includes(q))
    }
    return list
  })

  async function handleFileInput(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    setIsImporting(true)
    setImportStatus(`Loading ${files.length} brush file(s)...`)
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.name.toLowerCase().endsWith('.abr')) {
          setImportStatus(`Importing ${file.name}...`)
          const res = await brushPresets.loadAbrFile(file)
          setSelectedPackName(res.packName)
        }
      }
      setImportStatus(null)
    } catch (err) {
      console.error('Failed to import ABR:', err)
      setImportStatus('Error importing brush file.')
      setTimeout(() => setImportStatus(null), 3000)
    } finally {
      setIsImporting(false)
      if (fileInputRef) fileInputRef.value = ''
    }
  }

  async function handleNativePick(): Promise<void> {
    try {
      const paths = await window.api.openFileDialog({
        filters: [{ name: 'Photoshop Brushes (*.abr)', extensions: ['abr'] }],
        multi: true
      })
      if (!paths || paths.length === 0) return
      setIsImporting(true)
      setImportStatus(`Importing ${paths.length} file(s)...`)
      for (const p of paths) {
        const res = await brushPresets.loadAbrPath(p)
        setSelectedPackName(res.packName)
      }
      setImportStatus(null)
    } catch (err) {
      console.error('Failed to pick ABR files:', err)
      setImportStatus('Failed to import ABR file')
      setTimeout(() => setImportStatus(null), 3000)
    } finally {
      setIsImporting(false)
    }
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    setIsDraggingOver(false)
    if (e.dataTransfer?.files) {
      handleFileInput(e.dataTransfer.files)
    }
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Brush Preset Manager"
      icon={(p) => <SparklesIcon size={p.size} class="text-amber-400" />}
      size="xl"
      footer={
        <div class="flex items-center justify-between w-full">
          <Button
            variant="ghost"
            onClick={() => {
              brushPresets.clear()
              props.onClose()
            }}
          >
            Reset Round Tip
          </Button>
          <div class="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={handleNativePick}
              disabled={isImporting()}
            >
              <UploadIcon size={14} />
              <span>Import .ABR</span>
            </Button>
            <Button variant="secondary" onClick={props.onClose}>
              Done
            </Button>
          </div>
        </div>
      }
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".abr"
        multiple
        class="sr-only"
        onChange={(e) => handleFileInput(e.currentTarget.files)}
      />

      {/* Import Status Alert */}
      <Show when={importStatus()}>
        <div class="p-2.5 bg-blue-950/60 border border-blue-800/80 rounded-lg text-xs text-blue-300 animate-in fade-in">
          {importStatus()}
        </div>
      </Show>

      {/* Main Split Layout: Sidebar + Grid */}
      <div
        class={`flex gap-4 h-[480px] -mx-1 -my-1 p-1 rounded-xl transition-colors ${
          isDraggingOver() ? 'bg-blue-950/20 ring-2 ring-blue-500' : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDraggingOver(true)
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
      >
        {/* Left Sidebar: Packs List */}
        <div class="w-56 flex flex-col bg-zinc-950/50 border border-zinc-800/80 rounded-xl overflow-hidden flex-shrink-0">
          <div class="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
            <Label uppercase badge={packs().length}>Packs</Label>
          </div>

          <div class="flex-1 overflow-y-auto p-1.5 space-y-1">
            <button
              type="button"
              class={`flex items-center justify-between w-full h-7 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                selectedPackName() === 'All'
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                  : 'text-zinc-300 hover:bg-zinc-850 hover:text-zinc-100 border border-transparent'
              }`}
              onClick={() => setSelectedPackName('All')}
            >
              <span>All Brushes</span>
              <span class="font-mono text-[10px] text-zinc-500">
                {allBrushes().length}
              </span>
            </button>

            <For each={packs()}>
              {(pack) => {
                const isSelected = () => selectedPackName() === pack.packName
                return (
                  <div
                    class={`flex items-center justify-between w-full h-7 px-2 rounded-lg text-xs group transition-colors ${
                      isSelected()
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                        : 'text-zinc-300 hover:bg-zinc-850 hover:text-zinc-100 border border-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      class="flex-1 flex items-center justify-between truncate text-left pr-1 cursor-pointer"
                      onClick={() => setSelectedPackName(pack.packName)}
                      title={pack.packName}
                    >
                      <span class="truncate">{pack.packName}</span>
                      <span class="font-mono text-[10px] text-zinc-500 ml-1.5 flex-shrink-0">
                        {pack.brushes.length}
                      </span>
                    </button>
                    <Show when={pack.packName !== 'Standard Tips'}>
                      <button
                        type="button"
                        class="p-1 rounded opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 hover:bg-red-950/50 transition-all cursor-pointer"
                        title={`Delete pack "${pack.packName}"`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm(`Remove brush pack "${pack.packName}"?`)) {
                            brushPresets.removePack(pack.packName)
                            if (selectedPackName() === pack.packName) {
                              setSelectedPackName('All')
                            }
                          }
                        }}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>

          {/* Quick Dropzone Footer in Sidebar */}
          <div
            class="p-3 m-2 border border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg text-center bg-zinc-900/30 hover:bg-zinc-900/60 transition-colors cursor-pointer"
            onClick={() => fileInputRef?.click()}
          >
            <FolderOpenIcon size={16} class="mx-auto text-zinc-500 mb-1" />
            <span class="text-[10px] text-zinc-400 block font-medium">
              Drop .ABR file here
            </span>
            <span class="text-[9px] text-zinc-600 block">or click to browse</span>
          </div>
        </div>

        {/* Right Main Area: Search + Brushes Grid */}
        <div class="flex-1 flex flex-col gap-3 min-w-0">
          <SearchInput
            value={searchQuery()}
            onInput={setSearchQuery}
            placeholder="Search brushes by name..."
          />

          <div class="flex-1 overflow-y-auto p-1 border border-zinc-800/80 rounded-xl bg-zinc-950/40">
            <Show
              when={visibleBrushes().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center h-full text-center p-6">
                  <div class="p-3 rounded-md bg-zinc-900 text-zinc-500 mb-3">
                    <LayersPlusIcon size={28} />
                  </div>
                  <span class="text-xs font-semibold text-zinc-300 mb-1">
                    No brushes found
                  </span>
                  <span class="text-[11px] text-zinc-500 max-w-xs">
                    {searchQuery()
                      ? `No brushes match "${searchQuery()}".`
                      : 'Import a Photoshop .ABR file or choose another pack.'}
                  </span>
                </div>
              }
            >
              <div class="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                <For each={visibleBrushes()}>
                  {(brushItem) => {
                    const isSelected = () => brushPresets.active()?.id === brushItem.id
                    return (
                      <div
                        onClick={() => {
                          brushPresets.select(brushItem)
                          props.onClose()
                        }}
                        class={`flex flex-col p-2 rounded-xl border transition-all cursor-pointer group ${
                          isSelected()
                            ? 'bg-blue-600/15 border-blue-500/70 shadow-xs'
                            : 'bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-850/60'
                        }`}
                        title={`${brushItem.name} (${Math.round(brushItem.diameter)}px)`}
                      >
                        <div class="relative aspect-square rounded-lg overflow-hidden checkerboard-bg flex items-center justify-center p-1 mb-2 border border-zinc-800">
                          <img
                            src={brushItem.dataUrl}
                            alt={brushItem.name}
                            class="max-w-full max-h-full object-contain filter drop-shadow group-hover:scale-105 transition-transform"
                          />
                          <Show when={isSelected()}>
                            <span class="absolute top-1 right-1 px-1 py-0.2 bg-blue-600 text-white rounded font-mono text-[9px] font-bold">
                              ACTIVE
                            </span>
                          </Show>
                        </div>
                        <span class="text-xs font-medium text-zinc-200 truncate mb-1">
                          {brushItem.name}
                        </span>
                        <div class="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                          <span>{Math.round(brushItem.diameter)}px</span>
                          <span>{Math.round(brushItem.spacing * 100)}%</span>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Modal>
  )
}
