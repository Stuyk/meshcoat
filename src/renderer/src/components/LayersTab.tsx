import { For, Show, createSignal } from 'solid-js'
import type { Layer, LayerStack } from '../paint/layers'
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
  CornerDownRightIcon,
  LayersPlusIcon
} from './icons'

export default function LayersTab(props: {
  getStack: () => LayerStack | undefined
  version: number
  onChange: () => void
}) {
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [editName, setEditName] = createSignal('')

  function run(fn: (stack: LayerStack) => void): void {
    const stack = props.getStack()
    if (!stack) return
    fn(stack)
    props.onChange()
  }

  const orderedLayers = (): Layer[] => {
    void props.version
    return [...(props.getStack()?.layers ?? [])].reverse().map((l) => ({ ...l }))
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
            <PlusIcon size={24} />
          </button>
          <button
            class="layers-tool-icon-btn mask-btn"
            title="Add new Mask Layer (modulates layers below)"
            onClick={() => run((s) => s.addMaskLayer())}
          >
            <DramaIcon size={24} />
          </button>
        </div>
      </div>

      {/* Layers List */}
      <div class="layers-list">
        <For each={orderedLayers()}>
          {(layer) => {
            const stack = () => props.getStack()
            const layers = () => stack()?.layers ?? []
            const index = () => layers().findIndex((l) => l.id === layer.id)
            const isBottom = () => index() === 0
            const isTop = () => index() === layers().length - 1
            const isActive = () => stack()?.activeId === layer.id
            const preview = () => stack()?.previewFor(layer) ?? ''

            // Check if this layer is clipped to a mask
            const maskOwner = () => {
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
                    'is-mask': !!layer.isMask,
                    'is-clipped': isClipped(),
                    hidden: !layer.visible
                  }}
                  onClick={() => run((s) => (s.activeId = layer.id))}
                >
                  {/* Main Row: Visibility, Thumbnail, Name & Badges */}
                  <div class="layer-card-main">
                    {/* Visibility Toggle */}
                    <button
                      class="layer-vis-btn"
                      classList={{ 'is-hidden': !layer.visible }}
                      onClick={(e) => {
                        e.stopPropagation()
                        run((s) => s.setVisible(layer.id, !layer.visible))
                      }}
                      title={
                        layer.visible
                          ? layer.isMask
                            ? 'Disable mask'
                            : 'Hide layer'
                          : layer.isMask
                            ? 'Enable mask'
                            : 'Show layer'
                      }
                    >
                      {layer.visible ? <EyeIcon size={24} /> : <EyeOffIcon size={24} />}
                    </button>

                    {/* Thumbnail */}
                    <div
                      class="layer-preview-thumb checkerboard-bg"
                      classList={{ 'is-mask-thumb': !!layer.isMask }}
                      title={layer.isMask ? 'Mask Buffer (White reveals, Black hides)' : 'Color Buffer'}
                    >
                      <img src={preview()} alt="" />
                      <Show when={layer.isMask}>
                        <span class="mask-thumb-icon-badge" title="Mask Layer">
                          <DramaIcon size={14} />
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
                                <CornerDownRightIcon size={15} />
                              </span>
                            </Show>
                            <span class="layer-name-text">{layer.name}</span>
                            <Show when={layer.isMask}>
                              <span class="layer-type-badge mask">MASK</span>
                            </Show>
                            <Show when={isBottom() && !layer.isMask}>
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
                            <CheckIcon size={20} />
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
                        <Edit2Icon size={20} />
                      </button>
                    </Show>
                  </div>

                  {/* Opacity / Strength Row */}
                  <div class="layer-opacity-row" onClick={(e) => e.stopPropagation()}>
                    <span class="layer-opacity-label">
                      {layer.isMask ? 'Strength' : 'Opacity'}
                    </span>
                    <input
                      class="layer-opacity-slider"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={layer.opacity}
                      onInput={(e) =>
                        run((s) => s.setOpacity(layer.id, parseFloat(e.currentTarget.value)))
                      }
                    />
                    <span class="layer-opacity-val tabular">{Math.round(layer.opacity * 100)}%</span>
                  </div>

                  {/* Icon-Only Action Toolbar (Shown When Active) */}
                  <Show when={isActive()}>
                    <div class="layer-actions-bar" onClick={(e) => e.stopPropagation()}>
                      {/* Mask-Specific Action Group */}
                      <Show when={layer.isMask}>
                        <button
                          class="layer-action-btn accent"
                          title="Add paint layer below (clipped to this mask)"
                          onClick={() => run((s) => s.addLayerBelow(layer.id))}
                        >
                          <CornerDownRightIcon size={24} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Invert mask (swap reveal and hide)"
                          onClick={() => run((s) => s.invertMask(layer.id))}
                        >
                          <ContrastIcon size={24} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Reveal all (fill pure white)"
                          onClick={() => run((s) => s.fillMask(layer.id, true))}
                        >
                          <SunIcon size={24} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Hide all (fill pure black)"
                          onClick={() => run((s) => s.fillMask(layer.id, false))}
                        >
                          <MoonIcon size={24} />
                        </button>
                        <button
                          class="layer-action-btn"
                          classList={{ 'preview-active': !!layer.previewMaskOnModel }}
                          title="Inspect raw mask on 3D model"
                          onClick={() => run((s) => s.toggleMaskPreviewOnModel(layer.id))}
                        >
                          <CubeIcon size={24} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Unmask (convert back to color layer)"
                          onClick={() => run((s) => s.unmaskLayer(layer.id))}
                        >
                          <UnlinkIcon size={24} />
                        </button>
                      </Show>

                      {/* Color Layer Action Group */}
                      <Show when={!layer.isMask}>
                        <button
                          class="layer-action-btn accent"
                          title="Convert this layer to a Mask Layer"
                          onClick={() => run((s) => s.convertToMask(layer.id))}
                        >
                          <DramaIcon size={24} />
                        </button>
                        <button
                          class="layer-action-btn"
                          title="Add new mask directly above"
                          onClick={() => run((s) => s.addMaskAbove(layer.id))}
                        >
                          <LayersPlusIcon size={24} />
                        </button>
                        <Show when={isClipped()}>
                          <button
                            class="layer-action-btn"
                            title="Unclip from mask"
                            onClick={() => run((s) => s.setClipToMask(layer.id, 0))}
                          >
                            <UnlinkIcon size={24} />
                          </button>
                        </Show>
                      </Show>

                      <div class="layer-action-divider" />

                      {/* Stack Movement Group */}
                      <button
                        class="layer-action-btn"
                        disabled={isTop()}
                        title="Move layer up"
                        onClick={() => run((s) => s.moveLayer(layer.id, 'up'))}
                      >
                        <ArrowUpIcon size={24} />
                      </button>
                      <button
                        class="layer-action-btn"
                        disabled={isBottom()}
                        title="Move layer down"
                        onClick={() => run((s) => s.moveLayer(layer.id, 'down'))}
                      >
                        <ArrowDownIcon size={24} />
                      </button>

                      <div class="layer-action-divider" />

                      {/* Duplicate & Merge Group */}
                      <button
                        class="layer-action-btn"
                        title="Duplicate layer"
                        onClick={() => run((s) => s.duplicateLayer(layer.id))}
                      >
                        <CopyIcon size={24} />
                      </button>
                      <Show when={!layer.isMask}>
                        <button
                          class="layer-action-btn"
                          disabled={isBottom()}
                          title="Merge onto layer below"
                          onClick={() => run((s) => s.mergeDown(layer.id))}
                        >
                          <ChevronDownIcon size={24} />
                        </button>
                      </Show>

                      {/* Delete */}
                      <button
                        class="layer-action-btn danger"
                        disabled={(stack()?.layers.length ?? 0) <= 1}
                        title="Delete layer"
                        onClick={() => run((s) => s.removeLayer(layer.id))}
                      >
                        <Trash2Icon size={24} />
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

