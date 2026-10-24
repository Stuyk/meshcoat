import { open, rename, unlink, type FileHandle } from 'fs/promises'
import { createLogger } from './logger'

const logger = createLogger('write')

/**
 * Large files (projects, autosaves, brush packs) cross from the renderer in
 * pieces rather than as one IPC message: a single message has a hard size
 * cap, and building the whole file as one JS string first runs into V8's
 * ~512M-character string limit — the reason big projects became unsaveable.
 *
 * Each write streams into its own temp file and is renamed over the target
 * only on commit, so a crash or a failed chunk leaves the previous file intact.
 */
interface PendingWrite {
  target: string
  tempPath: string
  handle: FileHandle
  bytes: number
  started: number
}

const pending = new Map<number, PendingWrite>()
let nextId = 0

export async function beginWrite(target: string): Promise<number> {
  const id = ++nextId
  const tempPath = `${target}.${process.pid}.${id}.tmp`
  const handle = await open(tempPath, 'w')
  pending.set(id, { target, tempPath, handle, bytes: 0, started: Date.now() })
  return id
}

export async function writeChunk(id: number, chunk: Uint8Array): Promise<void> {
  const write = pending.get(id)
  if (!write) {
    throw new Error(`Unknown or finished write #${id}`)
  }
  try {
    await write.handle.write(chunk)
    write.bytes += chunk.byteLength
  } catch (err) {
    await abortWrite(id)
    throw err
  }
}

/** Finishes a write: the temp file replaces the target it was begun for. */
export async function commitWrite(id: number): Promise<{ path: string; bytes: number }> {
  const write = pending.get(id)
  if (!write) {
    throw new Error(`Unknown or finished write #${id}`)
  }
  pending.delete(id)
  try {
    await write.handle.sync()
    await write.handle.close()
    await rename(write.tempPath, write.target)
  } catch (err) {
    await write.handle.close().catch(() => {})
    await unlink(write.tempPath).catch(() => {})
    throw err
  }
  logger.debug(`Wrote ${write.target} (${write.bytes} bytes) in ${Date.now() - write.started}ms`)
  return { path: write.target, bytes: write.bytes }
}

export async function abortWrite(id: number): Promise<void> {
  const write = pending.get(id)
  if (!write) {
    return
  }
  pending.delete(id)
  await write.handle.close().catch(() => {})
  await unlink(write.tempPath).catch(() => {})
  logger.warn('Aborted write to', write.target)
}

/** Temp files of writes still in progress — anything else ending in .tmp is a crash leftover. */
export function pendingTempPaths(): Set<string> {
  return new Set([...pending.values()].map((w) => w.tempPath))
}
