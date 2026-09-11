import { Show } from 'solid-js'
import { brush, setTextureMapping } from '../paint/brush'
import type { ToolMode } from '../paint/brush'
import type { LightingMode } from '../viewport/scene'
import {
  BrushIcon,
  StampIcon,
  EraserIcon,
  FillIcon,
  EyedropperIcon,
  MousePointerIcon,
  LineIcon,
  LayersIcon,
  HelpCircleIcon,
  WireframeIcon,
  FocusIcon,
  XIcon
} from './icons'

export interface StatusBarProps {
  tool: ToolMode
  lightingMode: LightingMode
  wireframeVisible: boolean
  textureSize: number
  modelName: string
  activeLayerName?: string
  layerCount?: number
  selectedFaceCount: number
  onToggleWireframe: () => void
  onCycleLighting: () => void
  onOpenHelp: () => void
  onClearFaceSelection: () => void
  onFrameCamera: () => void
}

const TOOL_CONFIG: Record<ToolMode, { label: string; key: string; num: string; Icon: (props: any) => any }> = {
  brush: { label: 'Brush', key: 'B', num: '1', Icon: BrushIcon },
  line: { label: 'Line', key: 'L', num: 'L', Icon: LineIcon },
  eraser: { label: 'Eraser', key: 'E', num: '2', Icon: EraserIcon },
  stamp: { label: 'Stamp', key: 'T', num: '3', Icon: StampIcon },
  fill: { label: 'Fill', key: 'G', num: '4', Icon: FillIcon },
  eyedropper: { label: 'Eyedropper', key: 'I', num: '5', Icon: EyedropperIcon },
  faceSelect: { label: 'Face Select', key: 'V', num: '6', Icon: MousePointerIcon }
}

const LIGHTING_LABELS: Record<LightingMode, string> = {
  studio: 'Studio',
  flat: 'Flat (Unlit)',
  outdoor: 'Outdoor'
}

