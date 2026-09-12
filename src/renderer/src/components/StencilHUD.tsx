import { Show, For, createSignal } from 'solid-js'
import {
  stencil,
  setStencilTexturePath,
  setStencilStampUseLuminance,
  setStencilScale,
  setStencilRotation,
  setStencilDisplayOpacity,
  setStencilInvert,
  setStencilTransforming,
  setStencilVisible,
  resetStencilTransform
} from '../paint/stencil'
import {
  ImagesIcon,
  XIcon,
  RefreshCwIcon,
  FolderOpenIcon,
  StampIcon,
  Trash2Icon,
  ContrastIcon,
  BrushIcon,
  FocusIcon,
  EyeIcon,
  EyeOffIcon
} from './icons'
import { Button, IconButton, Slider, SegmentedControl } from './ui'
import { toAssetUrl } from '../utils/assetUrl'

export interface StencilHUDProps {
  /** Projects the stencil onto the model as a decal; false if it couldn't run. */
  onStamp: () => boolean
  onClose: () => void
  onToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  textures?: string[]
}

/**
 * Controls for the screen-space stencil (see stencil.ts). Sits alongside the
 * material HUD rather than in the right panel because positioning a stencil is
 * a viewport activity — the artist is looking at the model, not the sidebar.
 */
