import {
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  on,
  onMount,
  onCleanup,
  type JSX
} from 'solid-js'
import {
  brush,
  setTexturePath,
  setMaterialSet,
  addPastedTexture,
  removePastedTexture,
  clearPastedTextures
} from '../paint/brush'
import { groupMaterialSets, paintableChannels, type MaterialSet } from '../paint/materialSets'
import { CHANNEL_SPECS } from '../paint/channels'
import { Button, IconButton, SearchInput, Label, Select } from './ui'
import {
  FolderOpenIcon,
  XIcon,
  CheckIcon,
  StampIcon,
  ClipboardIcon,
  Trash2Icon,
  ChevronDownIcon,
  ChevronUpIcon
} from './icons'
import { toAssetUrl } from '../utils/assetUrl'
import { isBrowserDisplayable } from '../utils/textureLoad'
import { fileName } from '../utils/paths'

const CARD_WIDTH = 108
const COL_GAP = 8
const ROW_CONTENT_HEIGHT = 133 // thumb + gap + label
const ROW_GAP = 10
const ROW_STEP = ROW_CONTENT_HEIGHT + ROW_GAP
const OVERSCAN_ROWS = 4

/** Folder-filter value meaning "don't filter" — not a legal relative path. */
const ALL_FOLDERS = '\u0000all'

const SOLID_CARD = Symbol('solid-card')
/** A shelf entry: the solid-color swatch, a grouped PBR material set, or a loose image. */
type ShelfItem = string | typeof SOLID_CARD | MaterialSet

