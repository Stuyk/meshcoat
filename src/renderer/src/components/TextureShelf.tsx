import { For, Show, createSignal } from 'solid-js'
import { brush, setTexturePath } from '../paint/brush'
import {
  FolderOpenIcon,
  XIcon,
  SearchIcon,
  CheckIcon,
  StampIcon
} from './icons'
import { toAssetUrl } from '../utils/assetUrl'

export default function TextureShelf(props: {
  textures: string[]
  onPickFolder: () => void
  onClearFolder: () => void
}) {
  const [searchQuery, setSearchQuery] = createSignal('')

  const filteredTextures = () => {
    const q = searchQuery().trim().toLowerCase()
    if (!q) return props.textures
    return props.textures.filter((p) => {
      const filename = p.split('/').pop()?.toLowerCase() ?? ''
      return filename.includes(q)
    })
  }

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

      {/* Filter / Search Bar */}
      <Show when={props.textures.length > 0}>
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
      <div class="shelf-body">
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
            when={filteredTextures().length > 0}
            fallback={
              <div class="shelf-no-results">
                <span>No textures match "{searchQuery()}"</span>
              </div>
            }
          >
            <div class="shelf-grid">
              {/* Solid Color / No Texture Card */}
              <Show when={!searchQuery()}>
                <button
                  class="shelf-card shelf-card-solid"
                  classList={{ selected: brush.texturePath() === null }}
                  title="Solid Color (No Texture) - Hotkey: X"
                  onClick={() => setTexturePath(null)}
                >
                  <div class="shelf-thumb-frame" style={{ "background-color": brush.color() }}>
                    <Show when={brush.texturePath() === null}>
                      <div class="shelf-selected-check">
                        <CheckIcon size={11} strokeWidth={2.5} />
                      </div>
                    </Show>
                  </div>
                  <span class="shelf-card-name">Solid Color [X]</span>
                </button>
              </Show>

              <For each={filteredTextures()}>
                {(path) => {
                  const isSelected = () => brush.texturePath() === path
                  const filename = () => path.split('/').pop() ?? ''

                  return (
                    <button
                      class="shelf-card"
                      classList={{ selected: isSelected() }}
                      title={`${filename()} (Click to toggle)`}
                      onClick={() => {
                        // Toggle texture selection WITHOUT auto-switching tools!
                        setTexturePath(isSelected() ? null : path)
                      }}
                    >
                      <div class="shelf-thumb-frame checkerboard-bg">
                        <img src={toAssetUrl(path)} alt={filename()} />
                        <Show when={isSelected()}>
                          <div class="shelf-selected-check">
                            <CheckIcon size={11} strokeWidth={2.5} />
                          </div>
                        </Show>
                      </div>
                      <span class="shelf-card-name">{filename()}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </aside>
  )
}