export default function StatusBar(props: StatusBarProps) {
  const currentTool = () => TOOL_CONFIG[props.tool] ?? TOOL_CONFIG.brush

  return (
    <footer class="status-bar" role="status" aria-label="Application Status">
      {/* Left Area: Active Tool & Face Mask Status */}
      <div class="status-bar-left">
        {/* Tool Indicator */}
        <div
          class="status-item tool-status"
          title={`Active Tool: ${currentTool().label} (${currentTool().num} or ${currentTool().key})`}
        >
          {(() => {
            const Icon = currentTool().Icon
            return <Icon size={12} class="text-blue-400" />
          })()}
          <span class="status-text font-medium">{currentTool().label}</span>
          <kbd class="status-kbd">{currentTool().num}</kbd>
        </div>

        {/* Selected Faces Indicator */}
        <Show
          when={props.selectedFaceCount > 0}
          fallback={
            <div class="status-item subtle-hint" title="Hold Ctrl and drag to isolate faces (Ctrl+A selects all)">
              <span class="status-text text-muted">
                <kbd class="status-kbd">Ctrl</kbd>+Drag isolate faces
              </span>
            </div>
          }
        >
          <button
            class="status-item status-btn selection-active"
            onClick={props.onClearFaceSelection}
            title="Click or press Esc / Ctrl+D to clear face selection"
          >
            <span class="status-dot amber" />
            <span class="status-text">
              {props.selectedFaceCount} face{props.selectedFaceCount > 1 ? 's' : ''} masked
            </span>
            <span class="status-tag">Esc to clear</span>
            <XIcon size={11} class="status-clear-icon" />
          </button>
        </Show>

        {/* Brush Spec pills (only for brush-like tools) */}
        <Show when={props.tool === 'brush' || props.tool === 'stamp' || props.tool === 'eraser'}>
          <div class="status-item tabular" title="Brush radius: [ / ] or Shift+Wheel or RMB+Drag">
            <span class="status-label">R:</span>
            <span class="status-value">{Math.round(brush.radius())}px</span>
          </div>
          <div class="status-item tabular" title="Brush opacity: Shift+RMB+Drag">
            <span class="status-label">Op:</span>
            <span class="status-value">{Math.round(brush.opacity() * 100)}%</span>
          </div>
        </Show>

        {/* Brush Texture Projection toggle pill */}
        <Show when={props.tool === 'brush' && brush.texturePath()}>
          <button
            type="button"
            class="status-item status-btn tabular"
            onClick={() => {
              const current = brush.textureMapping()
              const next = current === 'uv' ? 'triplanar' : current === 'triplanar' ? 'tip' : 'uv'
              setTextureMapping(next)
            }}
            title="Click to cycle texture projection: Direct UV -> World Triplanar -> Brush Tip"
          >
            <span class="status-label">Proj:</span>
            <span class="status-value font-medium">
              {brush.textureMapping() === 'uv'
                ? 'Direct UV'
                : brush.textureMapping() === 'triplanar'
                  ? 'Triplanar'
                  : 'Brush Tip'}
            </span>
          </button>
        </Show>

        {/* Fill Spec pills (scale when filling with texture) */}
        <Show when={props.tool === 'fill' && brush.texturePath()}>
          <div class="status-item tabular" title="Fill texture scale / tiling ([ / ] or Shift+Wheel to adjust)">
            <span class="status-label">Scale:</span>
            <span class="status-value">{brush.textureScale().toFixed(2)}x</span>
          </div>
        </Show>
      </div>

      {/* Center Area: Camera / Nav shortcuts & gestures */}
      <div class="status-bar-center">
        <Show when={props.tool === 'fill'}>
          <span class="status-shortcut-hint">
            <kbd class="status-kbd">Click</kbd> Fill {props.selectedFaceCount > 0 ? 'Selection' : 'Whole Model'}
          </span>
          <span class="status-sep">·</span>
        </Show>
        <span class="status-shortcut-hint" title="Middle Mouse Button drag or Alt+LMB drag">
          <kbd class="status-kbd">MMB</kbd> Orbit
        </span>
        <span class="status-sep">·</span>
        <span class="status-shortcut-hint" title="Shift + Middle Mouse Button drag or Alt+MMB drag">
          <kbd class="status-kbd">Shift</kbd>+<kbd>MMB</kbd> Pan
        </span>
        <span class="status-sep">·</span>
        <span class="status-shortcut-hint" title="Scroll wheel or Alt+RMB drag">
          <kbd class="status-kbd">Wheel</kbd> Zoom
        </span>
        <span class="status-sep">·</span>
        <button class="status-btn-link" onClick={props.onFrameCamera} title="Focus / Frame model (F or Home)">
          <FocusIcon size={11} />
          <span>Frame [F]</span>
        </button>
      </div>

      {/* Right Area: System Specs & Interactive Toggles */}
      <div class="status-bar-right">
        {/* Active Layer Status */}
        <div class="status-item tabular" title="Current active painting layer">
          <LayersIcon size={12} class="text-amber-400" />
          <span class="status-text truncate max-w-[120px]">{props.activeLayerName || 'Base Layer'}</span>
          <span class="status-sub">({props.layerCount ?? 1})</span>
        </div>

        {/* Canvas Resolution */}
        <div class="status-item tabular" title="Canvas texture resolution">
          <span class="status-value">
            {props.textureSize} × {props.textureSize}
          </span>
        </div>

        {/* Wireframe Toggle */}
        <button
          class="status-item status-btn"
          classList={{ active: props.wireframeVisible }}
          onClick={props.onToggleWireframe}
          title="Toggle Wireframe Overlay (W)"
        >
          <WireframeIcon size={12} />
          <span>Wire: {props.wireframeVisible ? 'On' : 'Off'}</span>
        </button>

        {/* Lighting Mode Selector */}
        <button
          class="status-item status-btn"
          onClick={props.onCycleLighting}
          title="Click to cycle viewport lighting preset"
        >
          <span>Light: {LIGHTING_LABELS[props.lightingMode] ?? 'Studio'}</span>
        </button>

        {/* Hotkey Guide Link */}
        <button
          class="status-item status-btn help-btn"
          onClick={props.onOpenHelp}
          title="View full hotkeys and keyboard guide (?)"
        >
          <HelpCircleIcon size={12} />
          <span>Hotkeys (?)</span>
        </button>
      </div>
    </footer>
  )
}
