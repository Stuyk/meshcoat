/**
 * Which fonts the Text tool can actually draw with.
 *
 * Canvas silently substitutes a default face for a family that isn't
 * installed, so offering a hardcoded list means the artist can pick "Impact",
 * see something else, and have nothing tell them why. Two ways to avoid that,
 * in order of preference:
 *
 *   1. queryLocalFonts() — Chromium's Local Font Access API, which is the real
 *      system font list. It needs a permission the main process grants (see
 *      setPermissionRequestHandler) and only resolves from a user gesture.
 *   2. Measuring — for each candidate, compare its rendered width against the
 *      generic fallbacks. Identical on all three means it isn't installed.
 *      This can only vet a list, never enumerate one, so it's the fallback.
 */

/** Families worth probing when enumeration isn't available. */
const FALLBACK_CANDIDATES = [
  'Arial',
  'Arial Black',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'DejaVu Sans',
  'DejaVu Serif',
  'Franklin Gothic Medium',
  'Gabriola',
  'Georgia',
  'Helvetica',
  'Impact',
  'Liberation Sans',
  'Liberation Serif',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Noto Sans',
  'Noto Serif',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Ubuntu',
  'Verdana'
]

/** Always available, whatever the system has — the CSS generic families. */
const GENERIC_FAMILIES = ['sans-serif', 'serif', 'monospace']

const PROBE_TEXT = 'mmmmmmmmmmlliWWMMOO08'
const PROBE_SIZE = 72

interface LocalFontData {
  family: string
}

interface FontQueryWindow {
  queryLocalFonts?: () => Promise<LocalFontData[]>
}

/** True when the family renders differently from every generic fallback. */
function isInstalled(ctx: CanvasRenderingContext2D, family: string): boolean {
  return GENERIC_FAMILIES.every((generic) => {
    ctx.font = `${PROBE_SIZE}px ${generic}`
    const base = ctx.measureText(PROBE_TEXT).width
    // Quoting matters: an unquoted multi-word family is invalid CSS and the
    // whole font shorthand is ignored, which would measure as the fallback and
    // mark every such family missing.
    ctx.font = `${PROBE_SIZE}px "${family}", ${generic}`
    return ctx.measureText(PROBE_TEXT).width !== base
  })
}

function probeInstalledFonts(): string[] {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) {
    return [...GENERIC_FAMILIES]
  }
  const found = FALLBACK_CANDIDATES.filter((family) => isInstalled(ctx, family))
  return [...found, ...GENERIC_FAMILIES]
}

/**
 * The system's font families, sorted. Falls back to probing when the Local
 * Font Access API is missing or the permission is refused, so this always
 * returns something usable.
 */
export async function listAvailableFonts(): Promise<{ fonts: string[]; enumerated: boolean }> {
  const query = (window as unknown as FontQueryWindow).queryLocalFonts
  if (typeof query === 'function') {
    try {
      const entries = await query()
      // One entry per face (Regular, Bold, Italic...); the tool picks weight
      // and slant itself, so collapse them to families.
      const families = [...new Set(entries.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
      if (families.length > 0) {
        return { fonts: [...families, ...GENERIC_FAMILIES], enumerated: true }
      }
    } catch {
      // Permission refused, or no user gesture behind the call — probe instead.
    }
  }
  return { fonts: probeInstalledFonts().sort((a, b) => a.localeCompare(b)), enumerated: false }
}
