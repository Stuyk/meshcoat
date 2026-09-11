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
  CheckIcon
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

  return (
    <div class="layers-tab">
      {/* Layers Toolbar */}
      <div class="layers-toolbar">
        <div class="layers-count-badge">
          {props.getStack()?.layers.length ?? 0} {props.getStack()?.layers.length === 1 ? 'Layer' : 'Layers'}
        </div>
        <button
          class="layers-add-btn"
          title="Add new painting layer"
          onClick={() => run((s) => s.addLayer())}
        >
          <PlusIcon size={14} />
          <span>New Layer</span>
        </button>
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

            return (
              <div
                class="layer-card"
                classList={{
                  active: isActive(),
                  hidden: !layer.visible
                }}
                onClick={() => run((s) => (s.activeId = layer.id))}
              >
                {/* Main Row: Preview, Visibility, Name & Quick Actions */}
                <div class="layer-card-main">
                  {/* Thumbnail */}
                  <div class="layer-preview-thumb checkerboard-bg">
                    <img src={preview()} alt="" />
                  </div>

                  {/* Visibility Button */}
                  <button
                    class="layer-action-icon-btn visibility-btn"
                    classList={{ 'is-hidden': !layer.visible }}
                    onClick={(e) => {
                      e.stopPropagation()
                      run((s) => s.setVisible(layer.id, !layer.visible))
                    }}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
                  </button>

                  {/* Name and Rename Field */}
                  <div class="layer-name-wrap">
                    <Show
                      when={editingId() === layer.id}
                      fallback={
                        <div
                          class="layer-name-label"
                          onDblClick={(e) => startEditing(layer, e)}
                          title="Double-click to rename"
                        >
                          <span class="layer-name-text">{layer.name}</span>
                          <Show when={isBottom()}>
                            <span class="layer-base-badge">Base</span>
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
                          <CheckIcon size={13} />
                        </button>
                      </div>
                    </Show>
                  </div>

                  {/* Rename Pencil Trigger */}
                  <Show when={editingId() !== layer.id}>
                    <button
                      class="layer-rename-btn"
                      title="Rename layer"
                      onClick={(e) => startEditing(layer, e)}
                    >
                      <Edit2Icon size={12} />
                    </button>
                  </Show>
                </div>

                {/* Opacity Control Row */}
                <div class="layer-opacity-row" onClick={(e) => e.stopPropagation()}>
                  <span class="layer-opacity-label">Opacity</span>
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

                {/* Extended Action Bar (When Active) */}
                <Show when={isActive()}>
                  <div class="layer-actions-bar" onClick={(e) => e.stopPropagation()}>
                    <button
                      class="layer-btn-pill"
                      disabled={isTop()}
                      title="Move layer up in stack"
                      onClick={() => run((s) => s.moveLayer(layer.id, 'up'))}
                    >
                      <ArrowUpIcon size={13} />
                      <span>Up</span>
                    </button>

                    <button
                      class="layer-btn-pill"
                      disabled={isBottom()}
                      title="Move layer down in stack"
                      onClick={() => run((s) => s.moveLayer(layer.id, 'down'))}
                    >
                      <ArrowDownIcon size={13} />
                      <span>Down</span>
                    </button>

                    <button
                      class="layer-btn-pill"
                      title="Duplicate layer"
                      onClick={() => run((s) => s.duplicateLayer(layer.id))}
                    >
                      <CopyIcon size={13} />
                      <span>Clone</span>
                    </button>

                    <button
                      class="layer-btn-pill"
                      disabled={isBottom()}
                      title="Merge onto layer below"
                      onClick={() => run((s) => s.mergeDown(layer.id))}
                    >
                      <ChevronDownIcon size={13} />
                      <span>Merge</span>
                    </button>

                    <button
                      class="layer-btn-pill danger"
                      disabled={(stack()?.layers.length ?? 0) <= 1}
                      title="Delete layer"
                      onClick={() => run((s) => s.removeLayer(layer.id))}
                    >
                      <Trash2Icon size={13} />
                    </button>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
