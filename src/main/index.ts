import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  nativeImage,
  net,
  clipboard
} from 'electron'
import { join, extname } from 'path'
import { pathToFileURL } from 'url'
import { readdir, writeFile, readFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  getRecentProjects,
  addRecentProject,
  removeRecentProject,
  clearRecentProjects
} from './recent'
import {
  getLastTextureFolder,
  setLastTextureFolder,
  isBlenderPromptDismissed,
  setBlenderPromptDismissed,
  setBlenderPath,
  getColorLibrary,
  setColorLibrary,
  type ColorLibrary
} from './prefs'
import { saveAutosave, loadAutosave, clearAutosave } from './recovery'
import { pickScreenColor } from './screenPicker'
import { existsSync } from 'fs'
import { getEffectiveBlender, convertBlendToGlb, testBlenderExecutable } from './blenderBridge'

// Chromium can't decode .tga in an <img>, but three's TGALoader can, and
// texture packs routinely ship a .tga albedo beside .png data maps. Excluding
// it dropped those materials' color channel on the floor without a word — so
// the shelf lists them, decodes them through TGALoader for painting, and falls
// back to a sibling map for the thumbnail (see TextureShelf).
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tga'])

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset-file',
    privileges: {
      standard: true,
      stream: true,
      bypassCSP: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
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

  // The Text tool asks Chromium for the installed fonts (queryLocalFonts),
  // which is gated behind the "local-fonts" permission. Electron's typings
  // don't list that string yet, hence the widening — and everything else is
  // refused rather than silently granted, since nothing here needs it.
  const isAllowedPermission = (permission: string): boolean => permission === 'local-fonts'
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isAllowedPermission(permission))
  })
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    isAllowedPermission(permission)
  )

  mainWindow.webContents.setWindowOpenHandler((details) => {
    /**
     * A blank popup is one of our own inspector windows: the renderer calls
     * window.open('') and then writes the document itself (see
     * utils/uvInspector.ts), which needs same-origin access from the opener —
     * so it has to be a real child window rather than an external URL.
     *
     * Everything with an actual URL is a link and still goes to the browser;
     * this app never navigates a child window to remote content.
     */
    if (details.url === 'about:blank' || details.url === '') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 900,
          backgroundColor: '#141416',
          autoHideMenuBar: true,
          // Node stays out of the popup. It only ever shows a data-URL image
          // the main window handed it.
          webPreferences: { nodeIntegration: false, contextIsolation: true, preload: undefined }
        }
      }
    }
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

  ipcMain.handle(
    'file:open-dialog',
    async (
      _event,
      options: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }
    ) => {
      if (!mainWindow) {
        return null
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: options?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: options?.filters
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths
    }
  )

  ipcMain.handle(
    'file:save-dialog',
    async (
      _event,
      options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }
    ) => {
      if (!mainWindow) {
        return null
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: options?.defaultPath,
        filters: options?.filters
      })
      if (result.canceled || !result.filePath) {
        return null
      }
      return result.filePath
    }
  )

  /**
   * Image files in `dir`. With `depth` > 0 it also walks that many levels of
   * subfolders, so a library split into metal/ grass/ stamps/ loads whole and
   * the shelf can filter by folder. Root files come first; hidden folders are
   * skipped.
   */
  async function listTextures(dir: string, depth = 0): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(extname(e.name).toLowerCase()))
      .map((e) => join(dir, e.name))
    if (depth <= 0) {
      return files
    }
    const subdirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const sub of subdirs) {
      try {
        files.push(...(await listTextures(join(dir, sub.name), depth - 1)))
      } catch {
        // An unreadable subfolder shouldn't cost the rest of the library.
      }
    }
    return files
  }

  const TEXTURE_FOLDER_DEPTH = 3

  ipcMain.handle('folder:pick-textures', async () => {
    if (!mainWindow) {
      return null
    }
    const lastFolder = getLastTextureFolder()
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      ...(lastFolder && existsSync(lastFolder) ? { defaultPath: lastFolder } : {})
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const dir = result.filePaths[0]
    setLastTextureFolder(dir)
    return listTextures(dir, TEXTURE_FOLDER_DEPTH)
  })

  ipcMain.handle('folder:load-last-textures', async () => {
    const dir = getLastTextureFolder()
    if (!dir || !existsSync(dir)) {
      return null
    }
    return listTextures(dir, TEXTURE_FOLDER_DEPTH)
  })

  ipcMain.handle('folder:last-texture-root', () => getLastTextureFolder() ?? null)

  ipcMain.handle('folder:list-textures-in', async (_e, dir: string, recursive?: boolean) => {
    if (!dir || !existsSync(dir)) {
      return null
    }
    return listTextures(dir, recursive ? TEXTURE_FOLDER_DEPTH : 0)
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
      if (!existsSync(p)) {
        return null
      }
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

  ipcMain.handle('project:save-file', async (_e, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8')
      return true
    } catch (err) {
      console.error('Failed to save project file:', filePath, err)
      return false
    }
  })

  ipcMain.handle('project:read-file', async (_e, filePath: string) => {
    try {
      return await readFile(filePath, 'utf-8')
    } catch (err) {
      console.error('Failed to read project file:', filePath, err)
      return null
    }
  })

  ipcMain.handle('recovery:save', async (_e, data: string) => {
    return saveAutosave(data)
  })

  ipcMain.handle('recovery:load', async () => {
    return loadAutosave()
  })

  ipcMain.handle('recovery:clear', async () => {
    return clearAutosave()
  })

  ipcMain.handle('project:recent', () => {
    return getRecentProjects()
  })

  ipcMain.handle(
    'project:add-recent',
    (_e, projectPath: string, name?: string, type?: 'project' | 'model') => {
      addRecentProject(projectPath, name, type)
      return getRecentProjects()
    }
  )

  ipcMain.handle('project:remove-recent', (_e, projectPath: string) => {
    removeRecentProject(projectPath)
    return getRecentProjects()
  })

  ipcMain.handle('project:clear-recent', () => {
    clearRecentProjects()
    return []
  })

  /**
   * Reads an image off the system clipboard as a PNG data URL, for the stencil's
   * paste action. Returns null when the clipboard holds no image at all (text,
   * files, or empty) — nativeImage gives back an empty image rather than
   * throwing, so emptiness is what has to be checked.
   */
  ipcMain.handle('clipboard:read-image', () => {
    const image = clipboard.readImage()
    if (!image || image.isEmpty()) {
      return null
    }
    const { width, height } = image.getSize()
    return { dataUrl: image.toDataURL(), width, height }
  })

  ipcMain.handle('blender:detect', async () => {
    return getEffectiveBlender()
  })

  ipcMain.handle('blender:set-path', async (_e, customPath: string | null) => {
    if (!customPath) {
      setBlenderPath(undefined)
      return { success: true }
    }
    const test = await testBlenderExecutable(customPath)
    if (test.valid) {
      setBlenderPath(customPath)
      return { success: true, version: test.version }
    }
    return { success: false, error: test.error || 'Invalid Blender executable' }
  })

  ipcMain.handle('blender:browse-executable', async () => {
    if (!mainWindow) {
      return null
    }
    const isWin = process.platform === 'win32'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Blender Executable',
      properties: ['openFile'],
      filters: isWin
        ? [{ name: 'Blender Executable', extensions: ['exe'] }]
        : [{ name: 'All Files', extensions: ['*'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const chosen = result.filePaths[0]
    const test = await testBlenderExecutable(chosen)
    if (test.valid) {
      setBlenderPath(chosen)
      return { success: true, path: chosen, version: test.version }
    }
    return {
      success: false,
      error: test.error || 'Selected file is not a valid Blender executable.'
    }
  })

  ipcMain.handle('blend:convert', async (_e, blendPath: string) => {
    try {
      const res = await convertBlendToGlb(blendPath)
      return {
        success: true,
        glbPath: res.glbPath,
        durationMs: res.durationMs,
        version: res.version
      }
    } catch (err) {
      console.error('Failed to convert .blend file:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('blender:is-prompt-dismissed', () => {
    return isBlenderPromptDismissed()
  })

  ipcMain.handle('blender:set-prompt-dismissed', (_e, dismissed: boolean) => {
    setBlenderPromptDismissed(dismissed)
    return true
  })

  ipcMain.handle('color:pick-screen', (e) => {
    return pickScreenColor(BrowserWindow.fromWebContents(e.sender))
  })

  ipcMain.handle('prefs:get-color-library', () => {
    return getColorLibrary() ?? null
  })

  ipcMain.handle('prefs:set-color-library', (_e, library: ColorLibrary) => {
    setColorLibrary(library)
    return true
  })

  ipcMain.on('shell:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.on('drag:start', (event, filePaths: string[]) => {
    if (filePaths.length === 0) {
      return
    }
    event.sender.startDrag({
      file: filePaths[0],
      files: filePaths,
      icon: nativeImage.createFromPath(icon).resize({ width: 32, height: 32 })
    })
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
