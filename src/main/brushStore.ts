import { app } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readdir, rename, stat, unlink } from 'fs/promises'
import { createLogger } from './logger'

const logger = createLogger('brushes')

/**
 * Imported brush packs, one JSON file per pack.
 *
 * They used to share one brush-packs.json, rewritten whole on every import.
 * Tips are stored as PNG data URLs, so a single grunge pack runs ~100 MB of
 * text; around the 7th pack the combined JSON passed V8's string-length limit,
 * the stringify threw, and the file silently stayed at the previous six (#55).
 * Per-pack files keep each write to one pack's size and touch only that pack.
 */
function packsDir(): string {
  return join(app.getPath('userData'), 'brush-packs')
}

/** What older builds wrote — read once to migrate, then set aside. */
export function legacyPacksPath(): string {
  return join(app.getPath('userData'), 'brush-packs.json')
}

/** Stable, filesystem-safe file for a pack; the hash keeps names that sanitize alike apart. */
export async function packFilePath(packName: string): Promise<string> {
  const dir = packsDir()
  await mkdir(dir, { recursive: true })
  const safe =
    packName
      .replace(/[^a-z0-9 _-]+/gi, '_')
      .slice(0, 60)
      .trim() || 'pack'
  const hash = createHash('sha1').update(packName).digest('hex').slice(0, 8)
  return join(dir, `${safe}-${hash}.json`)
}

/** Every saved pack file, oldest first — the order they were imported in. */
export async function listPackFiles(): Promise<string[]> {
  const dir = packsDir()
  if (!existsSync(dir)) {
    return []
  }
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  const withTimes = await Promise.all(
    names.map(async (n) => ({ path: join(dir, n), mtime: (await stat(join(dir, n))).mtimeMs }))
  )
  return withTimes.sort((a, b) => a.mtime - b.mtime).map((f) => f.path)
}

export async function deletePackFile(packName: string): Promise<void> {
  const path = await packFilePath(packName)
  if (existsSync(path)) {
    await unlink(path)
    logger.info('Deleted brush pack file', path)
  }
}

/** Renames the old single-file store aside once its packs live in their own files. */
export async function retireLegacyPacks(): Promise<void> {
  const legacy = legacyPacksPath()
  if (existsSync(legacy)) {
    await rename(legacy, `${legacy}.migrated`)
    logger.info('Migrated brush packs to per-pack files; old store kept as', `${legacy}.migrated`)
  }
}
