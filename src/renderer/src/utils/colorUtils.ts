/**
 * Color math and conversion utilities for MeshCoat
 * Supports HEX (#RRGGBB / #RGB), RGB (0-255), and HSV (H: 0-360, S: 0-1, V: 0-1).
 */

export interface RGB {
  r: number // 0 - 255
  g: number // 0 - 255
  b: number // 0 - 255
}

export interface HSV {
  h: number // 0 - 360
  s: number // 0 - 1
  v: number // 0 - 1
}

/**
 * Validates whether a string is a valid 3-digit or 6-digit hex color code.
 */
export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim())
}

/**
 * Normalizes hex string into lowercase '#rrggbb' format.
 */
export function normalizeHex(hex: string, fallback = '#ffffff'): string {
  const clean = hex.trim().replace(/^#/, '')
  if (clean.length === 3) {
    const r = clean[0]
    const g = clean[1]
    const b = clean[2]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (clean.length === 6 && /^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean}`.toLowerCase()
  }
  return fallback.toLowerCase()
}

/**
 * Converts a hex string into an RGB object (0-255).
 */
export function hexToRgb(hex: string): RGB {
  const clean = normalizeHex(hex).slice(1)
  const num = parseInt(clean, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  }
}

/**
 * Converts RGB channels (0-255) to a lowercase hex string '#rrggbb'.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clampR = Math.min(255, Math.max(0, Math.round(r)))
  const clampG = Math.min(255, Math.max(0, Math.round(g)))
  const clampB = Math.min(255, Math.max(0, Math.round(b)))
  const hex = ((clampR << 16) | (clampG << 8) | clampB).toString(16).padStart(6, '0')
  return `#${hex}`
}

/**
 * Converts RGB (0-255) to HSV (h: 0-360, s: 0-1, v: 0-1).
 */
export function rgbToHsv(r: number, g: number, b: number): HSV {
  const normR = r / 255
  const normG = g / 255
  const normB = b / 255

  const max = Math.max(normR, normG, normB)
  const min = Math.min(normR, normG, normB)
  const delta = max - min

  let h = 0
  const s = max === 0 ? 0 : delta / max
  const v = max

  if (delta > 0) {
    if (max === normR) {
      h = ((normG - normB) / delta) % 6
    } else if (max === normG) {
      h = (normB - normR) / delta + 2
    } else {
      h = (normR - normG) / delta + 4
    }
    h = Math.round(h * 60)
    if (h < 0) {
      h += 360
    }
  }

  return { h, s, v }
}

/**
 * Converts HSV (h: 0-360, s: 0-1, v: 0-1) to RGB (0-255).
 */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const normH = ((h % 360) + 360) % 360
  const normS = Math.min(1, Math.max(0, s))
  const normV = Math.min(1, Math.max(0, v))

  const c = normV * normS
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1))
  const m = normV - c

  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (normH < 60) {
    rPrime = c
    gPrime = x
    bPrime = 0
  } else if (normH < 120) {
    rPrime = x
    gPrime = c
    bPrime = 0
  } else if (normH < 180) {
    rPrime = 0
    gPrime = c
    bPrime = x
  } else if (normH < 240) {
    rPrime = 0
    gPrime = x
    bPrime = c
  } else if (normH < 300) {
    rPrime = x
    gPrime = 0
    bPrime = c
  } else {
    rPrime = c
    gPrime = 0
    bPrime = x
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255)
  }
}

/**
 * Converts HEX string directly to HSV.
 */
export function hexToHsv(hex: string): HSV {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHsv(r, g, b)
}

/**
 * Converts HSV directly to HEX string '#rrggbb'.
 */
export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v)
  return rgbToHex(r, g, b)
}
