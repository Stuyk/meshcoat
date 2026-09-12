import { createSignal, onMount, onCleanup, For } from 'solid-js'
import { brush, setTexturePath, type ToolMode } from '../paint/brush'
import {
  BrushIcon,
  EraserIcon,
  FillIcon,
  StampIcon,
  EyedropperIcon,
  LineIcon,
  RotateIcon,
  SymmetryIcon
} from './icons'
import { toAssetUrl } from '../utils/assetUrl'

export interface PieMenuProps {
  x: number
  y: number
  activeTool: ToolMode
  availableTextures?: string[]
  onSelectTool: (tool: ToolMode) => void
  onClose: () => void
}

interface ToolWedge {
  id: ToolMode
  name: string
  shortcut: string
  angleDeg: number // Centered angle in degrees
  icon: (props: { size?: number }) => any
}

const WEDGES: ToolWedge[] = [
  { id: 'brush', name: 'Brush', shortcut: 'B', angleDeg: 270, icon: (p) => <BrushIcon {...p} /> },
  { id: 'line', name: 'Line Tool', shortcut: 'L', angleDeg: 330, icon: (p) => <LineIcon {...p} /> },
  { id: 'stamp', name: 'Stamp', shortcut: 'S', angleDeg: 30, icon: (p) => <StampIcon {...p} /> },
  { id: 'eraser', name: 'Eraser', shortcut: 'E', angleDeg: 90, icon: (p) => <EraserIcon {...p} /> },
  { id: 'fill', name: 'Fill', shortcut: 'G', angleDeg: 150, icon: (p) => <FillIcon {...p} /> },
  { id: 'eyedropper', name: 'Picker', shortcut: 'I', angleDeg: 210, icon: (p) => <EyedropperIcon {...p} /> }
]

const QUICK_COLORS = [
  '#ffffff',
  '#94a3b8',
  '#1e293b',
  '#000000',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899'
]

