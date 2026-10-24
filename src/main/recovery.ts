import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, readdir, unlink, stat, copyFile } from 'fs/promises'
import { createLogger } from './logger'
import { commitWrite, abortWrite, pendingTempPaths } from './chunkedWrite'

const logger = createLogger('recovery')

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

/** Deletes one pruned rolling backup; a failed delete is harmless — the file just lingers. */
async function deleteRollingBackup(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    // Harmless: the file just lingers until the next prune pass.
  }
}

/**
 * Autosave commit, load and clear all touch the autosave files, and each runs
 * across several awaits. Run one at a time, in the order asked: otherwise an
 * autosave still landing *after* the clear that follows a manual save leaves
 * a stale autosave to be offered back on next launch, or two slow autosaves
 * overlap and prune each other's backups.
 */
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

/** Current autosave. Binary .meshcoat since project format 5; the .json name is what older builds wrote. */
const AUTOSAVE_NAME = 'autosave.meshcoat'
const LEGACY_AUTOSAVE_NAME = 'autosave.json'
const KEEP_ROLLING_BACKUPS = 5

/** Where the renderer streams a new autosave (see chunkedWrite); commitAutosave publishes it. */
export async function autosaveTarget(): Promise<string> {
  return join(await ensureBackupsDir(), AUTOSAVE_NAME)
}

/**
 * Publishes a streamed autosave: the chunked write is renamed into place,
 * copied to a rolling backup, and old backups and crash leftovers pruned.
 */
export function commitAutosave(writeId: number): Promise<boolean> {
  return serialized(async () => {
    const started = Date.now()
    try {
      const { path, bytes } = await commitWrite(writeId)
      const dir = getBackupsDir()
      await copyFile(path, join(dir, `backup-${Date.now()}.meshcoat`))
      // The new autosave supersedes an older build's JSON one.
      await unlink(join(dir, LEGACY_AUTOSAVE_NAME)).catch(() => {})
      await pruneBackups(dir)
      logger.info(`Autosaved ${(bytes / 1048576).toFixed(1)} MB (commit ${Date.now() - started}ms)`)
      return true
    } catch (err) {
      await abortWrite(writeId)
      logger.error('Failed to save autosave:', err)
      return false
    }
  })
}

async function pruneBackups(dir: string): Promise<void> {
  const files = await readdir(dir)
  const rollingFiles = files.filter(
    (f) => f.startsWith('backup-') && (f.endsWith('.json') || f.endsWith('.meshcoat'))
  )
  if (rollingFiles.length > KEEP_ROLLING_BACKUPS) {
    // Timestamp names sort chronologically regardless of extension.
    rollingFiles.sort((a, b) => backupTime(a) - backupTime(b))
    const toDelete = rollingFiles.slice(0, rollingFiles.length - KEEP_ROLLING_BACKUPS)
    await Promise.all(toDelete.map((f) => deleteRollingBackup(join(dir, f))))
  }
  // Any temp file that isn't an in-progress write is one a crash or forced
  // quit left behind mid-write — each the size of a project.
  const inProgress = pendingTempPaths()
  const orphans = files.filter((f) => f.endsWith('.tmp') && !inProgress.has(join(dir, f)))
  await Promise.all(orphans.map((f) => deleteRollingBackup(join(dir, f))))
}

function backupTime(name: string): number {
  return Number(/^backup-(\d+)\./.exec(name)?.[1] ?? 0)
}

/** The newest autosave on disk, binary or legacy JSON; the renderer reads it through the asset protocol. */
export function loadAutosave(): Promise<{ path: string; timestamp: number } | null> {
  return serialized(async () => {
    try {
      const dir = getBackupsDir()
      let best: { path: string; timestamp: number } | null = null
      for (const name of [AUTOSAVE_NAME, LEGACY_AUTOSAVE_NAME]) {
        const path = join(dir, name)
        if (!existsSync(path)) {
          continue
        }
        const { mtimeMs } = await stat(path)
        if (!best || mtimeMs > best.timestamp) {
          best = { path, timestamp: mtimeMs }
        }
      }
      if (best) {
        logger.info(`Found autosave ${best.path} from ${new Date(best.timestamp).toISOString()}`)
      }
      return best
    } catch (err) {
      logger.error('Failed to load autosave:', err)
      return null
    }
  })
}

export function clearAutosave(): Promise<boolean> {
  return serialized(async () => {
    try {
      const dir = getBackupsDir()
      for (const name of [AUTOSAVE_NAME, LEGACY_AUTOSAVE_NAME]) {
        const path = join(dir, name)
        if (existsSync(path)) {
          await unlink(path)
        }
      }
      return true
    } catch (err) {
      logger.error('Failed to clear autosave:', err)
      return false
    }
  })
}
