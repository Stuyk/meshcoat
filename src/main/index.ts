import { app, shell, BrowserWindow, ipcMain, dialog, protocol, nativeImage, net } from 'electron'
import { join, extname } from 'path'
import { pathToFileURL } from 'url'
import { readdir, writeFile, readFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getRecentProjects, addRecentProject, removeRecentProject } from './recent'
import { getLastTextureFolder, setLastTextureFolder } from './prefs'
import { existsSync } from 'fs'

// .tga isn't decodable by <img>/browser image loaders without a custom
// decoder, so the texture shelf only lists formats Chromium can load directly.
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset-file',
    privileges: { standard: true, stream: true, bypassCSP: true, supportFetchAPI: true, corsEnabled: true }
  }
])

// GPU rasterization tuning. Deliberately NOT disabling the frame-rate limit —
// that uncaps rendering from vsync entirely, so a static scene (the render
// loop always redraws, no dirty-check) gets pushed at however many hundred/
// thousand FPS the GPU can physically produce, pinning it at 100% even at
// idle. Normal vsync-capped rendering (60/144Hz, whatever the display is) is
// what a desktop app should do; the uncapped mode is a benchmarking flag, not
// a performance win.
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'MeshCoat',
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sliptexturepaint.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  protocol.handle('asset-file', (request) => {
    let filePath = decodeURIComponent(new URL(request.url).pathname)
    if (process.platform === 'win32' && filePath.startsWith('/') && filePath[2] === ':') {
      filePath = filePath.slice(1)
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  ipcMain.handle('file:open-dialog', async (_event, options: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options?.filters
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle('file:save-dialog', async (_event, options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: options?.defaultPath,
      filters: options?.filters
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  async function listTextures(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(extname(e.name).toLowerCase()))
      .map((e) => join(dir, e.name))
  }

  ipcMain.handle('folder:pick-textures', async () => {
    if (!mainWindow) return null
    const lastFolder = getLastTextureFolder()
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      ...(lastFolder && existsSync(lastFolder) ? { defaultPath: lastFolder } : {})
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const dir = result.filePaths[0]
    setLastTextureFolder(dir)
    return listTextures(dir)
  })

  ipcMain.handle('folder:load-last-textures', async () => {
    const dir = getLastTextureFolder()
    if (!dir || !existsSync(dir)) return null
    return listTextures(dir)
  })

  ipcMain.handle('file:save-png', async (_e, filePath: string, dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    await writeFile(filePath, Buffer.from(base64, 'base64'))
    return true
  })

  ipcMain.handle('file:read-binary', async (_e, filePath: string) => {
    try {
      const buf = await readFile(filePath)
      return new Uint8Array(buf)
    } catch (err) {
      console.error('Failed to read binary file:', filePath, err)
      return null
    }
  })

  ipcMain.handle('brushes:load', async () => {
    try {
      const p = join(app.getPath('userData'), 'brush-packs.json')
      if (!existsSync(p)) return null
      const data = await readFile(p, 'utf-8')
      return JSON.parse(data)
    } catch (err) {
      console.error('Failed to load brush packs from disk:', err)
      return null
    }
  })

  ipcMain.handle('brushes:save', async (_e, packsJson: string) => {
    try {
      const p = join(app.getPath('userData'), 'brush-packs.json')
      await writeFile(p, packsJson, 'utf-8')
      return true
    } catch (err) {
      console.error('Failed to save brush packs to disk:', err)
      return false
    }
  })

  ipcMain.handle('project:recent', () => {
    return getRecentProjects()
  })

  ipcMain.handle('project:add-recent', (_e, projectPath: string) => {
    addRecentProject(projectPath)
    return getRecentProjects()
  })

  ipcMain.handle('project:remove-recent', (_e, projectPath: string) => {
    removeRecentProject(projectPath)
    return getRecentProjects()
  })

  ipcMain.on('shell:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.on('drag:start', (event, filePaths: string[]) => {
    if (filePaths.length === 0) return
    event.sender.startDrag({
      file: filePaths[0],
      files: filePaths,
      icon: nativeImage.createFromPath(icon).resize({ width: 32, height: 32 })
    })
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
