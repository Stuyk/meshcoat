import { Show, For } from 'solid-js'
import {
  brush,
  setEffectMode,
  setEffectStrength,
  setEffectRadius,
  setPixelSize,
  setSmudgeLength
} from '../paint/brush'
import { EFFECT_MODES, EFFECT_MODE_LABELS, type EffectMode } from '../paint/effectShader'
import { brushPresets } from '../paint/brushPresets'
import { DropletsIcon, SparklesIcon, FeatherIcon, WireframeIcon, XIcon } from './icons'
import { Slider, IconButton, Label, Button } from './ui'
import { toAssetUrl } from '../utils/assetUrl'

export interface EffectHUDProps {
  /** Rendered inside the tool panel dock rather than floating over the viewport. */
  docked?: boolean
  isOpen?: boolean
  onClose?: () => void
}

const EFFECT_DESCRIPTIONS: Record<EffectMode, string> = {
  blur: 'Softens and blends color transitions under the stroke',
  sharpen: 'Enhances micro-contrast and clarifies texture details',
  smudge: 'Drags and smears existing paint along the stroke direction',
  pixelate: 'Groups surface pixels into retro mosaic blocks'
}

const EFFECT_ICONS: Record<EffectMode, (props: { size?: number; class?: string }) => any> = {
  blur: DropletsIcon,
  sharpen: SparklesIcon,
  smudge: FeatherIcon,
  pixelate: WireframeIcon
}

export default function EffectHUD(props: EffectHUDProps) {
  // The set of tools that show this panel lives in paint/toolPanels.ts.
  const isVisible = () => props.isOpen ?? true

  const activeMode = () => brush.effectMode()

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
        {/* The dock draws this panel's title, summary and actions in its own
            section header, so a second one here is just noise that blurs where
            one panel ends and the next begins. */}
        <Show when={!props.docked}>
          {/* Header: Title, Active Mode, and Optional Close Button */}
          <div class="flex items-center justify-between pb-2 border-b border-zinc-800/80">
            <div class="flex items-center gap-2 min-w-0 pr-1">
              <DropletsIcon size={14} class="text-teal-400 flex-shrink-0" />
              <div class="flex flex-col min-w-0">
                <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider leading-none">
                  Effects Brush
                </span>
                <span class="text-xs font-semibold text-zinc-100 truncate mt-0.5">
                  {EFFECT_MODE_LABELS[activeMode()]} Filter
                </span>
              </div>
            </div>

            <Show when={props.onClose}>
              <IconButton size="xs" variant="ghost" onClick={props.onClose} title="Close panel">
                <XIcon size={13} />
              </IconButton>
            </Show>
          </div>
        </Show>

        {/* 2x2 Mode Choice Selector Grid */}
        <div class="flex items-center justify-between p-1.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-7 h-7 rounded-[var(--ui-radius)] checkerboard-bg border border-[var(--border-color)] flex items-center justify-center overflow-hidden shrink-0">
              <Show
                when={brush.tipTexturePath()}
                fallback={<div class="w-3.5 h-3.5 rounded-full bg-teal-400" />}
              >
                <img
                  src={toAssetUrl(brush.tipTexturePath()!)}
                  alt="Tip"
                  class="w-full h-full object-contain p-0.5"
                />
              </Show>
            </div>
            <span class="text-xs font-medium text-[var(--text-main)] truncate">
              {brushPresets.active() ? brushPresets.active()!.name : 'Round Tip'}
            </span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Show when={brushPresets.active()}>
              <IconButton
                size="xs"
                variant="ghost"
                onClick={() => brushPresets.clear()}
                tooltip="Reset to round tip"
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

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <Label uppercase>Filter Choice</Label>
            <span class="text-[10px] text-zinc-500 font-mono">Press U to cycle</span>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            <For each={EFFECT_MODES}>
              {(mode) => {
                const isSelected = () => brush.effectMode() === mode
                const Icon = EFFECT_ICONS[mode]
                return (
                  <button
                    type="button"
                    onClick={() => setEffectMode(mode)}
                    title={EFFECT_DESCRIPTIONS[mode]}
                    class={`h-8 px-2.5 rounded-md border text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      isSelected()
                        ? 'bg-teal-600/20 border-teal-500/80 text-teal-100 shadow-xs font-semibold'
                        : 'bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-850/50'
                    }`}
                  >
                    <Icon size={13} class={isSelected() ? 'text-teal-400' : 'text-zinc-400'} />
                    <span>{EFFECT_MODE_LABELS[mode]}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>

        {/* Effect Strength Slider */}
        <Slider
          label="Strength"
          value={brush.effectStrength()}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(v) => setEffectStrength(v)}
          displayValue={(v) => `${Math.round(v * 100)}%`}
          presets={[
            { label: '25%', value: 0.25 },
            { label: '50%', value: 0.5 },
            { label: '75%', value: 0.75 },
            { label: '100%', value: 1.0 }
          ]}
        />

        {/* Mode-Specific Parameter Sliders */}
        <Show when={activeMode() === 'blur' || activeMode() === 'sharpen'}>
          <Slider
            label="Kernel Radius"
            value={brush.effectRadius()}
            min={1}
            max={32}
            step={1}
            unit=" px"
            onChange={(v) => setEffectRadius(v)}
            presets={[
              { label: '2px', value: 2 },
              { label: '4px', value: 4 },
              { label: '8px', value: 8 },
              { label: '16px', value: 16 }
            ]}
          />
        </Show>

        <Show when={activeMode() === 'pixelate'}>
          <Slider
            label="Block Size"
            value={brush.pixelSize()}
            min={2}
            max={128}
            step={1}
            unit=" px"
            onChange={(v) => setPixelSize(v)}
            presets={[
              { label: '4px', value: 4 },
              { label: '8px', value: 8 },
              { label: '16px', value: 16 },
              { label: '32px', value: 32 }
            ]}
          />
        </Show>

        <Show when={activeMode() === 'smudge'}>
          <Slider
            label="Drag Length"
            value={brush.smudgeLength()}
            min={0.05}
            max={1}
            step={0.01}
            onChange={(v) => setSmudgeLength(v)}
            displayValue={(v) => `${Math.round(v * 100)}%`}
            presets={[
              { label: '25%', value: 0.25 },
              { label: '50%', value: 0.5 },
              { label: '75%', value: 0.75 },
              { label: '100%', value: 1.0 }
            ]}
          />
        </Show>

        {/* Brief helper note */}
        <p class="text-[10px] text-zinc-500 leading-normal bg-zinc-950/40 p-2 rounded border border-zinc-800/60">
          {EFFECT_DESCRIPTIONS[activeMode()]}
        </p>
      </div>
    </Show>
  )
}
