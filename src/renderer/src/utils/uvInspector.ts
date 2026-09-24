/**
 * Pops a texture out into its own OS window, shown at full resolution in UV
 * space.
 *
 * A 28px thumbnail in the layers panel is enough to tell two layers apart and
 * nothing more — it cannot answer "did the stamp land where I think it did",
 * "is this mask actually covering that seam", or "why is this island empty".
 * Those are questions about the sheet itself, so this shows the sheet itself:
 * one window per layer, fitted on open, over a checkerboard so transparency is
 * visible rather than guessed, with the texel and UV under the cursor readable
 * at the bottom.
 *
 * The window is a real child window (see main/index.ts, which allows blank
 * popups), not an in-app modal, so several can sit open on a second monitor
 * while painting continues in the main window.
 *
 * IMPORTANT — why there is no <script> in the popup: index.html sets
 * `script-src 'self'`, and a popup inherits its opener's CSP, so any inline
 * script written into this document is blocked outright. Everything below is
 * therefore wired from THIS realm: we write markup and CSS (style-src allows
 * inline), then attach listeners and hold the view state here. That also means
 * the popup needs no privileges of its own.
 */

/** What a popout shows, and how to re-read it when the user asks to refresh. */
export interface InspectSource {
  /**
   * Stable identity for this popout. Re-inspecting the same thing focuses and
   * refreshes the existing window instead of stacking up duplicates.
   */
  key: string
  title: string
  /** Shown under the title — piece name, channel, resolution. */
  subtitle: string
  /** Re-reads the pixels. Undefined means "nothing painted in this channel". */
  render: () => string | undefined
}

/** The live view state of one popout, owned by this realm. */
interface Inspector {
  win: Window
  source: InspectSource
  img: HTMLImageElement
  wrap: HTMLElement
  stage: HTMLElement
  zoomLabel: HTMLElement
  coords: HTMLElement
  titleEl: HTMLElement
  subtitleEl: HTMLElement
  scale: number
  panX: number
  panY: number
  fitted: boolean
}

const inspectors = new Map<string, Inspector>()