export default function RadialPieMenu(props: PieMenuProps) {
  const [hoveredTool, setHoveredTool] = createSignal<ToolMode | null>(props.activeTool)
  let colorInputRef: HTMLInputElement | undefined

  const RADIUS_INNER = 42
  const RADIUS_OUTER = 98
  const WHEEL_SIZE = 240
  const WHEEL_HALF = WHEEL_SIZE / 2

  // Clamp popup position so it doesn't render partially outside screen edges
  const posX = () => Math.max(160, Math.min(window.innerWidth - 160, props.x))
  const posY = () => Math.max(140, Math.min(window.innerHeight - 230, props.y))

  function onMouseMove(e: MouseEvent) {
    const dx = e.clientX - posX()
    const dy = e.clientY - posY()
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 28) {
      // In deadzone center
      setHoveredTool(props.activeTool)
      return
    }

    if (dist > 125) {
      // Outside radial wheel (interacting with palette or textures strip below) —
      // clear the wedge highlight instead of leaving the last one stuck.
      setHoveredTool(null)
      return
    }

    // Angle in degrees from 0 to 360
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg < 0) deg += 360

    // Find closest wedge (60 degrees each)
    let closest: ToolWedge = WEDGES[0]
    let minDiff = 360

    for (const w of WEDGES) {
      let diff = Math.abs(deg - w.angleDeg)
      if (diff > 180) diff = 360 - diff
      if (diff < minDiff) {
        minDiff = diff
        closest = w
      }
    }
    setHoveredTool(closest.id)
  }

  function onClick(e: MouseEvent) {
    // If clicking on quick bar controls, ignore
    const target = e.target as HTMLElement | null
    if (target?.closest('.pie-hud-card')) {
      return
    }

    const t = hoveredTool()
    if (t) {
      props.onSelectTool(t)
    }
    props.onClose()
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      e.preventDefault()
      e.stopPropagation()
      const t = hoveredTool()
      if (t) {
        props.onSelectTool(t)
      }
      props.onClose()
    } else if (e.key === 'Escape') {
      props.onClose()
    }
  }

  onMount(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click', onClick)
    window.addEventListener('keyup', onKeyUp)
  })

  onCleanup(() => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('click', onClick)
    window.removeEventListener('keyup', onKeyUp)
  })

  // Generate SVG path for a 60-degree sector
  function getSectorPath(centerAngleDeg: number): string {
    const startAngle = ((centerAngleDeg - 29) * Math.PI) / 180
    const endAngle = ((centerAngleDeg + 29) * Math.PI) / 180

    const x1 = Math.cos(startAngle) * RADIUS_OUTER
    const y1 = Math.sin(startAngle) * RADIUS_OUTER
    const x2 = Math.cos(endAngle) * RADIUS_OUTER
    const y2 = Math.sin(endAngle) * RADIUS_OUTER

    const x3 = Math.cos(endAngle) * RADIUS_INNER
    const y3 = Math.sin(endAngle) * RADIUS_INNER
    const x4 = Math.cos(startAngle) * RADIUS_INNER
    const y4 = Math.sin(startAngle) * RADIUS_INNER

    return `M ${x1} ${y1} A ${RADIUS_OUTER} ${RADIUS_OUTER} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${RADIUS_INNER} ${RADIUS_INNER} 0 0 0 ${x4} ${y4} Z`
  }

  const quickTextures = () => {
    const recent = brush.recentTextures()
    const available = props.availableTextures ?? []
    const seen = new Set<string>()
    const list: string[] = []

    for (const p of recent) {
      if (!seen.has(p)) {
        seen.add(p)
        list.push(p)
      }
    }
    for (const p of available) {
      if (list.length >= 5) break
      if (!seen.has(p)) {
        seen.add(p)
        list.push(p)
      }
    }
    return list.slice(0, 5)
  }

  return (
    <div
      class="radial-pie-overlay"
      style={{
        left: `${posX() - WHEEL_HALF}px`,
        top: `${posY() - WHEEL_HALF}px`
      }}
    >
      <svg class="radial-pie-svg" width="240" height="240" viewBox="-120 -120 240 240">
        {/* Background glow circle */}
        <circle r="106" class="pie-bg-blur" />

        {/* Wedges */}
        <For each={WEDGES}>
          {(w) => {
            const isHovered = () => hoveredTool() === w.id
            const isActive = () => props.activeTool === w.id
            const rad = (w.angleDeg * Math.PI) / 180
            const iconDist = (RADIUS_INNER + RADIUS_OUTER) / 2
            const ix = Math.cos(rad) * iconDist
            const iy = Math.sin(rad) * iconDist

            return (
              <g
                class="pie-wedge-group"
                classList={{ hovered: isHovered(), active: isActive() }}
              >
                <path d={getSectorPath(w.angleDeg)} class="pie-wedge-path" />
                {/* Wedge Icon - positioned with transform */}
                <g transform={`translate(${ix - 11}, ${iy - 11})`} class="pie-wedge-icon">
                  {w.icon({ size: 22 })}
                </g>
              </g>
            )
          }}
        </For>

        {/* Center Hub */}
        <circle
          r="36"
          class="pie-center-circle"
          onClick={(e) => {
            e.stopPropagation()
            colorInputRef?.click()
          }}
        />
        <circle
          r="18"
          class="pie-center-color"
          style={{
            fill: brush.color()
          }}
          onClick={(e) => {
            e.stopPropagation()
            colorInputRef?.click()
          }}
        />
      </svg>

      {/* Floating Tool Label underneath center */}
      <div class="pie-tooltip-card">
        <span class="pie-tool-name">
          {WEDGES.find((w) => w.id === hoveredTool())?.name ?? 'Tool'}
        </span>
        <span class="pie-tool-key">
          [{WEDGES.find((w) => w.id === hoveredTool())?.shortcut}]
        </span>
      </div>

      {/* Quick Access HUD Card (Colors, Textures, Symmetry, Rotation) */}
      <div class="pie-hud-card" onClick={(e) => e.stopPropagation()}>
        {/* Row 1: Quick Color Swatches */}
        <div class="pie-hud-section">
          <span class="pie-hud-label">Color</span>
          <div class="pie-swatches-strip">
            <For each={QUICK_COLORS}>
              {(col) => (
                <button
                  type="button"
                  class="pie-swatch-dot"
                  classList={{ active: brush.color().toLowerCase() === col.toLowerCase() }}
                  style={{ 'background-color': col }}
                  title={`Select color: ${col}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    brush.setColor(col)
                  }}
                />
              )}
            </For>
            <label class="pie-custom-color-picker" title="Pick custom color">
              <input
                ref={colorInputRef}
                type="color"
                class="pie-hidden-input"
                value={brush.color()}
                onInput={(e) => brush.setColor(e.currentTarget.value)}
              />
              <span class="pie-custom-swatch-preview" style={{ 'background-color': brush.color() }} />
            </label>
          </div>
        </div>

        {/* Row 2: Recent 5 Textures */}
        <div class="pie-hud-section">
          <div class="pie-hud-label-row">
            <span class="pie-hud-label">Textures</span>
            <span class="pie-hud-sub">{brush.texturePath() ? 'Texture Active' : 'Solid Color'}</span>
          </div>
          <div class="pie-textures-strip">
            <button
              type="button"
              class="pie-tex-btn none-btn"
              classList={{ active: !brush.texturePath() }}
              title="Solid Color (No Texture)"
              onClick={(e) => {
                e.stopPropagation()
                setTexturePath(null)
              }}
            >
              <span>None</span>
            </button>
            <For each={quickTextures()}>
              {(texPath) => {
                const fileName = texPath.split('/').pop()?.split('\\').pop() ?? ''
                const isSelected = () => brush.texturePath() === texPath
                return (
                  <button
                    type="button"
                    class="pie-tex-btn"
                    classList={{ active: isSelected() }}
                    title={fileName}
                    onClick={(e) => {
                      e.stopPropagation()
                      setTexturePath(isSelected() ? null : texPath)
                    }}
                  >
                    <img src={toAssetUrl(texPath)} alt={fileName} />
                  </button>
                )
              }}
            </For>
          </div>
        </div>

        {/* Row 3: Symmetry & Brush Angle */}
        <div class="pie-hud-footer-row">
          {/* Symmetry Axis Picker */}
          <div class="pie-hud-sym-group">
            <div class="pie-hud-mini-label">
              <SymmetryIcon size={12} />
              <span>Symmetry</span>
            </div>
            <div class="pie-sym-chips">
              {(['off', 'x', 'y', 'z'] as const).map((axis) => (
                <button
                  type="button"
                  class="pie-sym-chip"
                  classList={{ active: brush.symmetryAxis() === axis }}
                  onClick={(e) => {
                    e.stopPropagation()
                    brush.setSymmetryAxis(axis)
                  }}
                >
                  {axis === 'off' ? 'Off' : axis.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Brush Rotation Quick Stepper */}
          <div class="pie-hud-rot-group">
            <div class="pie-hud-mini-label">
              <RotateIcon size={12} />
              <span>Angle: {Math.round(brush.brushRotation())}°</span>
            </div>
            <div class="pie-rot-stepper">
              <button
                type="button"
                class="pie-step-btn"
                title="Rotate -15° (Shift+R)"
                onClick={(e) => {
                  e.stopPropagation()
                  brush.setBrushRotation(brush.brushRotation() - 15)
                }}
              >
                -15°
              </button>
              <button
                type="button"
                class="pie-step-btn"
                title="Rotate +15° (R)"
                onClick={(e) => {
                  e.stopPropagation()
                  brush.setBrushRotation(brush.brushRotation() + 15)
                }}
              >
                +15°
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
