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
import { join, extname, dirname } from 'path'
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
  getLastPath,
  setLastPath,
  isBlenderPromptDismissed,
  setBlenderPromptDismissed,
  setBlenderPath,
  getColorLibrary,
  setColorLibrary,
  type ColorLibrary
} from './prefs'
import { loadAutosave, clearAutosave, autosaveTarget, commitAutosave } from './recovery'
import { beginWrite, writeChunk, commitWrite, abortWrite } from './chunkedWrite'
import {
  listPackFiles,
  packFilePath,
  deletePackFile,
  legacyPacksPath,
  retireLegacyPacks
} from './brushStore'
import { existsSync } from 'fs'
import { getEffectiveBlender, convertBlendToGlb, testBlenderExecutable } from './blenderBridge'
import { initLogger, createLogger, log, getLogsDir, type LogLevel } from './logger'

initLogger()
const logger = createLogger('main')

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
let forceClose = false
/** The renderer can't answer 'app:before-close' while it's dead or hung, so
 * the close guard has to stand aside or the window can never be closed. */
let rendererGone = false
let rendererHung = false
/** One recovery dialog at a time — a hang that turns into a crash would otherwise stack two. */
let recoveryDialogOpen = false

/**
 * Offers a way out when the renderer can no longer be trusted (crashed, hung,
 * or lost its WebGL context). Work since the last autosave is gone either way;
 * reloading lands on the start wizard, which offers that autosave back.
 */
