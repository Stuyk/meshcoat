import { createSignal } from 'solid-js'
import { isValidHex, normalizeHex } from '../utils/colorUtils'
import { loadSavedSwatches, saveSavedSwatches, type PalettePreset } from './palettePresets'

/**
 * The user's own colors — saved swatches and palettes built from them —
 * shared app-wide. The source of truth is the global prefs file in the main
 * process (so they survive a cleared browser profile and are there in every
 * project); localStorage is kept as a synchronous cache so the panel paints
 * with the right colors on the first frame, before the IPC round trip lands.
 */

const CUSTOM_PALETTES_KEY = 'meshcoat:custom_palettes'
const MAX_SWATCHES = 48

function cleanColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) {
    return []
  }
  return colors.filter((c) => typeof c === 'string' && isValidHex(c)).map((c) => normalizeHex(c))
}

function cleanPalettes(list: unknown): PalettePreset[] {
  if (!Array.isArray(list)) {
    return []
  }
  return list
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({ id: p.id, name: p.name, colors: cleanColors(p.colors) }))
}

function loadCachedPalettes(): PalettePreset[] {
  try {
    return cleanPalettes(JSON.parse(localStorage.getItem(CUSTOM_PALETTES_KEY) ?? '[]'))
  } catch {
    return []
  }
}

const [savedSwatches, setSavedSwatchesRaw] = createSignal<string[]>(loadSavedSwatches())
const [customPalettes, setCustomPalettesRaw] = createSignal<PalettePreset[]>(loadCachedPalettes())

function persist(): void {
  saveSavedSwatches(savedSwatches())
  try {
    localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(customPalettes()))
  } catch {
    // Cache only — prefs below is the source of truth.
  }
  void window.api
    ?.setColorLibrary({ savedSwatches: savedSwatches(), customPalettes: customPalettes() })
    .catch(() => {})
}

let hydrated = false

/** Pulls the library from global prefs once; migrates the local cache up if prefs has none yet. */
export async function hydrateColorLibrary(): Promise<void> {
  if (hydrated || !window.api?.getColorLibrary) {
    return
  }
  hydrated = true
  try {
    const library = await window.api.getColorLibrary()
    if (!library) {
      persist()
      return
    }
    if (library.savedSwatches) {
      setSavedSwatchesRaw(cleanColors(library.savedSwatches))
    }
    if (library.customPalettes) {
      setCustomPalettesRaw(cleanPalettes(library.customPalettes))
    }
    saveSavedSwatches(savedSwatches())
    localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(customPalettes()))
  } catch {
    // No prefs bridge or unreadable prefs: keep the cached library.
  }
}

export function setSavedSwatches(next: string[] | ((prev: string[]) => string[])): void {
  const value = typeof next === 'function' ? next(savedSwatches()) : next
  setSavedSwatchesRaw(cleanColors(value).slice(0, MAX_SWATCHES))
  persist()
}

/** Snapshots the current saved swatches into a new named palette; returns it, or null if there's nothing to save. */
export function saveSwatchesAsPalette(name?: string): PalettePreset | null {
  const colors = savedSwatches()
  if (colors.length === 0) {
    return null
  }
  const palette: PalettePreset = {
    id: `custom-${Date.now().toString(36)}`,
    name: name?.trim() || `My Palette ${customPalettes().length + 1}`,
    colors: [...colors]
  }
  setCustomPalettesRaw((prev) => [...prev, palette])
  persist()
  return palette
}

export function renameCustomPalette(id: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) {
    return
  }
  setCustomPalettesRaw((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)))
  persist()
}

export function deleteCustomPalette(id: string): void {
  setCustomPalettesRaw((prev) => prev.filter((p) => p.id !== id))
  persist()
}

export function addCustomPalette(name: string, colors: string[]): PalettePreset {
  const palette: PalettePreset = {
    id: `custom-${Date.now().toString(36)}`,
    name: name.trim() || `My Palette ${customPalettes().length + 1}`,
    colors: cleanColors(colors).slice(0, 48)
  }
  setCustomPalettesRaw((prev) => [...prev, palette])
  persist()
  return palette
}

export const colorLibrary = {
  savedSwatches,
  customPalettes,
  setSavedSwatches,
  saveSwatchesAsPalette,
  renameCustomPalette,
  deleteCustomPalette,
  addCustomPalette,
  hydrateColorLibrary
}
