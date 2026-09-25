import { Show, type JSX } from 'solid-js'
import { brush, setTextureMapping } from '../paint/brush'
import { CHANNEL_SPECS, PAINT_CHANNELS } from '../paint/channels'
import type { ToolMode } from '../paint/brush'
import { stencil } from '../paint/stencil'
import { EFFECT_MODE_LABELS } from '../paint/effectShader'
import {
  BrushIcon,
  StampIcon,
  EraserIcon,
  FillIcon,
  EyedropperIcon,
  MousePointerIcon,
  DropletsIcon,
  LineIcon,
  HelpCircleIcon,
  FocusIcon,
  CompassIcon,
  TextIcon,
  XIcon, EyeIcon, EyeOffIcon,
  GradientIcon
} from './icons'
import { Kbd } from './ui'

export interface StatusBarProps {
  tool: ToolMode
  textureSize: number
  modelName: string
  selectedFaceCount: number
  onOpenHelp: () => void
  onClearFaceSelection: () => void
  onFrameCamera: () => void
}

type ToolIcon = (props: { size?: number; class?: string }) => JSX.Element

const TOOL_CONFIG: Record<ToolMode, { label: string; key: string; num: string; Icon: ToolIcon }> = {
  brush: { label: 'Brush', key: 'B', num: '1', Icon: BrushIcon },
  line: { label: 'Line', key: 'L', num: 'L', Icon: LineIcon },
  eraser: { label: 'Eraser', key: 'E', num: '2', Icon: EraserIcon },
  stamp: { label: 'Stamp', key: 'T', num: '3', Icon: StampIcon },
  fill: { label: 'Fill', key: 'G', num: '4', Icon: FillIcon },
  eyedropper: { label: 'Eyedropper', key: 'I', num: '5', Icon: EyedropperIcon },
  faceSelect: { label: 'Face Select', key: 'V', num: '6', Icon: MousePointerIcon },
  effect: { label: 'Effects', key: 'U', num: '7', Icon: DropletsIcon },
  faceProjector: { label: 'Face UV Projector', key: 'P', num: '8', Icon: CompassIcon },
  text: { label: 'Text', key: 'Y', num: '9', Icon: TextIcon },
  gradient: { label: 'Gradient', key: 'D', num: 'D', Icon: GradientIcon }
}

