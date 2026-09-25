import { colorLibrary } from '../paint/colorLibrary'
import { PALETTE_PRESETS, type PalettePreset } from '../paint/palettePresets'
import { createSignal, onMount, onCleanup, For, Show, type JSX } from 'solid-js'
import { brush, setTexturePath, type ToolMode } from '../paint/brush'
import { brushPresets } from '../paint/brushPresets'
import {
  BrushIcon,
  EraserIcon,
  FillIcon,
  StampIcon,
  EyedropperIcon,
  LineIcon,
  GradientIcon,
  DropletsIcon,
  SparklesIcon,
  RotateIcon,
  SymmetryIcon
} from './icons'
import { toAssetUrl } from '../utils/assetUrl'
import { fileName as displayName } from '../utils/paths'

export interface PieMenuProps {
  x: number
  y: number
  activeTool: ToolMode
  availableTextures?: string[]
  isMaskTarget?: () => boolean
  onSelectTool: (tool: ToolMode) => void
  onClose: () => void
}

interface ToolWedge {
  id: ToolMode
  name: string
  shortcut: string
  angleDeg: number
  icon: (props: { size?: number }) => any
}

const WEDGES: ToolWedge[] = [
  { id: 'brush', name: 'Brush', shortcut: 'B', angleDeg: 270, icon: (p) => <BrushIcon {...p} /> },
  { id: 'line', name: 'Line Tool', shortcut: 'L', angleDeg: 315, icon: (p) => <LineIcon {...p} /> },
  { id: 'stamp', name: 'Stamp', shortcut: 'T', angleDeg: 0, icon: (p) => <StampIcon {...p} /> },
  { id: 'gradient', name: 'Gradient', shortcut: 'D', angleDeg: 45, icon: (p) => <GradientIcon {...p} /> },
  { id: 'eraser', name: 'Eraser', shortcut: 'E', angleDeg: 90, icon: (p) => <EraserIcon {...p} /> },
  { id: 'fill', name: 'Fill', shortcut: 'G', angleDeg: 135, icon: (p) => <FillIcon {...p} /> },
  { id: 'effect', name: 'Filters', shortcut: 'U', angleDeg: 180, icon: (p) => <DropletsIcon {...p} /> },
  {
    id: 'eyedropper',
    name: 'Eyedropper',
    shortcut: 'I',
    angleDeg: 225,
    icon: (p) => <EyedropperIcon {...p} />
  }
]

const PIE_PALETTE_KEY = 'meshcoat:pie_palette'

function loadPiePalette(): string {
  try {
    return localStorage.getItem(PIE_PALETTE_KEY) ?? 'essentials'
  } catch {
    return 'essentials'
  }
}

