import { For, Show, createSignal, createMemo, createEffect, on, onMount, onCleanup } from 'solid-js'
import { brush, setTexturePath } from '../paint/brush'
import {
  FolderOpenIcon,
  XIcon,
  SearchIcon,
  CheckIcon,
  StampIcon
} from './icons'
import { toAssetUrl } from '../utils/assetUrl'

// Row geometry for the virtualized grid below — must track .shelf-grid /
// .shelf-thumb-frame / .shelf-card-name in index.css (260px shelf, 2 columns,
// 10px padding/gap, square thumb, one line of 10px label text). A CSS tweak
// there without updating these just shifts spacing slightly, it won't break.
const COLS = 2
const THUMB_SIZE = 115
const ROW_CONTENT_HEIGHT = 133 // thumb + 4px gap + ~14px label line
const ROW_GAP = 10
const ROW_STEP = ROW_CONTENT_HEIGHT + ROW_GAP
const OVERSCAN_ROWS = 4

const SOLID_CARD = Symbol('solid-card')
type ShelfItem = string | typeof SOLID_CARD

export default function TextureShelf(props: {
  textures: string[]
  onPickFolder: () => void
  onClearFolder: () => void
  isMaskTarget?: () => boolean
}) {
  const [searchQuery, setSearchQuery] = createSignal('')
  const [activeShelf, setActiveShelf] = createSignal<'all' | 'used'>('all')

  const sourceTextures = () => (activeShelf() === 'used' ? brush.recentTextures() : props.textures)

  const filteredTextures = () => {
    const q = searchQuery().trim().toLowerCase()
    const source = sourceTextures()
    if (!q) return source
    return source.filter((p) => {
      const filename = p.split('/').pop()?.toLowerCase() ?? ''
      return filename.includes(q)
    })
  }

  // Solid Color card is just item 0 of the same virtualized list so scrolling,
  // row math, and the empty-state checks all stay in one place.
  const displayItems = createMemo<ShelfItem[]>(() => {
    const showSolid = !searchQuery() && activeShelf() === 'all'
    const items: ShelfItem[] = showSolid ? [SOLID_CARD] : []
    items.push(...filteredTextures())
    return items
  })

  // --- Virtualization: with texture libraries running into the thousands,
  // mounting every <img> (and letting the browser eagerly decode all of them)
  // is what actually makes the shelf feel frozen — only render DOM nodes for
  // rows near the visible viewport.
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

  // Snap back to the top whenever the visible list changes shape, so
  // filtering/switching tabs doesn't leave the scroll position pointing at
  // whatever row used to be there.
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
    <aside class="vertical-texture-shelf">
      {/* Header Bar */}
      <div class="shelf-header">
        <div class="shelf-title-wrap">
          <span class="shelf-title">Textures</span>
          <span class="shelf-count-badge tabular">
            {props.textures.length}
          </span>
        </div>

        <div class="shelf-header-actions">
          <button
            class="shelf-btn-action"
            onClick={props.onPickFolder}
            title="Load folder of textures"
          >
            <FolderOpenIcon size={14} />
            <span>Load</span>
          </button>

          <Show when={props.textures.length > 0}>
            <button
              class="shelf-icon-btn danger"
              onClick={props.onClearFolder}
              title="Clear loaded textures"
            >
              <XIcon size={13} />
            </button>
          </Show>
        </div>
      </div>

      {/* All / Used Tabs */}
      <Show when={props.textures.length > 0}>
        <div class="shelf-tab-bar">
          <button
            class="shelf-tab-btn"
            classList={{ active: activeShelf() === 'all' }}
            onClick={() => setActiveShelf('all')}
          >
            All
          </button>
          <button
            class="shelf-tab-btn"
            classList={{ active: activeShelf() === 'used' }}
            onClick={() => setActiveShelf('used')}
            title="Textures you've painted, stamped, or filled with"
          >
            Used
            <Show when={brush.recentTextures().length > 0}>
              <span class="shelf-count-badge tabular">{brush.recentTextures().length}</span>
            </Show>
          </button>
        </div>
      </Show>

      {/* Filter / Search Bar */}
      <Show when={sourceTextures().length > 0}>
        <div class="shelf-search-wrap">
          <div class="shelf-search-box">
            <SearchIcon size={13} class="search-box-icon" />
            <input
              type="text"
              placeholder="Search textures..."
              class="shelf-search-input"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
            <Show when={searchQuery().length > 0}>
              <button
                class="shelf-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear filter"
              >
                <XIcon size={12} />
              </button>
            </Show>
          </div>
        </div>
      </Show>

      {/* Vertical Texture Grid Body */}
      <div
        class="shelf-body"
        ref={bodyRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <Show
          when={props.textures.length > 0}
          fallback={
            <div class="shelf-empty-state" onClick={props.onPickFolder}>
              <div class="shelf-empty-icon">
                <StampIcon size={24} />
              </div>
              <span class="shelf-empty-headline">No textures loaded</span>
              <span class="shelf-empty-desc">
                Click to select a folder of PNG, JPG, or WebP textures to paint or stamp.
              </span>
              <button class="btn-flat btn-primary" style={{ 'margin-top': '8px', 'pointer-events': 'none' }}>
                Load Folder
              </button>
            </div>
          }
        >
          <Show
            when={activeShelf() === 'all' || sourceTextures().length > 0}
            fallback={
              <div class="shelf-no-results">
                <span>No textures used yet — paint, stamp, or fill with one to see it here.</span>
              </div>
            }
          >
          <Show
            when={filteredTextures().length > 0}
            fallback={
              <div class="shelf-no-results">
                <span>No textures match "{searchQuery()}"</span>
              </div>
            }
          >
            <div class="shelf-grid-virtual-sizer" style={{ height: `${totalHeight()}px` }}>
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
                    return (
                      <button
                        class="shelf-card shelf-card-solid"
                        classList={{ selected: brush.texturePath() === null }}
                        title="Solid Color (No Texture) - Hotkey: X"
                        onClick={() => setTexturePath(null)}
                        style={style}
                      >
                        <div class="shelf-thumb-frame" style={{ 'background-color': brush.color() }}>
                          <Show when={brush.texturePath() === null}>
                            <div class="shelf-selected-check">
                              <CheckIcon size={11} strokeWidth={2.5} />
                            </div>
                          </Show>
                        </div>
                        <span class="shelf-card-name">Solid Color [X]</span>
                      </button>
                    )
                  }

                  const path = item
                  const isSelected = () => brush.texturePath() === path
                  const filename = path.split('/').pop() ?? ''

                  return (
                    <button
                      class="shelf-card"
                      classList={{ selected: isSelected() }}
                      title={`${filename} (Click to toggle)`}
                      onClick={() => {
                        // Toggle texture selection WITHOUT auto-switching tools!
                        setTexturePath(isSelected() ? null : path, !props.isMaskTarget?.())
                      }}
                      style={style}
                    >
                      <div class="shelf-thumb-frame checkerboard-bg">
                        <img
                          src={toAssetUrl(path)}
                          alt={filename}
                          loading="lazy"
                          decoding="async"
                          width={THUMB_SIZE}
                          height={THUMB_SIZE}
                        />
                        <Show when={isSelected()}>
                          <div class="shelf-selected-check">
                            <CheckIcon size={11} strokeWidth={2.5} />
                          </div>
                        </Show>
                      </div>
                      <span class="shelf-card-name">{filename}</span>
                    </button>
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
