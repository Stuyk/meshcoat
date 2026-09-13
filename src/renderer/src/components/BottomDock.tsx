import { Show, type JSX } from 'solid-js'
import { brush, setTextureMapping } from '../paint/brush'
import { CHANNEL_SPECS, PAINT_CHANNELS } from '../paint/channels'
import type { ToolMode } from '../paint/brush'
import { stencil, setStencilTransforming } from '../paint/stencil'
import { EFFECT_MODES, EFFECT_MODE_LABELS } from '../paint/effectShader'
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
  XIcon
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
  faceProjector: { label: 'Face UV Projector', key: 'P', num: '8', Icon: CompassIcon }
}

export default function StatusBar(props: StatusBarProps): JSX.Element {
  const currentTool = (): (typeof TOOL_CONFIG)[ToolMode] => TOOL_CONFIG[props.tool] ?? TOOL_CONFIG.brush

  return (
    <footer
      class="h-7 min-h-7 px-3 bg-zinc-925 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400 select-none z-30 flex-shrink-0"
      role="status"
      aria-label="Application Status"
    >
      {/* Left Area: Active Tool & Face Mask Status & Brush Specs */}
      <div class="flex items-center gap-2">
        {/* Tool Indicator */}
        <div
          class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200"
          title={`Active Tool: ${currentTool().label} (${currentTool().num} or ${currentTool().key})`}
        >
          {(() => {
            const Icon = currentTool().Icon
            return <Icon size={12} class="text-blue-400" />
          })()}
          <span class="font-medium text-zinc-200">{currentTool().label}</span>
          <Kbd size="xs">{currentTool().num}</Kbd>
        </div>

        {/* Selected Faces Indicator */}
        <Show
          when={props.selectedFaceCount > 0}
          fallback={
            <div
              class="hidden sm:flex items-center gap-1 text-zinc-500"
              title="Hold Ctrl and drag to isolate faces (Ctrl+A selects all)"
            >
              <Kbd size="xs">Ctrl</Kbd>
              <span>+Drag to isolate faces</span>
            </div>
          }
        >
          <button
            type="button"
            class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/80 text-amber-300 hover:bg-amber-900/60 transition-colors cursor-pointer"
            onClick={props.onClearFaceSelection}
            title="Click or press Esc / Ctrl+D to clear face selection"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span class="font-medium">
              {props.selectedFaceCount} face{props.selectedFaceCount > 1 ? 's' : ''} masked
            </span>
            <span class="text-amber-500/80 text-[10px]">(Esc to clear)</span>
            <XIcon size={11} class="text-amber-400" />
          </button>
        </Show>

        {/* Brush Spec pills */}
        <Show when={props.tool === 'brush' || props.tool === 'stamp' || props.tool === 'eraser' || props.tool === 'effect'}>
          <div
            class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/80 border border-zinc-800/60 font-mono text-zinc-300 tabular-nums"
            title="Brush radius: [ / ] or Shift+Wheel or RMB+Drag"
          >
            <span class="text-zinc-500 font-sans">R:</span>
            <span>{Math.round(brush.radius())}px</span>
          </div>
          <div
            class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/80 border border-zinc-800/60 font-mono text-zinc-300 tabular-nums"
            title="Brush opacity: Shift+RMB+Drag"
          >
            <span class="text-zinc-500 font-sans">Op:</span>
            <span>{Math.round(brush.opacity() * 100)}%</span>
          </div>
        </Show>

        {/* Active material channels — what the next stroke will actually write */}
        <Show when={props.tool === 'brush' || props.tool === 'line' || props.tool === 'stamp' || props.tool === 'fill'}>
          <div
            class="hidden lg:flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/80 border border-zinc-800/60 font-mono text-zinc-300"
            title="Material channels this brush writes (toggle them in Brush Settings)"
          >
            <span class="text-zinc-500 font-sans">Ch:</span>
            {PAINT_CHANNELS.filter((c) => brush.channelEnabled()[c]).map((c) => (
              <span class="text-[10px] text-zinc-300">{CHANNEL_SPECS[c].short}</span>
            ))}
          </div>
        </Show>

        {/* Effect Filter cycle pill */}
        <Show when={props.tool === 'effect'}>
          <button
            type="button"
            class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-teal-950/40 border border-teal-800/50 text-teal-300 hover:bg-teal-900/40 transition-colors cursor-pointer font-mono"
            onClick={() => {
              const nextMode = EFFECT_MODES[(EFFECT_MODES.indexOf(brush.effectMode()) + 1) % EFFECT_MODES.length]
              brush.setEffectMode(nextMode)
            }}
            title="Active Effect Filter. Click or press U to cycle (Blur -> Sharpen -> Smudge -> Pixelate)"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-teal-400" />
            <span class="text-teal-400/80 font-sans">Filter:</span>
            <span class="font-medium">{EFFECT_MODE_LABELS[brush.effectMode()]}</span>
          </button>
        </Show>

        {/* Brush Texture Projection toggle */}
        <Show when={props.tool === 'brush' && brush.texturePath()}>
          <button
            type="button"
            class="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-950/40 border border-blue-800/50 text-blue-300 hover:bg-blue-900/40 transition-colors cursor-pointer font-mono"
            onClick={() => {
              const current = brush.textureMapping()
              const next = current === 'uv' ? 'triplanar' : current === 'triplanar' ? 'tip' : 'uv'
              setTextureMapping(next)
            }}
            title="Click to cycle texture projection: Direct UV -> World Triplanar -> Brush Tip"
          >
            <span class="text-blue-400/80 font-sans">Proj:</span>
            <span class="font-medium">
              {brush.textureMapping() === 'uv'
                ? 'Direct UV'
                : brush.textureMapping() === 'triplanar'
                  ? 'Triplanar'
                  : 'Brush Tip'}
            </span>
          </button>
        </Show>

        {/* Texture Scale / Tiling Spec pills */}
        <Show when={(props.tool === 'fill' || props.tool === 'brush') && brush.texturePath()}>
          <div
            class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/80 border border-zinc-800/60 font-mono text-zinc-300 tabular-nums"
            title="Texture scale / tiling ([ / ] or Shift+Wheel to adjust)"
          >
            <span class="text-zinc-500 font-sans">Scale:</span>
            <span>{brush.textureScale().toFixed(2)}x</span>
          </div>
        </Show>

        {/* Screen Stencil Spec / Transform Toggle pill */}
        <Show when={stencil.stencilActive()}>
          <button
            type="button"
            class={`flex items-center gap-1.5 px-2 py-0.5 rounded border font-mono transition-colors cursor-pointer ${
              stencil.transforming()
                ? 'bg-blue-950/60 border-blue-600/70 text-blue-300'
                : 'bg-teal-950/40 border-teal-800/50 text-teal-300 hover:bg-teal-900/40'
            }`}
            onClick={() => setStencilTransforming(!stencil.transforming())}
            title={
              stencil.transforming()
                ? 'Screen Stencil is in Transform Mode. Click or press Esc to return to Painting'
                : 'Screen Stencil is active. Click to enter Stencil Transform mode'
            }
          >
            <span
              class={`w-1.5 h-1.5 rounded-full ${
                stencil.transforming() ? 'bg-blue-400 animate-pulse' : 'bg-teal-400'
              }`}
            />
            <span class="text-zinc-400 font-sans">Stencil:</span>
            <span>{stencil.transforming() ? 'Transforming' : `${Math.round(stencil.scale() * 100)}%`}</span>
          </button>
        </Show>
      </div>

      {/* Center Area: Camera / Navigation Shortcuts */}
      <div class="hidden md:flex items-center gap-2 text-zinc-500">
        <Show when={props.tool === 'brush' || props.tool === 'eraser' || props.tool === 'stamp'}>
          <span class="inline-flex items-center gap-1">
            <Kbd size="xs">Shift</Kbd>
            <span>+Click Straight Line</span>
          </span>
          <span>·</span>
        </Show>
        <Show when={props.tool === 'fill'}>
          <span class="inline-flex items-center gap-1">
            <Kbd size="xs">Click</Kbd>
            <span>
              Fill{' '}
              {brush.fillMode() === 'face' ? 'Clicked Face' : props.selectedFaceCount > 0 ? 'Selection' : 'Model'}
            </span>
          </span>
          <span>·</span>
        </Show>
        <span class="inline-flex items-center gap-1" title="Middle Mouse Button drag or Alt+LMB drag">
          <Kbd size="xs">MMB</Kbd>
          <span>Orbit</span>
        </span>
        <span>·</span>
        <span class="inline-flex items-center gap-1" title="Shift + Middle Mouse Button drag or Alt+MMB drag">
          <Kbd size="xs">Shift</Kbd>+<Kbd size="xs">MMB</Kbd>
          <span>Pan</span>
        </span>
        <span>·</span>
        <span class="inline-flex items-center gap-1" title="Scroll wheel or Alt+RMB drag">
          <Kbd size="xs">Wheel</Kbd>
          <span>Zoom</span>
        </span>
        <span>·</span>
        <button
          type="button"
          class="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          onClick={props.onFrameCamera}
          title="Focus / Frame model (F or Home)"
        >
          <FocusIcon size={11} />
          <span>Frame [F]</span>
        </button>
      </div>

      {/* Right Area: Resolution & Hotkey Link */}
      <div class="flex items-center gap-2">
        <span class="font-mono text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-[10px] tabular-nums" title="Canvas texture resolution">
          {props.textureSize} × {props.textureSize}
        </span>

        <button
          type="button"
          class="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          onClick={props.onOpenHelp}
          title="View keyboard shortcuts guide (?)"
        >
          <HelpCircleIcon size={12} />
          <span>Hotkeys (?)</span>
        </button>
      </div>
    </footer>
  )
}
