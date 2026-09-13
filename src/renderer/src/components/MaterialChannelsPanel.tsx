import { For, Show, type JSX } from 'solid-js'
import { brush } from '../paint/brush'
import { CHANNEL_SPECS, PAINT_CHANNELS, type PaintChannel } from '../paint/channels'
import { PanelSection, Slider, Label } from './ui'
import { SparklesIcon, CircleDotIcon, FeatherIcon, CheckIcon } from './icons'

/** Distinct accent colors per channel for quick recognition. */
const CHANNEL_ACCENT: Record<PaintChannel, string> = {
  baseColor: 'bg-emerald-600/20 border-emerald-500/70 text-emerald-100',
  roughness: 'bg-sky-600/20 border-sky-500/70 text-sky-100',
  metalness: 'bg-amber-600/20 border-amber-500/70 text-amber-100',
  normal: 'bg-violet-600/20 border-violet-500/70 text-violet-100'
}

export interface MaterialChannelsPanelProps {
  /** Mask layers are grayscale coverage — PBR values mean nothing on them. */
  isMaskTarget?: () => boolean
  onToast?: (message: string, kind?: 'info' | 'success' | 'warning') => void
}

/**
 * Multi-channel material brush controls: toggles for which channels each stroke
 * writes, plus per-channel value sliders.
 */
export default function MaterialChannelsPanel(props: MaterialChannelsPanelProps): JSX.Element {
  const disabled = (): boolean => !!props.isMaskTarget?.()

  const enabledCount = (): number => PAINT_CHANNELS.filter((c) => brush.channelEnabled()[c]).length

  const fromMap = (channel: PaintChannel): boolean => brush.setSuppliesChannel(channel)
  const valueLabel = (channel: PaintChannel, base: string): string =>
    fromMap(channel) ? `${base} (map ×)` : base

  return (
    <PanelSection
      title="Material Channels"
      icon={(p) => <SparklesIcon size={p.size} class="text-amber-400" />}
      badge={enabledCount()}
    >
      <Show
        when={!disabled()}
        fallback={
          <p class="text-[11px] text-zinc-500 leading-relaxed">
            The active layer is a mask — it stores grayscale coverage only. Select a paint layer to
            author material channels.
          </p>
        }
      >
        {/* Active Material Set notification if selected from shelf */}
        <Show when={brush.materialSet()}>
          {(set) => (
            <div class="flex items-start gap-2 p-2.5 rounded-md border border-amber-700/50 bg-amber-950/20">
              <SparklesIcon size={14} class="text-amber-400 mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold text-amber-200 truncate">{set().name}</p>
                <p class="text-[10px] text-amber-200/70 leading-relaxed mt-0.5">
                  Texture set active — sampling maps for{' '}
                  {PAINT_CHANNELS.filter((c) => fromMap(c))
                    .map((c) => CHANNEL_SPECS[c].label)
                    .join(', ')}
                  .
                </p>
              </div>
              <button
                type="button"
                class="text-[10px] font-medium text-amber-300 hover:text-amber-100 transition-colors shrink-0 px-2 py-0.5 rounded bg-amber-900/40 hover:bg-amber-900/70 border border-amber-700/50 cursor-pointer"
                onClick={() => brush.setMaterialSet(null)}
              >
                Clear
              </button>
            </div>
          )}
        </Show>

        {/* Channel toggles grid */}
        <div class="space-y-1.5">
          <Label uppercase>Active Channels</Label>
          <div class="grid grid-cols-2 gap-1.5">
            <For each={PAINT_CHANNELS}>
              {(channel) => {
                const active = (): boolean => brush.channelEnabled()[channel]
                return (
                  <button
                    type="button"
                    onClick={() => brush.toggleChannel(channel)}
                    title={`${CHANNEL_SPECS[channel].label}: ${
                      active() ? 'painted by this brush' : 'left untouched'
                    }`}
                    class={`flex items-center justify-between h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                      active()
                        ? CHANNEL_ACCENT[channel]
                        : 'bg-zinc-950/50 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                    }`}
                  >
                    <span>{CHANNEL_SPECS[channel].label}</span>
                    <Show when={active()}>
                      <CheckIcon size={11} class="shrink-0 opacity-90" />
                    </Show>
                  </button>
                )
              }}
            </For>
          </div>
        </div>

        {/* Roughness Slider */}
        <Show when={brush.channelEnabled().roughness}>
          <Slider
            label={valueLabel('roughness', 'Roughness')}
            icon={(p) => <CircleDotIcon size={p.size} class="text-sky-400" />}
            value={brush.roughnessValue()}
            min={0}
            max={1}
            step={0.01}
            displayValue={(v) => v.toFixed(2)}
            onChange={brush.setRoughnessValue}
            presets={[
              { label: 'Mirror', value: 0 },
              { label: 'Gloss', value: 0.2 },
              { label: 'Satin', value: 0.5 },
              { label: 'Matte', value: 1 }
            ]}
          />
        </Show>

        {/* Metalness Slider */}
        <Show when={brush.channelEnabled().metalness}>
          <Slider
            label={valueLabel('metalness', 'Metalness')}
            icon={(p) => <CircleDotIcon size={p.size} class="text-amber-400" />}
            value={brush.metalnessValue()}
            min={0}
            max={1}
            step={0.01}
            displayValue={(v) => v.toFixed(2)}
            onChange={brush.setMetalnessValue}
            presets={[
              { label: 'Dielectric', value: 0 },
              { label: 'Metal', value: 1 }
            ]}
          />
        </Show>

        {/* Relief / Normal Slider */}
        <Show when={brush.channelEnabled().normal}>
          <div class="space-y-1">
            <Slider
              label={valueLabel('normal', 'Relief')}
              icon={(p) => <FeatherIcon size={p.size} class="text-violet-400" />}
              value={brush.normalStrength()}
              min={-4}
              max={4}
              step={0.05}
              displayValue={(v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2))}
              onChange={brush.setNormalStrength}
              presets={[
                { label: 'Carve', value: -1 },
                { label: 'Flat', value: 0 },
                { label: 'Emboss', value: 1 },
                { label: 'Deep', value: 2.5 }
              ]}
            />
            <p class="text-[10px] text-zinc-500 leading-relaxed pl-0.5">
              <Show
                when={fromMap('normal')}
                fallback="Relief is generated from brush falloff/tip alpha. Negative values engrave."
              >
                Relief scaled from active material normal map.
              </Show>
            </p>
          </div>
        </Show>
      </Show>
    </PanelSection>
  )
}
