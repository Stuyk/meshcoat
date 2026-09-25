import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import type { UvPanelApi } from '../viewport/viewportTypes'
import { brush, setOpacity, setHardness } from '../paint/brush'
import { FitIcon, WireframeIcon, XIcon } from './icons'
import { IconButton, Slider } from './ui'
import { loadLayoutProfile, saveLayoutProfile } from '../utils/layoutProfile'

export interface UvPaintPanelProps {
  api: UvPanelApi
  /** Bumped whenever layer pixels change elsewhere (3D strokes, undo, layer edits). */
  version: number
  /** Active piece index — a different piece is a different texture and unwrap. */
  pieceIndex: number
  textureSize: number
  /** Active tool id, for the cursor and the toolbar readout. */
  tool: string
  onClose: () => void
}

/** Largest readback the panel asks for; the view scales it, and 4096² every frame is too slow. */
const MAX_DISPLAY = 1024
const MIN_ZOOM = 0.1
const MAX_ZOOM = 64
const SIZE_KEY = 'meshcoat:uv_brush_px'

const TOOL_LABELS: Record<string, string> = {
  brush: 'Brush',
  stamp: 'Stamp',
  eraser: 'Eraser',
  effect: 'Effect',
  fill: 'Fill',
  eyedropper: 'Eyedropper',
  faceSelect: 'Face Select',
  faceProjector: 'Face Projector',
  text: 'Text',
  line: 'Line'
}
/** Tools that lay down a round dab, and so get a sized brush cursor. */
const DAB_TOOLS = new Set(['brush', 'stamp', 'eraser', 'effect'])

function loadSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY))
    return n > 0 ? n : 24
  } catch {
    return 24
  }
}

/**
 * 2D painting panel: the active piece's texture laid flat and painted on
 * directly, the way a 2D paint app works — dabs are circles on the sheet,
 * sized in texels, and the cursor shows exactly what will be covered.
 *
 * Controls: left drag paints; middle drag or Space + drag pans; wheel zooms
 * about the cursor; right drag, Ctrl+wheel or [ / ] resizes the brush; F fits.
 */
