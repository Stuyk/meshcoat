import { Show, createSignal } from 'solid-js'
import {
  brush,
  setRadius,
  setOpacity,
  setHardness,
  setSpacing,
  setTextureScale,
  setTexturePath,
  setTextureMapping,
  clearFaceSelection,
  type ToolMode
} from '../paint/brush'
import { brushPresets } from '../paint/brushPresets'
import {
  XIcon,
  PaletteIcon,
  StampIcon,
  SparklesIcon,
  ChevronDownIcon,
  CircleDotIcon,
  SlidersHorizontalIcon,
  SpacingIcon,
  FeatherIcon,
  EyeIcon,
  ImagesIcon,
  FocusIcon,
  EyedropperIcon,
  RotateIcon,
  SymmetryIcon
} from './icons'
import { toAssetUrl } from '../utils/assetUrl'

const QUICK_COLORS = [
  '#ffffff',
  '#d1d5db',
  '#6b7280',
  '#1f2937',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899'
]

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

export default function BrushSettingsTab(props: {
  activeTool: ToolMode
  isMaskTarget?: () => boolean
}) {
  let colorInputRef: HTMLInputElement | undefined

  // Collapsible section toggles
  const [strokeOpen, setStrokeOpen] = createSignal(true)
  const [colorOpen, setColorOpen] = createSignal(true)
  const [textureOpen, setTextureOpen] = createSignal(!!brush.texturePath())

  // Compute visual falloff preview for canvas / CSS radial gradient
  const tipGradient = () => {
    const col = brush.color()
    const hard = Math.max(0, Math.min(1, brush.hardness()))
    const innerStop = Math.round(hard * 85)
    return `radial-gradient(circle, ${col} 0%, ${col} ${innerStop}%, transparent 100%)`
  }

  // Visual size of the tip avatar
  const tipDiameterPx = () => {
    const normalized = Math.min(1, Math.max(0.2, brush.radius() / 1.5))
    return Math.round(14 + normalized * 26)
  }

  return (
    <div class="brush-settings-tab">
      {/* 1. Contextual Restrict Banner (Face Selection) */}
      <Show when={brush.selectedFaces().size > 0}>
        <div class="brush-restrict-banner">
          <div class="restrict-banner-info">
            <FocusIcon size={16} class="restrict-icon" />
            <span>Restricted to <strong>{brush.selectedFaces().size}</strong> face(s)</span>
          </div>
          <button
            type="button"
            class="restrict-clear-btn"
            onClick={clearFaceSelection}
            title="Clear face selection constraint (Esc)"
          >
            Clear
          </button>
        </div>
      </Show>

      {/* 2. Mask Editing Alert Banner */}
      <Show when={props.isMaskTarget?.()}>
        <div class="mask-editing-banner">
          <div class="mask-banner-title">
            <span class="mask-dot" />
            <span>Editing Layer Mask</span>
          </div>
          <p class="mask-banner-desc">
            White reveals the layer, Black hides it. Press <strong>X</strong> to swap Black &amp; White.
          </p>
        </div>
      </Show>

      {/* 3. Unified Active Brush Profile Card */}
      <div class="brush-profile-card">
        <div class="brush-profile-left">
          <div class="brush-profile-avatar checkerboard-bg" title="Current brush tip & falloff preview">
            <Show
              when={brush.tipTexturePath()}
              fallback={
                <div
                  class="brush-profile-circle"
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
                class="brush-profile-img"
                style={{ opacity: brush.opacity() }}
              />
            </Show>
          </div>
          <div class="brush-profile-info">
            <div class="brush-profile-name">
              {brushPresets.active() ? brushPresets.active()!.name : 'Standard Round Tip'}
            </div>
            <div class="brush-profile-metrics">
              <span class="profile-metric-pill">R: {brush.radius().toFixed(2)}</span>
              <span class="profile-metric-pill">{Math.round(brush.opacity() * 100)}% Op</span>
              <span class="profile-metric-pill">{Math.round(brush.hardness() * 100)}% H</span>
            </div>
          </div>
        </div>

        <div class="brush-profile-actions">
          <Show when={brushPresets.active()}>
            <button
              type="button"
              class="brush-action-btn icon-only"
              title="Reset to default round tip"
              onClick={() => brushPresets.clear()}
            >
              <XIcon size={18} />
            </button>
          </Show>
          <button
            type="button"
            class="brush-action-btn primary"
            onClick={() => brushPresets.openManager()}
            title="Open Brush Preset Manager (ABR / Custom Brushes)"
          >
            <SparklesIcon size={18} />
            <span>Library</span>
          </button>
        </div>
      </div>


      {/* 4. Collapsible Section: Color & Palette */}
      <div class="inspector-section" classList={{ 'is-collapsed': !colorOpen() }}>
        <button
          type="button"
          class="inspector-section-header"
          onClick={() => setColorOpen(!colorOpen())}
        >
          <div class="header-title-wrap">
            <PaletteIcon size={16} class="section-icon text-emerald-400" />
            <span>{props.isMaskTarget?.() ? 'Mask Grayscale' : 'Paint Color'}</span>
          </div>
          <div class="header-meta-wrap">
            <span class="color-indicator-swatch" style={{ background: brush.color() }} />
            <ChevronDownIcon size={16} class="section-chevron" />
          </div>
        </button>

        <Show when={colorOpen()}>
          <div class="inspector-section-body">
            {/* Primary Swatch & Hex Stepper */}
            <div class="color-master-row">
              <button
                type="button"
                class="color-trigger-btn"
                onClick={() => colorInputRef?.click()}
                title="Click to open color picker"
              >
                <span class="color-trigger-chip" style={{ background: brush.color() }} />
                <span class="color-trigger-hex tabular">{brush.color().toUpperCase()}</span>
                <EyedropperIcon size={15} class="text-neutral-400 ml-auto" />
              </button>
              <input
                ref={colorInputRef}
                type="color"
                class="sr-only-picker"
                value={brush.color()}
                onInput={(e) => brush.setColor(e.currentTarget.value)}
              />
            </div>

            {/* Mask Mode Grayscale Buttons */}
            <Show when={props.isMaskTarget?.()}>
              <div class="mask-grays-list">
                {MASK_GRAYS.map((item) => (
                  <button
                    type="button"
                    class="mask-gray-row-btn"
                    classList={{ active: brush.color().toLowerCase() === item.hex.toLowerCase() }}
                    onClick={() => brush.setColor(item.hex)}
                    title={item.label}
                  >
                    <span class="mask-gray-chip" style={{ background: item.hex }} />
                    <span class="mask-gray-label">{item.label}</span>
                  </button>
                ))}
              </div>
            </Show>

            {/* Standard Quick Palette */}
            <Show when={!props.isMaskTarget?.()}>
              <div class="color-swatches-grid">
                {QUICK_COLORS.map((hex) => (
                  <button
                    type="button"
                    class="color-swatch-cell"
                    classList={{ active: brush.color().toLowerCase() === hex.toLowerCase() }}
                    style={{ background: hex }}
                    onClick={() => brush.setColor(hex)}
                    title={hex}
                  />
                ))}
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* 5. Collapsible Section: Surface Material & Texture */}
      <div class="inspector-section" classList={{ 'is-collapsed': !textureOpen() }}>
        <button
          type="button"
          class="inspector-section-header"
          onClick={() => setTextureOpen(!textureOpen())}
        >
          <div class="header-title-wrap">
            <ImagesIcon size={16} class="section-icon text-purple-400" />
            <span>Material Texture</span>
          </div>
          <div class="header-meta-wrap">
            <span
              class="section-meta-badge"
              classList={{ active: !!brush.texturePath() }}
            >
              {brush.texturePath() ? 'Active' : 'Solid Color'}
            </span>
            <ChevronDownIcon size={16} class="section-chevron" />
          </div>
        </button>

        <Show when={textureOpen()}>
          <div class="inspector-section-body">
            <Show
              when={brush.texturePath()}
              fallback={
                <div class="texture-empty-callout">
                  <StampIcon size={18} class="text-neutral-400" />
                  <div class="empty-callout-text">
                    <span class="empty-title">
                      {props.activeTool === 'fill' ? 'Solid Color Fill' : 'No Texture Selected'}
                    </span>
                    <span class="empty-desc">
                      Pick a texture from the bottom Texture Shelf to paint materials or stamp decals.
                    </span>
                  </div>
                </div>
              }
            >
              {/* Active Texture Card */}
              <div class="active-texture-row">
                <div class="texture-thumb-box checkerboard-bg">
                  <img src={toAssetUrl(brush.texturePath()!)} alt="" />
                </div>
                <div class="texture-meta-info">
                  <span class="texture-name-label" title={brush.texturePath()?.split('/').pop()}>
                    {brush.texturePath()?.split('/').pop()}
                  </span>
                  <span class="texture-mode-pill">
                    {props.activeTool === 'stamp'
                      ? 'Decal Stamp'
                      : props.activeTool === 'fill'
                        ? 'Fill Pattern'
                        : brush.textureMapping() === 'uv'
                          ? 'Direct UV'
                          : brush.textureMapping() === 'triplanar'
                            ? 'Triplanar'
                            : 'Brush Tip'}
                  </span>
                </div>
                <button
                  type="button"
                  class="texture-detach-btn"
                  title="Remove texture pattern"
                  onClick={() => setTexturePath(null)}
                >
                  <XIcon size={16} />
                </button>
              </div>

              {/* Projection Mode (Brush tool) */}
              <Show when={props.activeTool === 'brush'}>
                <div class="setting-row-group">
                  <div class="setting-label-row">
                    <span class="sub-label">Projection Mapping</span>
                  </div>
                  <div class="segmented-control-tabs">
                    <button
                      type="button"
                      class="segmented-tab"
                      classList={{ active: brush.textureMapping() === 'uv' }}
                      onClick={() => setTextureMapping('uv')}
                      title="Follows 3D model authored UV coordinates"
                    >
                      Direct UV
                    </button>
                    <button
                      type="button"
                      class="segmented-tab"
                      classList={{ active: brush.textureMapping() === 'triplanar' }}
                      onClick={() => setTextureMapping('triplanar')}
                      title="Seamless world-space 3D projection"
                    >
                      Triplanar
                    </button>
                    <button
                      type="button"
                      class="segmented-tab"
                      classList={{ active: brush.textureMapping() === 'tip' }}
                      onClick={() => setTextureMapping('tip')}
                      title="Stamps texture image directly per dab"
                    >
                      Brush Tip
                    </button>
                  </div>
                </div>
              </Show>

              {/* Tiling Scale */}
              <Show when={props.activeTool === 'brush' || props.activeTool === 'fill'}>
                <div class="setting-row-group">
                  <div class="setting-label-row">
                    <span class="sub-label">Tiling / Scale</span>
                    <span class="setting-badge tabular">{brush.textureScale().toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    class="compact-slider"
                    min="0.1"
                    max="5"
                    step="0.05"
                    value={brush.textureScale()}
                    onInput={(e) => setTextureScale(parseFloat(e.currentTarget.value))}
                  />
                  <div class="segmented-chips-row">
                    {[
                      { label: '0.5x', value: 0.5 },
                      { label: '1.0x', value: 1.0 },
                      { label: '2.0x', value: 2.0 },
                      { label: '3.0x', value: 3.0 }
                    ].map((p) => (
                      <button
                        type="button"
                        class="segmented-chip-btn"
                        classList={{ active: Math.abs(brush.textureScale() - p.value) < 0.05 }}
                        onClick={() => setTextureScale(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </Show>
            </Show>
          </div>
        </Show>
      </div>

      {/* 6. Collapsible Section: Stroke Dynamics */}
      <div class="inspector-section" classList={{ 'is-collapsed': !strokeOpen() }}>
        <button
          type="button"
          class="inspector-section-header"
          onClick={() => setStrokeOpen(!strokeOpen())}
        >
          <div class="header-title-wrap">
            <SlidersHorizontalIcon size={16} class="section-icon text-blue-400" />
            <span>Stroke Dynamics</span>
          </div>
          <div class="header-meta-wrap">
            <span class="section-meta-badge tabular">R: {brush.radius().toFixed(2)}</span>
            <ChevronDownIcon size={16} class="section-chevron" />
          </div>
        </button>

        <Show when={strokeOpen()}>
          <div class="inspector-section-body">
            {/* Radius / Size */}
            <div class="setting-row-group">
              <div class="setting-label-row">
                <div class="label-with-icon">
                  <CircleDotIcon size={14} class="text-neutral-400" />
                  <span>Size / Radius</span>
                </div>
                <div class="stepper-input-wrap">
                  <input
                    type="number"
                    min="0.01"
                    max="5"
                    step="0.05"
                    class="setting-stepper-input tabular"
                    value={brush.radius().toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.currentTarget.value)
                      if (!isNaN(val)) setRadius(val)
                    }}
                  />
                </div>
              </div>
              <input
                type="range"
                class="compact-slider"
                min="0.01"
                max="2"
                step="0.01"
                value={brush.radius()}
                onInput={(e) => setRadius(parseFloat(e.currentTarget.value))}
              />
              <div class="segmented-chips-row">
                {RADIUS_PRESETS.map((p) => (
                  <button
                    type="button"
                    class="segmented-chip-btn"
                    classList={{ active: Math.abs(brush.radius() - p.value) < 0.03 }}
                    onClick={() => setRadius(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Opacity */}
            <div class="setting-row-group">
              <div class="setting-label-row">
                <div class="label-with-icon">
                  <EyeIcon size={14} class="text-neutral-400" />
                  <span>Opacity / Flow</span>
                </div>
                <span class="setting-badge tabular">{Math.round(brush.opacity() * 100)}%</span>
              </div>
              <input
                type="range"
                class="compact-slider"
                min="0"
                max="1"
                step="0.01"
                value={brush.opacity()}
                onInput={(e) => setOpacity(parseFloat(e.currentTarget.value))}
              />
              <div class="segmented-chips-row">
                {OPACITY_PRESETS.map((p) => (
                  <button
                    type="button"
                    class="segmented-chip-btn"
                    classList={{ active: Math.abs(brush.opacity() - p.value) < 0.05 }}
                    onClick={() => setOpacity(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Hardness */}
            <div class="setting-row-group">
              <div class="setting-label-row">
                <div class="label-with-icon">
                  <FeatherIcon size={14} class="text-neutral-400" />
                  <span>Hardness (Falloff)</span>
                </div>
                <span class="setting-badge tabular">{Math.round(brush.hardness() * 100)}%</span>
              </div>
              <input
                type="range"
                class="compact-slider"
                min="0"
                max="1"
                step="0.01"
                value={brush.hardness()}
                onInput={(e) => setHardness(parseFloat(e.currentTarget.value))}
              />
              <div class="segmented-chips-row">
                {HARDNESS_PRESETS.map((p) => (
                  <button
                    type="button"
                    class="segmented-chip-btn"
                    classList={{ active: Math.abs(brush.hardness() - p.value) < 0.05 }}
                    onClick={() => setHardness(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Spacing */}
            <div class="setting-row-group">
              <div class="setting-label-row">
                <div class="label-with-icon">
                  <SpacingIcon size={14} class="text-neutral-400" />
                  <span>Spacing (Dab Rate)</span>
                </div>
                <span class="setting-badge tabular">{Math.round(brush.spacing() * 100)}%</span>
              </div>
              <input
                type="range"
                class="compact-slider"
                min="0.02"
                max="1"
                step="0.01"
                value={brush.spacing()}
                onInput={(e) => setSpacing(parseFloat(e.currentTarget.value))}
              />
              <div class="segmented-chips-row">
                {SPACING_PRESETS.map((p) => (
                  <button
                    type="button"
                    class="segmented-chip-btn"
                    classList={{ active: Math.abs(brush.spacing() - p.value) < 0.05 }}
                    onClick={() => setSpacing(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Rotation & Angle */}
            <div class="setting-row-group">
              <div class="setting-label-row">
                <div class="label-with-icon">
                  <RotateIcon size={14} class="text-neutral-400" />
                  <span>Rotation Angle</span>
                </div>
                <span class="setting-badge tabular">{Math.round(brush.brushRotation())}°</span>
              </div>
              <input
                type="range"
                class="compact-slider"
                min="0"
                max="360"
                step="1"
                value={brush.brushRotation()}
                onInput={(e) => brush.setBrushRotation(parseFloat(e.currentTarget.value))}
              />
              <div class="segmented-chips-row">
                {[
                  { label: '0°', value: 0 },
                  { label: '45°', value: 45 },
                  { label: '90°', value: 90 },
                  { label: '180°', value: 180 }
                ].map((p) => (
                  <button
                    type="button"
                    class="segmented-chip-btn"
                    classList={{ active: Math.abs(brush.brushRotation() - p.value) < 2 }}
                    onClick={() => brush.setBrushRotation(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamics / Follow Stroke & Jitter */}
            <div class="dynamics-toggle-box">
              <button
                type="button"
                class="dynamics-pill-btn"
                classList={{ active: brush.angleFollowStroke() }}
                onClick={() => brush.setAngleFollowStroke(!brush.angleFollowStroke())}
                title="Automatically rotates the brush tip to match the direction of pointer movement"
              >
                <RotateIcon size={13} />
                <span>Follow Stroke Direction</span>
              </button>
            </div>

            <div class="setting-row-group">
              <div class="setting-label-row">
                <span class="sub-label">Angle Jitter</span>
                <span class="setting-badge tabular">{Math.round(brush.angleJitter() * 100)}%</span>
              </div>
              <input
                type="range"
                class="compact-slider"
                min="0"
                max="1"
                step="0.05"
                value={brush.angleJitter()}
                onInput={(e) => brush.setAngleJitter(parseFloat(e.currentTarget.value))}
              />
            </div>

            <div class="setting-row-group">
              <div class="setting-label-row">
                <span class="sub-label">Size Jitter</span>
                <span class="setting-badge tabular">{Math.round(brush.sizeJitter() * 100)}%</span>
              </div>
              <input
                type="range"
                class="compact-slider"
                min="0"
                max="1"
                step="0.05"
                value={brush.sizeJitter()}
                onInput={(e) => brush.setSizeJitter(parseFloat(e.currentTarget.value))}
              />
            </div>

            {/* Symmetry Mirror Axis */}
            <div class="setting-row-group">
              <div class="setting-label-row">
                <div class="label-with-icon">
                  <SymmetryIcon size={14} class="text-neutral-400" />
                  <span>Symmetry Mirror</span>
                </div>
                <span class="setting-badge tabular">
                  {brush.symmetryAxis() === 'off' ? 'Off' : `${brush.symmetryAxis().toUpperCase()} Axis`}
                </span>
              </div>
              <div class="segmented-chips-row">
                {[
                  { label: 'Off', value: 'off' },
                  { label: 'X Axis', value: 'x' },
                  { label: 'Y Axis', value: 'y' },
                  { label: 'Z Axis', value: 'z' }
                ].map((item) => (
                  <button
                    type="button"
                    class="segmented-chip-btn"
                    classList={{ active: brush.symmetryAxis() === item.value }}
                    onClick={() => brush.setSymmetryAxis(item.value as any)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
