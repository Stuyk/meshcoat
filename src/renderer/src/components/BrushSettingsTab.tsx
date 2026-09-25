import { Show, createSignal, createMemo, For, onMount } from 'solid-js'
import {
  brush,
  setRadius,
  setOpacity,
  setHardness,
  setSpacing,
  clearFaceSelection,
  type ToolMode
} from '../paint/brush'
import { brushPresets } from '../paint/brushPresets'
import { EFFECT_MODES, EFFECT_MODE_LABELS } from '../paint/effectShader'
import {
  XIcon,
  PaletteIcon,
  SparklesIcon,
  CircleDotIcon,
  SlidersHorizontalIcon,
  SpacingIcon,
  FeatherIcon,
  EyeIcon,
  RotateIcon,
  PlusIcon,
  DownloadIcon,
  UploadIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  RefreshCwIcon,
  DropletsIcon,
  TrashIcon
} from './icons'
import {
  PanelSection,
  Slider,
  NumberInput,
  Button,
  IconButton,
  ColorPicker,
  Label,
  Select,
  ToggleSwitch,
  ColorSwatch,
  Kbd,
  TextInput,
  SegmentedControl
} from './ui'
import { toAssetUrl } from '../utils/assetUrl'
import {
  PALETTE_PRESETS,
  loadSavedSwatches,
  parsePaletteText,
  exportPaletteAsHex,
  exportPaletteAsJson
} from '../paint/palettePresets'
import { normalizeHex } from '../utils/colorUtils'
import { colorLibrary } from '../paint/colorLibrary'
import MaterialChannelsPanel from './MaterialChannelsPanel'
import { loadLayoutProfile, saveLayoutProfile } from '../utils/layoutProfile'

const RADIUS_PRESET_FRACTIONS = [
  { label: 'Fine', fraction: 0.025 },
  { label: 'Sm', fraction: 0.075 },
  { label: 'Med', fraction: 0.15 },
  { label: 'Lg', fraction: 0.3 },
  { label: 'XL', fraction: 0.6 }
]

const OPACITY_PRESETS = [
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1.0 }
]

const HARDNESS_PRESETS = [
  { label: 'Soft', value: 0.0 },
  { label: '35%', value: 0.35 },
  { label: '70%', value: 0.7 },
  { label: 'Hard', value: 1.0 }
]

const SPACING_PRESETS = [
  { label: 'Fine', value: 0.08 },
  { label: 'Normal', value: 0.25 },
  { label: 'Broad', value: 0.5 }
]

const MASK_GRAYS = [
  { label: 'White (Reveal)', hex: '#ffffff' },
  { label: '75% Gray', hex: '#bfbfbf' },
  { label: '50% Gray', hex: '#808080' },
  { label: '25% Gray', hex: '#404040' },
  { label: 'Black (Hide)', hex: '#000000' }
]

export interface BrushSettingsTabProps {
  activeTool: ToolMode
  isMaskTarget?: () => boolean
  onToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  onSelectEyedropper?: () => void
}

