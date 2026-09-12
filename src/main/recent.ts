import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export interface RecentEntry {
  projectPath: string
  openedAt: number
  name?: string
  type?: 'project' | 'model'
}

function storePath(): string {
  return join(app.getPath('userData'), 'recent-projects.json')
}

function load(): RecentEntry[] {
  const p = storePath()
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return []
  }
}

function save(entries: RecentEntry[]): void {
  writeFileSync(storePath(), JSON.stringify(entries, null, 2))
}

export function getRecentProjects(): RecentEntry[] {
  return load().sort((a, b) => b.openedAt - a.openedAt)
}

export function addRecentProject(projectPath: string, name?: string, type?: 'project' | 'model'): void {
  const entries = load().filter((e) => e.projectPath !== projectPath)
  const resolvedName = name || projectPath.split(/[/\\]/).pop() || 'Untitled'
  const resolvedType = type || (projectPath.endsWith('.meshcoat') ? 'project' : 'model')
  entries.push({
    projectPath,
    openedAt: Date.now(),
    name: resolvedName,
    type: resolvedType
  })
  save(entries.slice(-25))
}

export function removeRecentProject(projectPath: string): void {
  save(load().filter((e) => e.projectPath !== projectPath))
}

export function clearRecentProjects(): void {
  save([])
}