export default function StatusBar(props: StatusBarProps): JSX.Element {
  const currentTool = (): (typeof TOOL_CONFIG)[ToolMode] =>
    TOOL_CONFIG[props.tool] ?? TOOL_CONFIG.brush

  return (
    <footer
      class="h-7 min-h-7 px-3 bg-[var(--bg-panel-header)] border-t border-[var(--border-color)] flex items-center justify-between text-xs text-[var(--text-muted)] select-none z-30 shrink-0"
      role="status"
      aria-label="Application Status"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-main)]"
          title={`Active Tool: ${currentTool().label} (${currentTool().num} or ${currentTool().key})`}
        >
          {(() => {
            const Icon = currentTool().Icon
            return <Icon size={13} class="text-[var(--accent-color)]" />
          })()}
          <span class="font-medium">{currentTool().label}</span>
          <Kbd size="xs">{currentTool().num}</Kbd>
        </div>

        <Show
          when={props.selectedFaceCount > 0}
          fallback={
            <div
              class="hidden sm:flex items-center gap-1 text-[var(--text-muted)] text-[11px]"
              title="Hold Ctrl and drag to isolate faces (Ctrl+A selects all)"
            >
              <Kbd size="xs">Ctrl</Kbd>
              <span>+Drag to mask</span>
            </div>
          }
        >
          <button
            type="button"
            class="flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-amber-950/60 border border-amber-800/80 text-amber-300 hover:bg-amber-900/60 transition-colors cursor-pointer text-[11px]"
            onClick={props.onClearFaceSelection}
            title="Click or press Esc / Ctrl+D to clear face selection"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span class="font-medium">{props.selectedFaceCount} masked</span>
            <XIcon size={12} class="text-amber-400" />
          </button>
          <button
            type="button"
            class={`flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--ui-radius)] border transition-colors cursor-pointer text-[11px] ${
              brush.selectionHighlightHidden()
                ? 'bg-amber-500 text-black border-amber-400 font-semibold'
                : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
            onClick={() => brush.setSelectionHighlightHidden(!brush.selectionHighlightHidden())}
            title={
              brush.selectionHighlightHidden()
                ? 'Selection highlight is hidden — painting is still confined to the selection. Click to show.'
                : 'Hide the selection highlight (painting stays confined to the selection)'
            }
          >
            {brush.selectionHighlightHidden() ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
            <Show when={brush.selectionHighlightHidden()}>
              <span>Highlight hidden</span>
            </Show>
          </button>
        </Show>

        <Show
          when={
            props.tool === 'brush' ||
            props.tool === 'stamp' ||
            props.tool === 'eraser' ||
            props.tool === 'effect'
          }
        >
          <div
            class="flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] font-mono text-[var(--text-main)] tabular-nums text-[11px]"
            title="Brush radius: [ / ] or Shift+Wheel or RMB+Drag"
          >
            <span class="text-[var(--text-muted)] font-sans">R:</span>
            <span>{Math.round(brush.radius())}px</span>
          </div>

          <div
            class="flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] font-mono text-[var(--text-main)] tabular-nums text-[11px]"
            title="Opacity: Shift+[ / Shift+] or Shift+Alt+Wheel"
          >
            <span class="text-[var(--text-muted)] font-sans">Op:</span>
            <span>{Math.round(brush.opacity() * 100)}%</span>
          </div>

          <Show
            when={
              props.tool === 'brush' ||
              props.tool === 'stamp' ||
              props.tool === 'eraser' ||
              props.tool === 'effect'
            }
          >
            <div
              class="hidden md:flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] font-mono text-[var(--text-main)] tabular-nums text-[11px]"
              title="Hardness: Ctrl+[ / Ctrl+]"
            >
              <span class="text-[var(--text-muted)] font-sans">H:</span>
              <span>{Math.round(brush.hardness() * 100)}%</span>
            </div>
          </Show>

          <Show
            when={
              props.tool === 'brush' ||
              props.tool === 'stamp' ||
              props.tool === 'eraser' ||
              props.tool === 'effect'
            }
          >
            <div
              class="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] font-mono text-[var(--text-main)] tabular-nums text-[11px]"
              title="Brush rotation: Ctrl+Wheel or drag slider"
            >
              <span class="text-[var(--text-muted)] font-sans">Rot:</span>
              <span>{brush.brushRotation()}°</span>
            </div>
          </Show>
        </Show>

        <Show when={props.tool === 'effect'}>
          <div
            class="flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] font-mono text-[11px] text-teal-300"
            title="Cycle modes with 7 or U"
          >
            <span class="text-[var(--text-muted)] font-sans">Filter:</span>
            <span class="font-semibold">{EFFECT_MODE_LABELS[brush.effectMode()]}</span>
          </div>
        </Show>

        <Show when={props.tool === 'faceProjector'}>
          <div
            class="flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] font-mono text-[11px] text-purple-300"
            title="Texture placement on selected faces"
          >
            <span class="text-[var(--text-muted)] font-sans">UV Placement:</span>
            <span class="font-semibold">{brush.faceProjection().fit ? 'Fit' : 'Tile'}</span>
          </div>
        </Show>

        <Show when={stencil.texturePath()}>
          <div
            class={`flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] border text-[11px] font-mono transition-colors ${
              stencil.transforming()
                ? 'bg-amber-950/60 border-amber-800/80 text-amber-300'
                : stencil.visible()
                  ? 'bg-teal-950/50 border-teal-800/60 text-teal-300'
                  : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)]'
            }`}
            title="Screen Stencil: Hold Alt to scale/rotate/move, press S to toggle panel"
          >
            <span
              class={`w-1.5 h-1.5 rounded-full ${
                stencil.transforming()
                  ? 'bg-amber-400 animate-pulse'
                  : stencil.visible()
                    ? 'bg-teal-400'
                    : 'bg-zinc-600'
              }`}
            />
            <span>
              Stencil {stencil.transforming() ? 'Transform' : stencil.visible() ? 'Active' : 'Off'}
            </span>
          </div>
        </Show>
      </div>

      <div class="flex items-center gap-2">
        <Show when={props.tool === 'stamp'}>
          <div class="hidden xl:flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[11px]">
            <span class="text-[var(--text-muted)]">Mode:</span>
            <button
              type="button"
              class="text-[var(--accent-color)] hover:underline font-mono cursor-pointer"
              onClick={() => {
                const next = brush.textureMapping() === 'uv' ? 'triplanar' : 'uv'
                setTextureMapping(next)
              }}
              title="Click to toggle UV / Triplanar"
            >
              {brush.textureMapping()}
            </button>
          </div>
        </Show>

        <Show when={props.tool === 'brush'}>
          <div
            class="hidden 2xl:flex items-center gap-1 text-[11px] text-[var(--text-muted)]"
            title="Active PBR paint channels written per stroke"
          >
            <span class="font-medium">Channels:</span>
            <div class="flex items-center gap-0.5">
              {PAINT_CHANNELS.map((ch) => {
                const on = () => brush.channelEnabled()[ch]
                return (
                  <span
                    class={`px-1 rounded-[2px] font-mono text-[9px] font-bold ${
                      on()
                        ? 'text-[var(--accent-color)] bg-[var(--accent-color)]/10'
                        : 'text-zinc-600 line-through'
                    }`}
                  >
                    {CHANNEL_SPECS[ch].short}
                  </span>
                )
              })}
            </div>
          </div>
        </Show>

        <div class="hidden md:flex items-center gap-1 font-mono text-[11px] text-[var(--text-muted)] px-1.5">
          <span>
            {props.textureSize}×{props.textureSize}
          </span>
        </div>

        <button
          type="button"
          class="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer px-1 py-0.5 rounded-[var(--ui-radius)] hover:bg-white/5 text-[11px]"
          onClick={props.onFrameCamera}
          title="Frame model (F)"
        >
          <FocusIcon size={12} />
          <span class="hidden sm:inline">Frame</span>
          <Kbd size="xs">F</Kbd>
        </button>

        <button
          type="button"
          class="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer px-1 py-0.5 rounded-[var(--ui-radius)] hover:bg-white/5 text-[11px]"
          onClick={props.onOpenHelp}
          title="Open keyboard shortcuts & help (?)"
        >
          <HelpCircleIcon size={12} />
          <span class="hidden sm:inline">Help</span>
          <Kbd size="xs">?</Kbd>
        </button>
      </div>
    </footer>
  )
}
export { StatusBar }
