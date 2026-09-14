import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

interface Prefs {
  lastImportFolder?: string
  lastExportFolder?: string
  lastTextureFolder?: string
  blenderPath?: string
  blenderPromptDismissed?: boolean
}

function storePath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

function load(): Prefs {
  const p = storePath()
  if (!existsSync(p)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function save(prefs: Prefs): void {
  writeFileSync(storePath(), JSON.stringify(prefs, null, 2))
}

export function getLastImportFolder(): string | undefined {
  return load().lastImportFolder
}

export function setLastImportFolder(folder: string): void {
  const prefs = load()
  prefs.lastImportFolder = folder
  save(prefs)
}

export function getLastExportFolder(): string | undefined {
  return load().lastExportFolder
}

export function setLastExportFolder(folder: string): void {
  const prefs = load()
  prefs.lastExportFolder = folder
  save(prefs)
}

export function getLastTextureFolder(): string | undefined {
  return load().lastTextureFolder
}

export function setLastTextureFolder(folder: string): void {
  const prefs = load()
  prefs.lastTextureFolder = folder
  save(prefs)
}

export function getBlenderPath(): string | undefined {
  return load().blenderPath
}

export function setBlenderPath(path: string | undefined): void {
  const prefs = load()
  prefs.blenderPath = path
  save(prefs)
}

export function isBlenderPromptDismissed(): boolean {
  return !!load().blenderPromptDismissed
}

export function setBlenderPromptDismissed(dismissed: boolean): void {
  const prefs = load()
  prefs.blenderPromptDismissed = dismissed
  save(prefs)
}
