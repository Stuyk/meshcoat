import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface RecentEntry {
  projectPath: string
  openedAt: number
  name?: string
  type?: 'project' | 'model'
}

export interface FileFilter {
  name: string
  extensions: string[]
}

const api = {
  openFileDialog: (options?: {
    filters?: FileFilter[]
    multi?: boolean
  }): Promise<string[] | null> => ipcRenderer.invoke('file:open-dialog', options),
  saveFileDialog: (options?: {
    defaultPath?: string
    filters?: FileFilter[]
  }): Promise<string | null> => ipcRenderer.invoke('file:save-dialog', options),
  saveProjectFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('project:save-file', filePath, content),
  readProjectFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('project:read-file', filePath),
  saveRecovery: (content: string): Promise<boolean> => ipcRenderer.invoke('recovery:save', content),
  loadRecovery: (): Promise<{ data: string; timestamp: number } | null> =>
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
  listTexturesInFolder: (dir: string): Promise<string[] | null> =>
    ipcRenderer.invoke('folder:list-textures-in', dir),
  savePng: (filePath: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save-png', filePath, dataUrl),
  readClipboardImage: (): Promise<{ dataUrl: string; width: number; height: number } | null> =>
    ipcRenderer.invoke('clipboard:read-image'),
  readBinaryFile: (filePath: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('file:read-binary', filePath),
  loadBrushPacks: (): Promise<any | null> => ipcRenderer.invoke('brushes:load'),
  saveBrushPacks: (packsJson: string): Promise<boolean> =>
    ipcRenderer.invoke('brushes:save', packsJson),
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
    ipcRenderer.invoke('blender:set-prompt-dismissed', dismissed)
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
