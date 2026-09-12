import { createSignal, createEffect, onMount, onCleanup, Show, For } from 'solid-js'
import * as THREE from 'three'
import {
  XIcon,
  SparklesIcon,
  CheckIcon,
  PaletteIcon,
  ImagesIcon,
  FolderOpenIcon,
  RefreshCwIcon,
  SlidersIcon
} from './icons'
import { Button, IconButton, Slider, SegmentedControl } from './ui'
import type { EdgeWearParams } from '../paint/paintEngine'

export interface EdgeWearWizardProps {
  isOpen: boolean
  initialColor?: string
  textures: string[]
  onClose: () => void
  onPreview: (params: EdgeWearParams) => void
  onCancel: () => void
  onCommit: (params: EdgeWearParams, asNewLayer: boolean) => void
}

interface Preset {
  name: string
  desc: string
  threshold: number
  wearWidth: number
  noiseScale: number
  roughness: number
  amount: number
  contrast: number
  color: string
  opacity: number
}

const PRESETS: Preset[] = [
  {
    name: 'Subtle Highlight',
    desc: 'Soft rim light on sharp edges',
    threshold: 35,
    wearWidth: 0.03,
    noiseScale: 15,
    roughness: 0.3,
    amount: 0.6,
    contrast: 0.3,
    color: '#f3f4f6',
    opacity: 0.85
  },
  {
    name: 'Chipped Paint',
    desc: 'Peeling edges & exposed undercoat',
    threshold: 25,
    wearWidth: 0.06,
    noiseScale: 28,
    roughness: 0.7,
    amount: 0.75,
    contrast: 0.7,
    color: '#9ca3af',
    opacity: 1.0
  },
  {
    name: 'Heavy Weathered',
    desc: 'Heavy corrosion & battered metal',
    threshold: 18,
    wearWidth: 0.12,
    noiseScale: 35,
    roughness: 0.85,
    amount: 0.85,
    contrast: 0.6,
    color: '#4b5563',
    opacity: 1.0
  },
  {
    name: 'Fine Ink Contour',
    desc: 'Crisp graphic cel outline',
    threshold: 30,
    wearWidth: 0.015,
    noiseScale: 50,
    roughness: 0.2,
    amount: 0.9,
    contrast: 0.95,
    color: '#111827',
    opacity: 0.95
  }
]

const METAL_COLORS = [
  { name: 'Chrome', hex: '#f3f4f6' },
  { name: 'Aluminum', hex: '#d1d5db' },
  { name: 'Steel', hex: '#9ca3af' },
  { name: 'Dark Iron', hex: '#4b5563' },
  { name: 'Gold', hex: '#f59e0b' },
  { name: 'Copper', hex: '#ea580c' }
]

const WEATHER_COLORS = [
  { name: 'Rust Red', hex: '#b91c1c' },
  { name: 'Deep Rust', hex: '#78350f' },
  { name: 'Verdigris', hex: '#14b8a6' },
  { name: 'Patina Green', hex: '#059669' },
  { name: 'Dirt Brown', hex: '#451a03' },
  { name: 'Dark Soot', hex: '#1c1917' }
]

