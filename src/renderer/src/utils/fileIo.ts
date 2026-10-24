/**
 * Large-file I/O that never builds the whole file as one string or sends it
 * as one IPC message — both have hard size limits a big project or brush pack
 * passes (see main/chunkedWrite.ts).
 */

/** Well under the per-message IPC cap, and small enough to keep memory spikes flat. */
const CHUNK_BYTES = 32 * 1024 * 1024

/** Streams `parts` into an already-begun write. Aborts the write and rethrows on failure. */
export async function streamParts(writeId: number, parts: Uint8Array[]): Promise<number> {
  let total = 0
  try {
    for (const part of parts) {
      for (let offset = 0; offset < part.byteLength; offset += CHUNK_BYTES) {
        const chunk = part.subarray(offset, Math.min(offset + CHUNK_BYTES, part.byteLength))
        await window.api.writeFileChunk(writeId, chunk)
        total += chunk.byteLength
      }
    }
  } catch (err) {
    await window.api.abortFileWrite(writeId).catch(() => {})
    throw err
  }
  return total
}

/** Writes `parts` to `path` atomically (temp file + rename). Resolves false if the commit failed. */
export async function writeFileParts(path: string, parts: Uint8Array[]): Promise<boolean> {
  const id = await window.api.beginFileWrite(path)
  await streamParts(id, parts)
  return window.api.commitFileWrite(id)
}

/**
 * Reads a whole file through the asset protocol rather than IPC, so its size
 * is bounded only by memory. `no-store` keeps an autosave or a re-saved
 * project from coming back as an earlier cached copy.
 */
export async function readFileBytes(path: string): Promise<ArrayBuffer> {
  const res = await fetch(window.api.assetUrl(path), { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Could not read ${path} (${res.status})`)
  }
  return res.arrayBuffer()
}
