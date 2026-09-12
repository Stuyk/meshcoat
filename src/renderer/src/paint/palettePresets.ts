/**
 * Curated color palette presets, storage management, and import/export utilities.
 */
import { isValidHex, normalizeHex } from '../utils/colorUtils'

export interface PalettePreset {
  id: string
  name: string
  description?: string
  colors: string[]
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: 'essentials',
    name: 'Essentials',
    description: 'Clean standard 12-color studio spectrum',
    colors: [
      '#ffffff',
      '#d1d5db',
      '#6b7280',
      '#1f2937',
      '#ef4444',
      '#f97316',
      '#eab308',
      '#22c55e',
      '#06b6d4',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899'
    ]
  },
  {
    id: 'pico8',
    name: 'Retro 16 (Pico-8)',
    description: 'Classic 16-color fantasy console palette',
    colors: [
      '#000000',
      '#1d2b53',
      '#7e2553',
      '#008751',
      '#ab5236',
      '#5f574f',
      '#c2c3c7',
      '#fff1e8',
      '#ff004d',
      '#ffa300',
      '#ffec27',
      '#00e436',
      '#29adff',
      '#83769c',
      '#ff77a8',
      '#ffccaa'
    ]
  },
  {
    id: 'skin',
    name: 'Skin & Organic',
    description: 'Tones for portraits, character models, and organic forms',
    colors: [
      '#fcf0e8',
      '#f6d5be',
      '#e5b89a',
      '#c99374',
      '#a26c4f',
      '#77452d',
      '#4f2c1b',
      '#341c10',
      '#d66b72',
      '#b33e4b'
    ]
  },
  {
    id: 'metals',
    name: 'Metals & Weathering',
    description: 'Steel, gold, bronze, rust, and surface patina',
    colors: [
      '#d8dee9',
      '#8892b0',
      '#434c5e',
      '#2e3440',
      '#ffd700',
      '#d4af37',
      '#cd7f32',
      '#b85c38',
      '#7b3f00',
      '#4e878c'
    ]
  },
  {
    id: 'nature',
    name: 'Nature & Landscape',
    description: 'Foliage, moss, loam soil, sandstone, and atmospheric sky',
    colors: [
      '#2d5a27',
      '#4e7a3e',
      '#8ba870',
      '#c3d898',
      '#4a3525',
      '#7a593e',
      '#b38b6d',
      '#e6c280',
      '#648a9f',
      '#2c4456'
    ]
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk & Neon',
    description: 'High-energy vivid neon dyes and ultraviolet shades',
    colors: [
      '#050510',
      '#0b162c',
      '#00f0ff',
      '#00a8ff',
      '#ff0055',
      '#ff00a0',
      '#a200ff',
      '#7122fa',
      '#00ff66',
      '#ffe600'
    ]
  },
  {
    id: 'grayscale',
    name: 'Values (0-100%)',
    description: 'Linear 10% luminance steps for lighting, masks, and shading',
    colors: [
      '#ffffff',
      '#e6e6e6',
      '#cccccc',
      '#b3b3b3',
      '#999999',
      '#808080',
      '#666666',
      '#4d4d4d',
      '#333333',
      '#1a1a1a',
      '#000000'
    ]
  }
]

const SAVED_SWATCHES_KEY = 'meshcoat:saved_swatches'

const DEFAULT_SAVED_SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
  '#000000'
]

/**
 * Loads user saved swatches from localStorage, with fallback to initial set.
 */
export function loadSavedSwatches(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_SWATCHES_KEY)
    if (!raw) return [...DEFAULT_SAVED_SWATCHES]
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((c) => typeof c === 'string' && isValidHex(c)).map((c) => normalizeHex(c))
    }
  } catch {}
  return [...DEFAULT_SAVED_SWATCHES]
}

/**
 * Persists user saved swatches to localStorage.
 */
export function saveSavedSwatches(swatches: string[]): void {
  try {
    const valid = swatches.filter((c) => isValidHex(c)).map((c) => normalizeHex(c))
    localStorage.setItem(SAVED_SWATCHES_KEY, JSON.stringify(valid))
  } catch {}
}

/**
 * Parses a raw text file string (e.g. .hex, .gpl, or .json) into an array of normalized hex colors.
 */
export function parsePaletteText(text: string): string[] {
  const result: string[] = []
  const trimmed = text.trim()

  // 1. Try parsing as JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed)
      const list = Array.isArray(data) ? data : data.colors || data.palette || []
      for (const item of list) {
        const hex = typeof item === 'string' ? item : item?.hex || item?.color
        if (typeof hex === 'string' && isValidHex(hex)) {
          result.push(normalizeHex(hex))
        }
      }
      if (result.length > 0) return Array.from(new Set(result))
    } catch {}
  }

  // 2. Line by line parsing (.hex, GIMP .gpl, raw list)
  const lines = trimmed.split(/[\r\n]+/)
  for (const line of lines) {
    const cleanLine = line.trim()
    if (!cleanLine || cleanLine.startsWith('# ') || cleanLine.startsWith('GIMP') || cleanLine.startsWith('Name:')) {
      continue
    }

    // Check for hex pattern: #123456, 123456, #123
    const hexMatch = cleanLine.match(/#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/)
    if (hexMatch) {
      result.push(normalizeHex(hexMatch[0]))
      continue
    }

    // Check for GIMP GPL format: "255 128   0  Name"
    const rgbMatch = cleanLine.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/)
    if (rgbMatch) {
      const r = Math.min(255, parseInt(rgbMatch[1], 10))
      const g = Math.min(255, parseInt(rgbMatch[2], 10))
      const b = Math.min(255, parseInt(rgbMatch[3], 10))
      const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
      result.push(hex.toLowerCase())
    }
  }

  return Array.from(new Set(result))
}

/**
 * Initiates browser download of color array as a .hex text file.
 */
export function exportPaletteAsHex(colors: string[], filename = 'meshcoat-palette.hex'): void {
  const content = colors.map((c) => normalizeHex(c)).join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Initiates browser download of color array as a JSON file.
 */
export function exportPaletteAsJson(colors: string[], name = 'Custom Palette', filename = 'meshcoat-palette.json'): void {
  const data = {
    name,
    exportedAt: new Date().toISOString(),
    colors: colors.map((c) => normalizeHex(c))
  }
  const content = JSON.stringify(data, null, 2)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
