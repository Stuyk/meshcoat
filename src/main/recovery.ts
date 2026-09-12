import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'fs/promises'

function getBackupsDir(): string {
  return join(app.getPath('userData'), 'backups')
}

async function ensureBackupsDir(): Promise<string> {
  const dir = getBackupsDir()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  return dir
}

export async function saveAutosave(data: string): Promise<boolean> {
  try {
    const dir = await ensureBackupsDir()
    const autosavePath = join(dir, 'autosave.json')
    await writeFile(autosavePath, data, 'utf-8')

    // Also write rolling backup file
    const rollingPath = join(dir, `backup-${Date.now()}.json`)
    await writeFile(rollingPath, data, 'utf-8')

    // Prune rolling backups keeping at most 5 recent
    const files = await readdir(dir)
    const rollingFiles = files.filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
    if (rollingFiles.length > 5) {
      rollingFiles.sort() // Timestamp-based names sort chronologically
      const toDelete = rollingFiles.slice(0, rollingFiles.length - 5)
      for (const f of toDelete) {
        try {
          await unlink(join(dir, f))
        } catch {}
      }
    }

    return true
  } catch (err) {
    console.error('Failed to save autosave:', err)
    return false
  }
}

export async function loadAutosave(): Promise<{ data: string; timestamp: number } | null> {
  try {
    const dir = getBackupsDir()
    const autosavePath = join(dir, 'autosave.json')
    if (!existsSync(autosavePath)) return null

    const fileStat = await stat(autosavePath)
    const data = await readFile(autosavePath, 'utf-8')
    return {
      data,
      timestamp: fileStat.mtimeMs
    }
  } catch (err) {
    console.error('Failed to load autosave:', err)
    return null
  }
}

export async function clearAutosave(): Promise<boolean> {
  try {
    const dir = getBackupsDir()
    const autosavePath = join(dir, 'autosave.json')
    if (existsSync(autosavePath)) {
      await unlink(autosavePath)
    }
    return true
  } catch (err) {
    console.error('Failed to clear autosave:', err)
    return false
  }
}
