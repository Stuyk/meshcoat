import { BrowserWindow, desktopCapturer, screen, type Display } from 'electron'

/**
 * System-wide color picker: sample any pixel on any monitor, including other
 * applications.
 *
 * Electron doesn't implement the web `EyeDropper` (its UI lives in the Chrome
 * browser layer), so this works the way macOS's color sampler does:
 *
 *  1. The app hides, and every display is captured once into memory.
 *  2. One small magnifier window follows the global cursor across all
 *     monitors (polled with screen.getCursorScreenPoint), always sitting
 *     under it, drawing the magnified pixels around the cursor from the
 *     capture of whichever display the cursor is on.
 *  3. Because the cursor is always over the magnifier, a click lands on it:
 *     that's the pick. Esc or right-click cancels.
 *
 * An earlier version covered each monitor with a fullscreen snapshot window.
 * Multi-monitor window placement is up to the window manager, which on X11
 * would happily stack both fullscreen windows on one monitor; a single small
 * window that is simply moved to the cursor has no such dependency.
 */

const LOUPE_SIZE = 200
/** Odd, so there's a true center pixel. */
const GRID = 15
const POLL_MS = 8

export interface Capture {
  display: Display
  /** BGRA, row-major. */
  bitmap: Buffer
  width: number
  height: number
}

const LOUPE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent;
    cursor: none; user-select: none; }
  #wrap { position: absolute; width: 150px; height: 178px; border-radius: 10px; overflow: hidden;
    background: #111; border: 2px solid #fff; box-shadow: 0 0 0 1px #000, 0 6px 20px rgba(0,0,0,.6); }
  canvas { display: block; width: 150px; height: 150px; image-rendering: pixelated; }
  #center { position: absolute; left: 70px; top: 70px; width: 10px; height: 10px;
    box-sizing: border-box; border: 2px solid #fff; outline: 1px solid #000; }
  #info { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px;
    font: 600 12px ui-monospace, monospace; color: #eee; }
  #chip { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255,255,255,.5); }
  #hint { margin-left: auto; font: 10px system-ui, sans-serif; color: #999; }
</style></head><body>
<div id="wrap"><canvas id="c" width="${GRID}" height="${GRID}"></canvas><div id="center"></div>
<div id="info"><span id="chip"></span><span id="hex">------</span><span id="hint">Esc</span></div></div>
<script>
  const ctx = document.getElementById('c').getContext('2d')
  const wrap = document.getElementById('wrap')
  const hexEl = document.getElementById('hex')
  const chip = document.getElementById('chip')
  let current = null
  // Called by the main process every poll: pixels around the cursor (RGB hex
  // string, GRID*GRID*6 chars) and where the cursor sits inside this window.
  window.__loupe = (hex, cx, cy) => {
    const img = ctx.createImageData(${GRID}, ${GRID})
    for (let i = 0; i < ${GRID * GRID}; i++) {
      img.data[i * 4] = parseInt(hex.substr(i * 6, 2), 16)
      img.data[i * 4 + 1] = parseInt(hex.substr(i * 6 + 2, 2), 16)
      img.data[i * 4 + 2] = parseInt(hex.substr(i * 6 + 4, 2), 16)
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    const mid = Math.floor(${GRID * GRID} / 2) * 6
    current = '#' + hex.substr(mid, 6)
    hexEl.textContent = current.toUpperCase()
    chip.style.background = current
    // Center the magnifier's middle cell on the cursor. The WM may clamp the
    // window at a screen edge, so place it from the real cursor offset.
    wrap.style.left = (cx - 75) + 'px'
    wrap.style.top = (cy - 75) + 'px'
  }
  let pressed = false
  window.addEventListener('mousedown', (e) => {
    if (e.button === 2) { document.title = 'pick:cancel'; return }
    if (e.button === 0) pressed = true
  })
  // Commit on release: a release landing in another window after this one
  // closes would otherwise click it.
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && pressed && current) document.title = 'pick:' + current
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.title = 'pick:cancel'
    if (e.key === 'Enter' && current) document.title = 'pick:' + current
  })
  window.addEventListener('contextmenu', (e) => e.preventDefault())