export default function BrushSettingsTab(props: BrushSettingsTabProps) {
  let fileInputRef: HTMLInputElement | undefined

  const profile = loadLayoutProfile()
  const [showStylus, setShowStylus] = createSignal(false)
  const [paletteMode, setPaletteModeRaw] = createSignal<'swatches' | 'presets'>(profile.paletteMode)
  function setPaletteMode(mode: 'swatches' | 'presets'): void {
    setPaletteModeRaw(mode)
    saveLayoutProfile({ paletteMode: mode })
  }

  const { savedSwatches, setSavedSwatches, customPalettes } = colorLibrary
  const [activePresetId, setActivePresetIdRaw] = createSignal<string>(profile.activePresetId)
  function setActivePresetId(id: string): void {
    setActivePresetIdRaw(id)
    saveLayoutProfile({ activePresetId: id })
  }

  onMount(() => void colorLibrary.hydrateColorLibrary())

  const selectedPreset = createMemo(() => {
    return (
      customPalettes().find((p) => p.id === activePresetId()) ??
      PALETTE_PRESETS.find((p) => p.id === activePresetId()) ??
      PALETTE_PRESETS[0]
    )
  })
  const selectedIsCustom = (): boolean => customPalettes().some((p) => p.id === activePresetId())

  const handleSaveActiveColor = (hexToAdd?: string) => {
    const col = normalizeHex(hexToAdd ?? brush.color())
    setSavedSwatches((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== col.toLowerCase())
      return [col, ...filtered].slice(0, 48)
    })
    props.onToast?.(`Saved ${col.toUpperCase()} to swatches`, 'success')
  }

  const handleRemoveSavedColor = (index: number, e?: MouseEvent) => {
    e?.stopPropagation()
    setSavedSwatches((prev) => prev.filter((_, i) => i !== index))
  }

  const handleClearSavedSwatches = () => {
    setSavedSwatches([])
    props.onToast?.('Cleared all saved swatches', 'info')
  }

  const handleCopyPresetToSwatches = () => {
    const preset = selectedPreset()
    if (!preset || preset.colors.length === 0) {
      return
    }
    setSavedSwatches((prev) => Array.from(new Set([...preset.colors, ...prev])).slice(0, 48))
    props.onToast?.(`Added ${preset.colors.length} colors to Saved Swatches`, 'success')
  }

  const handleSaveAsPalette = (): void => {
    const palette = colorLibrary.saveSwatchesAsPalette()
    if (!palette) {
      props.onToast?.('No saved colors to turn into a palette', 'warning')
      return
    }
    setActivePresetId(palette.id)
    setPaletteMode('presets')
    props.onToast?.(`Saved ${palette.colors.length} colors as "${palette.name}"`, 'success')
  }

  const handleDeletePalette = (): void => {
    const id = activePresetId()
    colorLibrary.deleteCustomPalette(id)
    setActivePresetId('essentials')
  }

  const handleImportFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const parsed = parsePaletteText(text)
      if (parsed.length > 0) {
        if (paletteMode() === 'presets') {
          const fileName = file.name.replace(/\.[^/.]+$/, '') || 'Imported Palette'
          const created = colorLibrary.addCustomPalette(fileName, parsed)
          setActivePresetId(created.id)
          props.onToast?.(`Imported "${created.name}" (${created.colors.length} colors)`, 'success')
        } else {
          setSavedSwatches((prev) => Array.from(new Set([...parsed, ...prev])).slice(0, 48))
          props.onToast?.(`Imported ${parsed.length} colors into Saved Swatches`, 'success')
        }
      } else {
        props.onToast?.('No valid colors found in file', 'warning')
      }
    }
    reader.readAsText(file)
    input.value = ''
  }

  const handleResetSavedSwatches = () => {
    localStorage.removeItem('meshcoat:saved_swatches')
    setSavedSwatches(loadSavedSwatches())
    props.onToast?.('Reset Saved Swatches to default set', 'info')
  }

  const tipGradient = () => {
    const col = brush.color()
    const hard = Math.max(0, Math.min(1, brush.hardness()))
    const innerStop = Math.round(hard * 85)
    return `radial-gradient(circle, ${col} 0%, ${col} ${innerStop}%, transparent 100%)`
  }

  const tipDiameterPx = () => {
    const r = Math.max(0.02, Math.min(2, brush.radius()))
    return Math.round(10 + r * 18)
  }

  return (
    <div class="flex flex-col text-xs text-[var(--text-main)] select-none divide-y divide-[var(--border-color)]">
      <Show when={brush.selectedFaces().size > 0}>
        <div class="p-3 bg-amber-950/40 border-b border-amber-800/60 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span class="text-amber-300 font-medium text-xs">
              Constrained to {brush.selectedFaces().size} face
              {brush.selectedFaces().size > 1 ? 's' : ''}
            </span>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={clearFaceSelection}
            title="Clear face selection constraint (Esc)"
          >
            Clear
          </Button>
        </div>
      </Show>

      <Show when={props.isMaskTarget?.()}>
        <div class="p-3 bg-blue-950/40 border-b border-blue-800/60 flex flex-col gap-1">
          <div class="flex items-center gap-2 text-xs font-semibold text-blue-300">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span>Editing Layer Mask</span>
          </div>
          <p class="text-[11px] text-[var(--text-muted)] leading-tight">
            White reveals the layer, Black hides it. Press <Kbd size="xs">X</Kbd> to swap.
          </p>
        </div>
      </Show>

      <div class="p-3 flex items-center justify-between gap-3 bg-[var(--bg-panel-header)]">
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="w-11 h-11 rounded-[var(--ui-radius)] checkerboard-bg border border-[var(--border-color)] flex items-center justify-center overflow-hidden shrink-0 shadow-inner"
            title="Current brush tip preview"
          >
            <Show
              when={brush.tipTexturePath()}
              fallback={
                <div
                  class="rounded-full"
                  style={{
                    width: `${tipDiameterPx()}px`,
                    height: `${tipDiameterPx()}px`,
                    background: tipGradient(),
                    opacity: brush.opacity()
                  }}
                />
              }
            >
              <img
                src={toAssetUrl(brush.tipTexturePath()!)}
                alt="Brush Tip"
                class="w-full h-full object-contain p-1"
                style={{ opacity: brush.opacity() }}
              />
            </Show>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-semibold text-[var(--text-main)] truncate">
              {brushPresets.active() ? brushPresets.active()!.name : 'Standard Round Tip'}
            </span>
            <div class="flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)] mt-0.5">
              <span>R: {brush.radius().toFixed(2)}</span>
              <span>·</span>
              <span>{Math.round(brush.opacity() * 100)}% Op</span>
              <span>·</span>
              <span>{Math.round(brush.hardness() * 100)}% H</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <Show when={brushPresets.active()}>
            <IconButton
              size="xs"
              variant="ghost"
              onClick={() => brushPresets.clear()}
              tooltip="Reset to default round tip"
            >
              <XIcon size={14} />
            </IconButton>
          </Show>
          <Button
            variant="accent"
            size="xs"
            onClick={() => brushPresets.openManager()}
            title="Open Brush Preset Manager"
          >
            <SparklesIcon size={13} class="text-amber-300" />
            <span>Library</span>
          </Button>
        </div>
      </div>

      <Show
        when={
          props.activeTool !== 'eyedropper' &&
          props.activeTool !== 'faceSelect' &&
          props.activeTool !== 'effect'
        }
      >
        <MaterialChannelsPanel isMaskTarget={props.isMaskTarget} onToast={props.onToast} />
      </Show>

      <PanelSection
        title={props.isMaskTarget?.() ? 'Mask Grayscale' : 'Paint Color'}
        icon={(p) => <PaletteIcon size={p.size} class="text-emerald-400" />}
        actions={
          <span
            class="block w-4 h-4 rounded-[var(--ui-radius)] border border-white/30 shadow-xs shrink-0"
            style={{ 'background-color': brush.color() }}
            title={`Active: ${brush.color().toUpperCase()}`}
          />
        }
      >
        <Show when={props.isMaskTarget?.()}>
          <div class="grid grid-cols-1 gap-1.5">
            {MASK_GRAYS.map((item) => {
              const isActive = () => brush.color().toLowerCase() === item.hex.toLowerCase()
              return (
                <button
                  type="button"
                  title={`${item.label} — ${item.hex.toUpperCase()}: ${
                    item.hex === '#ffffff'
                      ? 'Full layer opacity (100% visible)'
                      : item.hex === '#000000'
                        ? 'Completely transparent (0% hidden)'
                        : 'Partial mask transparency'
                  }`}
                  onClick={() => brush.setColor(item.hex)}
                  class={`flex items-center gap-2.5 px-3 py-1.5 rounded-[var(--ui-radius)] border text-xs font-medium transition-colors cursor-pointer ${
                    isActive()
                      ? 'bg-[var(--accent-color)] text-[var(--accent-text)] border-[var(--accent-color)]'
                      : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-header)] border-[var(--border-color)]'
                  }`}
                >
                  <span
                    class="w-4 h-4 rounded-[2px] border border-white/20"
                    style={{ background: item.hex }}
                  />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </Show>

        <Show when={!props.isMaskTarget?.()}>
          <ColorPicker
            color={brush.color()}
            onChange={(hex) => brush.setColor(hex)}
            onSaveColor={handleSaveActiveColor}
            onEyeDropperClick={() => props.onSelectEyedropper?.()}
          />

          {/* Swatches & Preset Palettes Sub-section */}
          <div class="flex flex-col gap-2.5 pt-2.5 border-t border-[var(--border-color)]">
            {/* View Switcher */}
            <SegmentedControl
              size="xs"
              options={[
                { value: 'swatches', label: `Saved (${savedSwatches().length})` },
                { value: 'presets', label: 'Preset Palettes' }
              ]}
              value={paletteMode()}
              onChange={(val) => setPaletteMode(val as 'swatches' | 'presets')}
            />

            {/* TAB 1: Saved Swatches */}
            <Show when={paletteMode() === 'swatches'}>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-medium text-[var(--text-muted)]">
                    Quick Swatches
                  </span>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleSaveActiveColor()}
                      title="Add active brush color to saved swatches"
                      class="flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 border border-emerald-900/50 transition-colors cursor-pointer"
                    >
                      <PlusIcon size={11} />
                      <span>Add</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAsPalette}
                      title="Save current swatches as a new preset palette"
                      class="p-1 rounded-[var(--ui-radius)] text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-950/30 transition-colors cursor-pointer"
                    >
                      <PaletteIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef?.click()}
                      title="Import palette (.hex, .gpl, .json)"
                      class="p-1 rounded-[var(--ui-radius)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-header)] transition-colors cursor-pointer"
                    >
                      <UploadIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        if (e.shiftKey) {
                          exportPaletteAsJson(savedSwatches(), 'Saved Swatches', 'saved-swatches.json')
                        } else {
                          exportPaletteAsHex(savedSwatches(), 'saved-swatches.hex')
                        }
                      }}
                      title="Export swatches as .hex (Shift+Click for .json)"
                      class="p-1 rounded-[var(--ui-radius)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-header)] transition-colors cursor-pointer"
                    >
                      <DownloadIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={handleResetSavedSwatches}
                      title="Reset swatches to default colors"
                      class="p-1 rounded-[var(--ui-radius)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-header)] transition-colors cursor-pointer"
                    >
                      <RefreshCwIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSavedSwatches}
                      title="Clear all saved swatches"
                      class="p-1 rounded-[var(--ui-radius)] text-[var(--text-muted)] hover:text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer"
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-8 gap-1.5 min-h-[56px] p-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
                  <Show
                    when={savedSwatches().length > 0}
                    fallback={
                      <div class="col-span-8 py-3 flex flex-col items-center justify-center gap-1 text-center text-xs text-[var(--text-muted)] italic">
                        <span>No saved colors yet</span>
                        <span class="text-[10px] text-zinc-500">Click Add or the + in the color bar</span>
                      </div>
                    }
                  >
                    <For each={savedSwatches()}>
                      {(hex, idx) => {
                        const isActive = () => brush.color().toLowerCase() === hex.toLowerCase()
                        return (
                          <ColorSwatch
                            color={hex}
                            active={isActive()}
                            onClick={() => brush.setColor(hex)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              handleRemoveSavedColor(idx(), e)
                            }}
                            onRemove={(e) => handleRemoveSavedColor(idx(), e)}
                            title={`${hex.toUpperCase()} (Click to select, right-click to delete)`}
                          />
                        )
                      }}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>

            {/* TAB 2: Preset Palettes */}
            <Show when={paletteMode() === 'presets'}>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between gap-1.5">
                  <Select
                    size="xs"
                    value={activePresetId()}
                    onChange={(val) => setActivePresetId(val)}
                    class="flex-1 min-w-0"
                  >
                    <optgroup label="Curated Palettes">
                      <For each={PALETTE_PRESETS}>
                        {(preset) => (
                          <option value={preset.id}>
                            {preset.name} ({preset.colors.length})
                          </option>
                        )}
                      </For>
                    </optgroup>
                    <Show when={customPalettes().length > 0}>
                      <optgroup label="My Custom Palettes">
                        <For each={customPalettes()}>
                          {(preset) => (
                            <option value={preset.id}>
                              {preset.name} ({preset.colors.length})
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                  </Select>

                  <div class="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={handleCopyPresetToSwatches}
                      title="Load all colors from this palette into your Saved Swatches"
                      class="flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] text-[11px] font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-950/40 border border-blue-900/50 transition-colors cursor-pointer"
                    >
                      <PlusIcon size={11} />
                      <span>To Swatches</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef?.click()}
                      title="Import palette file as new custom palette"
                      class="p-1 rounded-[var(--ui-radius)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-header)] transition-colors cursor-pointer"
                    >
                      <UploadIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        const p = selectedPreset()
                        const filename = p.name.toLowerCase().replace(/\s+/g, '-')
                        if (e.shiftKey) {
                          exportPaletteAsJson(p.colors, p.name, `${filename}.json`)
                        } else {
                          exportPaletteAsHex(p.colors, `${filename}.hex`)
                        }
                      }}
                      title="Export palette as .hex (Shift+Click for .json)"
                      class="p-1 rounded-[var(--ui-radius)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-header)] transition-colors cursor-pointer"
                    >
                      <DownloadIcon size={12} />
                    </button>
                  </div>
                </div>

                <Show when={selectedIsCustom()}>
                  <div class="flex items-center gap-1.5">
                    <TextInput
                      size="xs"
                      class="flex-1"
                      value={selectedPreset().name}
                      onChange={(name) => colorLibrary.renameCustomPalette(activePresetId(), name)}
                      placeholder="Palette name"
                    />
                    <IconButton size="xs" onClick={handleDeletePalette} tooltip="Delete this custom palette">
                      <TrashIcon size={13} />
                    </IconButton>
                  </div>
                </Show>

                <Show when={selectedPreset().description}>
                  <p class="text-[11px] text-[var(--text-muted)] leading-tight">
                    {selectedPreset().description}
                  </p>
                </Show>

                <div class="grid grid-cols-8 gap-1.5 min-h-[56px] p-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
                  <For each={selectedPreset().colors}>
                    {(hex) => {
                      const isActive = () => brush.color().toLowerCase() === hex.toLowerCase()
                      return (
                        <ColorSwatch
                          color={hex}
                          active={isActive()}
                          onClick={() => brush.setColor(hex)}
                          title={`${hex.toUpperCase()} (Click to select)`}
                        />
                      )
                    }}
                  </For>
                </div>
              </div>
            </Show>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".hex,.gpl,.txt,.json"
              class="sr-only"
              onChange={handleImportFile}
            />
          </div>
        </Show>
      </PanelSection>

      <Show when={props.activeTool === 'effect'}>
        <PanelSection
          title="Effects Brush"
          icon={(p) => <DropletsIcon size={p.size} class="text-teal-400" />}
        >
          <div class="space-y-1.5">
            <Label uppercase>Mode</Label>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={EFFECT_MODES}>
                {(mode) => (
                  <button
                    type="button"
                    title={
                      mode === 'blur'
                        ? 'Blur: Smooth and soften paint transitions under the stroke'
                        : mode === 'sharpen'
                          ? 'Sharpen: Boost contrast and crisp edge details'
                          : mode === 'smudge'
                            ? 'Smudge: Drag and blend existing paint in the stroke direction'
                            : 'Pixelate: Quantize texels into chunky retro pixels'
                    }
                    onClick={() => brush.setEffectMode(mode)}
                    class={`h-7 rounded-[var(--ui-radius)] border text-xs font-medium transition-colors cursor-pointer ${
                      brush.effectMode() === mode
                        ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--accent-text)]'
                        : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-white/20'
                    }`}
                  >
                    {EFFECT_MODE_LABELS[mode]}
                  </button>
                )}
              </For>
            </div>
          </div>

          <Slider
            label="Effect Strength"
            value={brush.effectStrength()}
            min={0.01}
            max={1}
            step={0.01}
            onChange={(v) => brush.setEffectStrength(v)}
            displayValue={(v) => `${Math.round(v * 100)}%`}
            icon={(p) => <FeatherIcon size={p.size} />}
          />

          <Show when={brush.effectMode() === 'blur' || brush.effectMode() === 'sharpen'}>
            <Slider
              label="Kernel Radius"
              value={brush.effectRadius()}
              min={1}
              max={32}
              step={1}
              unit=" px"
              onChange={(v) => brush.setEffectRadius(v)}
            />
          </Show>

          <Show when={brush.effectMode() === 'pixelate'}>
            <Slider
              label="Block Size"
              value={brush.pixelSize()}
              min={2}
              max={256}
              step={1}
              unit=" px"
              onChange={(v) => brush.setPixelSize(v)}
            />
          </Show>

          <Show when={brush.effectMode() === 'smudge'}>
            <Slider
              label="Drag Length"
              value={brush.smudgeLength()}
              min={0.05}
              max={1}
              step={0.01}
              onChange={(v) => brush.setSmudgeLength(v)}
              displayValue={(v) => `${Math.round(v * 100)}%`}
            />
          </Show>

          <p class="text-[11px] text-[var(--text-muted)] leading-normal">
            Reworks paint already on the active layer — it never adds color, so the color and
            texture settings don't apply. Radius, hardness, opacity and pressure work as usual.
          </p>
        </PanelSection>
      </Show>

      <PanelSection
        title={props.activeTool === 'fill' ? 'Fill Settings' : 'Stroke Dynamics'}
        icon={(p) => <SlidersHorizontalIcon size={p.size} class="text-blue-400" />}
      >
        <div class="flex flex-col gap-4">
          <Show when={props.activeTool !== 'fill'}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <Label uppercase>Radius / Size</Label>
                <div class="w-28">
                  <NumberInput
                    value={brush.radius()}
                    min={brush.radiusRange().min}
                    max={brush.radiusRange().max}
                    step={0.01}
                    precision={2}
                    unit="m"
                    onChange={(v) => setRadius(v)}
                  />
                </div>
              </div>
              <Slider
                value={brush.radius()}
                min={brush.radiusRange().min}
                max={brush.radiusRange().max}
                step={brush.radiusRange().max / 200}
                onChange={(v) => setRadius(v)}
                displayValue={(v) => (v < 0.1 ? v.toFixed(3) : v.toFixed(2))}
                presets={RADIUS_PRESET_FRACTIONS.map((p) => ({
                  label: p.label,
                  value: brush.sceneScale() * p.fraction
                }))}
                icon={(p) => <CircleDotIcon size={p.size} />}
              />
            </div>
          </Show>

          <Slider
            label="Opacity / Flow"
            value={brush.opacity()}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setOpacity(v)}
            displayValue={(v) => `${Math.round(v * 100)}%`}
            presets={OPACITY_PRESETS}
            icon={(p) => <EyeIcon size={p.size} />}
          />

          <Show when={props.activeTool !== 'fill'}>
            <Slider
              label="Hardness (Falloff)"
              value={brush.hardness()}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setHardness(v)}
              displayValue={(v) => `${Math.round(v * 100)}%`}
              presets={HARDNESS_PRESETS}
              icon={(p) => <FeatherIcon size={p.size} />}
            />

            <button
              type="button"
              onClick={() => setShowStylus((v) => !v)}
              class="flex items-center justify-between w-full pt-2 border-t border-[var(--border-color)]/60 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              title="Stylus pressure, projector depth and max angle"
            >
              <Label uppercase>Stylus &amp; Projection</Label>
              {showStylus() ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
            </button>
            <Show when={showStylus()}>
              <div class="flex flex-col gap-2">
                <Label uppercase>Stylus Pressure</Label>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => brush.setPressureRadius(!brush.pressureRadius())}
                    title="Stylus pressure controls brush radius (tapered strokes)"
                    class={`flex-1 h-7 rounded-[var(--ui-radius)] border text-xs font-medium transition-colors cursor-pointer ${
                      brush.pressureRadius()
                        ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--accent-text)]'
                        : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-white/20'
                    }`}
                  >
                    → Size
                  </button>
                  <button
                    type="button"
                    onClick={() => brush.setPressureOpacity(!brush.pressureOpacity())}
                    title="Stylus pressure controls brush opacity (feathering and blending)"
                    class={`flex-1 h-7 rounded-[var(--ui-radius)] border text-xs font-medium transition-colors cursor-pointer ${
                      brush.pressureOpacity()
                        ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--accent-text)]'
                        : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-white/20'
                    }`}
                  >
                    → Opacity
                  </button>
                </div>
                <Slider
                  label="Min Pressure Floor"
                  value={brush.pressureMin()}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => brush.setPressureMin(v)}
                  displayValue={(v) => `${Math.round(v * 100)}%`}
                  icon={(p) => <FeatherIcon size={p.size} />}
                />
              </div>

              <div class="flex flex-col gap-3.5 pt-2 border-t border-[var(--border-color)]/60">
                <Slider
                  label="Depth (Bleed Through)"
                  value={brush.projectorDepth()}
                  min={0.02}
                  max={2}
                  step={0.01}
                  onChange={(v) => brush.setProjectorDepth(v)}
                  displayValue={(v) => `${Math.round(v * 100)}%`}
                  presets={[
                    { label: 'Thin', value: 0.15 },
                    { label: 'Default', value: 0.35 },
                    { label: 'Wrap', value: 1 }
                  ]}
                  icon={(p) => <FeatherIcon size={p.size} />}
                />

                <Slider
                  label="Max Angle"
                  value={brush.maxAngle()}
                  min={5}
                  max={180}
                  step={1}
                  unit="°"
                  onChange={(v) => brush.setMaxAngle(v)}
                  presets={[
                    { label: '60°', value: 60 },
                    { label: '85°', value: 85 },
                    { label: '120°', value: 120 }
                  ]}
                  icon={(p) => <RotateIcon size={p.size} />}
                />
              </div>
            </Show>

            <div class="flex flex-col gap-2 pt-2 border-t border-[var(--border-color)]/60">
              <div class="flex items-center justify-between">
                <Label uppercase>Spacing (Dab Rate)</Label>
                <div class="w-24">
                  <NumberInput
                    value={brush.spacing()}
                    min={0.02}
                    max={1}
                    step={0.01}
                    precision={2}
                    onChange={(v) => setSpacing(v)}
                  />
                </div>
              </div>
              <Slider
                value={brush.spacing()}
                min={0.02}
                max={1}
                step={0.01}
                onChange={(v) => setSpacing(v)}
                displayValue={(v) => `${Math.round(v * 100)}%`}
                presets={SPACING_PRESETS}
                icon={(p) => <SpacingIcon size={p.size} />}
              />
            </div>

            <div class="flex flex-col gap-3 pt-2 border-t border-[var(--border-color)]/60">
              <Slider
                label="Rotation Angle"
                value={brush.brushRotation()}
                min={0}
                max={360}
                step={1}
                unit="°"
                onChange={(v) => brush.setBrushRotation(v)}
                presets={[
                  { label: '0°', value: 0 },
                  { label: '45°', value: 45 },
                  { label: '90°', value: 90 },
                  { label: '180°', value: 180 }
                ]}
                icon={(p) => <RotateIcon size={p.size} />}
              />

              <ToggleSwitch
                checked={brush.angleFollowStroke()}
                onChange={(val) => brush.setAngleFollowStroke(val)}
                label="Follow Stroke Direction"
                icon={(p) => <RotateIcon size={p.size} />}
                title="Automatically rotates brush tip along stroke path"
              />
            </div>

            <div class="flex flex-col gap-3 pt-2 border-t border-[var(--border-color)]/60">
              <div class="flex items-center justify-between">
                <Label uppercase>Randomness</Label>
                <button
                  type="button"
                  onClick={() => brush.setChaos(!brush.chaosActive())}
                  title={
                    brush.chaosActive()
                      ? 'Turn every jitter off'
                      : 'Chaos: new rotation, size and slight color drift on every stroke'
                  }
                  class={`flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] border text-[11px] font-medium cursor-pointer transition-colors ${
                    brush.chaosActive()
                      ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--accent-text)]'
                      : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <SparklesIcon size={12} />
                  <span>{brush.chaosActive() ? 'Reset' : 'Chaos'}</span>
                </button>
              </div>

              <SegmentedControl
                size="xs"
                options={[
                  { value: 'dab', label: 'Every dab', title: 'Re-roll the variation on every dab' },
                  {
                    value: 'stroke',
                    label: 'Every stroke',
                    title: 'Re-roll once per stroke — each click gets its own variation'
                  }
                ]}
                value={brush.jitterScope()}
                onChange={(v) => brush.setJitterScope(v)}
                class="w-full justify-between"
              />

              <Slider
                label="Angle Jitter"
                title="Randomly varies the brush tip rotation"
                value={brush.angleJitter()}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => brush.setAngleJitter(v)}
                displayValue={(v) => `${Math.round(v * 100)}%`}
              />

              <Slider
                label="Size Jitter"
                title="Randomly varies the brush radius"
                value={brush.sizeJitter()}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => brush.setSizeJitter(v)}
                displayValue={(v) => `${Math.round(v * 100)}%`}
              />

              <Slider
                label="Hue Jitter"
                title="Randomly shifts the paint hue, up to ±60°"
                value={brush.hueJitter()}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => brush.setHueJitter(v)}
                displayValue={(v) => `±${Math.round(v * 60)}°`}
              />

              <Slider
                label="Saturation Jitter"
                title="Randomly raises or lowers saturation"
                value={brush.saturationJitter()}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => brush.setSaturationJitter(v)}
                displayValue={(v) => `±${Math.round(v * 50)}%`}
              />

              <Slider
                label="Lightness Jitter"
                title="Randomly lightens or darkens the paint"
                value={brush.valueJitter()}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => brush.setValueJitter(v)}
                displayValue={(v) => `±${Math.round(v * 35)}%`}
              />
            </div>
          </Show>
        </div>
      </PanelSection>
    </div>
  )
}
