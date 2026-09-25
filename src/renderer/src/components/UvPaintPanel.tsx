import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import type { UvPanelApi } from '../viewport/viewportTypes'
import { FitIcon, WireframeIcon, RefreshCwIcon, XIcon } from './icons'
import { IconButton } from './ui'

export interface UvPaintPanelProps {
  api: UvPanelApi
  /** Bumped whenever layer pixels change elsewhere (3D strokes, undo, layer edits). */
  version: number
  /** Active piece index — a different piece is a different texture and unwrap. */
  pieceIndex: number
  textureSize: number
  onClose: () => void
}

/** Largest readback the panel asks for; the view scales it, and 4096² every frame is too slow. */
const MAX_DISPLAY = 1024
const MIN_ZOOM = 0.1
const MAX_ZOOM = 32

/**
 * 2D painting panel: the active piece's texture laid flat, painted on
 * directly with whatever tool is active.
 *
 * Everything the brush does still happens on the surface — the panel maps
 * each pointer UV back onto the model (see viewport/uvPaint.ts) — so dab
 * size, texture projection, symmetry and face restriction behave the same
 * as in the 3D view. What it adds is reach: faces the camera can't frame
 * (inside a sleeve, under a flap) and a view of seams and island layout.
 *
 * Left drag paints; middle or right drag pans; wheel zooms about the cursor.
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
  const [placed, setPlaced] = createSignal(false)

  let edges: Float32Array | null = null
  let painting = false
  let panning: { x: number; y: number } | null = null
  let dirty = true
  let raf = 0

  const displaySize = (): number => Math.min(props.textureSize || MAX_DISPLAY, MAX_DISPLAY)

  /** Size in CSS px of the square the whole 0-1 sheet occupies at zoom 1. */
  function baseSize(): number {
    if (!viewCanvas) {
      return 1
    }
    return Math.min(viewCanvas.clientWidth, viewCanvas.clientHeight) * 0.92
  }

  /** CSS-px origin of the sheet's top-left corner. */
  function origin(): { x: number; y: number; s: number } {
    const s = baseSize() * zoom()
    const cw = viewCanvas?.clientWidth ?? 0
    const ch = viewCanvas?.clientHeight ?? 0
    return { x: (cw - s) / 2 + pan().x, y: (ch - s) / 2 + pan().y, s }
  }

  function toUv(e: { clientX: number; clientY: number }): { u: number; v: number } {
    const rect = viewCanvas!.getBoundingClientRect()
    const o = origin()
    const u = (e.clientX - rect.left - o.x) / o.s
    // Canvas rows run top-down; UV v runs bottom-up.
    const v = 1 - (e.clientY - rect.top - o.y) / o.s
    return { u, v }
  }

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
    // Checkerboard under the sheet so transparency reads as transparency.
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
    ctx.imageSmoothingEnabled = zoom() * baseSize() < displaySize()
    ctx.drawImage(texCanvas, o.x, o.y, o.s, o.s)
    ctx.restore()

    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.s - 1, o.s - 1)

    if (showWire() && edges) {
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.45)'
      ctx.lineWidth = 0.75
      ctx.beginPath()
      for (let i = 0; i < edges.length; i += 4) {
        ctx.moveTo(o.x + edges[i] * o.s, o.y + (1 - edges[i + 1]) * o.s)
        ctx.lineTo(o.x + edges[i + 2] * o.s, o.y + (1 - edges[i + 3]) * o.s)
      }
      ctx.stroke()
    }
  }

  function frame(): void {
    raf = requestAnimationFrame(frame)
    if (painting) {
      dirty = true
    }
    if (dirty) {
      dirty = false
      refreshTexture()
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
    viewCanvas.setPointerCapture(e.pointerId)
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      panning = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button !== 0) {
      return
    }
    const { u, v } = toUv(e)
    painting = true
    props.api.pointerDown(u, v, e)
  }

  function onPointerMove(e: PointerEvent): void {
    if (panning) {
      const dx = e.clientX - panning.x
      const dy = e.clientY - panning.y
      panning = { x: e.clientX, y: e.clientY }
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
      return
    }
    if (painting) {
      // Coalesced events keep a fast stroke from turning into spaced dots.
      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ev of events.length ? events : [e]) {
        const { u, v } = toUv(ev)
        props.api.pointerMove(u, v, ev)
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    viewCanvas?.releasePointerCapture(e.pointerId)
    panning = null
    if (painting) {
      painting = false
      props.api.pointerUp()
      dirty = true
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (!viewCanvas) {
      return
    }
    const rect = viewCanvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const before = origin()
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom() * Math.exp(-e.deltaY * 0.0015)))
    // Keep the sheet point under the cursor fixed while zooming.
    const fx = (mx - before.x) / before.s
    const fy = (my - before.y) / before.s
    setZoom(next)
    const after = origin()
    setPan((p) => ({
      x: p.x + (mx - (after.x + fx * after.s)),
      y: p.y + (my - (after.y + fy * after.s))
    }))
  }

  // Header drag moves the floating panel.
  function onHeaderDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button')) {
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
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  createEffect(() => {
    void props.version
    dirty = true
  })

  createEffect(() => {
    void props.pieceIndex
    void props.textureSize
    edges = props.api.edges()
    dirty = true
  })

  createEffect(() => {
    void zoom()
    void pan()
    void showWire()
    dirty = true
  })

  onMount(() => {
    if (root) {
      // Set once, not bound in the style: re-applying it on every move would
      // undo whatever size the user dragged the panel to.
      root.style.width = '480px'
      root.style.height = '520px'
    }
    if (!placed()) {
      setPos({
        x: Math.max(16, window.innerWidth - 520),
        y: Math.max(56, window.innerHeight - 580)
      })
      setPlaced(true)
    }
    const ro = new ResizeObserver(() => {
      dirty = true
    })
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

  return (
    <div
      ref={root}
      class="fixed z-40 flex flex-col rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-2xl overflow-hidden"
      style={{
        left: `${pos().x}px`,
        top: `${pos().y}px`,
        resize: 'both',
        'min-width': '260px',
        'min-height': '240px'
      }}
    >
      <div
        class="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] cursor-move select-none"
        onPointerDown={onHeaderDown}
      >
        <span class="text-xs font-semibold text-[var(--text-main)]">2D Paint</span>
        <span class="text-[10px] text-[var(--text-muted)]">
          {props.textureSize}px · {Math.round(zoom() * 100)}%
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
          <IconButton size="xs" onClick={() => (dirty = true)} tooltip="Refresh">
            <RefreshCwIcon size={13} />
          </IconButton>
          <IconButton size="xs" onClick={fit} tooltip="Fit sheet">
            <FitIcon size={13} />
          </IconButton>
          <IconButton size="xs" onClick={props.onClose} tooltip="Close 2D panel">
            <XIcon size={13} />
          </IconButton>
        </div>
      </div>
      <div ref={wrap} class="relative flex-1 min-h-0 bg-[var(--bg-app,#111)]">
        <canvas
          ref={viewCanvas}
          class="absolute inset-0 w-full h-full touch-none cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      <div class="px-2 py-1 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">
        Left drag: paint with active tool · Right/middle drag: pan · Wheel: zoom
      </div>
    </div>
  )
}
