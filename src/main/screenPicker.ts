import { BrowserWindow, desktopCapturer, screen } from 'electron'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * System-wide color picker: sample any pixel on any screen, including other
 * applications.
 *
 * Chromium's `EyeDropper` web API is not implemented by Electron (the picker
 * UI lives in the Chrome browser layer), so this does what desktop pickers do
 * themselves: snapshot every display, cover each one with a borderless
 * window showing that snapshot, and let the user click a pixel. The overlay
 * reports back through its document title, so it needs no preload or IPC of
 * its own and runs fully sandboxed.
 *
 * The app's own window is hidden for the capture so whatever is behind it —
 * a reference image in a browser, another program — can be sampled.
 */

const OVERLAY_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; cursor: crosshair; }
  #shot { position: fixed; inset: 0; width: 100vw; height: 100vh; image-rendering: pixelated; }
  #loupe { position: fixed; pointer-events: none; width: 154px; border-radius: 10px; overflow: hidden;
    background: #111; box-shadow: 0 6px 24px rgba(0,0,0,.6); border: 2px solid #fff; display: none; }
  #zoom { display: block; width: 154px; height: 154px; image-rendering: pixelated; }
  #info { display: flex; align-items: center; gap: 6px; padding: 5px 7px;
    font: 600 12px ui-monospace, monospace; color: #eee; }
  #chip { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255,255,255,.5); }
  #hint { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); padding: 6px 12px;
    border-radius: 6px; background: rgba(0,0,0,.75); color: #ddd; font: 12px system-ui, sans-serif; }
</style></head><body>
<img id="shot" src="shot.png">
<div id="hint">Click to pick a color · Esc or right-click to cancel</div>
<div id="loupe"><canvas id="zoom" width="11" height="11"></canvas>
  <div id="info"><span id="chip"></span><span id="hex">#000000</span></div></div>
<script>
  const shot = document.getElementById('shot')
  const loupe = document.getElementById('loupe')
  const zoom = document.getElementById('zoom').getContext('2d')
  const hexEl = document.getElementById('hex')
  const chip = document.getElementById('chip')
  const src = document.createElement('canvas')
  const sctx = src.getContext('2d', { willReadFrequently: true })
  let current = null
  const hex2 = (n) => n.toString(16).padStart(2, '0')
  shot.onload = () => {
    src.width = shot.naturalWidth; src.height = shot.naturalHeight
    sctx.drawImage(shot, 0, 0)
  }
  function sample(e) {
    if (!src.width) return
    const px = Math.floor(e.clientX * src.width / window.innerWidth)
    const py = Math.floor(e.clientY * src.height / window.innerHeight)
    const region = sctx.getImageData(px - 5, py - 5, 11, 11)
    zoom.putImageData(region, 0, 0)
    const c = sctx.getImageData(px, py, 1, 1).data
    current = '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2])
    hexEl.textContent = current.toUpperCase()
    chip.style.background = current
    loupe.style.display = 'block'
    const w = 158, h = 186
    let x = e.clientX + 20, y = e.clientY + 20
    if (x + w > window.innerWidth) x = e.clientX - w - 20
    if (y + h > window.innerHeight) y = e.clientY - h - 20
    loupe.style.left = x + 'px'; loupe.style.top = y + 'px'
  }
  // Crosshair on the center pixel, drawn in CSS over the zoomed canvas.
  const cross = document.createElement('div')
  cross.style.cssText = 'position:absolute;left:70px;top:70px;width:14px;height:14px;box-sizing:border-box;border:2px solid #fff;outline:1px solid #000;pointer-events:none'
  loupe.style.position = 'fixed'; loupe.appendChild(cross)
  window.addEventListener('mousemove', sample)
  // Commit on release, not press: the overlay closes on commit, and a release
  // landing on the app window underneath would otherwise click it.
  let pressed = false
  window.addEventListener('mousedown', (e) => {
    if (e.button === 2) { document.title = 'pick:cancel'; return }
    if (e.button === 0) { pressed = true; sample(e) }
  })
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !pressed) return
    sample(e)
    if (current) document.title = 'pick:' + current
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.title = 'pick:cancel'
    if (e.key === 'Enter' && current) document.title = 'pick:' + current
  })
  window.addEventListener('contextmenu', (e) => e.preventDefault())