async function showRecoveryDialog(
  win: BrowserWindow,
  message: string,
  detail: string,
  allowWait: boolean
): Promise<void> {
  if (recoveryDialogOpen || win.isDestroyed()) {
    return
  }
  recoveryDialogOpen = true
  logger.warn('Recovery dialog:', message)
  const buttons = allowWait ? ['Wait', 'Reload', 'Quit'] : ['Reload', 'Quit']
  const { response } = await dialog.showMessageBox(win, {
    type: 'error',
    title: 'MeshCoat',
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  recoveryDialogOpen = false
  if (win.isDestroyed()) {
    return
  }
  const choice = buttons[response]
  logger.info('Recovery dialog choice:', choice)
  if (choice === 'Reload') {
    rendererGone = false
    rendererHung = false
    win.webContents.reload()
  } else if (choice === 'Quit') {
    forceClose = true
    win.close()
  }
}

const RECOVERY_DETAIL =
  'Changes since the last autosave (every 60 seconds) may be lost. Reload to get back to the start screen, where the autosave can be restored.'

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
    logger.info('Main window ready')
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    logger.error('Renderer failed to load:', code, description, url)
  })

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error('Preload script error:', preloadPath, error)
  })

  // Never let a stray click on the close button, Alt+F4, or Cmd+Q throw away
  // unsaved work — the renderer decides (via its own dirty state) whether to
  // prompt, and tells us back through 'app:close-confirmed' when it's safe.
  mainWindow.on('close', (event) => {
    if (forceClose || rendererGone) {
      return
    }
    if (rendererHung) {
      // No answer is coming from a frozen renderer; ask here instead of
      // leaving the close button dead.
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        title: 'MeshCoat',
        message: 'MeshCoat is not responding.',
        detail: RECOVERY_DETAIL,
        buttons: ['Wait', 'Close Anyway'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (choice !== 1) {
        event.preventDefault()
      } else {
        logger.warn('Window closed while renderer unresponsive')
      }
      return
    }
    event.preventDefault()
    mainWindow?.webContents.send('app:before-close')
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Renderer process gone:', details)
    if (details.reason === 'clean-exit') {
      return
    }
    rendererGone = true
    rendererHung = false
    const reason = details.reason === 'oom' ? 'ran out of memory' : `stopped (${details.reason})`
    void showRecoveryDialog(mainWindow!, `MeshCoat ${reason}.`, RECOVERY_DETAIL, false)
  })

  mainWindow.on('unresponsive', () => {
    logger.warn('Renderer became unresponsive')
    rendererHung = true
    void showRecoveryDialog(
      mainWindow!,
      'MeshCoat is not responding.',
      `It may still be working on something heavy. ${RECOVERY_DETAIL}`,
      true
    )
  })

  mainWindow.on('responsive', () => {
    logger.info('Renderer responsive again')
    rendererHung = false
  })

  // Handled here rather than in the page so the shortcut still works while
  // the renderer is busy — which is exactly when you want the console.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return
    }
    const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control
    // In dev, the toolkit's watchWindowShortcuts already toggles on F12;
    // handling it here too would open and immediately close the panel.
    const isToggle =
      (input.key === 'F12' && !is.dev) ||
      (ctrlOrCmd && input.shift && input.key.toLowerCase() === 'i')
    if (isToggle) {
      event.preventDefault()
      mainWindow?.webContents.toggleDevTools()
    }
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
  logger.info('App ready')
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
      options: {
        filters?: { name: string; extensions: string[] }[]
        multi?: boolean
        /** Dialog purpose, e.g. 'model' or 'project' — remembers the folder per key. */
        key?: string
      }
    ) => {
      if (!mainWindow) {
        return null
      }
      const lastFolder = options?.key ? getLastPath(options.key) : undefined
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: options?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: options?.filters,
        ...(lastFolder && existsSync(lastFolder) ? { defaultPath: lastFolder } : {})
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      if (options?.key) {
        setLastPath(options.key, dirname(result.filePaths[0]))
      }
      logger.info(`Open dialog (${options?.key ?? 'unkeyed'}):`, result.filePaths.join(', '))
      return result.filePaths
    }
  )

  ipcMain.handle(
    'file:save-dialog',
    async (
      _event,
      options: {
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
        /** Dialog purpose, e.g. 'project' or 'export' — remembers the folder per key. */
        key?: string
        /**
         * A file to save next to — the model being painted. Its folder wins
         * over the remembered one: project files and exports belong beside the
         * model they were made from, not wherever the last save happened to go.
         */
        nearPath?: string | null
      }
    ) => {
      if (!mainWindow) {
        return null
      }
      const nearFolder =
        options?.nearPath && existsSync(options.nearPath) ? dirname(options.nearPath) : undefined
      const lastFolder = options?.key ? getLastPath(options.key) : undefined
      const folder = nearFolder ?? (lastFolder && existsSync(lastFolder) ? lastFolder : undefined)
      const defaultPath =
        folder && options?.defaultPath ? join(folder, options.defaultPath) : options?.defaultPath
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath,
        filters: options?.filters
      })
      if (result.canceled || !result.filePath) {
        return null
      }
      if (options?.key) {
        setLastPath(options.key, dirname(result.filePath))
      }
      logger.info(`Save dialog (${options?.key ?? 'unkeyed'}):`, result.filePath)
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
      } catch (err) {
        // An unreadable subfolder shouldn't cost the rest of the library.
        logger.warn('Skipped unreadable texture subfolder:', join(dir, sub.name), err)
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
    const files = await listTextures(dir, TEXTURE_FOLDER_DEPTH)
    logger.info(`Texture folder picked: ${dir} (${files.length} images)`)
    return files
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
    const bytes = Buffer.from(base64, 'base64')
    try {
      await writeFile(filePath, bytes)
    } catch (err) {
      logger.error('Failed to write PNG:', filePath, err)
      throw err
    }
    logger.info(`Wrote PNG ${filePath} (${bytes.length} bytes)`)
    return true
  })

  ipcMain.handle('file:read-binary', async (_e, filePath: string) => {
    try {
      const buf = await readFile(filePath)
      return new Uint8Array(buf)
    } catch (err) {
      logger.error('Failed to read binary file:', filePath, err)
      return null
    }
  })

  /**
   * Streamed file writes — see chunkedWrite.ts. Projects, autosaves and brush
   * packs all go through these, so none of them has to fit in one IPC
   * message or one JS string.
   */
  ipcMain.handle('file:write-begin', (_e, target: string) => beginWrite(target))
  ipcMain.handle('file:write-chunk', (_e, id: number, chunk: Uint8Array) => writeChunk(id, chunk))
  ipcMain.handle('file:write-abort', (_e, id: number) => abortWrite(id))
  ipcMain.handle('file:write-commit', async (_e, id: number) => {
    try {
      const { path, bytes } = await commitWrite(id)
      logger.info(`Saved ${path} (${(bytes / 1048576).toFixed(1)} MB)`)
      return true
    } catch (err) {
      logger.error('Failed to commit file write:', err)
      return false
    }
  })

  /** First of `paths` that exists on disk, for relinking a moved model (#52). */
  ipcMain.handle('file:find-existing', (_e, paths: string[]) => {
    return paths.find((p) => !!p && existsSync(p)) ?? null
  })

  ipcMain.handle('brushes:list', async () => {
    try {
      const legacy = legacyPacksPath()
      return { files: await listPackFiles(), legacy: existsSync(legacy) ? legacy : null }
    } catch (err) {
      logger.error('Failed to list brush packs:', err)
      return { files: [], legacy: null }
    }
  })
  ipcMain.handle('brushes:pack-path', (_e, packName: string) => packFilePath(packName))
  ipcMain.handle('brushes:delete', async (_e, packName: string) => {
    try {
      await deletePackFile(packName)
      return true
    } catch (err) {
      logger.error('Failed to delete brush pack file:', packName, err)
      return false
    }
  })
  ipcMain.handle('brushes:retire-legacy', async () => {
    try {
      await retireLegacyPacks()
    } catch (err) {
      logger.error('Failed to retire legacy brush pack store:', err)
    }
  })

  ipcMain.handle('recovery:target', () => autosaveTarget())
  ipcMain.handle('recovery:commit', (_e, writeId: number) => commitAutosave(writeId))

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
      logger.info('Blender path reset to auto-detect')
      setBlenderPath(undefined)
      return { success: true }
    }
    const test = await testBlenderExecutable(customPath)
    if (test.valid) {
      logger.info(`Blender path set: ${customPath} (${test.version})`)
      setBlenderPath(customPath)
      return { success: true, version: test.version }
    }
    logger.warn('Rejected Blender path:', customPath, test.error)
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
      logger.info(`Blender path set: ${chosen} (${test.version})`)
      setBlenderPath(chosen)
      return { success: true, path: chosen, version: test.version }
    }
    logger.warn('Rejected Blender executable:', chosen, test.error)
    return {
      success: false,
      error: test.error || 'Selected file is not a valid Blender executable.'
    }
  })

  ipcMain.handle('blend:convert', async (_e, blendPath: string) => {
    try {
      logger.info('Converting .blend:', blendPath)
      const res = await convertBlendToGlb(blendPath)
      logger.info(
        `Converted .blend in ${res.durationMs}ms with Blender ${res.version}:`,
        res.glbPath
      )
      return {
        success: true,
        glbPath: res.glbPath,
        durationMs: res.durationMs,
        version: res.version
      }
    } catch (err) {
      logger.error('Failed to convert .blend file:', blendPath, err)
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

  ipcMain.handle('prefs:get-color-library', () => {
    return getColorLibrary() ?? null
  })

  ipcMain.handle('prefs:set-color-library', (_e, library: ColorLibrary) => {
    setColorLibrary(library)
    return true
  })

  ipcMain.on('app:close-confirmed', () => {
    logger.info('Close confirmed by renderer')
    forceClose = true
    mainWindow?.close()
  })

  ipcMain.on('devtools:toggle', (event) => {
    event.sender.toggleDevTools()
  })

  // A lost WebGL context takes every layer's pixels with it (they live only
  // in GPU render targets), so there's nothing to restore in place.
  ipcMain.on('app:gpu-context-lost', () => {
    logger.error('Renderer reported WebGL context lost')
    if (mainWindow) {
      void showRecoveryDialog(
        mainWindow,
        'The graphics context was lost.',
        `The GPU driver reset or ran out of memory, and the painted textures went with it. ${RECOVERY_DETAIL}`,
        false
      )
    }
  })

  app.on('child-process-gone', (_event, details) => {
    logger.error('Child process gone:', details)
  })

  ipcMain.on('shell:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  /** Renderer log lines, written to the same file under a 'renderer:<scope>' tag. */
  const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])
  ipcMain.on('log:write', (_e, level: LogLevel, scope: string, args: unknown[]) => {
    const safeLevel = LOG_LEVELS.has(level) ? level : 'info'
    log(safeLevel, `renderer:${String(scope)}`, ...(Array.isArray(args) ? args : [args]))
  })

  ipcMain.handle('log:open-folder', async () => {
    const dir = getLogsDir()
    const error = await shell.openPath(dir)
    if (error) {
      logger.error('Failed to open logs folder:', dir, error)
    }
    return error === ''
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

app.on('before-quit', () => {
  logger.info('App quitting')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
