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
const BRUSH_GROUP_KEY = 'slip_brush_group_v1'

const standardPack: AbrFileResult = {
  fileName: 'Standard Tips',
  packName: 'Standard Tips',
  brushes: getStandardBrushPresets()
}

const [brushPacks, setBrushPacks] = createSignal<AbrFileResult[]>([standardPack])
const [activeBrushPreset, setActiveBrushPresetRaw] = createSignal<AbrBrushPreset | null>(null)
const [isBrushManagerOpen, setIsBrushManagerOpen] = createSignal(false)

/**
 * Brush group: several tips the viewport swaps between on its own, so one
 * pass of grunge lays down a mix of different stamps instead of the same tip
 * at different angles. When it swaps follows brush.jitterScope — once per
 * stroke (each click) or on every dab of a drag.
 */
export type BrushGroupOrder = 'random' | 'cycle'
const [brushGroup, setBrushGroupRaw] = createSignal<AbrBrushPreset[]>([])
const [brushGroupOrder, setBrushGroupOrderRaw] = createSignal<BrushGroupOrder>('random')
let cycleIndex = -1
let lastPickId: string | null = null

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
    customPacks = loadLegacyPacksFromLocalStorage()
  }

  const allPacks =
    customPacks && customPacks.length > 0 ? [standardPack, ...customPacks] : [standardPack]
  setBrushPacks(allPacks)

  restoreActiveBrushPreset(allPacks)
  restoreBrushGroup(allPacks)
}

/** Reads the legacy localStorage pack list and migrates it into IndexedDB/disk storage. Returns null on any failure or empty result. */
function loadLegacyPacksFromLocalStorage(): AbrFileResult[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const localData = JSON.parse(raw) as AbrFileResult[]
    if (!Array.isArray(localData) || localData.length === 0) {
      return null
    }
    // Migrate into IndexedDB and Electron disk
    void persistPacks([standardPack, ...localData])
    return localData
  } catch (err) {
    console.warn('Failed to restore brush packs from localStorage:', err)
    return null
  }
}

/** Re-selects whatever brush preset was active last session, if it still exists in one of the hydrated packs. */
function restoreActiveBrushPreset(allPacks: AbrFileResult[]): void {
  let savedActiveId: string | null = null
  try {
    savedActiveId = localStorage.getItem(ACTIVE_PRESET_KEY)
  } catch {
    // Ignore preset restoration errors
  }
  if (!savedActiveId) {
    return
  }
  for (const pack of allPacks) {
    const found = pack.brushes.find((b) => b.id === savedActiveId)
    if (!found) {
      continue
    }
    selectBrushPreset(found)
    return
  }
}

/** Re-creates last session's brush group from whichever of its tips still exist. */
function restoreBrushGroup(allPacks: AbrFileResult[]): void {
  let saved: { ids?: string[]; order?: BrushGroupOrder } | null = null
  try {
    const raw = localStorage.getItem(BRUSH_GROUP_KEY)
    saved = raw ? JSON.parse(raw) : null
  } catch {
    // A corrupt entry just means no group this session.
  }
  if (!saved) {
    return
  }
  if (saved.order === 'random' || saved.order === 'cycle') {
    setBrushGroupOrderRaw(saved.order)
  }
  const byId = new Map(allPacks.flatMap((p) => p.brushes.map((b) => [b.id, b] as const)))
  const members = (saved.ids ?? []).map((id) => byId.get(id)).filter((b) => !!b)
  setBrushGroupRaw(members)
}

function persistBrushGroup(): void {
  try {
    localStorage.setItem(
      BRUSH_GROUP_KEY,
      JSON.stringify({ ids: brushGroup().map((b) => b.id), order: brushGroupOrder() })
    )
  } catch {
    // Storage unavailable — the group just won't survive a restart.
  }
}

function setBrushGroup(next: AbrBrushPreset[]): void {
  setBrushGroupRaw(next)
  cycleIndex = -1
  lastPickId = null
  persistBrushGroup()
}

/**
 * Ctrl+click in the library: adds or removes a tip from the group. Starting a
 * group pulls in the tip already selected, since that is almost always the
 * first one the artist meant to include.
 */
export function toggleBrushGroupMember(preset: AbrBrushPreset): void {
  const current = brushGroup()
  if (current.some((b) => b.id === preset.id)) {
    const remaining = current.filter((b) => b.id !== preset.id)
    setBrushGroup(remaining)
    if (activeBrushPreset()?.id === preset.id && remaining.length > 0) {
      selectBrushPreset(remaining[0], { keepGroup: true })
    }
    return
  }
  const active = activeBrushPreset()
  const seed = current.length === 0 && active && active.id !== preset.id ? [active] : []
  setBrushGroup([...current, ...seed, preset])
  // The tip readout shows the active preset; keep it pointing into the group.
  if (!active || !brushGroup().some((b) => b.id === active.id)) {
    selectBrushPreset(preset, { keepGroup: true })
  }
}

export function clearBrushGroup(): void {
  setBrushGroup([])
}

export function setBrushGroupOrder(order: BrushGroupOrder): void {
  setBrushGroupOrderRaw(order)
  cycleIndex = -1
  persistBrushGroup()
}

/** True when the viewport should be swapping tips — a group of one is just a brush. */
export function brushGroupActive(): boolean {
  return brushGroup().length > 1
}

/**
 * Picks the group's next tip. Random never repeats the previous pick back to
 * back, so a short group still visibly changes on every click.
 */
export function nextBrushGroupTip(): AbrBrushPreset | null {
  const group = brushGroup()
  if (group.length < 2) {
    return null
  }
  let pick: AbrBrushPreset
  if (brushGroupOrder() === 'cycle') {
    cycleIndex = (cycleIndex + 1) % group.length
    pick = group[cycleIndex]
  } else {
    const pool = group.filter((b) => b.id !== lastPickId)
    pick = pool[Math.floor(Math.random() * pool.length)]
  }
  lastPickId = pick.id
  return pick
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
export function selectBrushPreset(
  preset: AbrBrushPreset | null,
  options: { keepGroup?: boolean } = {}
): void {
  // Picking a single tip (plain click, reset) means "this brush", not "this
  // brush plus whatever group was running".
  if (!options.keepGroup && brushGroup().length > 0) {
    setBrushGroup([])
  }
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
  if (packName === 'Standard Tips') {
    return
  }
  const next = brushPacks().filter((p) => p.packName !== packName)
  setBrushPacks(next)
  void persistPacks(next)

  if (brushGroup().some((b) => b.packName === packName)) {
    setBrushGroup(brushGroup().filter((b) => b.packName !== packName))
  }
  // If active brush was in this pack, clear it
  if (activeBrushPreset()?.packName === packName) {
    selectBrushPreset(null, { keepGroup: true })
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
  group: brushGroup,
  groupOrder: brushGroupOrder,
  groupActive: brushGroupActive,
  toggleGroupMember: toggleBrushGroupMember,
  clearGroup: clearBrushGroup,
  setGroupOrder: setBrushGroupOrder,
  nextGroupTip: nextBrushGroupTip,
  addPack: addBrushPack,
  removePack: removeBrushPack,
  loadAbrFile,
  loadAbrPath
}
