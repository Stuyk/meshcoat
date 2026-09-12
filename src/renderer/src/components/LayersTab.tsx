import { For, Show, createSignal } from 'solid-js'
import type { Layer, LayerStack } from '../paint/layers'
import { BLEND_MODES, BLEND_MODE_LABELS, type BlendMode } from '../paint/blendShader'
import {
  PlusIcon,
  Trash2Icon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronDownIcon,
  Edit2Icon,
  CheckIcon,
  DramaIcon,
  ContrastIcon,
  SunIcon,
  MoonIcon,
  CubeIcon,
  UnlinkIcon,
  CornerDownRightIcon
} from './icons'

export default function LayersTab(props: {
  getStack: () => LayerStack | undefined
  version: number
  onChange: () => void
}) {
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [editName, setEditName] = createSignal('')

  // Thumbnails are a render pass + pixel readback + PNG encode — only redo
  // that for a layer whose own content actually changed (tracked via its
  // PaintEngine's contentVersion), not for every layer on every unrelated
  // change (an opacity drag on one layer used to re-encode all of them).
  const thumbCache = new Map<number, { version: number; url: string }>()

  function run(fn: (stack: LayerStack) => void): void {
    const stack = props.getStack()
    if (!stack) return
    fn(stack)
    props.onChange()
  }

  // Stable Layer object references (no cloning) so <For> can diff by identity
  // and only mount/unmount the rows that were actually added/removed/moved —
  // cloning a fresh object per layer on every version bump used to make <For>
  // treat every row as brand new and fully rebuild the whole panel's DOM on
  // any change anywhere, which (among other things) yanked focus/pointer
  // capture out from under an in-progress opacity-slider drag.
  const orderedLayers = (): Layer[] => {
    void props.version
    const layers = props.getStack()?.layers ?? []
    const liveIds = new Set(layers.map((l) => l.id))
    for (const id of thumbCache.keys()) {
      if (!liveIds.has(id)) thumbCache.delete(id)
    }
    return [...layers].reverse()
  }

  function startEditing(layer: Layer, e: MouseEvent): void {
    e.stopPropagation()
    setEditingId(layer.id)
    setEditName(layer.name)
  }

  function commitEditing(id: number): void {
    if (editName().trim()) {
      run((s) => s.renameLayer(id, editName().trim()))
    }
    setEditingId(null)
  }

  const layerCount = () => {
    void props.version
    return props.getStack()?.layers.length ?? 0
  }

  return (
    <div class="layers-tab">
      {/* Layers Toolbar */}
      <div class="layers-toolbar">
        <span class="layers-count-badge">
          {layerCount()} {layerCount() === 1 ? 'Layer' : 'Layers'}
        </span>
        <div class="layers-toolbar-actions">
          <button
            class="layers-tool-icon-btn"
            title="Add new painting layer"
            onClick={() => run((s) => s.addLayer())}
          >
            <PlusIcon size={18} />
          </button>
        </div>
      </div>

      {/* Layers List */}
      <div class="layers-list">
        <For each={orderedLayers()}>
          {(layer) => {
            const stack = () => props.getStack()
            // Layer objects are mutated in place (opacity/visible/name/etc.),
            // so reads used for display must explicitly depend on
            // props.version to re-run when those mutations happen — the
            // array itself no longer changes identity to force that for us.
            const layers = () => {
              void props.version
              return stack()?.layers ?? []
            }
            const index = () => layers().findIndex((l) => l.id === layer.id)
            const isBottom = () => index() === 0
            const isTop = () => index() === layers().length - 1
            const isActive = () => {
              void props.version
              return stack()?.activeId === layer.id
            }
            const opacity = () => {
              void props.version
              return layer.opacity
            }
            const visible = () => {
              void props.version
              return layer.visible
            }
            const name = () => {
              void props.version
              return layer.name
            }
            const isMaskFlag = () => {
              void props.version
              return !!layer.isMask
            }
            const previewOnModel = () => {
              void props.version
              return !!layer.previewMaskOnModel
            }
            const blendMode = (): BlendMode => {
              void props.version
              return layer.blendMode ?? 'normal'
            }
            const preview = () => {
              const st = stack()
              if (!st) return ''
              const v = layer.engine.contentVersion
              const cached = thumbCache.get(layer.id)
              if (cached && cached.version === v) return cached.url
              const url = st.previewFor(layer)
              thumbCache.set(layer.id, { version: v, url })
              return url
            }

            // Check if this layer is clipped to a mask
            const maskOwner = () => {
              void props.version
              if (layer.isMask) return undefined
              if (layer.clippedToMaskId && layer.clippedToMaskId > 0) {
                return layers().find((l) => l.id === layer.clippedToMaskId)
              }
              if (
                layer.clippedToMaskId === undefined &&
                index() + 1 < layers().length &&
                layers()[index() + 1].isMask
              ) {
                return layers()[index() + 1]
              }
              return undefined
            }

            const isClipped = () => !!maskOwner()

            return (
              <div
                class="layer-item-container"
                classList={{
                  'is-clipped-wrapper': isClipped()
                }}
              >
                {/* Visual Branch Line Connector for clipped layer */}
                <Show when={isClipped()}>
                  <div class="layer-clip-guide" title={`Masked by ${maskOwner()?.name}`}>
                    <span class="tree-stem" />
                    <span class="tree-elbow" />
                  </div>
                </Show>

                <div
                  class="layer-card"
                  classList={{
                    active: isActive(),
                    'is-mask': isMaskFlag(),
                    'is-clipped': isClipped(),
                    hidden: !visible()
                  }}
                  onClick={() => run((s) => (s.activeId = layer.id))}
                >
                  {/* Main Row: Visibility, Thumbnail, Name & Badges */}
                  <div class="layer-card-main">
                    {/* Visibility Toggle */}
                    <button
                      class="layer-vis-btn"
                      classList={{ 'is-hidden': !visible() }}
                      onClick={(e) => {
                        e.stopPropagation()
                        run((s) => s.setVisible(layer.id, !layer.visible))
                      }}
                      title={
                        visible()
                          ? isMaskFlag()
                            ? 'Disable mask'
                            : 'Hide layer'
                          : isMaskFlag()
                            ? 'Enable mask'
                            : 'Show layer'
                      }
                    >
                      {visible() ? <EyeIcon size={17} /> : <EyeOffIcon size={17} />}
                    </button>

                    {/* Thumbnail */}
                    <div
                      class="layer-preview-thumb checkerboard-bg"
                      classList={{ 'is-mask-thumb': isMaskFlag() }}
                      title={isMaskFlag() ? 'Mask Buffer (White reveals, Black hides)' : 'Color Buffer'}
                    >
                      <img src={preview()} alt="" />
                      <Show when={isMaskFlag()}>
                        <span class="mask-thumb-icon-badge" title="Mask Layer">
                          <DramaIcon size={11} />
                        </span>
                      </Show>
                    </div>

                    {/* Layer Name, Status & In-place Rename */}
                    <div class="layer-name-wrap">
                      <Show
                        when={editingId() === layer.id}
                        fallback={
                          <div
                            class="layer-name-label"
                            onDblClick={(e) => startEditing(layer, e)}
                            title="Double-click to rename"
                          >
                            <Show when={isClipped()}>
                              <span
                                class="layer-clip-tag-icon"
                                title={`Masked by ${maskOwner()?.name}`}
                              >
                                <CornerDownRightIcon size={13} />
                              </span>
                            </Show>
                            <span class="layer-name-text">{name()}</span>
                            <Show when={isMaskFlag()}>
                              <span class="layer-type-badge mask">MASK</span>
                            </Show>
                            <Show when={isBottom() && !isMaskFlag()}>
                              <span class="layer-type-badge base">BASE</span>
                            </Show>
                          </div>
                        }
                      >
                        <div class="layer-rename-box" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            class="layer-rename-input"
                            value={editName()}
                            onInput={(e) => setEditName(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEditing(layer.id)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            autofocus
                          />
                          <button
                            class="layer-rename-confirm"
                            onClick={() => commitEditing(layer.id)}
                            title="Confirm name"
                          >
                            <CheckIcon size={15} />
                          </button>
                        </div>
                      </Show>
                    </div>

                    {/* Rename Trigger Button */}
                    <Show when={editingId() !== layer.id}>
                      <button
                        class="layer-rename-btn"
                        title="Rename layer"
                        onClick={(e) => startEditing(layer, e)}
                      >
                        <Edit2Icon size={15} />
                      </button>
                    </Show>
                  </div>

                  {/* Blend Mode + Opacity / Strength Row */}
                  <div class="layer-opacity-row" onClick={(e) => e.stopPropagation()}>
                    <Show
                      when={!isMaskFlag()}
                      fallback={<span class="layer-opacity-label">Strength</span>}
                    >
                      <select
                        class="layer-blend-select"
                        title="Blend mode"
                        value={blendMode()}
                        onChange={(e) =>
                          run((s) => s.setBlendMode(layer.id, e.currentTarget.value as BlendMode))
                        }
                      >
                        <For each={BLEND_MODES}>
                          {(mode) => <option value={mode}>{BLEND_MODE_LABELS[mode]}</option>}
                        </For>
                      </select>
                    </Show>
                    <input
                      class="layer-opacity-slider"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={opacity()}
                      onPointerDown={() => run((s) => s.history.record())}
                      onInput={(e) =>
                        run((s) => s.setOpacity(layer.id, parseFloat(e.currentTarget.value), false))
                      }
                    />
                    <span class="layer-opacity-val tabular">{Math.round(opacity() * 100)}%</span>
                  </div>

                  {/* Icon-Only Action Toolbar (Shown When Active) */}
                  <Show when={isActive()}>
                    <div class="layer-actions-bar" onClick={(e) => e.stopPropagation()}>
                      {/* Single Mask <-> Texture Mode Toggle */}
                      <button
                        class="layer-action-btn accent"
                        classList={{ active: isMaskFlag() }}
                        title={isMaskFlag() ? 'Switch to Texture Layer' : 'Switch to Mask Layer'}
                        onClick={() =>
                          run((s) => (layer.isMask ? s.unmaskLayer(layer.id) : s.convertToMask(layer.id)))
                        }
                      >
                        <DramaIcon size={16} />
                      </button>

                      {/* Mask-Specific Action Group */}
                      <Show when={isMaskFlag()}>
                        <button
                          class="layer-action-btn"
                          title="Add paint layer below (clipped to this mask)"
                          onClick={() => run((s) => s.addLayerBelow(layer.id))}
                        >
                          <CornerDownRightIcon size={16} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Invert mask (swap reveal and hide)"
                          onClick={() => run((s) => s.invertMask(layer.id))}
                        >
                          <ContrastIcon size={16} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Reveal all (fill pure white)"
                          onClick={() => run((s) => s.fillMask(layer.id, true))}
                        >
                          <SunIcon size={16} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Hide all (fill pure black)"
                          onClick={() => run((s) => s.fillMask(layer.id, false))}
                        >
                          <MoonIcon size={16} />
                        </button>
                        <button
                          class="layer-action-btn"
                          classList={{ 'preview-active': previewOnModel() }}
                          title="Inspect raw mask on 3D model"
                          onClick={() => run((s) => s.toggleMaskPreviewOnModel(layer.id))}
                        >
                          <CubeIcon size={16} />
                        </button>
                      </Show>

                      {/* Color Layer: unclip if attached to a mask (attach it by moving it under one instead) */}
                      <Show when={!isMaskFlag() && isClipped()}>
                        <button
                          class="layer-action-btn"
                          title="Unclip from mask"
                          onClick={() => run((s) => s.setClipToMask(layer.id, 0))}
                        >
                          <UnlinkIcon size={16} />
                        </button>
                      </Show>

                      <div class="layer-action-divider" />

                      {/* Stack Movement Group */}
                      <button
                        class="layer-action-btn"
                        disabled={isTop()}
                        title="Move layer up"
                        onClick={() => run((s) => s.moveLayer(layer.id, 'up'))}
                      >
                        <ArrowUpIcon size={16} />
                      </button>
                      <button
                        class="layer-action-btn"
                        disabled={isBottom()}
                        title="Move layer down"
                        onClick={() => run((s) => s.moveLayer(layer.id, 'down'))}
                      >
                        <ArrowDownIcon size={16} />
                      </button>

                      <div class="layer-action-divider" />

                      {/* Duplicate & Merge Group */}
                      <button
                        class="layer-action-btn"
                        title="Duplicate layer"
                        onClick={() => run((s) => s.duplicateLayer(layer.id))}
                      >
                        <CopyIcon size={16} />
                      </button>
                      <Show when={!isMaskFlag()}>
                        <button
                          class="layer-action-btn"
                          disabled={isBottom()}
                          title="Merge onto layer below"
                          onClick={() => run((s) => s.mergeDown(layer.id))}
                        >
                          <ChevronDownIcon size={16} />
                        </button>
                      </Show>

                      {/* Delete */}
                      <button
                        class="layer-action-btn danger"
                        disabled={(stack()?.layers.length ?? 0) <= 1}
                        title="Delete layer"
                        onClick={() => run((s) => s.removeLayer(layer.id))}
                      >
                        <Trash2Icon size={16} />
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
