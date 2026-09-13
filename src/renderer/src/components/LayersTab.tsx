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
import { IconButton, Label, Select, TextInput } from './ui'

export default function LayersTab(props: {
  getStack: () => LayerStack | undefined
  version: number
  onChange: () => void
  hideHeader?: boolean
}) {
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [editName, setEditName] = createSignal('')

  const thumbCache = new Map<number, { version: number; url: string }>()

  function run(fn: (stack: LayerStack) => void): void {
    const stack = props.getStack()
    if (!stack) return
    fn(stack)
    props.onChange()
  }

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
    <div class="flex flex-col h-full text-xs text-zinc-300 select-none">
      {/* Layers Toolbar (hidden when parent provides unified header) */}
      <Show when={!props.hideHeader}>
        <div class="h-9 px-3.5 flex items-center justify-between border-b border-zinc-850 bg-zinc-900/40 flex-shrink-0">
          <Label uppercase>
            {layerCount()} {layerCount() === 1 ? 'Layer' : 'Layers'}
          </Label>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => run((s) => s.addLayer())}
            title="Add new painting layer"
          >
            <PlusIcon size={15} />
          </IconButton>
        </div>
      </Show>

      {/* Layers List */}
      <div class="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        <For each={orderedLayers()}>
          {(layer) => {
            const stack = () => props.getStack()
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
              <div class={`relative flex flex-col ${isClipped() ? 'pl-4' : ''}`}>
                {/* Visual Branch Line Connector for clipped layer */}
                <Show when={isClipped()}>
                  <div
                    class="absolute -left-0.5 top-0 bottom-1/2 w-3.5 border-l-2 border-b-2 border-zinc-700/80 rounded-bl-md pointer-events-none"
                    title={`Masked by ${maskOwner()?.name}`}
                  />
                </Show>

                <div
                  onClick={() => run((s) => (s.activeId = layer.id))}
                  class={`flex flex-col p-2 rounded-xl border transition-all cursor-pointer ${
                    isActive()
                      ? 'bg-zinc-850/90 border-blue-500/80 shadow-xs ring-1 ring-blue-500/20'
                      : 'bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-750 hover:bg-zinc-850/50'
                  } ${!visible() ? 'opacity-50' : ''}`}
                >
                  {/* Row 1: Visibility, Thumbnail, Name, Rename Button */}
                  <div class="flex items-center gap-2.5">
                    {/* Visibility Toggle */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        run((s) => s.setVisible(layer.id, !layer.visible))
                      }}
                      class="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
                      title={visible() ? 'Hide layer' : 'Show layer'}
                    >
                      {visible() ? <EyeIcon size={14} /> : <EyeOffIcon size={14} class="text-zinc-600" />}
                    </button>

                    {/* Thumbnail */}
                    <div class="relative w-8 h-8 rounded-lg overflow-hidden checkerboard-bg border border-zinc-750 flex-shrink-0">
                      <img src={preview()} alt="" class="w-full h-full object-cover" />
                      <Show when={isMaskFlag()}>
                        <span class="absolute bottom-0 right-0 p-0.5 bg-blue-600 text-white rounded-tl text-[8px]" title="Mask Layer">
                          <DramaIcon size={8} />
                        </span>
                      </Show>
                    </div>

                    {/* Layer Name & Inline Rename */}
                    <div class="flex-1 min-w-0">
                      <Show
                        when={editingId() === layer.id}
                        fallback={
                          <div
                            class="flex items-center gap-1.5 truncate"
                            onDblClick={(e) => startEditing(layer, e)}
                            title="Double-click to rename"
                          >
                            <Show when={isClipped()}>
                              <CornerDownRightIcon size={11} class="text-zinc-500 flex-shrink-0" />
                            </Show>
                            <span class="text-xs font-semibold text-zinc-200 truncate">
                              {name()}
                            </span>
                            <Show when={isMaskFlag()}>
                              <span class="px-1 py-0 rounded bg-blue-950/80 border border-blue-800/60 text-[9px] font-mono text-blue-300">
                                MASK
                              </span>
                            </Show>
                            <Show when={isBottom() && !isMaskFlag()}>
                              <span class="px-1 py-0 rounded bg-zinc-800 border border-zinc-700 text-[9px] font-mono text-zinc-400">
                                BASE
                              </span>
                            </Show>
                          </div>
                        }
                      >
                        <div class="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <TextInput
                            size="xs"
                            value={editName()}
                            onInput={(val) => setEditName(val)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEditing(layer.id)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            autofocus
                            class="w-full"
                          />
                          <button
                            type="button"
                            onClick={() => commitEditing(layer.id)}
                            class="p-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                            title="Confirm rename"
                          >
                            <CheckIcon size={13} />
                          </button>
                        </div>
                      </Show>
                    </div>

                    {/* Rename Button */}
                    <Show when={editingId() !== layer.id}>
                      <button
                        type="button"
                        onClick={(e) => startEditing(layer, e)}
                        class="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Rename layer"
                      >
                        <Edit2Icon size={12} />
                      </button>
                    </Show>
                  </div>

                  {/* Row 2: Blend Mode & Opacity Slider */}
                  <div class="flex items-center gap-2 mt-2 pt-1.5 border-t border-zinc-800/60" onClick={(e) => e.stopPropagation()}>
                    <Show
                      when={!isMaskFlag()}
                      fallback={<span class="text-[10px] font-medium text-zinc-500 w-16">Strength</span>}
                    >
                      <Select
                        size="xs"
                        class="w-24 truncate"
                        title="Blend mode"
                        value={blendMode()}
                        onChange={(val) => run((s) => s.setBlendMode(layer.id, val as BlendMode))}
                      >
                        <For each={BLEND_MODES}>
                          {(mode) => <option value={mode}>{BLEND_MODE_LABELS[mode]}</option>}
                        </For>
                      </Select>
                    </Show>

                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={opacity()}
                      onPointerDown={() => run((s) => s.history.record())}
                      onInput={(e) => run((s) => s.setOpacity(layer.id, parseFloat(e.currentTarget.value), false))}
                      class="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span class="font-mono text-[10px] text-zinc-400 tabular-nums w-8 text-right">
                      {Math.round(opacity() * 100)}%
                    </span>
                  </div>

                  {/* Row 3: Action Toolbar (Shown When Active) */}
                  <Show when={isActive()}>
                    <div
                      class="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-zinc-800/80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Mask Toggle */}
                      <button
                        type="button"
                        onClick={() => run((s) => (layer.isMask ? s.unmaskLayer(layer.id) : s.convertToMask(layer.id)))}
                        class={`p-1.5 rounded transition-colors cursor-pointer ${
                          isMaskFlag()
                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                        title={isMaskFlag() ? 'Switch to Texture Layer' : 'Switch to Mask Layer'}
                      >
                        <DramaIcon size={13} />
                      </button>

                      {/* Mask-Specific Action Group */}
                      <Show when={isMaskFlag()}>
                        <button
                          type="button"
                          onClick={() => run((s) => s.addLayerBelow(layer.id))}
                          class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                          title="Add paint layer below (clipped to this mask)"
                        >
                          <CornerDownRightIcon size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => run((s) => s.invertMask(layer.id))}
                          class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                          title="Invert mask"
                        >
                          <ContrastIcon size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => run((s) => s.fillMask(layer.id, true))}
                          class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                          title="Reveal all (White)"
                        >
                          <SunIcon size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => run((s) => s.fillMask(layer.id, false))}
                          class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                          title="Hide all (Black)"
                        >
                          <MoonIcon size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => run((s) => s.toggleMaskPreviewOnModel(layer.id))}
                          class={`p-1.5 rounded transition-colors cursor-pointer ${
                            previewOnModel()
                              ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
                              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                          }`}
                          title="Inspect raw mask on 3D model"
                        >
                          <CubeIcon size={13} />
                        </button>
                      </Show>

                      {/* Unclip button for clipped layers */}
                      <Show when={!isMaskFlag() && isClipped()}>
                        <button
                          type="button"
                          onClick={() => run((s) => s.setClipToMask(layer.id, 0))}
                          class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                          title="Unclip from mask"
                        >
                          <UnlinkIcon size={13} />
                        </button>
                      </Show>

                      <div class="h-4 w-px bg-zinc-800 my-auto" />

                      {/* Reorder Buttons */}
                      <button
                        type="button"
                        disabled={isTop()}
                        onClick={() => run((s) => s.moveLayer(layer.id, 'up'))}
                        class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                        title="Move layer up"
                      >
                        <ArrowUpIcon size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={isBottom()}
                        onClick={() => run((s) => s.moveLayer(layer.id, 'down'))}
                        class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                        title="Move layer down"
                      >
                        <ArrowDownIcon size={13} />
                      </button>

                      <div class="h-4 w-px bg-zinc-800 my-auto" />

                      {/* Duplicate & Merge */}
                      <button
                        type="button"
                        onClick={() => run((s) => s.duplicateLayer(layer.id))}
                        class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                        title="Duplicate layer"
                      >
                        <CopyIcon size={13} />
                      </button>
                      <Show when={!isMaskFlag()}>
                        <button
                          type="button"
                          disabled={isBottom()}
                          onClick={() => run((s) => s.mergeDown(layer.id))}
                          class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          title="Merge onto layer below"
                        >
                          <ChevronDownIcon size={13} />
                        </button>
                      </Show>

                      {/* Delete */}
                      <button
                        type="button"
                        disabled={(stack()?.layers.length ?? 0) <= 1}
                        onClick={() => run((s) => s.removeLayer(layer.id))}
                        class="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-950/40 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                        title="Delete layer"
                      >
                        <Trash2Icon size={13} />
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
