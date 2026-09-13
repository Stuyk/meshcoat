/**
 * Last path segment of a file path, for display.
 *
 * Splits on BOTH separators: Windows hands back `C:\Users\me\textures\rock.png`,
 * and splitting on '/' alone leaves the whole path as the "filename" — which is
 * how full paths ended up filling the texture shelf on Windows while looking
 * fine on Linux and macOS. A data URL has no meaningful name, so it gets a
 * generic one rather than a screenful of base64.
 */
export function fileName(path: string | null | undefined, fallback = 'Texture'): string {
  if (!path) return fallback
  if (path.startsWith('data:') || path.startsWith('blob:')) return fallback
  return path.split(/[/\\]/).pop() || fallback
}

/** Filename without its extension, for labels that don't need one. */
export function fileStem(path: string | null | undefined, fallback = 'Texture'): string {
  return fileName(path, fallback).replace(/\.[^.]+$/, '')
}
