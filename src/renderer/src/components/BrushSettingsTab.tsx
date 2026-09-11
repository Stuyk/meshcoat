import { Show } from 'solid-js'
import {
  brush,
  setRadius,
  setOpacity,
  setHardness,
  setSpacing,
  setTextureScale,
  setTexturePath,
  type ToolMode
} from '../paint/brush'
import { XIcon, PaletteIcon, StampIcon } from './icons'

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
  { label: 'Small', value: 0.15 },
  { label: 'Med', value: 0.3 },
  { label: 'Large', value: 0.6 },
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

export default function BrushSettingsTab(props: { activeTool: ToolMode }) {
  let colorInputRef: HTMLInputElement | undefined

  // Compute visual falloff preview for canvas / CSS radial gradient
  const tipGradient = () => {
    const col = brush.color()
    const hard = Math.max(0, Math.min(1, brush.hardness()))
    const innerStop = Math.round(hard * 85)
    return `radial-gradient(circle, ${col} 0%, ${col} ${innerStop}%, transparent 100%)`
  }

  // Visual size of the tip within a 110px preview box (clamped for visual display)
  const tipDiameterPx = () => {
    const normalized = Math.min(1, Math.max(0.1, brush.radius() / 1.5))
    return Math.round(18 + normalized * 74)
  }

  return (
    <div class="brush-settings-tab">
      {/* Live Brush Tip Visual Preview */}
      <div class="brush-preview-card">
        <div class="brush-preview-header">
          <span class="preview-label">Brush Tip Preview</span>
          <span class="preview-info">
            R: {brush.radius().toFixed(2)} • H: {Math.round(brush.hardness() * 100)}%
          </span>
        </div>
        <div class="brush-preview-stage checkerboard-bg">
          <div
            class="brush-preview-circle"
            style={{
              width: `${tipDiameterPx()}px`,
              height: `${tipDiameterPx()}px`,
              background: tipGradient(),
              opacity: brush.opacity()
            }}
          >
            <Show when={brush.texturePath()}>
              <img
                src={window.api.assetUrl(brush.texturePath()!)}
                alt=""
                class="brush-preview-texture"
                style={{ opacity: brush.opacity() }}
              />
            </Show>
          </div>
        </div>
      </div>

      {/* Color Palette & Selector */}
      <div class="setting-group">
        <div class="setting-group-header">
          <div class="setting-label">
            <PaletteIcon size={14} /> Color
          </div>
          <button
            class="color-hex-badge tabular"
            onClick={() => colorInputRef?.click()}
            title="Click to open full color picker"
          >
            <span class="color-preview-chip" style={{ background: brush.color() }} />
            <span>{brush.color().toUpperCase()}</span>
          </button>
          <input
            ref={colorInputRef}
            type="color"
            class="sr-only-picker"
            value={brush.color()}
            onInput={(e) => brush.setColor(e.currentTarget.value)}
          />
        </div>

        {/* Quick Color Swatches */}
        <div class="color-swatches-row">
          {QUICK_COLORS.map((hex) => (
            <button
              class="color-swatch-btn"
              classList={{ active: brush.color().toLowerCase() === hex.toLowerCase() }}
              style={{ background: hex }}
              onClick={() => brush.setColor(hex)}
              title={hex}
            />
          ))}
        </div>
      </div>

      {/* Radius Setting */}
      <div class="setting-group">
        <div class="setting-header-row">
          <span class="setting-title">Radius</span>
          <div class="setting-value-stepper">
            <input
              type="number"
              min="0.01"
              max="5"
              step="0.05"
              class="setting-num-input tabular"
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
          class="custom-slider"
          min="0.01"
          max="2"
          step="0.01"
          value={brush.radius()}
          onInput={(e) => setRadius(parseFloat(e.currentTarget.value))}
        />
        <div class="preset-chips-row">
          {RADIUS_PRESETS.map((p) => (
            <button
              class="preset-chip"
              classList={{ active: Math.abs(brush.radius() - p.value) < 0.03 }}
              onClick={() => setRadius(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Opacity Setting */}
      <div class="setting-group">
        <div class="setting-header-row">
          <span class="setting-title">Opacity</span>
          <span class="setting-val-badge tabular">{Math.round(brush.opacity() * 100)}%</span>
        </div>
        <input
          type="range"
          class="custom-slider"
          min="0"
          max="1"
          step="0.01"
          value={brush.opacity()}
          onInput={(e) => setOpacity(parseFloat(e.currentTarget.value))}
        />
        <div class="preset-chips-row">
          {OPACITY_PRESETS.map((p) => (
            <button
              class="preset-chip"
              classList={{ active: Math.abs(brush.opacity() - p.value) < 0.05 }}
              onClick={() => setOpacity(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hardness Setting */}
      <div class="setting-group">
        <div class="setting-header-row">
          <span class="setting-title">Hardness</span>
          <span class="setting-val-badge tabular">{Math.round(brush.hardness() * 100)}%</span>
        </div>
        <input
          type="range"
          class="custom-slider"
          min="0"
          max="1"
          step="0.01"
          value={brush.hardness()}
          onInput={(e) => setHardness(parseFloat(e.currentTarget.value))}
        />
        <div class="preset-chips-row">
          {HARDNESS_PRESETS.map((p) => (
            <button
              class="preset-chip"
              classList={{ active: Math.abs(brush.hardness() - p.value) < 0.05 }}
              onClick={() => setHardness(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Spacing Setting */}
      <div class="setting-group">
        <div class="setting-header-row">
          <span class="setting-title">Spacing</span>
          <span class="setting-val-badge tabular">{Math.round(brush.spacing() * 100)}%</span>
        </div>
        <input
          type="range"
          class="custom-slider"
          min="0.02"
          max="1"
          step="0.01"
          value={brush.spacing()}
          onInput={(e) => setSpacing(parseFloat(e.currentTarget.value))}
        />
        <div class="preset-chips-row">
          {SPACING_PRESETS.map((p) => (
            <button
              class="preset-chip"
              classList={{ active: Math.abs(brush.spacing() - p.value) < 0.05 }}
              onClick={() => setSpacing(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Texture / Stamp Card */}
      <Show
        when={brush.texturePath()}
        fallback={
          <div class="texture-callout-box">
            <StampIcon size={16} class="text-blue-400" />
            <div class="callout-text">
              <span class="callout-title">Texture Stamp Inactive</span>
              <span class="callout-desc">Select an image from the bottom drawer to stamp decals or paint patterns.</span>
            </div>
          </div>
        }
      >
        <div class="active-texture-card">
          <div class="texture-card-header">
            <span class="texture-card-title">Active Texture</span>
            <button class="texture-clear-btn" title="Remove texture from brush" onClick={() => setTexturePath(null)}>
              <XIcon size={14} />
            </button>
          </div>
          <div class="texture-card-body">
            <div class="texture-thumb-frame checkerboard-bg">
              <img src={window.api.assetUrl(brush.texturePath()!)} alt="" />
            </div>
            <div class="texture-card-meta">
              <span class="texture-file-name" title={brush.texturePath()?.split('/').pop()}>
                {brush.texturePath()?.split('/').pop()}
              </span>
              <span class="texture-mode-badge">
                {props.activeTool === 'stamp' ? 'Decal Stamp Mode' : 'Tiled Pattern Mode'}
              </span>
            </div>
          </div>

          <Show when={props.activeTool === 'brush'}>
            <div class="texture-scale-section">
              <div class="setting-header-row">
                <span class="setting-sublabel">Tiling Scale</span>
                <span class="setting-val-badge tabular">{brush.textureScale().toFixed(2)}x</span>
              </div>
              <input
                type="range"
                class="custom-slider"
                min="0.05"
                max="3"
                step="0.05"
                value={brush.textureScale()}
                onInput={(e) => setTextureScale(parseFloat(e.currentTarget.value))}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
