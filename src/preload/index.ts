import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface RecentEntry {
  projectPath: string
  openedAt: number
}

export interface FileFilter {
  name: string
  extensions: string[]
}

const api = {
  openFileDialog: (options?: { filters?: FileFilter[]; multi?: boolean }): Promise<string[] | null> =>
    ipcRenderer.invoke('file:open-dialog', options),
  saveFileDialog: (options?: { defaultPath?: string; filters?: FileFilter[] }): Promise<string | null> =>
    ipcRenderer.invoke('file:save-dialog', options),
  getRecentProjects: (): Promise<RecentEntry[]> => ipcRenderer.invoke('project:recent'),
  addRecentProject: (projectPath: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke('project:add-recent', projectPath),
  removeRecentProject: (projectPath: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke('project:remove-recent', projectPath),
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
  loadLastTextureFolder: (): Promise<string[] | null> => ipcRenderer.invoke('folder:load-last-textures'),
  savePng: (filePath: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save-png', filePath, dataUrl),
  readBinaryFile: (filePath: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('file:read-binary', filePath),
  loadBrushPacks: (): Promise<any | null> => ipcRenderer.invoke('brushes:load'),
  saveBrushPacks: (packsJson: string): Promise<boolean> =>
    ipcRenderer.invoke('brushes:save', packsJson)
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
