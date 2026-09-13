import { For, Show, createSignal, createMemo, createEffect, on, onMount, onCleanup } from 'solid-js'
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
import { Button, IconButton, SearchInput, Label } from './ui'
import {
  FolderOpenIcon,
  XIcon,
  CheckIcon,
  StampIcon,
  ClipboardIcon,
  Trash2Icon
} from './icons'
import { toAssetUrl } from '../utils/assetUrl'
import { isBrowserDisplayable } from '../utils/textureLoad'
import { fileName } from '../utils/paths'

const COLS = 2
const ROW_CONTENT_HEIGHT = 133 // thumb + gap + label
const ROW_GAP = 10
const ROW_STEP = ROW_CONTENT_HEIGHT + ROW_GAP
const OVERSCAN_ROWS = 4

const SOLID_CARD = Symbol('solid-card')
/** A shelf entry: the solid-color swatch, a grouped PBR material set, or a loose image. */
type ShelfItem = string | typeof SOLID_CARD | MaterialSet

export default function TextureShelf(props: {
  textures: string[]
  onPickFolder: () => void
  onClearFolder: () => void
  isMaskTarget?: () => boolean
  onToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void
}) {
  const [searchQuery, setSearchQuery] = createSignal('')
  const [activeShelf, setActiveShelf] = createSignal<'all' | 'used' | 'pasted'>('all')

  const pastedUrls = (): string[] => brush.pastedTextures().map((t) => t.url)

  /**
   * The pasted texture the brush currently holds, if any — what the tab's
   * trash button acts on. With nothing selected it falls back to clearing the
   * whole tab, which is the only other thing that button could mean.
   */
  const selectedPasted = (): { url: string; name: string } | undefined => {
    const current = brush.texturePath()
    if (!current || brush.materialSet()) return undefined
    return brush.pastedTextures().find((t) => t.url === current)
  }

  const sourceTextures = (): string[] =>
    activeShelf() === 'used'
      ? brush.recentTextures()
      : activeShelf() === 'pasted'
        ? pastedUrls()
        : props.textures

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
    if (activeShelf() !== 'pasted') return
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
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
  const [viewportHeight, setViewportHeight] = createSignal(400)

  const totalRows = () => Math.ceil(displayItems().length / COLS)
  const totalHeight = () => Math.max(0, totalRows() * ROW_STEP - ROW_GAP)

  const visibleRange = createMemo(() => {
    const startRow = Math.max(0, Math.floor(scrollTop() / ROW_STEP) - OVERSCAN_ROWS)
    const endRow = Math.min(
      totalRows(),
      Math.ceil((scrollTop() + viewportHeight()) / ROW_STEP) + OVERSCAN_ROWS
    )
    return { startRow, endRow }
  })

  const visibleItems = createMemo(() => {
    const { startRow, endRow } = visibleRange()
    const items = displayItems()
    const startIndex = startRow * COLS
    const endIndex = Math.min(items.length, endRow * COLS)
    const out: { item: ShelfItem; index: number }[] = []
    for (let i = startIndex; i < endIndex; i++) {
      out.push({ item: items[i], index: i })
    }
    return out
  })

  createEffect(
    on([searchQuery, activeShelf], () => {
      if (bodyRef) bodyRef.scrollTop = 0
      setScrollTop(0)
    })
  )

  let resizeObserver: ResizeObserver | undefined
  onMount(() => {
    if (!bodyRef) return
    setViewportHeight(bodyRef.clientHeight)
    resizeObserver = new ResizeObserver(() => {
      if (bodyRef) setViewportHeight(bodyRef.clientHeight)
    })
    resizeObserver.observe(bodyRef)
  })
  onCleanup(() => resizeObserver?.disconnect())

  return (
    <aside class="w-[260px] min-w-[260px] max-w-[260px] h-full flex flex-col bg-zinc-925 border-r border-zinc-800 select-none z-20 flex-shrink-0">
      {/* Header Bar */}
      <div class="h-10 px-3 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 flex-shrink-0">
        <Label uppercase badge={props.textures.length}>Textures</Label>

        <div class="flex items-center gap-1.5">
          <Button variant="secondary" size="xs" onClick={props.onPickFolder} title="Load folder of textures">
            <FolderOpenIcon size={13} />
            <span>Load</span>
          </Button>

          <Show when={props.textures.length > 0}>
            <IconButton
              size="xs"
              variant="ghost"
              onClick={props.onClearFolder}
              title="Clear loaded textures"
            >
              <XIcon size={13} class="text-zinc-400 hover:text-red-400" />
            </IconButton>
          </Show>
        </div>
      </div>

      {/* All / Used / Pasted Tabs. Always shown, unlike the rest of the shelf
          chrome: Pasted is the one tab that works with no folder loaded at all,
          so gating the bar on props.textures would hide the only way to reach
          it from exactly the empty project that most wants it. */}
      <div class="px-3 pt-2 pb-1 flex items-center gap-1 border-b border-zinc-800/80 bg-zinc-925">
        <button
          type="button"
          class={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            activeShelf() === 'all'
              ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
          }`}
          onClick={() => setActiveShelf('all')}
        >
          All
        </button>
        <button
          type="button"
          class={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            activeShelf() === 'used'
              ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
          }`}
          onClick={() => setActiveShelf('used')}
          title="Textures you've painted, stamped, or filled with"
        >
          <span>Used</span>
          <Show when={brush.recentTextures().length > 0}>
            <span class="font-mono text-[10px] text-zinc-500">
              {brush.recentTextures().length}
            </span>
          </Show>
        </button>
        <button
          type="button"
          class={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            activeShelf() === 'pasted'
              ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
          }`}
          onClick={() => setActiveShelf('pasted')}
          title="Images pasted from the clipboard — kept in memory for this session only"
        >
          <span>Pasted</span>
          <Show when={brush.pastedTextures().length > 0}>
            <span class="font-mono text-[10px] text-zinc-500">
              {brush.pastedTextures().length}
            </span>
          </Show>
        </button>
      </div>

      {/* Paste toolbar — lives inside the Pasted tab rather than in the shelf
          header, so the header keeps meaning "the loaded folder". */}
      <Show when={activeShelf() === 'pasted'}>
        <div class="px-2.5 py-2 border-b border-zinc-800 bg-zinc-925 flex items-center gap-1.5 flex-shrink-0">
          <Button
            variant="primary"
            size="xs"
            class="flex-1"
            onClick={() => void pasteFromClipboard()}
            title="Paste the clipboard image as a texture (Ctrl+V)"
          >
            <ClipboardIcon size={13} />
            <span>Paste Image</span>
          </Button>
          <Show when={brush.pastedTextures().length > 0}>
            <IconButton
              size="xs"
              variant="ghost"
              onClick={() => {
                const selected = selectedPasted()
                if (selected) removePastedTexture(selected.url)
                else clearPastedTextures()
              }}
              title={
                selectedPasted()
                  ? `Discard ${selectedPasted()!.name}`
                  : 'Discard every pasted texture'
              }
            >
              <Trash2Icon size={13} class="text-zinc-400 hover:text-red-400" />
            </IconButton>
          </Show>
        </div>
      </Show>

      {/* Filter / Search Bar */}
      <Show when={sourceTextures().length > 0}>
        <div class="px-2.5 py-2 border-b border-zinc-800 bg-zinc-925 flex-shrink-0">
          <SearchInput
            value={searchQuery()}
            onInput={setSearchQuery}
            placeholder="Search textures..."
          />
        </div>
      </Show>

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
              class="flex flex-col items-center justify-center h-full p-4 border border-dashed border-zinc-800 hover:border-zinc-700 rounded-xl text-center bg-zinc-950/40 hover:bg-zinc-900/40 transition-all cursor-pointer group"
            >
              <div class="p-3 rounded-md bg-zinc-900 text-zinc-500 group-hover:text-blue-400 transition-colors mb-2">
                <StampIcon size={24} />
              </div>
              <span class="text-xs font-semibold text-zinc-300 mb-1">
                No textures loaded
              </span>
              <span class="text-[11px] text-zinc-500 mb-3 max-w-[180px]">
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
              <div class="flex items-center justify-center h-48 text-center text-[11px] text-zinc-500 p-4">
                <Show
                  when={activeShelf() === 'pasted'}
                  fallback="No textures used yet — paint, stamp, or fill with one to see it here."
                >
                  Copy an image anywhere — a browser, a screenshot, an image editor — then
                  hit Paste Image (Ctrl+V). It stays in memory for this session.
                </Show>
              </div>
            }
          >
            <Show
              when={hasResults()}
              fallback={
                <div class="flex items-center justify-center h-48 text-center text-[11px] text-zinc-500 p-4">
                  No textures match "{searchQuery()}"
                </div>
              }
            >
              <div class="relative w-full" style={{ height: `${totalHeight()}px` }}>
                <For each={visibleItems()}>
                  {({ item, index }) => {
                    const row = Math.floor(index / COLS)
                    const col = index % COLS
                    const style = {
                      position: 'absolute' as const,
                      top: `${row * ROW_STEP}px`,
                      left: col === 0 ? '0' : 'calc(50% + 5px)',
                      width: 'calc(50% - 5px)'
                    }

                    if (item === SOLID_CARD) {
                      const isSelected = () => brush.texturePath() === null
                      return (
                        <button
                          type="button"
                          onClick={() => setTexturePath(null)}
                          title="Solid Color (No Texture) - Hotkey: X"
                          style={style}
                          class={`flex flex-col p-1.5 rounded-lg border text-left transition-all cursor-pointer group ${
                            isSelected()
                              ? 'bg-blue-600/15 border-blue-500/80 shadow-xs'
                              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850/60'
                          }`}
                        >
                          <div
                            class="relative aspect-square w-full rounded-md border border-white/10 flex items-center justify-center"
                            style={{ 'background-color': brush.color() }}
                          >
                            <Show when={isSelected()}>
                              <div class="absolute top-1 right-1 w-4 h-4 rounded bg-blue-600 text-white flex items-center justify-center shadow-xs">
                                <CheckIcon size={10} />
                              </div>
                            </Show>
                          </div>
                          <span class="text-[10px] font-medium text-zinc-300 truncate mt-1.5">
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
                          class={`flex flex-col p-1.5 rounded-lg border text-left transition-all cursor-pointer group ${
                            isSelected()
                              ? 'bg-amber-600/15 border-amber-500/80 shadow-xs'
                              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850/60'
                          }`}
                        >
                          <div class="relative aspect-square w-full rounded-md overflow-hidden checkerboard-bg border border-zinc-800 flex items-center justify-center">
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
                            <div class="absolute bottom-1 left-1 flex gap-0.5">
                              <For each={channels}>
                                {(c) => (
                                  <span class="px-1 rounded bg-black/70 text-[8px] font-mono uppercase text-amber-200 leading-4">
                                    {CHANNEL_SPECS[c].short}
                                  </span>
                                )}
                              </For>
                            </div>
                            <Show when={isSelected()}>
                              <div class="absolute top-1 right-1 w-4 h-4 rounded bg-amber-500 text-black flex items-center justify-center shadow-xs">
                                <CheckIcon size={10} />
                              </div>
                            </Show>
                          </div>
                          <span class="text-[10px] font-medium text-amber-200/90 truncate mt-1.5" title={set.name}>
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
                        class={`w-full flex flex-col p-1.5 rounded-lg border text-left transition-all cursor-pointer group ${
                          isSelected()
                            ? 'bg-blue-600/15 border-blue-500/80 shadow-xs'
                            : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850/60'
                        }`}
                      >
                        <div class="relative aspect-square w-full rounded-md overflow-hidden checkerboard-bg border border-zinc-800 flex items-center justify-center">
                          <Show
                            when={isBrowserDisplayable(path)}
                            fallback={
                              <span class="text-[10px] font-mono uppercase text-zinc-500">
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
                            <div class="absolute top-1 right-1 w-4 h-4 rounded bg-blue-600 text-white flex items-center justify-center shadow-xs">
                              <CheckIcon size={10} />
                            </div>
                          </Show>
                        </div>
                        <span class="text-[10px] font-medium text-zinc-300 truncate mt-1.5" title={filename()}>
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
    </aside>
  )
}