/** Markup + CSS only. No script: see the CSP note in this file's header. */
const DOCUMENT_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Layer Inspector</title>
<style>
  :root {
    --bg: #141416;
    --panel: #1c1c20;
    --border: #2e2e34;
    --text: #e4e4e7;
    --muted: #8b8b94;
    --accent: #60a5fa;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
  }
  .meta { min-width: 0; flex: 1; }
  .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .subtitle { color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; }
  .tools { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
  button {
    background: #26262b;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 9px;
    font: inherit;
    cursor: pointer;
  }
  button:hover { background: #32323a; border-color: #43434d; }
  .zoom {
    font-family: ui-monospace, monospace;
    color: var(--muted);
    min-width: 54px;
    text-align: center;
  }
  #stage { flex: 1; position: relative; overflow: hidden; cursor: grab; }
  #stage.dragging { cursor: grabbing; }
  #wrap {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    /* 8px checkerboard, so an empty (transparent) island is unmistakable. */
    background-image:
      linear-gradient(45deg, #232327 25%, transparent 25%, transparent 75%, #232327 75%),
      linear-gradient(45deg, #232327 25%, transparent 25%, transparent 75%, #232327 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
    background-color: #191919;
    box-shadow: 0 0 0 1px var(--border);
  }
  /* Pixelated, because the point of zooming in here is to see individual texels. */
  #img { display: block; image-rendering: pixelated; }
  #empty {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    text-align: center;
    padding: 24px;
  }
  body.empty #empty { display: flex; }
  body.empty #wrap { display: none; }
  footer {
    flex: 0 0 auto;
    padding: 5px 12px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  kbd {
    background: #26262b;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 4px;
    font-family: ui-monospace, monospace;
  }
</style>
</head>
<body>
  <header>
    <div class="meta">
      <div class="title" id="title">Layer</div>
      <div class="subtitle" id="subtitle"></div>
    </div>
    <div class="tools">
      <button id="fit" title="Fit the whole sheet in the window (F)">Fit</button>
      <button id="one" title="One screen pixel per texel (1)">1:1</button>
      <button id="out" title="Zoom out (-)">&minus;</button>
      <span class="zoom" id="zoom">100%</span>
      <button id="in" title="Zoom in (+)">+</button>
      <button id="refresh" title="Re-read the pixels from the app (R)">Refresh</button>
    </div>
  </header>
  <div id="stage">
    <div id="wrap"><img id="img" alt="" /></div>
    <div id="empty">Nothing painted here yet.</div>
  </div>
  <footer>
    <span>Drag to pan &middot; wheel to zoom &middot; <kbd>F</kbd> fit &middot; <kbd>1</kbd> actual &middot; <kbd>R</kbd> refresh</span>
    <span id="coords"></span>
  </footer>
</body>
</html>`

const MIN_SCALE = 0.02
const MAX_SCALE = 32

function applyTransform(it: Inspector): void {
  it.wrap.style.transform = `translate(${it.panX}px,${it.panY}px) scale(${it.scale})`
  it.zoomLabel.textContent = `${Math.round(it.scale * 100)}%`
}

function fit(it: Inspector): void {
  if (!it.img.naturalWidth) {
    return
  }
  const pad = 24
  const sx = (it.stage.clientWidth - pad) / it.img.naturalWidth
  const sy = (it.stage.clientHeight - pad) / it.img.naturalHeight
  it.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(sx, sy)))
  it.panX = (it.stage.clientWidth - it.img.naturalWidth * it.scale) / 2
  it.panY = (it.stage.clientHeight - it.img.naturalHeight * it.scale) / 2
  applyTransform(it)
}

function actualSize(it: Inspector): void {
  it.scale = 1
  it.panX = (it.stage.clientWidth - it.img.naturalWidth) / 2
  it.panY = (it.stage.clientHeight - it.img.naturalHeight) / 2
  applyTransform(it)
}

/** Zoom toward a point, so the texel under the cursor stays under the cursor. */
function zoomAt(it: Inspector, factor: number, cx: number, cy: number): void {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, it.scale * factor))
  const k = next / it.scale
  it.panX = cx - (cx - it.panX) * k
  it.panY = cy - (cy - it.panY) * k
  it.scale = next
  applyTransform(it)
}

function build(win: Window, key: string): Inspector | null {
  win.document.open()
  win.document.write(DOCUMENT_HTML)
  win.document.close()

  const doc = win.document
  const pick = <T extends HTMLElement>(id: string): T | null => doc.getElementById(id) as T | null
  const stage = pick('stage')
  const wrap = pick('wrap')
  const img = pick<HTMLImageElement>('img')
  const zoomLabel = pick('zoom')
  const coords = pick('coords')
  const titleEl = pick('title')
  const subtitleEl = pick('subtitle')
  if (!stage || !wrap || !img || !zoomLabel || !coords || !titleEl || !subtitleEl) {
    return null
  }

  const it: Inspector = {
    win,
    // Replaced by the caller straight after; a source is always pushed before
    // the window is shown anything.
    source: { key, title: '', subtitle: '', render: () => undefined },
    img,
    wrap,
    stage,
    zoomLabel,
    coords,
    titleEl,
    subtitleEl,
    scale: 1,
    panX: 0,
    panY: 0,
    fitted: false
  }

  const center = (): [number, number] => [stage.clientWidth / 2, stage.clientHeight / 2]
  pick<HTMLButtonElement>('fit')!.onclick = () => fit(it)
  pick<HTMLButtonElement>('one')!.onclick = () => actualSize(it)
  pick<HTMLButtonElement>('in')!.onclick = () => zoomAt(it, 1.25, ...center())
  pick<HTMLButtonElement>('out')!.onclick = () => zoomAt(it, 0.8, ...center())
  pick<HTMLButtonElement>('refresh')!.onclick = () => push(it)

  stage.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      zoomAt(it, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top)
    },
    { passive: false }
  )

  let dragging = false
  let lastX = 0
  let lastY = 0
  stage.addEventListener('pointerdown', (e: PointerEvent) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    stage.classList.add('dragging')
    stage.setPointerCapture(e.pointerId)
  })
  stage.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = stage.getBoundingClientRect()
    // Texel under the cursor, plus its UV — a UV question is usually "which
    // texel is this, and where is it in 0-1".
    const tx = Math.floor((e.clientX - rect.left - it.panX) / it.scale)
    const ty = Math.floor((e.clientY - rect.top - it.panY) / it.scale)
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w && tx >= 0 && ty >= 0 && tx < w && ty < h) {
      // v is flipped: the image's top row is v = 1.
      coords.textContent = `${tx}, ${ty}   u ${(tx / w).toFixed(3)}  v ${(1 - ty / h).toFixed(3)}`
    } else {
      coords.textContent = ''
    }
    if (!dragging) {
      return
    }
    it.panX += e.clientX - lastX
    it.panY += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    applyTransform(it)
  })
  const endDrag = (e: PointerEvent): void => {
    dragging = false
    stage.classList.remove('dragging')
    if (stage.hasPointerCapture(e.pointerId)) {
      stage.releasePointerCapture(e.pointerId)
    }
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)

  win.addEventListener('keydown', (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (k === 'f') {
      fit(it)
    } else if (k === '1') {
      actualSize(it)
    } else if (k === 'r') {
      push(it)
    } else if (e.key === '+' || e.key === '=') {
      zoomAt(it, 1.25, ...center())
    } else if (e.key === '-') {
      zoomAt(it, 0.8, ...center())
    }
  })

  img.addEventListener('load', () => {
    wrap.style.width = `${img.naturalWidth}px`
    wrap.style.height = `${img.naturalHeight}px`
    // Fit once, on the first image. A refresh must not throw away the zoom and
    // pan the viewer set up to look at a specific island.
    if (!it.fitted) {
      it.fitted = true
      fit(it)
    }
  })

  // A closed window's entry is dead weight, and its render closure pins the
  // piece it came from.
  win.addEventListener('pagehide', () => inspectors.delete(key))

  return it
}

/** Re-reads the pixels and updates one popout's image and captions. */
function push(it: Inspector): void {
  if (it.win.closed) {
    inspectors.delete(it.source.key)
    return
  }
  const url = it.source.render()
  it.titleEl.textContent = it.source.title
  it.subtitleEl.textContent = it.source.subtitle
  it.win.document.title = `${it.source.title} — Layer Inspector`
  if (url) {
    it.win.document.body.classList.remove('empty')
    it.img.src = url
  } else {
    it.win.document.body.classList.add('empty')
    it.img.removeAttribute('src')
  }
}

/**
 * Opens (or focuses and refreshes) the popout for `source`.
 *
 * Returns false when no window could be created or built, which in practice
 * means the popup was blocked — the caller should say so rather than appear to
 * do nothing.
 */
export function openUvInspector(source: InspectSource): boolean {
  const existing = inspectors.get(source.key)
  if (existing && !existing.win.closed) {
    existing.source = source
    existing.win.focus()
    push(existing)
    return true
  }

  const win = window.open('', source.key, 'width=900,height=900')
  if (!win) {
    return false
  }
  const it = build(win, source.key)
  if (!it) {
    win.close()
    return false
  }
  it.source = source
  inspectors.set(source.key, it)
  push(it)
  return true
}

/** Closes every popout — for when the pixels they show are about to be disposed. */
export function closeAllUvInspectors(): void {
  for (const { win } of inspectors.values()) {
    if (!win.closed) {
      win.close()
    }
  }
  inspectors.clear()
}

/** Re-reads every open popout. Call after an edit if you want them to follow along. */
export function refreshUvInspectors(): void {
  for (const it of [...inspectors.values()]) {
    push(it)
  }
}
