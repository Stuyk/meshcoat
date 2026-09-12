import { Show } from 'solid-js'
import {
  brush,
  setTexturePath,
  setTextureScale,
  setTextureMapping,
  setFillMode,
  type ToolMode
} from '../paint/brush'
import { ImagesIcon, XIcon } from './icons'
import { Slider, SegmentedControl, IconButton } from './ui'
import { toAssetUrl } from '../utils/assetUrl'

export interface MaterialTextureHUDProps {
  activeTool: ToolMode
  isMaskTarget?: () => boolean
}

export default function MaterialTextureHUD(props: MaterialTextureHUDProps) {
  const isApplicableTool = () =>
    props.activeTool === 'brush' || props.activeTool === 'fill' || props.activeTool === 'stamp'

  const isVisible = () => (!!brush.texturePath() && isApplicableTool()) || props.activeTool === 'fill'

  const filename = () => brush.texturePath()?.split('/').pop() ?? 'Texture'

  return (
    <Show when={isVisible()}>
      <div
        class="absolute bottom-4 right-4 z-20 w-72 p-3 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-md shadow-2xl flex flex-col gap-2.5 select-none animate-in fade-in slide-in-from-bottom-2 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <Show when={brush.texturePath()}>
          {/* Header: Title, Filename & Close Button */}
          <div class="flex items-center justify-between pb-2 border-b border-zinc-800/80">
            <div class="flex items-center gap-2 min-w-0 pr-1">
              <ImagesIcon size={14} class="text-purple-400 flex-shrink-0" />
              <div class="flex flex-col min-w-0">
                <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider leading-none">
                  Material Texture
                </span>
                <span class="text-xs font-semibold text-zinc-100 truncate mt-0.5" title={filename()}>
                  {filename()}
                </span>
              </div>
            </div>

            <IconButton
              size="xs"
              variant="ghost"
              onClick={() => setTexturePath(null, !props.isMaskTarget?.())}
              title="Remove texture (Switch back to solid color)"
            >
              <XIcon size={13} />
            </IconButton>
          </div>

          {/* Thumbnail & Mode Badge */}
          <div class="flex items-center gap-2.5 p-2 bg-zinc-950/60 border border-zinc-800/80 rounded-md">
            <div class="w-11 h-11 rounded overflow-hidden checkerboard-bg border border-zinc-750 flex-shrink-0 flex items-center justify-center">
              <img
                src={toAssetUrl(brush.texturePath()!)}
                alt={filename()}
                class="w-full h-full object-cover"
              />
            </div>
            <div class="flex flex-col min-w-0 flex-1 gap-0.5">
              <span class="text-xs font-medium text-zinc-200 truncate">
                {props.activeTool === 'stamp'
                  ? 'Decal Stamp'
                  : props.activeTool === 'fill'
                    ? 'Fill Pattern'
                    : brush.textureMapping() === 'uv'
                      ? 'Direct UV Mode'
                      : brush.textureMapping() === 'triplanar'
                        ? 'Triplanar Mode'
                        : 'Brush Tip Mode'}
              </span>
              <span class="text-[10px] font-mono text-zinc-500 truncate">
                {brush.texturePath()}
              </span>
            </div>
          </div>
        </Show>

        {/* Fill Mode (Fill Tool only) */}
        <Show when={props.activeTool === 'fill'}>
          <div class="space-y-1">
            <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Fill Mode
            </span>
            <SegmentedControl
              size="xs"
              options={[
                { value: 'whole', label: 'Fill', title: 'Fill the whole model (or the active face selection)' },
                { value: 'face', label: 'Fill Face', title: 'Fill only the single face clicked' }
              ]}
              value={brush.fillMode()}
              onChange={(m) => setFillMode(m as any)}
              class="w-full justify-between"
            />
          </div>
        </Show>

        {/* Projection Mode (Brush Tool only) */}
        <Show when={props.activeTool === 'brush'}>
          <div class="space-y-1">
            <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Projection
            </span>
            <SegmentedControl
              size="xs"
              options={[
                { value: 'uv', label: 'UV', title: 'Direct surface UV mapping' },
                { value: 'triplanar', label: 'Triplanar', title: 'Seamless 3D world projection' },
                { value: 'tip', label: 'Tip', title: 'Brush tip dab decal' }
              ]}
              value={brush.textureMapping()}
              onChange={(m) => setTextureMapping(m as any)}
              class="w-full justify-between"
            />
          </div>
        </Show>

        {/* Tiling Scale Slider */}
        <Show when={props.activeTool === 'brush' || props.activeTool === 'fill'}>
          <Slider
            label="Tiling Scale"
            value={brush.textureScale()}
            min={0}
            max={16}
            step={0.1}
            unit="x"
            onChange={(v) => setTextureScale(v)}
            displayValue={(v) => `${v.toFixed(1)}x`}
            presets={[
              { label: '0x', value: 0 },
              { label: '1x', value: 1 },
              { label: '2x', value: 2 },
              { label: '4x', value: 4 },
              { label: '8x', value: 8 },
              { label: '16x', value: 16 }
            ]}
          />
        </Show>
      </div>
    </Show>
  )
}