export default function EdgeWearWizard(props: EdgeWearWizardProps) {
  const [activeTab, setActiveTab] = createSignal<'material' | 'tuning'>('material')

  const [threshold, setThreshold] = createSignal(25)
  const [wearWidth, setWearWidth] = createSignal(0.06)
  const [noiseScale, setNoiseScale] = createSignal(28)
  const [roughness, setRoughness] = createSignal(0.7)
  const [amount, setAmount] = createSignal(0.75)
  const [contrast, setContrast] = createSignal(0.7)
  const [seed, setSeed] = createSignal(1)
  const [color, setColor] = createSignal(props.initialColor ?? '#f3f4f6')
  const [opacity, setOpacity] = createSignal(1.0)
  const [asNewLayer, setAsNewLayer] = createSignal(true)
  const [livePreview, setLivePreview] = createSignal(true)
  const [activePreset, setActivePreset] = createSignal<string>('Chipped Paint')

  const [materialMode, setMaterialMode] = createSignal<'color' | 'texture'>('color')
  const [selectedTexturePath, setSelectedTexturePath] = createSignal<string | null>(null)
  const [textureScale, setTextureScale] = createSignal(1.0)
  const [textureMapping, setTextureMapping] = createSignal<'uv' | 'triplanar'>('triplanar')
  const [customTextures, setCustomTextures] = createSignal<string[]>([])

  let colorPickerRef: HTMLInputElement | undefined
  let loadedTexture: THREE.Texture | null = null
  const textureLoader = new THREE.TextureLoader()

  const allTextures = () => [...customTextures(), ...props.textures]

  function getParams(): EdgeWearParams {
    return {
      thresholdAngle: threshold(),
      wearWidth: wearWidth(),
      noiseScale: noiseScale(),
      roughness: roughness(),
      amount: amount(),
      contrast: contrast(),
      seed: seed(),
      color: color(),
      opacity: opacity(),
      texture: materialMode() === 'texture' ? loadedTexture : null,
      textureScale: textureScale(),
      textureMapping: textureMapping()
    }
  }

  function triggerPreview(): void {
    if (!props.isOpen) return
    if (livePreview()) {
      props.onPreview(getParams())
    } else {
      props.onCancel()
    }
  }

  createEffect(() => {
    const path = selectedTexturePath()
    if (!path || materialMode() !== 'texture') {
      loadedTexture = null
      if (props.isOpen) triggerPreview()
      return
    }

    const url = window.api.assetUrl(path)
    textureLoader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.needsUpdate = true
      loadedTexture = tex
      if (props.isOpen) triggerPreview()
    })
  })

  createEffect(() => {
    if (props.isOpen) {
      triggerPreview()
    }
  })

  function handleSliderChange(): void {
    setActivePreset('')
    triggerPreview()
  }

  function applyPreset(p: Preset): void {
    setActivePreset(p.name)
    setThreshold(p.threshold)
    setWearWidth(p.wearWidth)
    setNoiseScale(p.noiseScale)
    setRoughness(p.roughness)
    setAmount(p.amount)
    setContrast(p.contrast)
    setColor(p.color)
    setOpacity(p.opacity)
    triggerPreview()
  }

  function toggleLivePreview(enabled: boolean): void {
    setLivePreview(enabled)
    if (enabled) {
      props.onPreview(getParams())
    } else {
      props.onCancel()
    }
  }

  function handleClose(): void {
    props.onCancel()
    props.onClose()
  }

  function handleCommit(): void {
    props.onCommit(getParams(), asNewLayer())
    props.onClose()
  }

  function rerollSeed(): void {
    setSeed((s) => s + 1)
    triggerPreview()
  }

  async function browseForTexture(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    })
    const path = paths?.[0]
    if (path) {
      setCustomTextures((prev) => (prev.includes(path) ? prev : [path, ...prev]))
      setSelectedTexturePath(path)
      setMaterialMode('texture')
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!props.isOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleCommit()
    }
  }

  onMount(() => window.addEventListener('keydown', onKeyDown))
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  return (
    <div class="flex flex-col h-full bg-zinc-900/90 text-xs text-zinc-300 select-none">
      {/* Top Banner Header */}
      <div class="h-11 px-3.5 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/60 flex-shrink-0">
        <div class="flex items-center gap-2.5">
          <div class="p-1 rounded-lg bg-amber-500/20 text-amber-400">
            <SparklesIcon size={16} />
          </div>
          <div class="flex flex-col">
            <span class="text-xs font-semibold text-zinc-100">Edge Wear Wizard</span>
            <span class="text-[10px] text-zinc-500">Procedural Ridge & Chipping</span>
          </div>
        </div>
        <IconButton size="xs" variant="ghost" onClick={handleClose} title="Cancel (Esc)">
          <XIcon size={14} />
        </IconButton>
      </div>

      {/* Wizard Navigation Tabs */}
      <div class="flex items-center border-b border-zinc-800 bg-zinc-950/40 p-1 gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('material')}
          class={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab() === 'material'
              ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
          }`}
        >
          <PaletteIcon size={13} />
          <span>Material</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tuning')}
          class={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab() === 'tuning'
              ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
          }`}
        >
          <SlidersIcon size={13} />
          <span>Ridge & Noise</span>
        </button>
      </div>

      {/* Wizard Scrollable Body */}
      <div class="flex-1 overflow-y-auto p-3 space-y-4">
        {/* ============================================================ */}
        {/* TAB 1: WEAR MATERIAL & STYLE                                 */}
        {/* ============================================================ */}
        <Show when={activeTab() === 'material'}>
          {/* Active Material Hero Card */}
          <div class="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl checkerboard-bg border border-zinc-750 flex items-center justify-center overflow-hidden flex-shrink-0">
              <Show
                when={materialMode() === 'texture' && selectedTexturePath()}
                fallback={
                  <div
                    class="w-full h-full"
                    style={{
                      background: color(),
                      opacity: opacity()
                    }}
                  />
                }
              >
                <img
                  src={window.api.assetUrl(selectedTexturePath()!)}
                  alt="Wear pattern"
                  class="w-full h-full object-cover"
                  style={{ opacity: opacity() }}
                />
              </Show>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-1 mb-1">
                <span class="text-[10px] font-mono uppercase text-zinc-500">
                  {materialMode() === 'color' ? 'Solid Color' : 'Texture Pattern'}
                </span>
                <span class="font-mono text-[10px] text-zinc-400 tabular-nums">
                  {Math.round(opacity() * 100)}%
                </span>
              </div>
              <span class="text-xs font-semibold text-zinc-200 truncate block mb-1.5">
                {materialMode() === 'color'
                  ? color().toUpperCase()
                  : (selectedTexturePath()?.split('/').pop() ?? 'No Texture Selected')}
              </span>
              <SegmentedControl
                size="xs"
                options={[
                  { value: 'color', label: 'Solid Color', icon: (p) => <PaletteIcon size={p.size} /> },
                  { value: 'texture', label: 'Texture', icon: (p) => <ImagesIcon size={p.size} /> }
                ]}
                value={materialMode()}
                onChange={(m) => {
                  setMaterialMode(m)
                  if (m === 'texture' && !selectedTexturePath() && allTextures().length > 0) {
                    setSelectedTexturePath(allTextures()[0])
                  }
                  triggerPreview()
                }}
                class="w-full"
              />
            </div>
          </div>

          {/* Solid Color Mode Controls */}
          <Show when={materialMode() === 'color'}>
            <div class="space-y-3">
              <div class="space-y-1.5">
                <span class="text-[11px] font-semibold text-zinc-400">Metallic Presets</span>
                <div class="grid grid-cols-3 gap-1.5">
                  <For each={METAL_COLORS}>
                    {(item) => {
                      const isActive = () => color().toLowerCase() === item.hex.toLowerCase()
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setColor(item.hex)
                            setActivePreset('')
                            triggerPreview()
                          }}
                          class={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                            isActive()
                              ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
                              : 'bg-zinc-950/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border-zinc-800'
                          }`}
                        >
                          <span class="w-3.5 h-3.5 rounded-full border border-white/20 flex-shrink-0" style={{ background: item.hex }} />
                          <span class="text-[11px] font-medium truncate">{item.name}</span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>

              <div class="space-y-1.5">
                <span class="text-[11px] font-semibold text-zinc-400">Corrosion & Weathering</span>
                <div class="grid grid-cols-3 gap-1.5">
                  <For each={WEATHER_COLORS}>
                    {(item) => {
                      const isActive = () => color().toLowerCase() === item.hex.toLowerCase()
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setColor(item.hex)
                            setActivePreset('')
                            triggerPreview()
                          }}
                          class={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                            isActive()
                              ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
                              : 'bg-zinc-950/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border-zinc-800'
                          }`}
                        >
                          <span class="w-3.5 h-3.5 rounded-full border border-white/20 flex-shrink-0" style={{ background: item.hex }} />
                          <span class="text-[11px] font-medium truncate">{item.name}</span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>

              {/* Custom Color & Opacity Row */}
              <div class="flex items-center gap-2 p-2 bg-zinc-950/40 border border-zinc-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => colorPickerRef?.click()}
                  class="flex items-center gap-2 flex-1 cursor-pointer"
                >
                  <span class="w-5 h-5 rounded-md border border-white/20" style={{ background: color() }} />
                  <span class="font-mono text-xs text-zinc-200">{color().toUpperCase()}</span>
                </button>
                <input
                  ref={colorPickerRef}
                  type="color"
                  class="sr-only"
                  value={color()}
                  onInput={(e) => {
                    setColor(e.currentTarget.value)
                    setActivePreset('')
                    triggerPreview()
                  }}
                />
              </div>

              <Slider
                label="Wear Opacity"
                value={opacity()}
                min={0.05}
                max={1.0}
                step={0.05}
                onChange={(v) => {
                  setOpacity(v)
                  handleSliderChange()
                }}
                displayValue={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
          </Show>

          {/* Texture Pattern Mode Controls */}
          <Show when={materialMode() === 'texture'}>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold text-zinc-400">Available Textures</span>
                <Button variant="ghost" size="xs" onClick={browseForTexture}>
                  <FolderOpenIcon size={12} />
                  <span>Browse...</span>
                </Button>
              </div>

              <Show
                when={allTextures().length > 0}
                fallback={
                  <div
                    onClick={browseForTexture}
                    class="p-4 border border-dashed border-zinc-800 hover:border-zinc-700 rounded-xl text-center bg-zinc-950/40 cursor-pointer"
                  >
                    <FolderOpenIcon size={20} class="mx-auto text-blue-400 mb-1" />
                    <span class="text-xs font-medium text-zinc-300 block">No Textures Loaded</span>
                    <span class="text-[10px] text-zinc-500 block">Click to import image files</span>
                  </div>
                }
              >
                <div class="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto p-1 border border-zinc-800 rounded-xl bg-zinc-950/30">
                  <For each={allTextures()}>
                    {(path) => {
                      const isSelected = () => selectedTexturePath() === path
                      const filename = path.split('/').pop() ?? path
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTexturePath(path)
                            triggerPreview()
                          }}
                          class={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                            isSelected()
                              ? 'bg-blue-600/20 border-blue-500/70 shadow-xs'
                              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          <div class="w-8 h-8 rounded checkerboard-bg overflow-hidden flex-shrink-0">
                            <img src={window.api.assetUrl(path)} alt="" class="w-full h-full object-cover" />
                          </div>
                          <span class="text-[11px] font-medium text-zinc-300 truncate" title={filename}>
                            {filename}
                          </span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </Show>

              {/* Texture Projection & Tiling */}
              <div class="space-y-2 p-3 bg-zinc-950/40 border border-zinc-800 rounded-xl">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-medium text-zinc-400">Projection</span>
                  <SegmentedControl
                    size="xs"
                    options={[
                      { value: 'triplanar', label: 'Triplanar' },
                      { value: 'uv', label: 'UV' }
                    ]}
                    value={textureMapping()}
                    onChange={(m) => {
                      setTextureMapping(m as any)
                      triggerPreview()
                    }}
                  />
                </div>

                <Slider
                  label="Pattern Scale"
                  value={textureScale()}
                  min={0.0}
                  max={16.0}
                  step={0.1}
                  onChange={(v) => {
                    setTextureScale(v)
                    triggerPreview()
                  }}
                  displayValue={(v) => `${v.toFixed(1)}×`}
                  presets={[
                    { label: '0×', value: 0 },
                    { label: '1×', value: 1 },
                    { label: '2×', value: 2 },
                    { label: '4×', value: 4 },
                    { label: '8×', value: 8 },
                    { label: '16×', value: 16 }
                  ]}
                />

                <Slider
                  label="Texture Opacity"
                  value={opacity()}
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  onChange={(v) => {
                    setOpacity(v)
                    triggerPreview()
                  }}
                  displayValue={(v) => `${Math.round(v * 100)}%`}
                />
              </div>
            </div>
          </Show>

          {/* Style Presets */}
          <div class="space-y-1.5 pt-2">
            <span class="text-[11px] font-semibold text-zinc-400">Style Presets</span>
            <div class="grid grid-cols-2 gap-2">
              <For each={PRESETS}>
                {(preset) => {
                  const isSelected = () => activePreset() === preset.name
                  return (
                    <button
                      type="button"
                      onClick={() => applyPreset(preset)}
                      class={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected()
                          ? 'bg-blue-600/15 border-blue-500/70 shadow-xs'
                          : 'bg-zinc-950/50 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50'
                      }`}
                    >
                      <span class="text-xs font-semibold text-zinc-200 block truncate">
                        {preset.name}
                      </span>
                      <span class="text-[10px] text-zinc-500 block truncate mt-0.5">
                        {preset.desc}
                      </span>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* ============================================================ */}
        {/* TAB 2: RIDGE & NOISE TUNING                                  */}
        {/* ============================================================ */}
        <Show when={activeTab() === 'tuning'}>
          {/* Edge Detection */}
          <div class="space-y-3">
            <span class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
              Edge Ridge Detection
            </span>
            <Slider
              label="Angle Threshold"
              value={threshold()}
              min={5}
              max={85}
              step={1}
              unit="°"
              onChange={(v) => {
                setThreshold(v)
                handleSliderChange()
              }}
            />
            <Slider
              label="Wear Width"
              value={wearWidth()}
              min={0.005}
              max={0.25}
              step={0.005}
              onChange={(v) => {
                setWearWidth(v)
                handleSliderChange()
              }}
              displayValue={(v) => `${(v * 100).toFixed(1)}%`}
            />
          </div>

          {/* Chips & Noise */}
          <div class="space-y-3 pt-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Procedural Chips
              </span>
              <Button variant="ghost" size="xs" onClick={rerollSeed} title="Shuffle noise seed">
                <RefreshCwIcon size={12} />
                <span>Reroll</span>
              </Button>
            </div>

            <Slider
              label="Chips Frequency"
              value={noiseScale()}
              min={2}
              max={70}
              step={1}
              onChange={(v) => {
                setNoiseScale(v)
                handleSliderChange()
              }}
              displayValue={(v) => v.toFixed(0)}
            />

            <Slider
              label="Detail & Roughness"
              value={roughness()}
              min={0.0}
              max={1.0}
              step={0.05}
              onChange={(v) => {
                setRoughness(v)
                handleSliderChange()
              }}
              displayValue={(v) => `${Math.round(v * 100)}%`}
            />

            <Slider
              label="Wear Amount"
              value={amount()}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => {
                setAmount(v)
                handleSliderChange()
              }}
              displayValue={(v) => `${Math.round(v * 100)}%`}
            />

            <Slider
              label="Edge Sharpness"
              value={contrast()}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => {
                setContrast(v)
                handleSliderChange()
              }}
              displayValue={(v) => `${Math.round(v * 100)}%`}
            />
          </div>

          {/* Bake Destination */}
          <div class="space-y-2 pt-2">
            <span class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
              Bake Destination
            </span>
            <div class="space-y-1.5">
              <button
                type="button"
                onClick={() => setAsNewLayer(true)}
                class={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left w-full transition-colors cursor-pointer ${
                  asNewLayer()
                    ? 'bg-blue-600/15 border-blue-500/70'
                    : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div class="w-4 h-4 rounded-full border border-blue-500 mt-0.5 flex items-center justify-center">
                  <Show when={asNewLayer()}>
                    <div class="w-2 h-2 rounded-full bg-blue-500" />
                  </Show>
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="text-xs font-semibold text-zinc-200">
                    New "Edge Wear" Layer (Recommended)
                  </span>
                  <span class="text-[10px] text-zinc-500">
                    Creates an editable layer you can toggle, erase, or blend later.
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAsNewLayer(false)}
                class={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left w-full transition-colors cursor-pointer ${
                  !asNewLayer()
                    ? 'bg-blue-600/15 border-blue-500/70'
                    : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div class="w-4 h-4 rounded-full border border-blue-500 mt-0.5 flex items-center justify-center">
                  <Show when={!asNewLayer()}>
                    <div class="w-2 h-2 rounded-full bg-blue-500" />
                  </Show>
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="text-xs font-semibold text-zinc-200">
                    Merge into Active Layer
                  </span>
                  <span class="text-[10px] text-zinc-500">
                    Permanently bakes the wear into the currently active layer.
                  </span>
                </div>
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* Sticky Bottom Action Bar */}
      <footer class="h-12 px-3.5 flex items-center justify-between border-t border-zinc-800 bg-zinc-950/80 flex-shrink-0">
        <label class="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={livePreview()}
            onChange={(e) => toggleLivePreview(e.currentTarget.checked)}
            class="rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 cursor-pointer"
          />
          <span>Live 3D Preview</span>
        </label>

        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleCommit}>
            <CheckIcon size={14} />
            <span>{asNewLayer() ? 'Apply to New Layer' : 'Merge Wear'}</span>
          </Button>
        </div>
      </footer>
    </div>
  )
}
