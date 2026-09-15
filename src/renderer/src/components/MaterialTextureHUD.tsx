import { Show, type JSX } from 'solid-js'
import {
  brush,
  setTexturePath,
  setTextureScale,
  setTextureMapping,
  setTextureRepeat,
  setFillMode,
  type ToolMode,
  type FillMode,
  type BrushTextureMapping,
  type BrushTextureRepeat
} from '../paint/brush'
import { ImagesIcon, XIcon, Trash2Icon, SparklesIcon } from './icons'
import { Slider, SegmentedControl, IconButton, Label, Button } from './ui'
import { brushPresets } from '../paint/brushPresets'
import { toAssetUrl } from '../utils/assetUrl'
import { fileName } from '../utils/paths'

export interface MaterialTextureHUDProps {
  /** Rendered inside the tool panel dock rather than floating over the viewport. */
  docked?: boolean
  /** Closable, and reopened from the Panels menu in the header. */
  isOpen: boolean
  onClose: () => void
  activeTool: ToolMode
  isMaskTarget?: () => boolean
}

export default function MaterialTextureHUD(props: MaterialTextureHUDProps): JSX.Element {
  const isApplicableTool = (): boolean =>
    props.activeTool === 'brush' ||
    props.activeTool === 'fill' ||
    props.activeTool === 'stamp' ||
    props.activeTool === 'faceProjector'

  const isVisible = (): boolean =>
    props.isOpen && ((!!brush.texturePath() && isApplicableTool()) || props.activeTool === 'fill')

  const filename = (): string => fileName(brush.texturePath())

  return (
    <Show when={isVisible()}>
      <div
        class={
          props.docked
            ? // Docked: the dock owns the frame, so no card chrome of its own.
              'w-full flex flex-col gap-2.5 select-none'
            : 'absolute bottom-4 right-4 z-20 w-72 p-3 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-md shadow-2xl flex flex-col gap-2.5 select-none animate-in fade-in slide-in-from-bottom-2 duration-150'
        }
        onClick={(e) => e.stopPropagation()}
      >
        <Show when={brush.texturePath()}>
          {/* The dock draws this panel's title, summary and actions in its own
              section header, so a second one here is just noise that blurs where
              one panel ends and the next begins. */}
          <Show when={!props.docked}>
            {/* Header: Title, Filename & Close Button */}
            <div class="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div class="flex items-center gap-2 min-w-0 pr-1">
                <ImagesIcon size={14} class="text-purple-400 flex-shrink-0" />
                <div class="flex flex-col min-w-0">
                  <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider leading-none">
                    Material Texture
                  </span>
                  <span
                    class="text-xs font-semibold text-zinc-100 truncate mt-0.5"
                    title={filename()}
                  >
                    {filename()}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-0.5">
                <IconButton
                  size="xs"
                  variant="ghost"
                  onClick={() => setTexturePath(null, !props.isMaskTarget?.())}
                  title="Remove texture (switch back to solid color)"
                >
                  <Trash2Icon size={13} />
                </IconButton>
                {/* Distinct from removing the texture: this only hides the panel,
                    and the header's Panels menu brings it back. */}
                <IconButton
                  size="xs"
                  variant="ghost"
                  onClick={props.onClose}
                  title="Hide this panel"
                >
                  <XIcon size={13} />
                </IconButton>
              </div>
            </div>
          </Show>

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
            </div>
          </div>
        </Show>

        <Show when={props.activeTool === 'stamp'}>
          <div class="flex items-center justify-between p-1.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-7 h-7 rounded-[var(--ui-radius)] checkerboard-bg border border-[var(--border-color)] flex items-center justify-center overflow-hidden shrink-0">
                <Show
                  when={brush.tipTexturePath()}
                  fallback={<div class="w-3.5 h-3.5 rounded-full bg-blue-400" />}
                >
                  <img
                    src={toAssetUrl(brush.tipTexturePath()!)}
                    alt="Tip"
                    class="w-full h-full object-contain p-0.5"
                  />
                </Show>
              </div>
              <span class="text-xs font-medium text-[var(--text-main)] truncate">
                {brushPresets.active() ? brushPresets.active()!.name : 'Standard Round Tip'}
              </span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Show when={brushPresets.active()}>
                <IconButton
                  size="xs"
                  variant="ghost"
                  onClick={() => brushPresets.clear()}
                  tooltip="Reset to standard round tip"
                >
                  <XIcon size={12} />
                </IconButton>
              </Show>
              <Button
                variant="accent"
                size="xs"
                onClick={() => brushPresets.openManager()}
                title="Open Brush Library"
              >
                <SparklesIcon size={12} class="text-amber-300" />
                <span>Library</span>
              </Button>
            </div>
          </div>
        </Show>

        {/* Fill Mode (Fill Tool only) */}
        <Show when={props.activeTool === 'fill'}>
          <div class="space-y-1">
            <Label uppercase>Fill Mode</Label>
            <SegmentedControl
              size="xs"
              options={[
                {
                  value: 'whole',
                  label: 'Fill',
                  title: 'Fill the whole model (or the active face selection)'
                },
                { value: 'face', label: 'Fill Face', title: 'Fill only the single face clicked' }
              ]}
              value={brush.fillMode()}
              onChange={(m) => setFillMode(m as FillMode)}
              class="w-full justify-between"
            />
          </div>
        </Show>

        {/* Placement + Repeat (Brush Tool only).
            Renamed from the old UV / Triplanar / Tip trio, which described the
            implementation rather than what the artist gets: "Surface" means the
            picture lands on the surface you point at, "World" means the pattern
            is fixed in space and the model moves through it, "Cursor" means one
            copy per dab under the brush. */}
        <Show when={props.activeTool === 'brush'}>
          <div class="space-y-1">
            <Label uppercase>Placement</Label>
            <SegmentedControl
              size="xs"
              options={[
                {
                  value: 'uv',
                  label: 'Surface',
                  title:
                    'Texture follows the model surface (UV). Predictable, matches the exported map.'
                },
                {
                  value: 'triplanar',
                  label: 'World',
                  title:
                    'Pattern fixed in world space. For dressing a whole model in a seamless material.'
                },
                {
                  value: 'tip',
                  label: 'Cursor',
                  title:
                    'One copy of the region per dab, centred on the cursor and rotated with the brush.'
                }
              ]}
              value={brush.textureMapping()}
              onChange={(m) => setTextureMapping(m as BrushTextureMapping)}
              class="w-full justify-between"
            />
          </div>

          <div class="space-y-1">
            <Label uppercase>Repeat</Label>
            <SegmentedControl
              size="xs"
              options={[
                { value: 'tile', label: 'Tile', title: 'The selected region repeats edge to edge' },
                {
                  value: 'mirror',
                  label: 'Mirror',
                  title: 'Every other copy flips, so a non-tiling region has no visible seam'
                },
                {
                  value: 'once',
                  label: 'Once',
                  title: 'A single copy, nothing outside it — brush to reveal a decal'
                }
              ]}
              value={brush.textureRepeat()}
              onChange={(m) => setTextureRepeat(m as BrushTextureRepeat)}
              class="w-full justify-between"
            />
          </div>
        </Show>

        {/* Tiling Scale Slider */}
        <Show when={props.activeTool === 'brush' || props.activeTool === 'fill'}>
          <Slider
            label={
              brush.textureMapping() === 'triplanar'
                ? 'Tiling (repeats / world unit)'
                : 'Tiling (repeats across UV)'
            }
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