export default function StencilHUD(props: StencilHUDProps) {
  const [showTexturePicker, setShowTexturePicker] = createSignal(false)

  const filename = () => stencil.texturePath()?.split('/').pop() ?? 'Stencil'

  async function browse(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    })
    const path = paths?.[0]
    if (path) {
      loadStencil(path)
    }
  }

  function loadStencil(path: string): void {
    setStencilTexturePath(path)
    resetStencilTransform()
    // Straight into transform mode: a freshly loaded stencil is never in the
    // right place, and this saves the artist a click every single time.
    setStencilTransforming(true)
    setShowTexturePicker(false)
  }

  function clear(): void {
    setStencilTexturePath(null)
    setStencilTransforming(false)
  }

  function stamp(): void {
    if (props.onStamp()) {
      props.onToast?.('Stamped stencil onto the model', 'success')
    } else {
      props.onToast?.('Load a model and a stencil image first', 'warning')
    }
  }

  return (
    <div
      class="absolute top-3 left-3 z-30 w-72 p-3 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-md shadow-2xl flex flex-col gap-2.5 select-none animate-in fade-in slide-in-from-top-2 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header: Title, Active Image Name, and Close Panel Button */}
      <div class="flex items-center justify-between pb-2 border-b border-zinc-800/80">
        <div class="flex items-center gap-2 min-w-0 pr-1">
          <ImagesIcon size={14} class="text-teal-400 flex-shrink-0" />
          <div class="flex flex-col min-w-0">
            <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider leading-none">
              Screen Stencil
            </span>
            <span class="text-xs font-semibold text-zinc-100 truncate mt-0.5" title={filename()}>
              {stencil.texturePath() ? filename() : 'Projection Mask'}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-0.5">
          <Show when={stencil.texturePath()}>
            <IconButton
              size="xs"
              variant="ghost"
              onClick={() => setStencilVisible(!stencil.visible())}
              title={stencil.visible() ? 'Hide stencil sheet from viewport' : 'Show stencil sheet in viewport'}
            >
              <Show when={stencil.visible()} fallback={<EyeOffIcon size={13} class="text-zinc-500" />}>
                <EyeIcon size={13} class="text-teal-400" />
              </Show>
            </IconButton>
          </Show>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={props.onClose}
            title="Close stencil panel"
          >
            <XIcon size={13} />
          </IconButton>
        </div>
      </div>

      {/* Content */}
      <Show
        when={stencil.texturePath()}
        fallback={
          <div class="flex flex-col gap-2.5">
            {/* Empty State Dropzone / Load Button */}
            <div
              onClick={browse}
              class="p-4 rounded-lg border-2 border-dashed border-zinc-750 hover:border-teal-500/60 bg-zinc-950/40 hover:bg-zinc-950/70 flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-colors group"
              title="Click to select a stencil image"
            >
              <div class="w-9 h-9 rounded-full bg-zinc-800/80 group-hover:bg-teal-950/60 flex items-center justify-center text-zinc-400 group-hover:text-teal-400 transition-colors">
                <FolderOpenIcon size={16} />
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-zinc-200 group-hover:text-teal-300">
                  Load Stencil Image…
                </span>
                <span class="text-[10px] text-zinc-500">
                  PNG, JPG, WebP, BMP
                </span>
              </div>
            </div>

            {/* Quick-Pick from Project Textures if available */}
            <Show when={props.textures && props.textures.length > 0}>
              <div class="space-y-1.5 pt-1 border-t border-zinc-800/80">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Or Use Project Texture
                  </span>
                  <span class="text-[10px] font-mono text-zinc-500">
                    {props.textures!.length}
                  </span>
                </div>
                <div class="grid grid-cols-4 gap-1.5 max-h-28 overflow-y-auto p-1 bg-zinc-950/60 rounded border border-zinc-800/80">
                  <For each={props.textures}>
                    {(texPath) => {
                      const name = () => texPath.split('/').pop() ?? 'texture'
                      return (
                        <button
                          type="button"
                          onClick={() => loadStencil(texPath)}
                          title={name()}
                          class="aspect-square rounded overflow-hidden checkerboard-bg border border-zinc-750 hover:border-teal-500 transition-all cursor-pointer relative group"
                        >
                          <img
                            src={toAssetUrl(texPath)}
                            alt={name()}
                            class="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>
            </Show>

            <p class="text-[10px] text-zinc-500 leading-normal">
              A stencil floats as a screen-space sheet over the 3D viewport. Orbit the mesh underneath it, then paint or stamp through it.
            </p>
          </div>
        }
      >
        {/* Active Stencil Thumbnail & Details Card */}
        <div class="flex items-center gap-2.5 p-2 bg-zinc-950/60 border border-zinc-800/80 rounded-md">
          <div class="w-11 h-11 rounded overflow-hidden checkerboard-bg border border-zinc-750 flex-shrink-0 flex items-center justify-center">
            <img
              src={toAssetUrl(stencil.texturePath()!)}
              alt="Stencil"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="flex flex-col min-w-0 flex-1 gap-0.5">
            <span class="text-xs font-medium text-zinc-200 truncate" title={filename()}>
              {filename()}
            </span>
            <span class="text-[10px] font-mono text-teal-400/90 truncate">
              Screen Projection Sheet
            </span>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <IconButton
              size="xs"
              variant="ghost"
              onClick={resetStencilTransform}
              title="Recenter and reset size & rotation"
            >
              <RefreshCwIcon size={12} />
            </IconButton>
            <IconButton
              size="xs"
              variant="ghost"
              onClick={clear}
              title="Unload stencil"
            >
              <Trash2Icon size={12} class="text-zinc-400 hover:text-red-400" />
            </IconButton>
          </div>
        </div>

        {/* Viewport Interaction Mode */}
        <div class="space-y-1">
          <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Viewport Mode
          </span>
          <SegmentedControl
            size="xs"
            options={[
              {
                value: 'paint',
                label: 'Paint Mode',
                title: 'Paint onto the 3D model through the stencil sheet',
                icon: (p) => <BrushIcon size={p.size} />
              },
              {
                value: 'transform',
                label: 'Transform Stencil',
                title: 'Drag viewport to move, wheel to scale, shift+wheel to rotate',
                icon: (p) => <FocusIcon size={p.size} />
              }
            ]}
            value={stencil.transforming() ? 'transform' : 'paint'}
            onChange={(m) => setStencilTransforming(m === 'transform')}
            class="w-full justify-between"
          />
        </div>

        {/* Sliders with presets */}
        <Slider
          label="Size"
          value={stencil.scale()}
          min={0.05}
          max={3}
          step={0.01}
          onChange={(v) => setStencilScale(v)}
          displayValue={(v) => `${Math.round(v * 100)}%`}
          presets={[
            { label: '25%', value: 0.25 },
            { label: '50%', value: 0.5 },
            { label: '100%', value: 1.0 },
            { label: '150%', value: 1.5 }
          ]}
        />
        <Slider
          label="Rotation"
          value={stencil.rotation()}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={(v) => setStencilRotation(v)}
          presets={[
            { label: '0°', value: 0 },
            { label: '90°', value: 90 },
            { label: '180°', value: 180 },
            { label: '270°', value: 270 }
          ]}
        />
        <Slider
          label="Overlay Opacity"
          value={stencil.displayOpacity()}
          min={0.05}
          max={1}
          step={0.01}
          onChange={(v) => setStencilDisplayOpacity(v)}
          displayValue={(v) => `${Math.round(v * 100)}%`}
          presets={[
            { label: '25%', value: 0.25 },
            { label: '50%', value: 0.5 },
            { label: '75%', value: 0.75 },
            { label: '100%', value: 1.0 }
          ]}
        />

        {/* Mask Invert & Replace Stencil */}
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStencilInvert(!stencil.invert())}
            title="Invert stencil luminance (paint through dark regions instead of light regions)"
            class={`flex-1 h-7 rounded-md border text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              stencil.invert()
                ? 'bg-teal-600/20 border-teal-500/70 text-teal-200'
                : 'bg-zinc-850 hover:bg-zinc-800 border-zinc-700/80 text-zinc-300'
            }`}
          >
            <ContrastIcon size={12} />
            <span>Invert Mask</span>
          </button>
          <Button
            variant="secondary"
            size="xs"
            onClick={browse}
            class="flex-1 justify-center h-7"
            title="Choose a different image file for the stencil"
          >
            <FolderOpenIcon size={12} />
            <span>Replace…</span>
          </Button>
        </div>

        {/* Alternate project texture picker drawer if project textures exist */}
        <Show when={props.textures && props.textures.length > 0}>
          <div class="space-y-1">
            <button
              type="button"
              onClick={() => setShowTexturePicker(!showTexturePicker())}
              class="w-full flex items-center justify-between text-[10px] text-zinc-400 hover:text-zinc-200 py-0.5 transition-colors cursor-pointer"
            >
              <span class="font-semibold uppercase tracking-wider">
                {showTexturePicker() ? 'Hide Project Textures' : 'Choose From Project Textures…'}
              </span>
              <span class="font-mono text-zinc-500">{props.textures!.length}</span>
            </button>
            <Show when={showTexturePicker()}>
              <div class="grid grid-cols-4 gap-1.5 max-h-24 overflow-y-auto p-1 bg-zinc-950/60 rounded border border-zinc-800/80 animate-in fade-in duration-100">
                <For each={props.textures}>
                  {(texPath) => {
                    const isCurrent = () => stencil.texturePath() === texPath
                    return (
                      <button
                        type="button"
                        onClick={() => loadStencil(texPath)}
                        title={texPath.split('/').pop() ?? 'texture'}
                        class={`aspect-square rounded overflow-hidden checkerboard-bg border transition-all cursor-pointer relative group ${
                          isCurrent() ? 'border-teal-400 ring-1 ring-teal-400/50' : 'border-zinc-750 hover:border-zinc-600'
                        }`}
                      >
                        <img
                          src={toAssetUrl(texPath)}
                          alt="Texture"
                          class="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Decal Stamping Section */}
        <div class="pt-2 border-t border-zinc-800/80 flex flex-col gap-2">
          <div class="space-y-1">
            <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Stamp Projection
            </span>
            <SegmentedControl
              size="xs"
              options={[
                {
                  value: 'color',
                  label: 'Image RGB',
                  title: 'Stamp decal using original texture colors and alpha'
                },
                {
                  value: 'mask',
                  label: 'Color Mask',
                  title: 'Stamp decal using stencil brightness with the active paint color'
                }
              ]}
              value={stencil.stampUseLuminance() ? 'mask' : 'color'}
              onChange={(v) => setStencilStampUseLuminance(v === 'mask')}
              class="w-full justify-between"
            />
          </div>

          <Button variant="primary" size="sm" onClick={stamp} class="w-full justify-center">
            <StampIcon size={14} />
            <span>Stamp Onto Model</span>
          </Button>
        </div>

        {/* Workflow Tip */}
        <p class="text-[10px] text-zinc-400 leading-normal bg-zinc-950/40 p-2 rounded border border-zinc-800/60">
          <span class="text-zinc-300 font-semibold">Tip:</span> Orbit the model under the stencil sheet, then click <b>Stamp Onto Model</b> or paint directly through it with any brush.
        </p>
      </Show>
    </div>
  )
}
