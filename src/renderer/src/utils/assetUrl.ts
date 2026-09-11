/**
 * Safely resolves any local file path, data URL, blob URL, or asset URL.
 * Preserves data: and blob: URLs without running them through asset-file:// protocol.
 */
export function toAssetUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (
    path.startsWith('data:') ||
    path.startsWith('blob:') ||
    path.startsWith('asset-file:') ||
    path.startsWith('http:') ||
    path.startsWith('https:')
  ) {
    return path
  }
  if (typeof window !== 'undefined' && window.api?.assetUrl) {
    return window.api.assetUrl(path)
  }
  return path
}