export default function TextureShelf(props: {
  textures: string[]
  /** Folder the textures were loaded from; enables the subfolder filter. */
  textureRoot?: string | null
  onPickFolder: () => void
  onClearFolder: () => void
  isMaskTarget?: () => boolean
  onToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}): JSX.Element {
  const [searchQuery, setSearchQuery] = createSignal('')
  const [activeShelf, setActiveShelf] = createSignal<'all' | 'used' | 'pasted'>('all')
  /** Subfolder filter for the All tab: ALL_FOLDERS, '' for the root, or a relative path. */
  const [folderFilter, setFolderFilter] = createSignal(ALL_FOLDERS)

  /**
   * Folder of `path` relative to the loaded root, '/'-separated, '' for files
   * sitting in the root itself. Paths outside the root (shouldn't happen) are
   * treated as root files so they never vanish behind the filter.
   */
  const relativeFolder = (path: string): string => {
    const root = props.textureRoot
    if (!root) {
      return ''
    }
    const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
    const dir = norm(path).replace(/\/[^/]*$/, '')
    const base = norm(root)
    if (dir === base || !dir.startsWith(base + '/')) {
      return ''
    }
    return dir.slice(base.length + 1)
  }

  const folders = createMemo<string[]>(() => {
    const set = new Set(props.textures.map(relativeFolder))
    return [...set].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  })

  // A new library means the old subfolder name is meaningless.
  createEffect(
    on(
      () => props.textures,
      () => setFolderFilter(ALL_FOLDERS),
      { defer: true }
    )
  )

  const folderOptions = (): { value: string; label: string }[] => [
    { value: ALL_FOLDERS, label: `All folders (${folders().length})` },
    ...folders().map((f) => ({
      value: f,
      label: f === '' ? `${fileName(props.textureRoot, 'Root')} (root)` : f
    }))
  ]

  const filteredByFolder = (): string[] => {
    const f = folderFilter()
    return f === ALL_FOLDERS
      ? props.textures
      : props.textures.filter((p) => relativeFolder(p) === f)
  }

  const pastedUrls = (): string[] => brush.pastedTextures().map((t) => t.url)

  /**
   * The pasted texture the brush currently holds, if any — what the tab's
   * trash button acts on. With nothing selected it falls back to clearing the
   * whole tab, which is the only other thing that button could mean.
   */
  const selectedPasted = (): { url: string; name: string } | undefined => {
    const current = brush.texturePath()
    if (!current || brush.materialSet()) {
      return undefined
    }
    return brush.pastedTextures().find((t) => t.url === current)
  }

  const sourceTextures = (): string[] =>
    activeShelf() === 'used'
      ? brush.recentTextures()
      : activeShelf() === 'pasted'
        ? pastedUrls()
        : filteredByFolder()

  /**
   * Pulls whatever image is on the system clipboard onto the Pasted shelf and
   * selects it. It stays a data URL in memory — nothing is written to disk —
   * which is the point: cropping a 64x64 tile out of a reference and getting it
   * onto the model is a two-step loop for PSX-style work, not an asset import.
   */
  async function pasteFromClipboard(): Promise<void> {
    const image = await window.api.readClipboardImage()
    if (!image) {
      props.onToast?.('No image on the clipboard — copy one first', 'warning')
      return
    }
    const entry = addPastedTexture(image)
    setActiveShelf('pasted')
    setTexturePath(entry.url, !props.isMaskTarget?.())
    props.onToast?.(`${entry.name} — ${image.width}x${image.height}`, 'success')
  }

  // Ctrl/Cmd+V only while the Pasted tab is open, matching how the stencil
  // panel claims paste: elsewhere it stays whatever the focused control expects.
  const onPasteKey = (e: KeyboardEvent): void => {
    if (activeShelf() !== 'pasted') {
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') {
      return
    }
    const target = e.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return
    }
    e.preventDefault()
    void pasteFromClipboard()
  }
  onMount(() => window.addEventListener('keydown', onPasteKey))
  onCleanup(() => window.removeEventListener('keydown', onPasteKey))

  // A PBR texture set arrives as loose files that only a filename convention
  // ties together (rock_BaseColor.png, rock_Roughness.png, ...). Group them back
  // into one material the artist can paint with, and leave anything that isn't
  // part of a set as the plain stamp image it is.
  const grouped = createMemo(() => groupMaterialSets(sourceTextures()))

  const matchesQuery = (text: string): boolean => {
    const q = searchQuery().trim().toLowerCase()
    return !q || text.toLowerCase().includes(q)
  }

  const filteredSets = (): MaterialSet[] => grouped().sets.filter((set) => matchesQuery(set.name))

  const filteredTextures = (): string[] =>
    grouped().loose.filter((p) => matchesQuery(fileName(p, '')))

  const hasResults = (): boolean => filteredSets().length > 0 || filteredTextures().length > 0

  const displayItems = createMemo<ShelfItem[]>(() => {
    const showSolid = !searchQuery() && activeShelf() === 'all'
    const items: ShelfItem[] = showSolid ? [SOLID_CARD] : []
    // Materials first: they are the thing to reach for when a folder has both.
    items.push(...filteredSets())
    items.push(...filteredTextures())
    return items
  })

  let bodyRef: HTMLDivElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(200)
  const [viewportWidth, setViewportWidth] = createSignal(600)

  const cols = (): number =>
    Math.max(2, Math.floor((viewportWidth() - 20 + COL_GAP) / (CARD_WIDTH + COL_GAP)))
  const totalRows = (): number => Math.ceil(displayItems().length / cols())
  const totalHeight = (): number => Math.max(0, totalRows() * ROW_STEP - ROW_GAP)

  const visibleRange = createMemo(() => {
    const numCols = cols()
    const startRow = Math.max(0, Math.floor(scrollTop() / ROW_STEP) - OVERSCAN_ROWS)
    const endRow = Math.min(
      totalRows(),
      Math.ceil((scrollTop() + viewportHeight()) / ROW_STEP) + OVERSCAN_ROWS
    )
    return { startRow, endRow, numCols }
  })

  const visibleItems = createMemo(() => {
    const { startRow, endRow, numCols } = visibleRange()
    const items = displayItems()
    const startIndex = startRow * numCols
    const endIndex = Math.min(items.length, endRow * numCols)
    const out: { item: ShelfItem; index: number }[] = []
    for (let i = startIndex; i < endIndex; i++) {
      out.push({ item: items[i], index: i })
    }
    return out
  })

  createEffect(
    on([searchQuery, activeShelf], () => {
      if (bodyRef) {
        bodyRef.scrollTop = 0
      }
      setScrollTop(0)
    })
  )

  let resizeObserver: ResizeObserver | undefined
  onMount(() => {
    if (!bodyRef) {
      return
    }
    setViewportHeight(bodyRef.clientHeight)
    setViewportWidth(bodyRef.clientWidth)
    resizeObserver = new ResizeObserver(() => {
      if (bodyRef) {
        setViewportHeight(bodyRef.clientHeight)
        setViewportWidth(bodyRef.clientWidth)
      }
    })
    resizeObserver.observe(bodyRef)
  })
  onCleanup(() => resizeObserver?.disconnect())

  if (props.collapsed) {
    return (
      <div
        class="w-full h-9 px-3 flex items-center justify-between bg-[var(--bg-panel-header)] border-t border-[var(--border-color)] select-none z-20 shrink-0 cursor-pointer hover:bg-white/5 transition-colors box-border"
        onClick={props.onToggleCollapse}
        title="Expand Texture Drawer (Ctrl+B)"
      >
        <div class="flex items-center gap-2 min-w-0">
          <FolderOpenIcon size={14} class="text-amber-400 shrink-0" />
          <span class="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] shrink-0">
            Textures
          </span>
          <Show when={props.textures.length > 0}>
            <span class="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-color)]/20 text-[var(--accent-text)] border border-[var(--accent-color)]/40 font-semibold shrink-0">
              {props.textures.length}
            </span>
          </Show>
          <Show when={brush.texturePath()}>
            <span class="text-xs text-[var(--text-muted)] truncate ml-1">
              · {fileName(brush.texturePath()!, 'Texture')}
            </span>
          </Show>
        </div>

        <div class="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="xs"
            onClick={props.onPickFolder}
            title="Load folder of textures"
          >
            <FolderOpenIcon size={13} />
            <span>Load Folder</span>
          </Button>

          <IconButton
            size="xs"
            variant="ghost"
            onClick={props.onToggleCollapse}
            tooltip="Expand Texture Drawer (Ctrl+B)"
          >
            <ChevronUpIcon size={14} />
          </IconButton>
        </div>
      </div>
    )
  }

  return (
    <div class="w-full h-full flex flex-col bg-[var(--bg-panel)] border-t border-[var(--border-color)] select-none z-20 shrink-0 box-border">
      <div class="h-9 px-3 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] shrink-0 gap-3">
        <div class="flex items-center gap-2.5 shrink-0">
          <Label uppercase badge={props.textures.length}>
            Textures
          </Label>

          <div class="flex items-center p-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
            <button
              type="button"
              title="All loaded textures and material sets"
              class={`flex items-center justify-center gap-1.5 py-0.5 px-2 rounded-[2px] text-xs font-medium transition-colors cursor-pointer ${
                activeShelf() === 'all'
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)] font-semibold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              onClick={() => setActiveShelf('all')}
            >
              <span>All</span>
            </button>
            <button
              type="button"
              class={`flex items-center justify-center gap-1.5 py-0.5 px-2 rounded-[2px] text-xs font-medium transition-colors cursor-pointer ${
                activeShelf() === 'used'
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)] font-semibold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              onClick={() => setActiveShelf('used')}
              title="Textures you've painted, stamped, or filled with"
            >
              <span>Used</span>
              <Show when={brush.recentTextures().length > 0}>
                <span
                  class={`font-mono text-[10px] px-1 rounded-full ${
                    activeShelf() === 'used'
                      ? 'bg-black/30 text-[var(--accent-text)]'
                      : 'bg-white/10 text-[var(--text-muted)]'
                  }`}
                >
                  {brush.recentTextures().length}
                </span>
              </Show>
            </button>
            <button
              type="button"
              class={`flex items-center justify-center gap-1.5 py-0.5 px-2 rounded-[2px] text-xs font-medium transition-colors cursor-pointer ${
                activeShelf() === 'pasted'
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)] font-semibold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              onClick={() => setActiveShelf('pasted')}
              title="Images pasted from the clipboard — kept in memory for this session only"
            >
              <span>Pasted</span>
              <Show when={brush.pastedTextures().length > 0}>
                <span
                  class={`font-mono text-[10px] px-1 rounded-full ${
                    activeShelf() === 'pasted'
                      ? 'bg-black/30 text-[var(--accent-text)]'
                      : 'bg-white/10 text-[var(--text-muted)]'
                  }`}
                >
                  {brush.pastedTextures().length}
                </span>
              </Show>
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-1 max-w-lg min-w-0">
          <Show when={activeShelf() === 'all' && folders().length > 1}>
            <div class="w-40 shrink-0">
              <Select
                size="xs"
                class="w-full"
                value={folderFilter()}
                onChange={setFolderFilter}
                options={folderOptions()}
                title="Show textures from one subfolder of the loaded library"
              />
            </div>
          </Show>

          <Show when={sourceTextures().length > 0 || folderFilter() !== ALL_FOLDERS}>
            <div class="flex-1 min-w-[120px]">
              <SearchInput
                value={searchQuery()}
                onInput={setSearchQuery}
                placeholder="Search textures..."
              />
            </div>
          </Show>

          <Show when={activeShelf() === 'pasted'}>
            <div class="flex items-center gap-1.5 shrink-0">
              <Button
                variant="primary"
                size="xs"
                onClick={() => void pasteFromClipboard()}
                title="Paste the clipboard image as a texture (Ctrl+V)"
              >
                <ClipboardIcon size={12} />
                <span>Paste Image</span>
              </Button>
              <Show when={brush.pastedTextures().length > 0}>
                <IconButton
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    const selected = selectedPasted()
                    if (selected) {
                      removePastedTexture(selected.url)
                    } else {
                      clearPastedTextures()
                    }
                  }}
                  title={
                    selectedPasted()
                      ? `Discard ${selectedPasted()!.name}`
                      : 'Discard every pasted texture'
                  }
                >
                  <Trash2Icon size={12} class="text-[var(--text-muted)] hover:text-red-400" />
                </IconButton>
              </Show>
            </div>
          </Show>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <Button
            variant="secondary"
            size="xs"
            onClick={props.onPickFolder}
            title="Load folder of textures"
          >
            <FolderOpenIcon size={14} />
            <span>Load Folder</span>
          </Button>

          <Show when={props.textures.length > 0}>
            <IconButton
              size="xs"
              variant="ghost"
              onClick={props.onClearFolder}
              title="Clear loaded textures"
            >
              <XIcon size={14} class="text-[var(--text-muted)] hover:text-red-400" />
            </IconButton>
          </Show>

          <Show when={props.onToggleCollapse}>
            <div class="w-px h-4 bg-[var(--border-color)] mx-1" />
            <IconButton
              size="xs"
              variant="ghost"
              onClick={props.onToggleCollapse}
              tooltip="Collapse Texture Drawer (Ctrl+B)"
            >
              <ChevronDownIcon size={14} />
            </IconButton>
          </Show>
        </div>
      </div>

      {/* Virtualized Texture Grid */}
      <div
        ref={bodyRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        class="flex-1 overflow-y-auto p-2.5 relative"
      >
        <Show
          when={props.textures.length > 0 || activeShelf() === 'pasted'}
          fallback={
            <div
              onClick={props.onPickFolder}
              class="flex flex-col items-center justify-center h-full p-4 border border-dashed border-[var(--border-color)] hover:border-[var(--accent-color)]/60 rounded-[var(--ui-radius)] text-center bg-[var(--bg-input)] hover:bg-[var(--bg-panel-header)] transition-all cursor-pointer group"
            >
              <div class="p-3 rounded-[var(--ui-radius)] bg-[var(--bg-panel-header)] text-[var(--text-muted)] group-hover:text-[var(--accent-color)] transition-colors mb-2 border border-[var(--border-color)]">
                <StampIcon size={24} />
              </div>
              <span class="text-xs font-semibold text-[var(--text-main)] mb-1">
                No textures loaded
              </span>
              <span class="text-[11px] text-[var(--text-muted)] mb-3 max-w-[180px]">
                Click to load a folder of PNG, JPG, or WebP textures.
              </span>
              <Button variant="primary" size="xs">
                Load Folder
              </Button>
            </div>
          }
        >
          <Show
            when={activeShelf() === 'all' || sourceTextures().length > 0}
            fallback={
              <div class="flex items-center justify-center h-48 text-center text-[11px] text-[var(--text-muted)] p-4">
                <Show
                  when={activeShelf() === 'pasted'}
                  fallback="No textures used yet — paint, stamp, or fill with one to see it here."
                >
                  Copy an image anywhere — a browser, a screenshot, an image editor — then hit Paste
                  Image (Ctrl+V). It stays in memory for this session.
                </Show>
              </div>
            }
          >
            <Show
              when={hasResults()}
              fallback={
                <div class="flex items-center justify-center h-48 text-center text-[11px] text-[var(--text-muted)] p-4">
                  No textures match "{searchQuery()}"
                </div>
              }
            >
              <div class="relative w-full" style={{ height: `${totalHeight()}px` }}>
                <For each={visibleItems()}>
                  {({ item, index }) => {
                    const numCols = cols()
                    const row = Math.floor(index / numCols)
                    const col = index % numCols
                    const style = {
                      position: 'absolute' as const,
                      top: `${row * ROW_STEP}px`,
                      left: `${col * (CARD_WIDTH + COL_GAP)}px`,
                      width: `${CARD_WIDTH}px`
                    }

                    if (item === SOLID_CARD) {
                      const isSelected = () => brush.texturePath() === null
                      return (
                        <button
                          type="button"
                          onClick={() => setTexturePath(null)}
                          title="Solid Color (No Texture) - Hotkey: X"
                          style={style}
                          class={`flex flex-col p-1.5 rounded-[var(--ui-radius)] border text-left transition-all cursor-pointer group ${
                            isSelected()
                              ? 'bg-[var(--accent-color)]/10 border-[var(--accent-color)] ring-1 ring-[var(--accent-color)]/40 shadow-xs'
                              : 'bg-[var(--bg-input)] border-[var(--border-color)] hover:border-white/20 hover:bg-white/5'
                          }`}
                        >
                          <div
                            class="relative aspect-square w-full rounded-[2px] border border-white/10 flex items-center justify-center"
                            style={{ 'background-color': brush.color() }}
                          >
                            <Show when={isSelected()}>
                              <div class="absolute top-1 right-1 w-4 h-4 rounded-[2px] bg-[var(--accent-color)] text-[var(--accent-text)] flex items-center justify-center shadow-xs">
                                <CheckIcon size={10} />
                              </div>
                            </Show>
                          </div>
                          <span class="text-[11px] font-medium text-[var(--text-main)] truncate mt-1.5">
                            Solid Color [X]
                          </span>
                        </button>
                      )
                    }

                    if (typeof item !== 'string') {
                      const set = item
                      const channels = paintableChannels(set)
                      // A TGA albedo paints fine (TGALoader) but cannot be
                      // shown in an <img>, so the card borrows a sibling map
                      // rather than rendering a broken image.
                      const thumb =
                        [set.maps.baseColor, set.maps.normal, ...Object.values(set.maps)].find(
                          (m): m is string => !!m && isBrowserDisplayable(m)
                        ) ?? undefined
                      const isSelected = (): boolean => brush.materialSet()?.id === set.id
                      return (
                        <button
                          type="button"
                          onClick={() => setMaterialSet(isSelected() ? null : set)}
                          title={`${set.name} — material set: ${channels
                            .map((c) => CHANNEL_SPECS[c].label)
                            .join(', ')}. Painting it writes every one of those channels at once.`}
                          style={style}
                          class={`flex flex-col p-1.5 rounded-[var(--ui-radius)] border text-left transition-all cursor-pointer group ${
                            isSelected()
                              ? 'bg-amber-500/15 border-amber-500 ring-1 ring-amber-500/40 shadow-xs'
                              : 'bg-[var(--bg-input)] border-[var(--border-color)] hover:border-white/20 hover:bg-white/5'
                          }`}
                        >
                          <div class="relative aspect-square w-full rounded-[2px] overflow-hidden checkerboard-bg border border-[var(--border-color)] flex items-center justify-center">
                            <Show when={thumb}>
                              <img
                                src={toAssetUrl(thumb!)}
                                alt={set.name}
                                loading="lazy"
                                decoding="async"
                                class="max-w-full max-h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            </Show>
                            {/* Which channels this set can actually supply — the
                                thing that is invisible in a folder of loose files. */}
                            <div class="absolute bottom-1 left-1 flex items-center gap-0.5 bg-black/80 p-0.5 rounded-[2px] backdrop-blur-xs border border-white/10">
                              <For each={channels}>
                                {(c) => (
                                  <span
                                    title={CHANNEL_SPECS[c].label}
                                    class={`w-3.5 h-3.5 flex items-center justify-center rounded-[1px] font-bold text-[8px] font-mono leading-none ${
                                      c === 'baseColor'
                                        ? 'bg-emerald-500/20 text-emerald-300'
                                        : c === 'roughness'
                                          ? 'bg-sky-500/20 text-sky-300'
                                          : c === 'metalness'
                                            ? 'bg-amber-500/20 text-amber-300'
                                            : 'bg-violet-500/20 text-violet-300'
                                    }`}
                                  >
                                    {c === 'baseColor'
                                      ? 'C'
                                      : c === 'roughness'
                                        ? 'R'
                                        : c === 'metalness'
                                          ? 'M'
                                          : 'N'}
                                  </span>
                                )}
                              </For>
                            </div>
                            <Show when={isSelected()}>
                              <div class="absolute top-1 right-1 w-4 h-4 rounded-[2px] bg-amber-500 text-black flex items-center justify-center shadow-xs">
                                <CheckIcon size={10} />
                              </div>
                            </Show>
                          </div>
                          <span
                            class="text-[11px] font-medium text-amber-200/90 truncate mt-1.5"
                            title={set.name}
                          >
                            {set.name}
                          </span>
                        </button>
                      )
                    }

                    const path = item
                    const isSelected = () => brush.texturePath() === path && !brush.materialSet()
                    // A pasted texture's "path" is a data URL with no filename
                    // in it, so it carries its own label instead.
                    const pasted = () => brush.pastedTextures().find((t) => t.url === path)
                    const filename = (): string => pasted()?.name ?? fileName(path, '')

                    return (
                      <div style={style} class="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setTexturePath(isSelected() ? null : path, !props.isMaskTarget?.())
                          }}
                          title={
                            pasted()
                              ? `${filename()} — ${pasted()!.width}x${pasted()!.height} (Click to toggle)`
                              : `${filename()} (Click to toggle)`
                          }
                          class={`w-full flex flex-col p-1.5 rounded-[var(--ui-radius)] border text-left transition-all cursor-pointer group ${
                            isSelected()
                              ? 'bg-[var(--accent-color)]/10 border-[var(--accent-color)] ring-1 ring-[var(--accent-color)]/40 shadow-xs'
                              : 'bg-[var(--bg-input)] border-[var(--border-color)] hover:border-white/20 hover:bg-white/5'
                          }`}
                        >
                          <div class="relative aspect-square w-full rounded-[2px] overflow-hidden checkerboard-bg border border-[var(--border-color)] flex items-center justify-center">
                            <Show
                              when={isBrowserDisplayable(path)}
                              fallback={
                                <span class="text-[10px] font-mono uppercase text-[var(--text-muted)]">
                                  {(filename().split('.').pop() ?? '').toUpperCase()}
                                </span>
                              }
                            >
                              <img
                                src={toAssetUrl(path)}
                                alt={filename()}
                                loading="lazy"
                                decoding="async"
                                class="max-w-full max-h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            </Show>
                            <Show when={isSelected()}>
                              <div class="absolute top-1 right-1 w-4 h-4 rounded-[2px] bg-[var(--accent-color)] text-[var(--accent-text)] flex items-center justify-center shadow-xs">
                                <CheckIcon size={10} />
                              </div>
                            </Show>
                          </div>
                          <span
                            class="text-[11px] font-medium text-[var(--text-main)] truncate mt-1.5"
                            title={filename()}
                          >
                            {filename()}
                          </span>
                        </button>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
