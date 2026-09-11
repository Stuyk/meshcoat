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
  { name: 'Dirt / Earth', hex: '#451a03' },
  { name: 'Charcoal Grime', hex: '#1f2937' },
  { name: 'Chalk White', hex: '#ffffff' },
  { name: 'Primer Gray', hex: '#64748b' }
]

export default function EdgeWearWizard(props: EdgeWearWizardProps) {
  // Navigation Tabs: 'material' or 'tuning'
  const [activeTab, setActiveTab] = createSignal<'material' | 'tuning'>('material')

  const [threshold, setThreshold] = createSignal(28)
  const [wearWidth, setWearWidth] = createSignal(0.05)
  const [noiseScale, setNoiseScale] = createSignal(25)
  const [roughness, setRoughness] = createSignal(0.65)
  const [amount, setAmount] = createSignal(0.7)
  const [contrast, setContrast] = createSignal(0.55)
  const [seed, setSeed] = createSignal(0)
  const [color, setColor] = createSignal(props.initialColor || '#d1d5db')
  const [opacity, setOpacity] = createSignal(1.0)
  const [asNewLayer, setAsNewLayer] = createSignal(true)
  const [livePreview, setLivePreview] = createSignal(true)
  const [activePreset, setActivePreset] = createSignal<string>('Chipped Paint')

  // Material Mode: 'color' or 'texture'
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

  // Reload THREE.Texture when texture path changes
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

  // Trigger preview when wizard opens
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
    <div class="edge-wear-wizard-panel">
      {/* Top Banner Header */}
      <div class="edge-wear-wizard-header">
        <div class="wizard-header-left">
          <div class="edge-wear-header-icon">
            <SparklesIcon size={16} class="text-amber-400" />
          </div>
          <div>
            <h3 class="wizard-header-title">Edge Wear Wizard</h3>
            <p class="wizard-header-subtitle">Procedural Ridge & Chipping Generator</p>
          </div>
        </div>
        <button class="modal-close-btn" onClick={handleClose} title="Cancel & Close (Esc)">
          <XIcon size={15} />
        </button>
      </div>

      {/* Subheader Wizard Navigation Tabs */}
      <div class="wizard-nav-tabs">
        <button
          class="wizard-nav-tab"
          classList={{ active: activeTab() === 'material' }}
          onClick={() => setActiveTab('material')}
        >
          <PaletteIcon size={14} />
          <span>Wear Material</span>
        </button>
        <button
          class="wizard-nav-tab"
          classList={{ active: activeTab() === 'tuning' }}
          onClick={() => setActiveTab('tuning')}
        >
          <SlidersIcon size={14} />
          <span>Ridge & Noise Tuning</span>
        </button>
      </div>

      {/* Wizard Scrollable Body */}
      <div class="edge-wear-wizard-scroll-body">
        {/* ============================================================ */}
        {/* TAB 1: WEAR MATERIAL & STYLE                                 */}
        {/* ============================================================ */}
        <Show when={activeTab() === 'material'}>
          {/* Active Material Hero Card */}
          <div class="wizard-hero-card">
            <div class="hero-preview-box checkerboard-bg">
              <Show
                when={materialMode() === 'texture' && selectedTexturePath()}
                fallback={
                  <div
                    class="hero-color-swatch"
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
                  class="hero-texture-img"
                  style={{ opacity: opacity() }}
                />
              </Show>
            </div>

            <div class="hero-info-column">
              <div class="hero-mode-badge-row">
                <span class="hero-mode-pill">
                  {materialMode() === 'color' ? 'Solid Color Mode' : 'Texture Pattern Mode'}
                </span>
                <span class="hero-opacity-pill tabular">{Math.round(opacity() * 100)}%</span>
              </div>

              <div class="hero-title-text" title={materialMode() === 'color' ? color() : (selectedTexturePath()?.split('/').pop() ?? 'No texture')}>
                {materialMode() === 'color'
                  ? color().toUpperCase()
                  : (selectedTexturePath()?.split('/').pop() ?? 'No Texture Selected')}
              </div>

              {/* Mode Toggle Switch */}
              <div class="wizard-mode-pills hero-mode-switch">
                <button
                  class="mode-pill-btn"
                  classList={{ active: materialMode() === 'color' }}
                  onClick={() => {
                    setMaterialMode('color')
                    triggerPreview()
                  }}
                >
                  <PaletteIcon size={13} />
                  <span>Solid Color</span>
                </button>
                <button
                  class="mode-pill-btn"
                  classList={{ active: materialMode() === 'texture' }}
                  onClick={() => {
                    setMaterialMode('texture')
                    if (!selectedTexturePath() && allTextures().length > 0) {
                      setSelectedTexturePath(allTextures()[0])
                    }
                    triggerPreview()
                  }}
                >
                  <ImagesIcon size={13} />
                  <span>Texture Pattern</span>
                </button>
              </div>
            </div>
          </div>

          {/* Solid Color Mode Controls */}
          <Show when={materialMode() === 'color'}>
            <section class="wizard-section-card">
              <div class="wizard-section-card-header">
                <span class="wizard-section-title">Metallic Colors</span>
              </div>
              <div class="color-palette-grid-spacious">
                <For each={METAL_COLORS}>
                  {(item) => (
                    <button
                      class="palette-chip-btn-spacious"
                      classList={{ active: color().toLowerCase() === item.hex.toLowerCase() }}
                      onClick={() => {
                        setColor(item.hex)
                        setActivePreset('')
                        triggerPreview()
                      }}
                      title={item.name}
                    >
                      <span class="chip-circle-large" style={{ background: item.hex }} />
                      <span class="chip-name">{item.name}</span>
                    </button>
                  )}
                </For>
              </div>

              <div class="wizard-section-card-header" style={{ 'margin-top': '8px' }}>
                <span class="wizard-section-title">Weathering & Corrosion</span>
              </div>
              <div class="color-palette-grid-spacious">
                <For each={WEATHER_COLORS}>
                  {(item) => (
                    <button
                      class="palette-chip-btn-spacious"
                      classList={{ active: color().toLowerCase() === item.hex.toLowerCase() }}
                      onClick={() => {
                        setColor(item.hex)
                        setActivePreset('')
                        triggerPreview()
                      }}
                      title={item.name}
                    >
                      <span class="chip-circle-large" style={{ background: item.hex }} />
                      <span class="chip-name">{item.name}</span>
                    </button>
                  )}
                </For>
              </div>

              {/* Custom Color Picker & Opacity */}
              <div class="material-controls-row">
                <div class="custom-color-picker-wrap">
                  <span class="setting-inline-label">Custom Color</span>
                  <button
                    class="color-hex-badge-large tabular"
                    onClick={() => colorPickerRef?.click()}
                    title="Click to open system color picker"
                  >
                    <span class="color-preview-chip-large" style={{ background: color() }} />
                    <span>{color().toUpperCase()}</span>
                  </button>
                  <input
                    ref={colorPickerRef}
                    type="color"
                    class="sr-only-picker"
                    value={color()}
                    onInput={(e) => {
                      setColor(e.currentTarget.value)
                      setActivePreset('')
                      triggerPreview()
                    }}
                  />
                </div>

                <div class="opacity-slider-wrap">
                  <div class="setting-header-row">
                    <span class="setting-title">Opacity</span>
                    <span class="setting-val-badge tabular">{Math.round(opacity() * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    class="custom-slider"
                    min="0.05"
                    max="1.0"
                    step="0.05"
                    value={opacity()}
                    onInput={(e) => {
                      setOpacity(parseFloat(e.currentTarget.value))
                      handleSliderChange()
                    }}
                  />
                </div>
              </div>
            </section>
          </Show>

          {/* Texture Pattern Mode Controls */}
          <Show when={materialMode() === 'texture'}>
            <section class="wizard-section-card">
              <div class="texture-selector-header">
                <span class="wizard-section-title">Available Textures</span>
                <button class="browse-texture-btn" onClick={browseForTexture} title="Load image file from computer">
                  <FolderOpenIcon size={14} />
                  <span>Browse File...</span>
                </button>
              </div>

              {/* Available Textures Grid - Generous 2 columns */}
              <Show
                when={allTextures().length > 0}
                fallback={
                  <div class="wizard-empty-textures" onClick={browseForTexture}>
                    <FolderOpenIcon size={28} class="text-blue-400" />
                    <span class="empty-title">No Textures Loaded</span>
                    <span class="empty-desc">Click here to browse and import any image file (PNG, JPG, WebP)</span>
                  </div>
                }
              >
                <div class="wizard-texture-grid-spacious">
                  <For each={allTextures()}>
                    {(path) => (
                      <button
                        class="wizard-texture-card-spacious"
                        classList={{ active: selectedTexturePath() === path }}
                        onClick={() => {
                          setSelectedTexturePath(path)
                          triggerPreview()
                        }}
                        title={path.split('/').pop() ?? path}
                      >
                        <img src={window.api.assetUrl(path)} alt="" class="texture-card-img-spacious" />
                        <span class="texture-card-name-spacious">{path.split('/').pop()}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              {/* Texture Projection & Tiling Options */}
              <div class="texture-options-box">
                <div class="texture-option-row">
                  <div class="projection-label-group">
                    <span class="setting-title">Texture Projection</span>
                    <span class="setting-desc-subtle">
                      {textureMapping() === 'triplanar'
                        ? 'World Triplanar (Seamless 3D projection across UV island seams)'
                        : 'UV Mapping (Follows mesh 2D UV unwrapping)'}
                    </span>
                  </div>
                  <div class="segmented-control-mini">
                    <button
                      class="segmented-btn-mini"
                      classList={{ active: textureMapping() === 'triplanar' }}
                      onClick={() => {
                        setTextureMapping('triplanar')
                        triggerPreview()
                      }}
                    >
                      Triplanar
                    </button>
                    <button
                      class="segmented-btn-mini"
                      classList={{ active: textureMapping() === 'uv' }}
                      onClick={() => {
                        setTextureMapping('uv')
                        triggerPreview()
                      }}
                    >
                      UV Islands
                    </button>
                  </div>
                </div>

                <div class="setting-group" style={{ 'margin-top': '8px' }}>
                  <div class="setting-header-row">
                    <span class="setting-title">Pattern Scale</span>
                    <span class="setting-val-badge tabular">{textureScale().toFixed(2)}×</span>
                  </div>
                  <input
                    type="range"
                    class="custom-slider"
                    min="0.1"
                    max="5.0"
                    step="0.1"
                    value={textureScale()}
                    onInput={(e) => {
                      setTextureScale(parseFloat(e.currentTarget.value))
                      triggerPreview()
                    }}
                  />
                </div>

                {/* Color Tint & Texture Opacity */}
                <div class="material-controls-row" style={{ 'margin-top': '8px' }}>
                  <div class="custom-color-picker-wrap">
                    <span class="setting-inline-label">Color Tint</span>
                    <button
                      class="color-hex-badge-large tabular"
                      onClick={() => colorPickerRef?.click()}
                      title="Tint color multiplied over texture"
                    >
                      <span class="color-preview-chip-large" style={{ background: color() }} />
                      <span>{color().toUpperCase()}</span>
                    </button>
                    <input
                      ref={colorPickerRef}
                      type="color"
                      class="sr-only-picker"
                      value={color()}
                      onInput={(e) => {
                        setColor(e.currentTarget.value)
                        triggerPreview()
                      }}
                    />
                  </div>

                  <div class="opacity-slider-wrap">
                    <div class="setting-header-row">
                      <span class="setting-title">Opacity</span>
                      <span class="setting-val-badge tabular">{Math.round(opacity() * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      class="custom-slider"
                      min="0.05"
                      max="1.0"
                      step="0.05"
                      value={opacity()}
                      onInput={(e) => {
                        setOpacity(parseFloat(e.currentTarget.value))
                        triggerPreview()
                      }}
                    />
                  </div>
                </div>
              </div>
            </section>
          </Show>

          {/* Style Presets */}
          <section class="wizard-section-card">
            <div class="wizard-section-card-header">
              <span class="wizard-section-title">Style Presets</span>
              <span class="setting-desc-subtle">Quick wear styles</span>
            </div>
            <div class="edge-wear-presets-grid">
              <For each={PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="edge-wear-preset-card"
                    classList={{ active: activePreset() === preset.name }}
                    onClick={() => applyPreset(preset)}
                  >
                    <div class="preset-card-title">{preset.name}</div>
                    <div class="preset-card-desc">{preset.desc}</div>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        {/* ============================================================ */}
        {/* TAB 2: RIDGE & NOISE TUNING                                  */}
        {/* ============================================================ */}
        <Show when={activeTab() === 'tuning'}>
          {/* Section 1: Edge Ridge Geometry */}
          <section class="wizard-section-card">
            <div class="wizard-section-card-header">
              <span class="wizard-section-title">Edge Ridge Detection</span>
            </div>

            <div class="wizard-sliders-column">
              {/* Angle Threshold */}
              <div class="setting-group">
                <div class="setting-header-row">
                  <span class="setting-title" title="Minimum dihedral angle between adjacent faces to be recognized as an edge">
                    Angle Threshold
                  </span>
                  <span class="setting-val-badge tabular">{threshold()}°</span>
                </div>
                <input
                  type="range"
                  class="custom-slider"
                  min="5"
                  max="85"
                  step="1"
                  value={threshold()}
                  onInput={(e) => {
                    setThreshold(parseFloat(e.currentTarget.value))
                    handleSliderChange()
                  }}
                />
                <span class="setting-subtext">Lower values detect gentler curves; higher values detect sharp corners.</span>
              </div>

              {/* Wear Width */}
              <div class="setting-group">
                <div class="setting-header-row">
                  <span class="setting-title" title="Distance wear extends inward from sharp edges">
                    Wear Width
                  </span>
                  <span class="setting-val-badge tabular">{(wearWidth() * 100).toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  class="custom-slider"
                  min="0.005"
                  max="0.25"
                  step="0.005"
                  value={wearWidth()}
                  onInput={(e) => {
                    setWearWidth(parseFloat(e.currentTarget.value))
                    handleSliderChange()
                  }}
                />
                <span class="setting-subtext">Thickness of the wear border spreading inward along adjacent faces.</span>
              </div>
            </div>
          </section>

          {/* Section 2: Procedural Grunge & Noise */}
          <section class="wizard-section-card">
            <div class="wizard-section-card-header">
              <span class="wizard-section-title">Procedural Chips & Scratches</span>
              <button class="seed-reroll-btn" onClick={rerollSeed} title="Shuffle noise seed">
                <RefreshCwIcon size={12} />
                <span>Reroll Variation</span>
              </button>
            </div>

            <div class="wizard-sliders-column">
              {/* Noise Scale */}
              <div class="setting-group">
                <div class="setting-header-row">
                  <span class="setting-title" title="Frequency of chips, scratches, and noise">
                    Chips Frequency (Scale)
                  </span>
                  <span class="setting-val-badge tabular">{noiseScale().toFixed(0)}</span>
                </div>
                <input
                  type="range"
                  class="custom-slider"
                  min="2"
                  max="70"
                  step="1"
                  value={noiseScale()}
                  onInput={(e) => {
                    setNoiseScale(parseFloat(e.currentTarget.value))
                    handleSliderChange()
                  }}
                />
              </div>

              {/* Detail & Roughness */}
              <div class="setting-group">
                <div class="setting-header-row">
                  <span class="setting-title" title="Fractal fBm micro-scratches and surface roughness">
                    Detail & Roughness
                  </span>
                  <span class="setting-val-badge tabular">{Math.round(roughness() * 100)}%</span>
                </div>
                <input
                  type="range"
                  class="custom-slider"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={roughness()}
                  onInput={(e) => {
                    setRoughness(parseFloat(e.currentTarget.value))
                    handleSliderChange()
                  }}
                />
              </div>

              {/* Wear Amount */}
              <div class="setting-group">
                <div class="setting-header-row">
                  <span class="setting-title" title="Overall edge coverage density">
                    Wear Amount
                  </span>
                  <span class="setting-val-badge tabular">{Math.round(amount() * 100)}%</span>
                </div>
                <input
                  type="range"
                  class="custom-slider"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={amount()}
                  onInput={(e) => {
                    setAmount(parseFloat(e.currentTarget.value))
                    handleSliderChange()
                  }}
                />
              </div>

              {/* Contrast */}
              <div class="setting-group">
                <div class="setting-header-row">
                  <span class="setting-title" title="Falloff edge sharpness of the wear chips">
                    Edge Sharpness / Contrast
                  </span>
                  <span class="setting-val-badge tabular">{Math.round(contrast() * 100)}%</span>
                </div>
                <input
                  type="range"
                  class="custom-slider"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={contrast()}
                  onInput={(e) => {
                    setContrast(parseFloat(e.currentTarget.value))
                    handleSliderChange()
                  }}
                />
              </div>
            </div>
          </section>

          {/* Section 3: Bake Destination */}
          <section class="wizard-section-card">
            <div class="wizard-section-card-header">
              <span class="wizard-section-title">Bake Destination</span>
            </div>

            <div class="destination-options-column">
              <label
                class="destination-option-pill"
                classList={{ selected: asNewLayer() }}
                onClick={() => setAsNewLayer(true)}
              >
                <input
                  type="radio"
                  name="wearTarget"
                  checked={asNewLayer()}
                  onChange={() => setAsNewLayer(true)}
                />
                <div class="option-pill-content">
                  <span class="option-pill-title">New "Edge Wear" Layer (Recommended)</span>
                  <span class="option-pill-desc">Creates a separate layer so you can toggle, erase, or adjust opacity later.</span>
                </div>
              </label>

              <label
                class="destination-option-pill"
                classList={{ selected: !asNewLayer() }}
                onClick={() => setAsNewLayer(false)}
              >
                <input
                  type="radio"
                  name="wearTarget"
                  checked={!asNewLayer()}
                  onChange={() => setAsNewLayer(false)}
                />
                <div class="option-pill-content">
                  <span class="option-pill-title">Merge into Active Layer</span>
                  <span class="option-pill-desc">Permanently blends the wear into the active texture layer.</span>
                </div>
              </label>
            </div>
          </section>
        </Show>
      </div>

      {/* Sticky Bottom Action Bar */}
      <footer class="edge-wear-wizard-footer">
        <div class="wizard-footer-left">
          <label class="checkbox-label" title="Toggle before/after preview in 3D viewport">
            <input
              type="checkbox"
              checked={livePreview()}
              onChange={(e) => toggleLivePreview(e.currentTarget.checked)}
            />
            <span>Live 3D Preview</span>
          </label>
        </div>

        <div class="wizard-footer-right">
          <button class="btn-flat btn-ghost" onClick={handleClose}>
            Cancel
          </button>
          <button class="btn-flat btn-primary" onClick={handleCommit}>
            <CheckIcon size={14} />
            <span>{asNewLayer() ? 'Apply to New Layer' : 'Merge Wear'}</span>
          </button>
        </div>
      </footer>
    </div>
  )
}
