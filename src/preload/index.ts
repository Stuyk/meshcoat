import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface RecentEntry {
  projectPath: string
  openedAt: number
  name?: string
  type?: 'project' | 'model'
}

/** Mirrors main/prefs.ts ColorLibrary. */
export interface ColorLibrary {
  savedSwatches?: string[]
  customPalettes?: { id: string; name: string; colors: string[] }[]
}

export interface FileFilter {
  name: string
  extensions: string[]
}

const api = {
  openFileDialog: (options?: {
    filters?: FileFilter[]
    multi?: boolean
    key?: string
  }): Promise<string[] | null> => ipcRenderer.invoke('file:open-dialog', options),
  saveFileDialog: (options?: {
    defaultPath?: string
    filters?: FileFilter[]
    key?: string
    /** Open next to this file (e.g. the loaded model) when it exists on disk. */
    nearPath?: string | null
  }): Promise<string | null> => ipcRenderer.invoke('file:save-dialog', options),
  /** Streamed write to `target` (temp file + rename on commit) — see renderer utils/fileIo. */
  beginFileWrite: (target: string): Promise<number> =>
    ipcRenderer.invoke('file:write-begin', target),
  writeFileChunk: (id: number, chunk: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('file:write-chunk', id, chunk),
  commitFileWrite: (id: number): Promise<boolean> => ipcRenderer.invoke('file:write-commit', id),
  abortFileWrite: (id: number): Promise<void> => ipcRenderer.invoke('file:write-abort', id),
  findExistingFile: (paths: string[]): Promise<string | null> =>
    ipcRenderer.invoke('file:find-existing', paths),
  recoveryTarget: (): Promise<string> => ipcRenderer.invoke('recovery:target'),
  commitRecovery: (writeId: number): Promise<boolean> =>
    ipcRenderer.invoke('recovery:commit', writeId),
  loadRecovery: (): Promise<{ path: string; timestamp: number } | null> =>
    ipcRenderer.invoke('recovery:load'),
  clearRecovery: (): Promise<boolean> => ipcRenderer.invoke('recovery:clear'),
  getRecentProjects: (): Promise<RecentEntry[]> => ipcRenderer.invoke('project:recent'),
  addRecentProject: (
    projectPath: string,
    name?: string,
    type?: 'project' | 'model'
  ): Promise<RecentEntry[]> => ipcRenderer.invoke('project:add-recent', projectPath, name, type),
  removeRecentProject: (projectPath: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke('project:remove-recent', projectPath),
  clearRecentProjects: (): Promise<RecentEntry[]> => ipcRenderer.invoke('project:clear-recent'),
  revealInFolder: (path: string): void => ipcRenderer.send('shell:reveal', path),
  assetUrl: (filePath: string): string => {
    if (
      filePath.startsWith('data:') ||
      filePath.startsWith('blob:') ||
      filePath.startsWith('asset-file:') ||
      filePath.startsWith('http:') ||
      filePath.startsWith('https:')
    ) {
      return filePath
    }
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const encoded = normalized
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
    return `asset-file://local/${encoded}`
  },
  startDrag: (filePaths: string[]): void => ipcRenderer.send('drag:start', filePaths),
  pickTextureFolder: (): Promise<string[] | null> => ipcRenderer.invoke('folder:pick-textures'),
  loadLastTextureFolder: (): Promise<string[] | null> =>
    ipcRenderer.invoke('folder:load-last-textures'),
  listTexturesInFolder: (dir: string, recursive?: boolean): Promise<string[] | null> =>
    ipcRenderer.invoke('folder:list-textures-in', dir, recursive),
  getTextureFolderRoot: (): Promise<string | null> =>
    ipcRenderer.invoke('folder:last-texture-root'),
  savePng: (filePath: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save-png', filePath, dataUrl),
  readClipboardImage: (): Promise<{ dataUrl: string; width: number; height: number } | null> =>
    ipcRenderer.invoke('clipboard:read-image'),
  readBinaryFile: (filePath: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('file:read-binary', filePath),
  listBrushPackFiles: (): Promise<{ files: string[]; legacy: string | null }> =>
    ipcRenderer.invoke('brushes:list'),
  brushPackPath: (packName: string): Promise<string> =>
    ipcRenderer.invoke('brushes:pack-path', packName),
  deleteBrushPackFile: (packName: string): Promise<boolean> =>
    ipcRenderer.invoke('brushes:delete', packName),
  retireLegacyBrushPacks: (): Promise<void> => ipcRenderer.invoke('brushes:retire-legacy'),
  detectBlender: (): Promise<{ path: string | null; version?: string }> =>
    ipcRenderer.invoke('blender:detect'),
  setBlenderPath: (
    customPath: string | null
  ): Promise<{ success: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('blender:set-path', customPath),
  browseBlenderExecutable: (): Promise<{
    success: boolean
    path?: string
    version?: string
    error?: string
  } | null> => ipcRenderer.invoke('blender:browse-executable'),
  convertBlendFile: (
    blendPath: string
  ): Promise<{
    success: boolean
    glbPath?: string
    durationMs?: number
    version?: string
    error?: string
  }> => ipcRenderer.invoke('blend:convert', blendPath),
  isBlenderPromptDismissed: (): Promise<boolean> =>
    ipcRenderer.invoke('blender:is-prompt-dismissed'),
  setBlenderPromptDismissed: (dismissed: boolean): Promise<boolean> =>
    ipcRenderer.invoke('blender:set-prompt-dismissed', dismissed),
  getColorLibrary: (): Promise<ColorLibrary | null> =>
    ipcRenderer.invoke('prefs:get-color-library'),
  setColorLibrary: (library: ColorLibrary): Promise<boolean> =>
    ipcRenderer.invoke('prefs:set-color-library', library),
  onBeforeClose: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:before-close', listener)
    return () => ipcRenderer.removeListener('app:before-close', listener)
  },
  confirmClose: (): void => ipcRenderer.send('app:close-confirmed'),
  toggleDevTools: (): void => ipcRenderer.send('devtools:toggle'),
  reportGpuContextLost: (): void => ipcRenderer.send('app:gpu-context-lost'),
  /** Appends a line to the app log file. Args must already be cloneable (see renderer utils/logger). */
  writeLog: (level: 'debug' | 'info' | 'warn' | 'error', scope: string, args: unknown[]): void =>
    ipcRenderer.send('log:write', level, scope, args),
  openLogsFolder: (): Promise<boolean> => ipcRenderer.invoke('log:open-folder')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