export default function RadialPieMenu(props: PieMenuProps) {
  const [hoveredTool, setHoveredTool] = createSignal<ToolMode | null>(props.activeTool)
  let colorInputRef: HTMLInputElement | undefined
  const [piePaletteId, setPiePaletteId] = createSignal(loadPiePalette())
  const piePalette = (): PalettePreset =>
    colorLibrary.customPalettes().find((p) => p.id === piePaletteId()) ??
    PALETTE_PRESETS.find((p) => p.id === piePaletteId()) ??
    PALETTE_PRESETS[0]

  onMount(() => void colorLibrary.hydrateColorLibrary())

  function PieSwatch(p: { color: string }): JSX.Element {
    return (
      <button
        type="button"
        class={`w-full aspect-square rounded-full border transition-transform cursor-pointer ${
          brush.color().toLowerCase() === p.color.toLowerCase()
            ? 'ring-2 ring-blue-500 scale-110 border-white'
            : 'border-white/20 hover:scale-110'
        }`}
        style={{ 'background-color': p.color }}
        title={p.color.toUpperCase()}
        onClick={(e) => {
          e.stopPropagation()
          brush.setColor(p.color)
        }}
      />
    )
  }

  const RADIUS_INNER = 42
  const RADIUS_OUTER = 98
  const WHEEL_SIZE = 240
  const WHEEL_HALF = WHEEL_SIZE / 2

  const posX = () => Math.max(160, Math.min(window.innerWidth - 160, props.x))
  const posY = () => Math.max(140, Math.min(window.innerHeight - 230, props.y))

  function onMouseMove(e: MouseEvent) {
    const dx = e.clientX - posX()
    const dy = e.clientY - posY()
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 28) {
      setHoveredTool(props.activeTool)
      return
    }

    if (dist > 125) {
      setHoveredTool(null)
      return
    }

    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg < 0) {
      deg += 360
    }

    let closest: ToolWedge = WEDGES[0]
    let minDiff = 360

    for (const w of WEDGES) {
      let diff = Math.abs(deg - w.angleDeg)
      if (diff > 180) {
        diff = 360 - diff
      }
      if (diff < minDiff) {
        minDiff = diff
        closest = w
      }
    }
    setHoveredTool(closest.id)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.code === 'Space') {
      e.preventDefault()
      props.onClose()
    }
  }

  onMount(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('keydown', onKeyDown)
  })

  onCleanup(() => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('keydown', onKeyDown)
  })

  function getSectorPath(centerAngleDeg: number) {
    const halfSweep = 21 * (Math.PI / 180)
    const centerRad = (centerAngleDeg * Math.PI) / 180
    const startRad = centerRad - halfSweep
    const endRad = centerRad + halfSweep

    const x1 = Math.cos(startRad) * RADIUS_INNER
    const y1 = Math.sin(startRad) * RADIUS_INNER
    const x2 = Math.cos(startRad) * RADIUS_OUTER
    const y2 = Math.sin(startRad) * RADIUS_OUTER
    const x3 = Math.cos(endRad) * RADIUS_OUTER
    const y3 = Math.sin(endRad) * RADIUS_OUTER
    const x4 = Math.cos(endRad) * RADIUS_INNER
    const y4 = Math.sin(endRad) * RADIUS_INNER

    return `M ${x1} ${y1} L ${x2} ${y2} A ${RADIUS_OUTER} ${RADIUS_OUTER} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${RADIUS_INNER} ${RADIUS_INNER} 0 0 0 ${x1} ${y1} Z`
  }

  const quickTextures = () => {
    const recents = brush.recentTextures()
    const available = props.availableTextures ?? []
    const list: string[] = []
    const seen = new Set<string>()

    for (const p of recents) {
      if (!seen.has(p)) {
        seen.add(p)
        list.push(p)
      }
    }
    for (const p of available) {
      if (!seen.has(p)) {
        seen.add(p)
        list.push(p)
      }
    }
    return list.slice(0, 5)
  }

  return (
    <>
      {/* Fullscreen transparent backdrop to catch clicks outside and dismiss */}
      <div
        class="fixed inset-0 z-40 bg-black/25"
        onClick={(e) => {
          e.stopPropagation()
          props.onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          props.onClose()
        }}
      />

      <div
        class="fixed z-50 pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-100"
        style={{
          left: `${posX() - WHEEL_HALF}px`,
          top: `${posY() - WHEEL_HALF}px`
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <svg width="240" height="240" viewBox="-120 -120 240 240" class="drop-shadow-2xl">
          {/* Background glow circle */}
          <circle
            r="106"
            fill="rgba(18, 18, 24, 0.88)"
            stroke="rgba(255, 255, 255, 0.1)"
            stroke-width="1"
          />

          {/* Wedges */}
          <For each={WEDGES}>
            {(w) => {
              const isHovered = () => hoveredTool() === w.id
              const isActive = () => props.activeTool === w.id
              const rad = (w.angleDeg * Math.PI) / 180
              const iconDist = (RADIUS_INNER + RADIUS_OUTER) / 2
              const ix = Math.cos(rad) * iconDist
              const iy = Math.sin(rad) * iconDist

              const wedgeFill = () => {
                if (isHovered()) {
                  return 'rgba(59, 130, 246, 0.5)'
                }
                if (isActive()) {
                  return 'rgba(59, 130, 246, 0.25)'
                }
                return 'rgba(30, 30, 40, 0.75)'
              }

              const wedgeStroke = () => {
                if (isHovered()) {
                  return '#60a5fa'
                }
                if (isActive()) {
                  return '#3b82f6'
                }
                return 'rgba(255, 255, 255, 0.12)'
              }

              return (
                <g
                  class="transition-all cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onSelectTool(w.id)
                  }}
                >
                  <path
                    d={getSectorPath(w.angleDeg)}
                    fill={wedgeFill()}
                    stroke={wedgeStroke()}
                    stroke-width="1.5"
                  />
                  <g
                    transform={`translate(${ix - 10}, ${iy - 10})`}
                    class={
                      isHovered() ? 'text-white' : isActive() ? 'text-blue-300' : 'text-zinc-300'
                    }
                  >
                    {w.icon({ size: 20 })}
                  </g>
                </g>
              )
            }}
          </For>

          {/* Center Hub */}
          <circle
            r="36"
            fill="rgba(24, 24, 32, 0.95)"
            stroke="rgba(255, 255, 255, 0.18)"
            stroke-width="1.5"
            class="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              colorInputRef?.click()
            }}
          />
          <circle
            r="18"
            style={{ fill: brush.color() }}
            stroke="rgba(255, 255, 255, 0.3)"
            stroke-width="1.5"
            class="cursor-pointer hover:scale-110 transition-transform"
            onClick={(e) => {
              e.stopPropagation()
              colorInputRef?.click()
            }}
          />
        </svg>

        {/* Floating Tool Label underneath center */}
        <Show when={WEDGES.find((w) => w.id === hoveredTool())}>
          {(wedge) => (
            <div class="absolute left-1/2 -translate-x-1/2 top-[125px] flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700 shadow-xl backdrop-blur-sm text-xs font-semibold text-zinc-100 whitespace-nowrap pointer-events-none">
              <span>{wedge().name}</span>
              <span class="font-mono text-[10px] text-zinc-400">[{wedge().shortcut}]</span>
            </div>
          )}
        </Show>

        {/* Quick Access HUD Card (Brush Library, Colors, Textures, Symmetry, Rotation) */}
        <div
          class="absolute left-1/2 -translate-x-1/2 top-[245px] w-[270px] p-2.5 bg-zinc-900/95 border border-zinc-750 rounded-xl shadow-2xl backdrop-blur-md flex flex-col gap-2.5 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Row 0: Brush Preset / Library Picker */}
          <div class="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div class="flex items-center gap-2 min-w-0">
              <div
                class="w-6 h-6 rounded bg-zinc-950 border border-zinc-700 flex items-center justify-center overflow-hidden shrink-0 shadow-xs"
                title="Current brush preset"
              >
                <Show
                  when={brush.tipTexturePath()}
                  fallback={<SparklesIcon size={13} class="text-amber-300" />}
                >
                  <img
                    src={toAssetUrl(brush.tipTexturePath()!)}
                    alt="Brush Tip"
                    class="w-full h-full object-contain p-0.5"
                  />
                </Show>
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-[11px] font-semibold text-zinc-200 truncate">
                  {brushPresets.active() ? brushPresets.active()!.name : 'Standard Round Tip'}
                </span>
                <span class="text-[10px] text-zinc-400 font-mono">
                  R: {brush.radius().toFixed(2)} · {Math.round(brush.opacity() * 100)}% Op
                </span>
              </div>
            </div>
            <button
              type="button"
              class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--accent-color)] text-[var(--accent-text)] font-semibold text-[11px] shadow-xs hover:brightness-110 active:brightness-95 transition-all cursor-pointer shrink-0"
              title="Open Brush Preset Library / Picker"
              onClick={(e) => {
                e.stopPropagation()
                props.onClose()
                brushPresets.openManager()
              }}
            >
              <SparklesIcon size={12} class="text-amber-300" />
              <span>Brushes</span>
            </button>
          </div>

          {/* Row 1: the artist's own saved colors, then a palette to pick from */}
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                Saved Colors
              </span>
              <label
                class="relative w-4 h-4 rounded-full border border-white/40 overflow-hidden cursor-pointer"
                title="Current color — click for the system color dialog"
              >
                <input
                  ref={colorInputRef}
                  type="color"
                  class="sr-only"
                  value={brush.color()}
                  onInput={(e) => brush.setColor(e.currentTarget.value)}
                />
                <span class="block w-full h-full" style={{ 'background-color': brush.color() }} />
              </label>
            </div>
            <Show
              when={colorLibrary.savedSwatches().length > 0}
              fallback={
                <span class="text-[10px] text-zinc-500 italic">
                  No saved colors yet — use Save in the color panel
                </span>
              }
            >
              <div class="grid grid-cols-12 gap-1">
                <For each={colorLibrary.savedSwatches().slice(0, 24)}>
                  {(col) => <PieSwatch color={col} />}
                </For>
              </div>
            </Show>
          </div>

          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                Palette
              </span>
              <select
                class="min-w-0 max-w-[150px] bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-200 cursor-pointer"
                value={piePalette().id}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  setPiePaletteId(e.currentTarget.value)
                  try {
                    localStorage.setItem(PIE_PALETTE_KEY, e.currentTarget.value)
                  } catch {
                    // Remembered choice is a convenience only.
                  }
                }}
              >
                <Show when={colorLibrary.customPalettes().length > 0}>
                  <optgroup label="My Palettes">
                    <For each={colorLibrary.customPalettes()}>
                      {(pal) => <option value={pal.id}>{pal.name}</option>}
                    </For>
                  </optgroup>
                </Show>
                <optgroup label="Built-in">
                  <For each={PALETTE_PRESETS}>
                    {(pal) => <option value={pal.id}>{pal.name}</option>}
                  </For>
                </optgroup>
              </select>
            </div>
            <div class="grid grid-cols-12 gap-1">
              <For each={piePalette().colors.slice(0, 24)}>
                {(col) => <PieSwatch color={col} />}
              </For>
            </div>
          </div>

          {/* Row 2: Recent 5 Textures */}
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-[10px]">
              <span class="font-semibold text-zinc-400 uppercase tracking-wider">Textures</span>
              <span class="text-zinc-500 font-mono">
                {brush.texturePath() ? 'Texture Active' : 'Solid Color'}
              </span>
            </div>
            <div class="flex items-center gap-1 overflow-x-auto pb-0.5">
              <button
                type="button"
                class={`px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                  !brush.texturePath()
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500/60'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                }`}
                title="Solid Color (No Texture)"
                onClick={(e) => {
                  e.stopPropagation()
                  setTexturePath(null)
                }}
              >
                None
              </button>
              <For each={quickTextures()}>
                {(texPath) => {
                  const label = displayName(texPath, '')
                  const isSelected = () => brush.texturePath() === texPath
                  return (
                    <button
                      type="button"
                      class={`w-6 h-6 rounded checkerboard-bg overflow-hidden border transition-transform cursor-pointer flex-shrink-0 ${
                        isSelected()
                          ? 'ring-2 ring-blue-500 border-white'
                          : 'border-zinc-700 hover:border-zinc-500'
                      }`}
                      title={label}
                      onClick={(e) => {
                        e.stopPropagation()
                        setTexturePath(isSelected() ? null : texPath, !props.isMaskTarget?.())
                      }}
                    >
                      <img
                        src={toAssetUrl(texPath)}
                        alt={label}
                        class="w-full h-full object-cover"
                      />
                    </button>
                  )
                }}
              </For>
            </div>
          </div>

          {/* Row 3: Symmetry & Brush Angle */}
          <div class="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800 text-[10px]">
            {/* Symmetry */}
            <div class="flex items-center gap-1">
              <span class="flex items-center gap-1 text-zinc-400">
                <SymmetryIcon size={12} />
                <span>Sym:</span>
              </span>
              <div class="flex items-center gap-0.5">
                {(['off', 'x', 'y', 'z'] as const).map((axis) => (
                  <button
                    type="button"
                    class={`px-1.5 py-0.5 rounded font-mono text-[10px] font-medium border transition-colors cursor-pointer ${
                      brush.symmetryAxis() === axis
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                    }`}
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

            {/* Angle */}
            <div class="flex items-center gap-1">
              <span class="flex items-center gap-1 text-zinc-400 font-mono">
                <RotateIcon size={12} />
                <span>{Math.round(brush.brushRotation())}°</span>
              </span>
              <div class="flex items-center gap-0.5">
                <button
                  type="button"
                  class="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-750 font-mono text-[10px] cursor-pointer"
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
                  class="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-750 font-mono text-[10px] cursor-pointer"
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
    </>
  )
}
