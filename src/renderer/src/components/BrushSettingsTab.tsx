import { Show, createSignal, createMemo, For } from 'solid-js'
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
import {
  XIcon,
  PaletteIcon,
  SparklesIcon,
  CircleDotIcon,
  SlidersHorizontalIcon,
  SpacingIcon,
  FeatherIcon,
  EyeIcon,
  EyedropperIcon,
  RotateIcon,
  PlusIcon,
  DownloadIcon,
  UploadIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  RefreshCwIcon
} from './icons'
import { PanelSection, Slider, Button, IconButton, ColorPicker } from './ui'
import { toAssetUrl } from '../utils/assetUrl'
import {
  PALETTE_PRESETS,
  loadSavedSwatches,
  saveSavedSwatches,
  parsePaletteText,
  exportPaletteAsHex,
  exportPaletteAsJson
} from '../paint/palettePresets'
import { normalizeHex } from '../utils/colorUtils'

const RADIUS_PRESETS = [
  { label: 'Fine', value: 0.05 },
  { label: 'Sm', value: 0.15 },
  { label: 'Med', value: 0.3 },
  { label: 'Lg', value: 0.6 },
  { label: 'XL', value: 1.2 }
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

  const [showColorPicker, setShowColorPicker] = createSignal(true)
  const [savedSwatches, setSavedSwatches] = createSignal<string[]>(loadSavedSwatches())
  const [activePresetId, setActivePresetId] = createSignal<string>('essentials')

  const selectedPreset = createMemo(() => {
    return PALETTE_PRESETS.find((p) => p.id === activePresetId()) ?? PALETTE_PRESETS[0]
  })

  const handleSaveActiveColor = (hexToAdd?: string) => {
    const col = normalizeHex(hexToAdd ?? brush.color())
    setSavedSwatches((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== col.toLowerCase())
      const next = [col, ...filtered].slice(0, 36)
      saveSavedSwatches(next)
      return next
    })
    props.onToast?.(`Saved ${col.toUpperCase()} to swatches`, 'success')
  }

  const handleRemoveSavedColor = (index: number, e?: MouseEvent) => {
    e?.stopPropagation()
    setSavedSwatches((prev) => {
      const next = prev.filter((_, i) => i !== index)
      saveSavedSwatches(next)
      return next
    })
  }

  const handleImportFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const parsed = parsePaletteText(text)
      if (parsed.length > 0) {
        setSavedSwatches((prev) => {
          const combined = Array.from(new Set([...parsed, ...prev])).slice(0, 48)
          saveSavedSwatches(combined)
          return combined
        })
        props.onToast?.(`Imported ${parsed.length} colors into Saved Swatches`, 'success')
      } else {
        props.onToast?.('No valid colors found in file', 'warning')
      }
    }
    reader.readAsText(file)
    input.value = ''
  }

  const handleResetSavedSwatches = () => {
    localStorage.removeItem('meshcoat:saved_swatches')
    const defaults = loadSavedSwatches()
    setSavedSwatches(defaults)
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
    <div class="flex flex-col text-xs text-zinc-300 select-none divide-y divide-zinc-850">
      {/* 1. Face Selection Constraint Banner */}
      <Show when={brush.selectedFaces().size > 0}>
        <div class="p-3 bg-amber-950/40 border-b border-amber-800/60 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span class="text-amber-300 font-medium text-xs">
              Constrained to {brush.selectedFaces().size} face{brush.selectedFaces().size > 1 ? 's' : ''}
            </span>
          </div>
          <Button variant="ghost" size="xs" onClick={clearFaceSelection} title="Clear face selection constraint (Esc)">
            Clear
          </Button>
        </div>
      </Show>

      {/* 2. Mask Editing Alert Banner */}
      <Show when={props.isMaskTarget?.()}>
        <div class="p-3 bg-blue-950/40 border-b border-blue-800/60 flex flex-col gap-1">
          <div class="flex items-center gap-2 text-xs font-semibold text-blue-300">
            <span class="w-2 h-2 rounded-full bg-blue-400" />
            <span>Editing Layer Mask</span>
          </div>
          <p class="text-[11px] text-zinc-400 leading-tight">
            White reveals the layer, Black hides it. Press <kbd class="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 font-mono text-zinc-300">X</kbd> to swap.
          </p>
        </div>
      </Show>

      {/* 3. Active Brush Profile Card */}
      <div class="p-3.5 flex items-center justify-between gap-3 bg-zinc-900/30">
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="w-12 h-12 rounded-xl checkerboard-bg border border-zinc-750/80 flex items-center justify-center overflow-hidden flex-shrink-0"
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
            <span class="text-xs font-semibold text-zinc-100 truncate">
              {brushPresets.active() ? brushPresets.active()!.name : 'Standard Round Tip'}
            </span>
            <div class="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400 mt-1">
              <span>R: {brush.radius().toFixed(2)}</span>
              <span>·</span>
              <span>{Math.round(brush.opacity() * 100)}% Op</span>
              <span>·</span>
              <span>{Math.round(brush.hardness() * 100)}% H</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          <Show when={brushPresets.active()}>
            <IconButton
              size="xs"
              variant="ghost"
              onClick={() => brushPresets.clear()}
              title="Reset to default round tip"
            >
              <XIcon size={14} />
            </IconButton>
          </Show>
          <Button
            variant="primary"
            size="xs"
            onClick={() => brushPresets.openManager()}
            title="Open Brush Preset Manager"
          >
            <SparklesIcon size={13} class="text-amber-300" />
            <span>Library</span>
          </Button>
        </div>
      </div>

      {/* 4. Color & Palette Section */}
      <PanelSection
        title={props.isMaskTarget?.() ? 'Mask Grayscale' : 'Paint Color'}
        icon={(p) => <PaletteIcon size={p.size} class="text-emerald-400" />}
        actions={
          <span
            class="block w-4 h-4 rounded-full border border-white/25 shadow-xs ring-1 ring-black/30 shrink-0"
            style={{ 'background-color': brush.color() }}
            title={`Active: ${brush.color().toUpperCase()}`}
          />
        }
      >
        {/* Mask Mode Grayscale Buttons */}
        <Show when={props.isMaskTarget?.()}>
          <div class="grid grid-cols-1 gap-1.5">
            {MASK_GRAYS.map((item) => {
              const isActive = () => brush.color().toLowerCase() === item.hex.toLowerCase()
              return (
                <button
                  type="button"
                  onClick={() => brush.setColor(item.hex)}
                  class={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    isActive()
                      ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
                      : 'bg-zinc-950/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border-zinc-800'
                  }`}
                >
                  <span class="w-4 h-4 rounded border border-white/20" style={{ background: item.hex }} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </Show>

        {/* Standard Paint Color & Palettes */}
        <Show when={!props.isMaskTarget?.()}>
          {/* Master Color Bar */}
          <div class="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-zinc-950/60 border border-zinc-800">
            {/* Click to toggle picker */}
            <button
              type="button"
              class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer group text-left px-1"
              onClick={() => setShowColorPicker((v) => !v)}
              title={showColorPicker() ? 'Collapse Color Picker' : 'Expand Color Picker'}
            >
              <span
                class="w-6 h-6 rounded-full border border-white/25 shadow-inner group-hover:scale-105 transition-transform shrink-0"
                style={{ 'background-color': brush.color() }}
              />
              <span class="font-mono text-xs font-semibold text-zinc-200 truncate">
                {brush.color().toUpperCase()}
              </span>
              <span class="text-zinc-500 group-hover:text-zinc-300 ml-auto mr-1">
                {showColorPicker() ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
              </span>
            </button>

            <div class="flex items-center gap-1 shrink-0">
              {/* Eyedropper Button */}
              <IconButton
                size="sm"
                onClick={() => props.onSelectEyedropper?.()}
                title="Eyedropper Tool (I)"
              >
                <EyedropperIcon size={14} />
              </IconButton>

              {/* Save Active Color Button */}
              <Button
                variant="secondary"
                size="xs"
                onClick={() => handleSaveActiveColor()}
                title="Save current color to My Swatches"
                class="h-7 px-2 text-[11px]"
              >
                <PlusIcon size={12} class="text-emerald-400" />
                <span>Save</span>
              </Button>
            </div>
          </div>

          {/* Expandable Color Picker */}
          <Show when={showColorPicker()}>
            <ColorPicker
              color={brush.color()}
              onChange={(hex) => brush.setColor(hex)}
              onSaveColor={handleSaveActiveColor}
              onEyeDropperClick={() => props.onSelectEyedropper?.()}
            />
          </Show>

          {/* Saved Colors ("My Swatches") */}
          <div class="flex flex-col gap-2 pt-1 border-t border-zinc-800/80">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <span>Saved Colors</span>
                <span class="text-[10px] text-zinc-500 font-mono">({savedSwatches().length})</span>
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSaveActiveColor()}
                  title="Add current color to saved swatches"
                  class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30 transition-colors cursor-pointer"
                >
                  <PlusIcon size={11} />
                  <span>Add</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetSavedSwatches}
                  title="Reset saved colors to default"
                  class="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <RefreshCwIcon size={11} />
                </button>
              </div>
            </div>

            {/* Saved Swatches Grid */}
            <div class="grid grid-cols-10 gap-1.5 min-h-6">
              <Show
                when={savedSwatches().length > 0}
                fallback={
                  <div class="col-span-10 py-1.5 text-center text-[11px] text-zinc-500 italic">
                    Click + to save current color
                  </div>
                }
              >
                <For each={savedSwatches()}>
                  {(hex, idx) => {
                    const isActive = () => brush.color().toLowerCase() === hex.toLowerCase()
                    return (
                      <button
                        type="button"
                        class={`group relative w-full aspect-square rounded-full border transition-all cursor-pointer ${
                          isActive()
                            ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-950 border-white scale-110 z-10 shadow-xs'
                            : 'border-white/15 hover:scale-110 hover:border-white/40'
                        }`}
                        style={{ 'background-color': hex }}
                        onClick={() => brush.setColor(hex)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          handleRemoveSavedColor(idx(), e)
                        }}
                        title={`${hex.toUpperCase()} (Right-click to remove)`}
                      >
                        {/* Hover Delete Button */}
                        <span
                          onClick={(e) => handleRemoveSavedColor(idx(), e)}
                          title="Remove color"
                          class="opacity-0 group-hover:opacity-100 absolute -top-1 -right-1 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50 flex items-center justify-center transition-opacity shadow-xs"
                        >
                          <XIcon size={8} />
                        </span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>

          {/* Preset Palettes ("Load Palette") */}
          <div class="flex flex-col gap-2 pt-2 border-t border-zinc-800/80">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Preset Palette
              </span>
              <select
                value={activePresetId()}
                onChange={(e) => setActivePresetId(e.currentTarget.value)}
                class="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded px-2 py-0.5 text-xs text-zinc-200 outline-hidden cursor-pointer"
              >
                <For each={PALETTE_PRESETS}>
                  {(preset) => <option value={preset.id}>{preset.name}</option>}
                </For>
              </select>
            </div>

            {/* Selected Preset Description */}
            <Show when={selectedPreset().description}>
              <p class="text-[10px] text-zinc-500 -mt-1">{selectedPreset().description}</p>
            </Show>

            {/* Preset Swatches Grid */}
            <div class="grid grid-cols-10 gap-1.5">
              <For each={selectedPreset().colors}>
                {(hex) => {
                  const isActive = () => brush.color().toLowerCase() === hex.toLowerCase()
                  return (
                    <button
                      type="button"
                      class={`w-full aspect-square rounded-full border transition-all cursor-pointer ${
                        isActive()
                          ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-950 border-white scale-110 z-10 shadow-xs'
                          : 'border-white/15 hover:scale-110 hover:border-white/40'
                      }`}
                      style={{ 'background-color': hex }}
                      onClick={() => brush.setColor(hex)}
                      title={hex.toUpperCase()}
                    />
                  )
                }}
              </For>
            </div>
          </div>

          {/* Palette Import / Export Actions Bar */}
          <div class="flex items-center justify-between gap-1.5 pt-2 border-t border-zinc-800/80">
            {/* Hidden File Input for Palette Import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".hex,.gpl,.txt,.json"
              class="sr-only"
              onChange={handleImportFile}
            />

            <Button
              variant="secondary"
              size="xs"
              onClick={() => fileInputRef?.click()}
              title="Import palette (.hex, .gpl, .json)"
              class="flex-1 text-[11px] justify-center"
            >
              <UploadIcon size={12} class="text-blue-400" />
              <span>Import</span>
            </Button>

            <Button
              variant="secondary"
              size="xs"
              onClick={() => exportPaletteAsHex(savedSwatches())}
              title="Export saved colors as .hex file"
              class="flex-1 text-[11px] justify-center"
            >
              <DownloadIcon size={12} class="text-zinc-400" />
              <span>Export</span>
            </Button>

            <Button
              variant="secondary"
              size="xs"
              onClick={() => exportPaletteAsJson(savedSwatches())}
              title="Export saved colors as .json file"
              class="flex-1 text-[11px] justify-center"
            >
              <DownloadIcon size={12} class="text-zinc-400" />
              <span>JSON</span>
            </Button>
          </div>
        </Show>
      </PanelSection>

      {/* Stroke Dynamics Section */}
      <PanelSection
        title="Stroke Dynamics"
        icon={(p) => <SlidersHorizontalIcon size={p.size} class="text-blue-400" />}
      >
        {/* Radius / Size */}
        <Slider
          label="Radius / Size"
          value={brush.radius()}
          min={0.01}
          max={2}
          step={0.01}
          onChange={(v) => setRadius(v)}
          displayValue={(v) => v.toFixed(2)}
          presets={RADIUS_PRESETS}
          icon={(p) => <CircleDotIcon size={p.size} />}
        />

        {/* Opacity / Flow */}
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

        {/* Hardness (Falloff) */}
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

        {/* Spacing (Dab Rate) */}
        <Slider
          label="Spacing (Dab Rate)"
          value={brush.spacing()}
          min={0.02}
          max={1}
          step={0.01}
          onChange={(v) => setSpacing(v)}
          displayValue={(v) => `${Math.round(v * 100)}%`}
          presets={SPACING_PRESETS}
          icon={(p) => <SpacingIcon size={p.size} />}
        />

        {/* Rotation Angle */}
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

        {/* Follow Stroke Direction Toggle */}
        <button
          type="button"
          onClick={() => brush.setAngleFollowStroke(!brush.angleFollowStroke())}
          class={`flex items-center justify-between w-full p-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
            brush.angleFollowStroke()
              ? 'bg-blue-600/20 text-blue-300 border-blue-500/50'
              : 'bg-zinc-950/40 text-zinc-400 hover:text-zinc-200 border-zinc-800'
          }`}
          title="Automatically rotates brush tip along stroke path"
        >
          <div class="flex items-center gap-2">
            <RotateIcon size={14} class="text-blue-400" />
            <span>Follow Stroke Direction</span>
          </div>
          <span class={`w-2 h-2 rounded-full ${brush.angleFollowStroke() ? 'bg-blue-400' : 'bg-zinc-600'}`} />
        </button>

        {/* Jitter Controls */}
        <Slider
          label="Angle Jitter"
          value={brush.angleJitter()}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => brush.setAngleJitter(v)}
          displayValue={(v) => `${Math.round(v * 100)}%`}
        />

        <Slider
          label="Size Jitter"
          value={brush.sizeJitter()}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => brush.setSizeJitter(v)}
          displayValue={(v) => `${Math.round(v * 100)}%`}
        />
      </PanelSection>
    </div>
  )
}