export default function UvPaintPanel(props: UvPaintPanelProps): JSX.Element {
  let viewCanvas: HTMLCanvasElement | undefined
  let wrap: HTMLDivElement | undefined
  let root: HTMLDivElement | undefined
  const texCanvas = document.createElement('canvas')
  const texCtx = texCanvas.getContext('2d')

  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [showWire, setShowWire] = createSignal(true)
  const [pos, setPos] = createSignal({ x: 0, y: 0 })
  const [sizePx, setSizePxRaw] = createSignal(loadSize())
  const [hover, setHover] = createSignal<{ x: number; y: number; u: number; v: number } | null>(
    null
  )
  const [spaceDown, setSpaceDown] = createSignal(false)
  const [isPanning, setIsPanning] = createSignal(false)

  let edges: Float32Array | null = null
  let painting = false
  let panning: { x: number; y: number } | null = null
  let resizing: { x: number; start: number } | null = null
  let texDirty = true
  let viewDirty = true
  let raf = 0
  let lastReadback = 0

  const maxSize = (): number => Math.max(8, Math.round((props.textureSize || 2048) / 4))
  const setSizePx = (n: number): void => {
    const clamped = Math.round(Math.min(maxSize(), Math.max(1, n)))
    setSizePxRaw(clamped)
    viewDirty = true
    try {
      localStorage.setItem(SIZE_KEY, String(clamped))
    } catch {
      // Size is a per-machine convenience; losing it is harmless.
    }
  }

  const displaySize = (): number => Math.min(props.textureSize || MAX_DISPLAY, MAX_DISPLAY)

  /** Size in CSS px of the square the whole 0-1 sheet occupies at zoom 1. */
  function baseSize(): number {
    if (!viewCanvas) {
      return 1
    }
    return Math.min(viewCanvas.clientWidth, viewCanvas.clientHeight) * 0.92
  }

  /** CSS-px origin and side length of the sheet. */
  function origin(): { x: number; y: number; s: number } {
    const s = baseSize() * zoom()
    const cw = viewCanvas?.clientWidth ?? 0
    const ch = viewCanvas?.clientHeight ?? 0
    return { x: (cw - s) / 2 + pan().x, y: (ch - s) / 2 + pan().y, s }
  }

  function local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = viewCanvas!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function toUv(e: { clientX: number; clientY: number }): { u: number; v: number } {
    const p = local(e)
    const o = origin()
    // Canvas rows run top-down; UV v runs bottom-up.
    return { u: (p.x - o.x) / o.s, v: 1 - (p.y - o.y) / o.s }
  }

  /** Brush radius on screen, in CSS px. */
  const screenRadius = (): number => (sizePx() / (props.textureSize || 2048)) * origin().s

  function refreshTexture(): void {
    if (!texCtx) {
      return
    }
    const size = displaySize()
    if (texCanvas.width !== size) {
      texCanvas.width = size
      texCanvas.height = size
    }
    props.api.renderInto(texCtx, size)
  }

  function drawCursor(ctx: CanvasRenderingContext2D): void {
    const h = hover()
    if (!h || panning || spaceDown()) {
      return
    }
    if (!DAB_TOOLS.has(props.tool)) {
      // Point tools: a precise crosshair on the texel that will be sampled/filled.
      ctx.beginPath()
      ctx.moveTo(h.x - 8, h.y)
      ctx.lineTo(h.x + 8, h.y)
      ctx.moveTo(h.x, h.y - 8)
      ctx.lineTo(h.x, h.y + 8)
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.stroke()
      return
    }
    const r = Math.max(1, screenRadius())
    const color = props.tool === 'eraser' ? '#ffffff' : brush.color()
    ctx.save()
    // Soft preview of coverage, in the paint color.
    ctx.globalAlpha = 0.18
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    // Outer edge: dark + light rings so it reads on any texture.
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'
    ctx.stroke()
    ctx.lineWidth = 1.25
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    // Hardness: where the falloff begins.
    const inner = r * brush.hardness()
    if (inner > 2 && inner < r - 2) {
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.arc(h.x, h.y, inner, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.fillStyle = '#fff'
    ctx.fillRect(h.x - 1, h.y - 1, 2, 2)
    ctx.restore()
  }

  function draw(): void {
    const canvas = viewCanvas
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)

    const o = origin()
    ctx.save()
    ctx.beginPath()
    ctx.rect(o.x, o.y, o.s, o.s)
    ctx.clip()
    const cell = 12
    for (let y = Math.floor(o.y / cell) * cell; y < o.y + o.s; y += cell) {
      for (let x = Math.floor(o.x / cell) * cell; x < o.x + o.s; x += cell) {
        ctx.fillStyle = ((x + y) / cell) % 2 === 0 ? '#2a2a2e' : '#1f1f23'
        ctx.fillRect(x, y, cell, cell)
      }
    }
    // Crisp texels once zoomed past 1:1, smooth when shrunk.
    ctx.imageSmoothingEnabled = o.s < displaySize()
    ctx.drawImage(texCanvas, o.x, o.y, o.s, o.s)
    ctx.restore()

    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.s - 1, o.s - 1)

    if (showWire() && edges) {
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)'
      ctx.lineWidth = 0.75
      ctx.beginPath()
      for (let i = 0; i < edges.length; i += 4) {
        ctx.moveTo(o.x + edges[i] * o.s, o.y + (1 - edges[i + 1]) * o.s)
        ctx.lineTo(o.x + edges[i + 2] * o.s, o.y + (1 - edges[i + 3]) * o.s)
      }
      ctx.stroke()
    }

    drawCursor(ctx)
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    // Mid-stroke, the readback is the expensive part: ~30 fps is plenty.
    if (painting && now - lastReadback > 33) {
      texDirty = true
    }
    if (texDirty) {
      texDirty = false
      lastReadback = now
      refreshTexture()
      viewDirty = true
    }
    if (viewDirty) {
      viewDirty = false
      draw()
    }
  }

  function fit(): void {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function onPointerDown(e: PointerEvent): void {
    if (!viewCanvas) {
      return
    }
    viewCanvas.focus()
    viewCanvas.setPointerCapture(e.pointerId)
    if (e.button === 1 || (e.button === 0 && spaceDown())) {
      e.preventDefault()
      panning = { x: e.clientX, y: e.clientY }
      setIsPanning(true)
      viewDirty = true
      return
    }
    if (e.button === 2) {
      e.preventDefault()
      resizing = { x: e.clientX, start: sizePx() }
      return
    }
    if (e.button !== 0) {
      return
    }
    const { u, v } = toUv(e)
    painting = true
    props.api.pointerDown(u, v, e, sizePx())
    texDirty = true
  }

  function onPointerMove(e: PointerEvent): void {
    const p = local(e)
    const { u, v } = toUv(e)
    if (resizing) {
      // Horizontal drag scales the brush; the cursor stays put so the ring
      // visibly grows around it.
      setSizePx(resizing.start * Math.exp((e.clientX - resizing.x) * 0.01))
      const h = hover()
      if (h) {
        props.api.hover({ u: h.u, v: h.v, radiusPx: sizePx() })
      }
      return
    }
    setHover({ x: p.x, y: p.y, u, v })
    props.api.hover({ u, v, radiusPx: sizePx() })
    viewDirty = true
    if (panning) {
      const dx = e.clientX - panning.x
      const dy = e.clientY - panning.y
      panning = { x: e.clientX, y: e.clientY }
      setPan((q) => ({ x: q.x + dx, y: q.y + dy }))
      return
    }
    if (painting) {
      // Coalesced events keep a fast stroke's path, not just its endpoints.
      const events = e.getCoalescedEvents?.() ?? []
      for (const ev of events.length ? events : [e]) {
        const uv = toUv(ev)
        props.api.pointerMove(uv.u, uv.v, ev, sizePx())
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    try {
      viewCanvas?.releasePointerCapture(e.pointerId)
    } catch {
      // Capture was already released (pointer cancelled).
    }
    panning = null
    setIsPanning(false)
    resizing = null
    if (painting) {
      painting = false
      props.api.pointerUp()
      texDirty = true
    }
    viewDirty = true
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (!viewCanvas) {
      return
    }
    if (e.ctrlKey || e.altKey) {
      setSizePx(sizePx() * Math.exp(-e.deltaY * 0.002))
      return
    }
    const p = local(e)
    const before = origin()
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom() * Math.exp(-e.deltaY * 0.0015)))
    // Keep the sheet point under the cursor fixed while zooming.
    const fx = (p.x - before.x) / before.s
    const fy = (p.y - before.y) / before.s
    setZoom(next)
    const after = origin()
    setPan((q) => ({
      x: q.x + (p.x - (after.x + fx * after.s)),
      y: q.y + (p.y - (after.y + fy * after.s))
    }))
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Handled only while the panel has focus, so they never fight the 3D hotkeys.
    if (e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      setSpaceDown(true)
      viewDirty = true
    } else if (e.key === '[') {
      e.stopPropagation()
      setSizePx(sizePx() / 1.15)
    } else if (e.key === ']') {
      e.stopPropagation()
      setSizePx(sizePx() * 1.15)
    } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
      e.stopPropagation()
      fit()
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') {
      e.stopPropagation()
      setSpaceDown(false)
      viewDirty = true
    }
  }

  // Header drag moves the floating panel.
  function onHeaderDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button, input')) {
      return
    }
    e.preventDefault()
    const start = { x: e.clientX - pos().x, y: e.clientY - pos().y }
    const move = (ev: PointerEvent): void => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - start.x)),
        y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - start.y))
      })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      saveLayoutProfile({ uvPanelX: pos().x, uvPanelY: pos().y })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  createEffect(() => {
    void props.version
    texDirty = true
  })

  createEffect(() => {
    void props.pieceIndex
    void props.textureSize
    edges = props.api.edges()
    texDirty = true
  })

  createEffect(() => {
    void zoom()
    void pan()
    void showWire()
    void props.tool
    void brush.color()
    void brush.hardness()
    viewDirty = true
  })

  onMount(() => {
    const profile = loadLayoutProfile()
    const targetW = profile.uvPanelWidth || 560
    const targetH = profile.uvPanelHeight || 640

    if (root) {
      root.style.width = `${targetW}px`
      root.style.height = `${targetH}px`
    }

    const defaultX = Math.max(16, window.innerWidth - targetW - 40)
    const defaultY = Math.max(56, window.innerHeight - targetH - 60)
    setPos({
      x: profile.uvPanelX !== null ? Math.min(profile.uvPanelX, window.innerWidth - 100) : defaultX,
      y: profile.uvPanelY !== null ? Math.min(profile.uvPanelY, window.innerHeight - 60) : defaultY
    })

    const ro = new ResizeObserver(() => {
      viewDirty = true
      if (root && root.clientWidth > 0 && root.clientHeight > 0) {
        saveLayoutProfile({
          uvPanelWidth: root.clientWidth,
          uvPanelHeight: root.clientHeight
        })
      }
    })
    if (root) {
      ro.observe(root)
    }
    if (wrap) {
      ro.observe(wrap)
    }
    raf = requestAnimationFrame(frame)
    onCleanup(() => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      if (painting) {
        props.api.pointerUp()
      }
    })
  })

  const hoverTexel = (): string => {
    const h = hover()
    if (!h || h.u < 0 || h.u > 1 || h.v < 0 || h.v > 1) {
      return ''
    }
    const size = props.textureSize || 2048
    return `${Math.floor(h.u * size)}, ${Math.floor((1 - h.v) * size)}`
  }

  const previewDot = (): number => Math.max(3, Math.min(30, sizePx() / 2))

  return (
    <div
      ref={root}
      class="fixed z-40 flex flex-col rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-2xl overflow-hidden"
      style={{
        left: `${pos().x}px`,
        top: `${pos().y}px`,
        resize: 'both',
        'min-width': '400px',
        'min-height': '340px'
      }}
    >
      {/* Title bar */}
      <div
        class="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] cursor-move select-none"
        onPointerDown={onHeaderDown}
      >
        <span class="text-xs font-semibold text-[var(--text-main)]">2D Paint</span>
        <span class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-medium text-zinc-300">
          {TOOL_LABELS[props.tool] ?? props.tool}
        </span>
        <div class="ml-auto flex items-center gap-1">
          <IconButton
            size="xs"
            active={showWire()}
            onClick={() => setShowWire((v) => !v)}
            tooltip="Show UV wireframe"
          >
            <WireframeIcon size={13} />
          </IconButton>
          <IconButton size="xs" onClick={fit} tooltip="Fit sheet (F)">
            <FitIcon size={13} />
          </IconButton>
          <IconButton size="xs" onClick={props.onClose} tooltip="Close 2D panel">
            <XIcon size={13} />
          </IconButton>
        </div>
      </div>

      {/* Brush bar: what you're painting with, and how big */}
      <div class="flex items-center gap-3 px-2.5 py-2 border-b border-[var(--border-color)] select-none">
        <div
          class="w-9 h-9 shrink-0 rounded-md bg-zinc-900 border border-zinc-700 flex items-center justify-center overflow-hidden"
          title={
            props.tool === 'eraser'
              ? 'Eraser'
              : `Paint color ${brush.color().toUpperCase()} · size and softness preview`
          }
        >
          <div
            class="rounded-full"
            style={{
              width: `${previewDot()}px`,
              height: `${previewDot()}px`,
              background: `radial-gradient(circle, ${
                props.tool === 'eraser' ? '#ffffff' : brush.color()
              } ${Math.round(brush.hardness() * 70)}%, transparent 71%)`
            }}
          />
        </div>
        <div class="grid grid-cols-3 gap-3 flex-1 min-w-0">
          <Slider
            label="Size"
            value={sizePx()}
            min={1}
            max={maxSize()}
            step={1}
            unit="px"
            onChange={setSizePx}
            title="Brush radius in texture pixels ([ / ], right drag, Ctrl+wheel)"
          />
          <Slider
            label="Opacity"
            value={brush.opacity()}
            min={0}
            max={1}
            step={0.01}
            displayValue={(v) => `${Math.round(v * 100)}%`}
            onChange={setOpacity}
          />
          <Slider
            label="Hardness"
            value={brush.hardness()}
            min={0}
            max={1}
            step={0.01}
            displayValue={(v) => `${Math.round(v * 100)}%`}
            onChange={setHardness}
          />
        </div>
      </div>

      <div ref={wrap} class="relative flex-1 min-h-0 bg-[#141416]">
        <canvas
          ref={viewCanvas}
          tabIndex={0}
          class="absolute inset-0 w-full h-full touch-none outline-none"
          style={{
            cursor:
              spaceDown() || isPanning() ? 'grab' : DAB_TOOLS.has(props.tool) ? 'none' : 'crosshair'
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            setHover(null)
            props.api.hover(null)
            viewDirty = true
          }}
          onPointerEnter={() => viewCanvas?.focus({ preventScroll: true })}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <div class="flex items-center gap-3 px-2.5 py-1 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)] select-none">
        <span>
          {props.textureSize}px · {Math.round(zoom() * 100)}%
        </span>
        <Show when={hoverTexel()}>
          <span class="font-mono">px {hoverTexel()}</span>
        </Show>
        <span class="ml-auto truncate">
          Paint: drag · Pan: middle / Space+drag · Zoom: wheel · Size: right drag, [ ]
        </span>
      </div>
    </div>
  )
}
