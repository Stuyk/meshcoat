import { createSignal, createMemo, Show, For } from 'solid-js'
import {
  brushPresets,
  type AbrBrushPreset
} from '../paint/brushPresets'
import {
  XIcon,
  SearchIcon,
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
    <Show when={props.isOpen}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <div
          class="brush-modal-dialog"
          classList={{ 'dragging-over': isDraggingOver() }}
          onClick={(e) => e.stopPropagation()}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDraggingOver(true)
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
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

          {/* Modal Header */}
          <div class="brush-modal-header">
            <div class="brush-modal-title-group">
              <span class="brush-modal-icon">
                <SparklesIcon size={24} />
              </span>
              <div>
                <h2 class="brush-modal-title">Brush Preset Manager</h2>
                <p class="brush-modal-subtitle">
                  Browse, search, and import Photoshop .ABR brush tips for painting on 3D surfaces
                </p>
              </div>
            </div>
            <div class="brush-modal-header-actions">
              <button
                type="button"
                class="brush-modal-btn primary"
                onClick={handleNativePick}
                title="Import Photoshop .ABR file"
                disabled={isImporting()}
              >
                <UploadIcon size={20} />
                <span>Import .ABR</span>
              </button>
              <button
                type="button"
                class="brush-modal-close-btn"
                onClick={props.onClose}
                title="Close"
              >
                <XIcon size={24} />
              </button>
            </div>
          </div>

          {/* Import Status Alert */}
          <Show when={importStatus()}>
            <div class="brush-import-toast">
              <span>{importStatus()}</span>
            </div>
          </Show>

          {/* Modal Body */}
          <div class="brush-modal-body">
            {/* Left Sidebar: Packs List */}
            <div class="brush-modal-sidebar">
              <div class="sidebar-section-header">
                <span>BRUSH PACKS</span>
                <span class="pack-count-pill">{packs().length}</span>
              </div>

              <div class="brush-packs-list">
                <button
                  type="button"
                  class="brush-pack-item-btn"
                  classList={{ active: selectedPackName() === 'All' }}
                  onClick={() => setSelectedPackName('All')}
                >
                  <span class="pack-item-name">All Brushes</span>
                  <span class="pack-item-count">{allBrushes().length}</span>
                </button>

                <For each={packs()}>
                  {(pack) => (
                    <div
                      class="brush-pack-item"
                      classList={{ active: selectedPackName() === pack.packName }}
                    >
                      <button
                        type="button"
                        class="brush-pack-item-label"
                        onClick={() => setSelectedPackName(pack.packName)}
                        title={pack.packName}
                      >
                        <span class="pack-item-name">{pack.packName}</span>
                        <span class="pack-item-count">{pack.brushes.length}</span>
                      </button>
                      <Show when={pack.packName !== 'Standard Tips'}>
                        <button
                          type="button"
                          class="pack-delete-btn"
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
                          <TrashIcon size={18} />
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>

              {/* Sidebar Quick Import Dropzone */}
              <div
                class="sidebar-drop-card"
                onClick={() => fileInputRef?.click()}
                title="Click or drag .ABR file here"
              >
                <FolderOpenIcon size={24} />
                <span class="drop-card-label">Drag &amp; drop .ABR here</span>
                <span class="drop-card-hint">or click to browse files</span>
              </div>
            </div>

            {/* Right Main Area: Search, Tools, Brushes Grid */}
            <div class="brush-modal-content">
              {/* Toolbar */}
              <div class="brush-modal-toolbar">
                <div class="brush-search-box">
                  <SearchIcon size={20} class="search-box-icon" />
                  <input
                    type="text"
                    placeholder="Search brushes by name..."
                    value={searchQuery()}
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    class="brush-search-input"
                  />
                  <Show when={searchQuery()}>
                    <button
                      type="button"
                      class="brush-search-clear"
                      onClick={() => setSearchQuery('')}
                    >
                      <XIcon size={16} />
                    </button>
                  </Show>
                </div>

                <div class="toolbar-right-actions">
                  <button
                    type="button"
                    class="brush-modal-btn secondary"
                    onClick={() => {
                      brushPresets.clear()
                      props.onClose()
                    }}
                    title="Revert to standard round brush"
                  >
                    Reset Round Tip
                  </button>
                </div>
              </div>

              {/* Brushes Grid */}
              <div class="brush-grid-container">
                <Show
                  when={visibleBrushes().length > 0}
                  fallback={
                    <div class="brush-empty-state">
                      <LayersPlusIcon size={48} class="empty-icon" />
                      <p class="empty-title">No brushes found</p>
                      <p class="empty-desc">
                        {searchQuery()
                          ? `No brushes match "${searchQuery()}".`
                          : 'Import a Photoshop .ABR file or select another pack.'}
                      </p>
                    </div>
                  }
                >
                  <div class="brush-cards-grid">
                    <For each={visibleBrushes()}>
                      {(brushItem) => {
                        const isSelected = () => brushPresets.active()?.id === brushItem.id
                        return (
                          <div
                            class="brush-card"
                            classList={{ active: isSelected() }}
                            onClick={() => {
                              brushPresets.select(brushItem)
                              props.onClose()
                            }}
                            title={`${brushItem.name} (${Math.round(brushItem.diameter)}px)`}
                          >
                            <div class="brush-card-thumb-frame checkerboard-bg">
                              <img
                                src={brushItem.dataUrl}
                                alt={brushItem.name}
                                class="brush-card-img"
                              />
                              <Show when={isSelected()}>
                                <span class="brush-card-active-pill">ACTIVE</span>
                              </Show>
                            </div>
                            <div class="brush-card-info">
                              <span class="brush-card-name" title={brushItem.name}>
                                {brushItem.name}
                              </span>
                              <div class="brush-card-meta">
                                <span class="brush-size-badge">
                                  {Math.round(brushItem.diameter)}px
                                </span>
                                <span class="brush-spacing-badge">
                                  {Math.round(brushItem.spacing * 100)}%
                                </span>
                              </div>
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
        </div>
      </div>
    </Show>
  )
}
