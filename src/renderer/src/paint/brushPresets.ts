import { createSignal } from 'solid-js'
import {
  parseAbr,
  getStandardBrushPresets,
  type AbrBrushPreset,
  type AbrFileResult
} from './abrLoader'
import { setSpacing, setTipTexturePath } from './brush'
import { idbGet, idbSet } from '../utils/idbStorage'

export type { AbrBrushPreset, AbrFileResult }

const STORAGE_KEY = 'slip_custom_brush_packs_v1'
const ACTIVE_PRESET_KEY = 'slip_active_brush_preset_id'

const standardPack: AbrFileResult = {
  fileName: 'Standard Tips',
  packName: 'Standard Tips',
  brushes: getStandardBrushPresets()
}

// Signal for all brush packs
const [brushPacks, setBrushPacks] = createSignal<AbrFileResult[]>([standardPack])
// Active selected brush preset
const [activeBrushPreset, setActiveBrushPresetRaw] = createSignal<AbrBrushPreset | null>(null)
// Modal visibility signal
const [isBrushManagerOpen, setIsBrushManagerOpen] = createSignal(false)

/** Load persisted custom packs from Electron disk storage or IndexedDB on initialization */
export async function initBrushPresets(): Promise<void> {
  let customPacks: AbrFileResult[] | null = null

  // 1. Try loading from Electron userData disk storage
  if (typeof window.api?.loadBrushPacks === 'function') {
    try {
      const diskData = await window.api.loadBrushPacks()
      if (Array.isArray(diskData) && diskData.length > 0) {
        customPacks = diskData
      }
    } catch (err) {
      console.warn('Failed to load brush packs from Electron disk storage:', err)
    }
  }

  // 2. Fallback to IndexedDB (virtually unlimited quota)
  if (!customPacks) {
    try {
      const idbData = await idbGet<AbrFileResult[]>(STORAGE_KEY)
      if (Array.isArray(idbData) && idbData.length > 0) {
        customPacks = idbData
      }
    } catch (err) {
      console.warn('Failed to load brush packs from IndexedDB:', err)
    }
  }

  // 3. Fallback to localStorage (legacy migration)
  if (!customPacks) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const localData = JSON.parse(raw) as AbrFileResult[]
        if (Array.isArray(localData) && localData.length > 0) {
          customPacks = localData
          // Migrate into IndexedDB and Electron disk
          void persistPacks([standardPack, ...customPacks])
        }
      }
    } catch (err) {
      console.warn('Failed to restore brush packs from localStorage:', err)
    }
  }

  // Hydrate packs
  const allPacks = customPacks && customPacks.length > 0 ? [standardPack, ...customPacks] : [standardPack]
  setBrushPacks(allPacks)

  // Restore active brush preset if previously selected
  try {
    const savedActiveId = localStorage.getItem(ACTIVE_PRESET_KEY)
    if (savedActiveId) {
      for (const pack of allPacks) {
        const found = pack.brushes.find((b) => b.id === savedActiveId)
        if (found) {
          selectBrushPreset(found)
          break
        }
      }
    }
  } catch {
    // Ignore preset restoration errors
  }
}

/** Persist custom packs to Electron disk storage, IndexedDB, and localStorage */
export async function persistPacks(packs: AbrFileResult[]): Promise<void> {
  // Only persist user-imported packs (exclude Standard Tips)
  const custom = packs.filter((p) => p.packName !== 'Standard Tips')

  // 1. Electron filesystem storage (app.getPath('userData')/brush-packs.json)
  if (typeof window.api?.saveBrushPacks === 'function') {
    try {
      await window.api.saveBrushPacks(JSON.stringify(custom))
    } catch (err) {
      console.warn('Failed to persist brush packs to Electron disk:', err)
    }
  }

  // 2. IndexedDB storage (handles large textures without quota restrictions)
  try {
    await idbSet(STORAGE_KEY, custom)
  } catch (err) {
    console.warn('Failed to persist brush packs to IndexedDB:', err)
  }

  // 3. Optional small fallback in localStorage if small enough
  try {
    const serialized = JSON.stringify(custom)
    if (serialized.length < 2_000_000) {
      localStorage.setItem(STORAGE_KEY, serialized)
    }
  } catch {
    // Quota exceeded is normal for large brushes; IndexedDB and disk handle it.
  }
}

export function openBrushManager(): void {
  setIsBrushManagerOpen(true)
}

export function closeBrushManager(): void {
  setIsBrushManagerOpen(false)
}

/** Selects an active brush preset and configures brush spacing, texture, and mapping mode. */
export function selectBrushPreset(preset: AbrBrushPreset | null): void {
  if (!preset) {
    setActiveBrushPresetRaw(null)
    setTipTexturePath(null)
    try {
      localStorage.removeItem(ACTIVE_PRESET_KEY)
    } catch {}
    return
  }

  setActiveBrushPresetRaw(preset)
  setTipTexturePath(preset.dataUrl)
  if (typeof preset.spacing === 'number' && preset.spacing > 0) {
    setSpacing(preset.spacing)
  }
  try {
    localStorage.setItem(ACTIVE_PRESET_KEY, preset.id)
  } catch {}
}

/** Clears the active custom brush tip, reverting to a default round brush. */
export function clearBrushPreset(): void {
  selectBrushPreset(null)
}

/** Adds an imported brush pack to the library. */
export function addBrushPack(pack: AbrFileResult): void {
  const current = brushPacks()
  // Replace if exists with same packName or append
  const filtered = current.filter((p) => p.packName !== pack.packName)
  const next = [...filtered, pack]
  setBrushPacks(next)
  void persistPacks(next)
}

/** Removes a brush pack by name. */
export function removeBrushPack(packName: string): void {
  if (packName === 'Standard Tips') return
  const next = brushPacks().filter((p) => p.packName !== packName)
  setBrushPacks(next)
  void persistPacks(next)

  // If active brush was in this pack, clear it
  if (activeBrushPreset()?.packName === packName) {
    clearBrushPreset()
  }
}

/** Imports an ABR file from a File object (e.g. from file input or drag-and-drop). */
export async function loadAbrFile(file: File): Promise<AbrFileResult> {
  const buffer = await file.arrayBuffer()
  const result = parseAbr(buffer, file.name)
  if (result.brushes.length > 0) {
    addBrushPack(result)
  }
  return result
}

/** Imports an ABR file from a filesystem path via Electron IPC (or asset-file protocol fallback). */
export async function loadAbrPath(filePath: string): Promise<AbrFileResult> {
  let bytes: Uint8Array | null = null

  if (typeof window.api?.readBinaryFile === 'function') {
    try {
      bytes = await window.api.readBinaryFile(filePath)
    } catch {
      bytes = null
    }
  }

  if (!bytes) {
    // Fallback via asset-file:// protocol
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const encoded = normalized
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
    const url = `asset-file://local/${encoded}`
    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error(`Failed to read file at ${filePath} (${resp.status})`)
    }
    const buf = await resp.arrayBuffer()
    bytes = new Uint8Array(buf)
  }

  const fileName = filePath.split(/[/\\]/).pop() || 'Brushes.abr'
  const result = parseAbr(bytes, fileName)
  if (result.brushes.length > 0) {
    addBrushPack(result)
  }
  return result
}

export const brushPresets = {
  packs: brushPacks,
  active: activeBrushPreset,
  isManagerOpen: isBrushManagerOpen,
  openManager: openBrushManager,
  closeManager: closeBrushManager,
  select: selectBrushPreset,
  clear: clearBrushPreset,
  addPack: addBrushPack,
  removePack: removeBrushPack,
  loadAbrFile,
  loadAbrPath
}