</script></body></html>`

let active: Promise<string | null> | null = null

export function pickScreenColor(owner: BrowserWindow | null): Promise<string | null> {
  // A second request while one is open joins it rather than stacking overlays.
  if (!active) {
    active = runPicker(owner).finally(() => {
      active = null
    })
  }
  return active
}

async function runPicker(owner: BrowserWindow | null): Promise<string | null> {
  const displays = screen.getAllDisplays()
  const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)))
  const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))

  const ownerWasVisible = !!owner && owner.isVisible() && !owner.isMinimized()
  if (ownerWasVisible) {
    owner!.hide()
    // Give the window manager a moment to actually take the window off screen
    // (Cinnamon/Muffin animate unmaps), or the capture would still show it.
    await new Promise((r) => setTimeout(r, 400))
  }

  const dir = mkdtempSync(join(tmpdir(), 'meshcoat-pick-'))
  const overlays: BrowserWindow[] = []
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxW, height: maxH }
    })
    if (sources.length === 0) {
      return null
    }

    const result = await new Promise<string | null>((resolve) => {
      let settled = false
      const finish = (value: string | null): void => {
        if (settled) {
          return
        }
        settled = true
        resolve(value)
      }

      displays.forEach((display, i) => {
        // display_id is empty on some Linux setups; fall back to capture order.
        const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[i]
        if (!source) {
          return
        }
        const shotDir = mkdtempSync(join(dir, `d${i}-`))
        writeFileSync(join(shotDir, 'shot.png'), source.thumbnail.toPNG())
        writeFileSync(join(shotDir, 'index.html'), OVERLAY_HTML)

        const win = new BrowserWindow({
          ...display.bounds,
          // A real fullscreen window: a frameless window merely sized to the
          // display gets pushed around by panels/struts on X11 window managers,
          // and any offset means the picked pixel isn't the one under the cursor.
          fullscreen: true,
          frame: false,
          show: false,
          resizable: false,
          movable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          fullscreenable: true,
          enableLargerThanScreen: true,
          backgroundColor: '#000000',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
        })
        win.setAlwaysOnTop(true, 'screen-saver')
        win.webContents.on('page-title-updated', (_e, title) => {
          if (!title.startsWith('pick:')) {
            return
          }
          const value = title.slice(5)
          finish(/^#[0-9a-f]{6}$/.test(value) ? value : null)
        })
        win.on('closed', () => {
          // Closing any overlay (alt-F4, WM close) counts as a cancel.
          finish(null)
        })
        win.once('ready-to-show', () => {
          win.setBounds(display.bounds)
          win.show()
          win.setFullScreen(true)
          win.moveTop()
          win.focus()
          // X11 focus-stealing prevention can leave keyboard focus behind, which
          // makes Esc do nothing; ask once more after the map settles.
          setTimeout(() => {
            if (!win.isDestroyed()) {
              win.focus()
              win.webContents.focus()
            }
          }, 150)
        })
        void win.loadFile(join(shotDir, 'index.html'))
        overlays.push(win)
      })

      if (overlays.length === 0) {
        finish(null)
      }
    })
    return result
  } finally {
    for (const win of overlays) {
      if (!win.isDestroyed()) {
        win.removeAllListeners('closed')
        win.destroy()
      }
    }
    rmSync(dir, { recursive: true, force: true })
    if (ownerWasVisible && owner && !owner.isDestroyed()) {
      owner.show()
      owner.focus()
    }
  }
}