</script></body></html>`

let active: Promise<string | null> | null = null

export function pickScreenColor(owner: BrowserWindow | null): Promise<string | null> {
  // A second request while one is open joins it rather than stacking pickers.
  if (!active) {
    active = runPicker(owner).finally(() => {
      active = null
    })
  }
  return active
}

async function captureDisplays(): Promise<Capture[]> {
  const displays = screen.getAllDisplays()
  const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)))
  const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH }
  })
  const captures: Capture[] = []
  displays.forEach((display, i) => {
    // display_id can be empty on some Linux setups; fall back to capture order.
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[i]
    if (!source || source.thumbnail.isEmpty()) {
      return
    }
    const size = source.thumbnail.getSize()
    captures.push({
      display,
      bitmap: source.thumbnail.toBitmap(),
      width: size.width,
      height: size.height
    })
  })
  return captures
}

/** GRID×GRID pixels around a global DIP point, as a flat RGB hex string. */
export function sampleAround(captures: Capture[], x: number, y: number): string | null {
  const cap =
    captures.find((c) => {
      const b = c.display.bounds
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
    }) ?? null
  if (!cap) {
    return null
  }
  const b = cap.display.bounds
  // DIP -> capture pixels. The capture may be scaled to fit thumbnailSize,
  // so map by its actual size rather than by scaleFactor.
  const cx = Math.floor(((x - b.x) * cap.width) / b.width)
  const cy = Math.floor(((y - b.y) * cap.height) / b.height)
  const half = (GRID - 1) / 2
  let out = ''
  for (let gy = -half; gy <= half; gy++) {
    for (let gx = -half; gx <= half; gx++) {
      const px = cx + gx
      const py = cy + gy
      if (px < 0 || py < 0 || px >= cap.width || py >= cap.height) {
        out += '000000'
        continue
      }
      const o = (py * cap.width + px) * 4
      // NativeImage bitmaps are BGRA.
      out +=
        cap.bitmap[o + 2].toString(16).padStart(2, '0') +
        cap.bitmap[o + 1].toString(16).padStart(2, '0') +
        cap.bitmap[o].toString(16).padStart(2, '0')
    }
  }
  return out
}

async function runPicker(owner: BrowserWindow | null): Promise<string | null> {
  const ownerWasVisible = !!owner && owner.isVisible() && !owner.isMinimized()
  if (ownerWasVisible) {
    owner!.hide()
    // Give the window manager a moment to actually take the window off screen
    // (Cinnamon/Muffin animate unmaps), or the capture would still show it.
    await new Promise((r) => setTimeout(r, 400))
  }

  let loupe: BrowserWindow | null = null
  let timer: NodeJS.Timeout | null = null
  try {
    const captures = await captureDisplays()
    if (captures.length === 0) {
      return null
    }

    const start = screen.getCursorScreenPoint()
    loupe = new BrowserWindow({
      x: start.x - LOUPE_SIZE / 2,
      y: start.y - LOUPE_SIZE / 2,
      width: LOUPE_SIZE,
      height: LOUPE_SIZE,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    loupe.setAlwaysOnTop(true, 'screen-saver')
    await loupe.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOUPE_HTML)}`)

    const win = loupe
    return await new Promise<string | null>((resolve) => {
      let settled = false
      const finish = (value: string | null): void => {
        if (!settled) {
          settled = true
          resolve(value)
        }
      }
      win.webContents.on('page-title-updated', (_e, title) => {
        if (title.startsWith('pick:')) {
          const value = title.slice(5)
          finish(/^#[0-9a-f]{6}$/.test(value) ? value : null)
        }
      })
      win.on('closed', () => finish(null))

      let lastKey = ''
      const tick = (): void => {
        if (win.isDestroyed()) {
          return
        }
        const p = screen.getCursorScreenPoint()
        const key = `${p.x},${p.y}`
        if (key === lastKey) {
          return
        }
        lastKey = key
        win.setPosition(Math.round(p.x - LOUPE_SIZE / 2), Math.round(p.y - LOUPE_SIZE / 2))
        const [wx, wy] = win.getPosition()
        const pixels = sampleAround(captures, p.x, p.y)
        if (pixels) {
          void win.webContents
            .executeJavaScript(
              `window.__loupe(${JSON.stringify(pixels)}, ${p.x - wx}, ${p.y - wy})`
            )
            .catch(() => {})
        }
      }
      tick()
      win.show()
      win.focus()
      // X11 focus-stealing prevention can leave keyboard focus behind (so Esc
      // would do nothing); ask again once the window is mapped.
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.focus()
          win.webContents.focus()
        }
      }, 150)
      timer = setInterval(tick, POLL_MS)
    })
  } finally {
    if (timer) {
      clearInterval(timer)
    }
    if (loupe && !loupe.isDestroyed()) {
      loupe.removeAllListeners('closed')
      loupe.destroy()
    }
    if (ownerWasVisible && owner && !owner.isDestroyed()) {
      owner.show()
      owner.focus()
    }
  }
}
