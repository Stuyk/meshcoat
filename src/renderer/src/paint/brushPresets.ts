import { createSignal } from 'solid-js'
import {
  parseAbr,
  getStandardBrushPresets,
  type AbrBrushPreset,
  type AbrFileResult
} from './abrLoader'
import { setSpacing, setTipTexturePath } from './brush'
import { idbGet, idbDelete } from '../utils/idbStorage'
import { readFileBytes, writeFileParts } from '../utils/fileIo'
import { createLogger } from '../utils/logger'

const logger = createLogger('brushes')

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

/**
 * Loads imported packs: one file per pack on disk (see main/brushStore.ts).
 *
 * Older builds kept every pack in one brush-packs.json, mirrored to IndexedDB
 * and, when small, localStorage. That single file stopped saving once it got
 * too big to stringify (#55), while the IndexedDB copy kept every pack — so
 * on first run the stores are merged by pack name, anything not yet in its
 * own file is written out, and the old copies are retired. That brings back
 * packs the old file silently dropped.
 */
export async function initBrushPresets(): Promise<void> {
  const fromFiles = await loadPackFiles()
  let customPacks = fromFiles

  const legacy = await loadLegacyPacks()
  if (legacy.length > 0) {
    const have = new Set(fromFiles.map((p) => p.packName))
    const missing = legacy.filter((p) => !have.has(p.packName))
    let migrated = true
    for (const pack of missing) {
      migrated = (await persistPack(pack)) && migrated
    }
    customPacks = [...fromFiles, ...missing]
    if (missing.length > 0) {
      logger.info(`Migrated ${missing.length} brush pack(s) to per-pack files`)
    }
    // Only drop the old copies once every pack is safely in its own file.
    if (migrated) {
      await retireLegacyPacks()
    }
  }

  setBrushPacks([standardPack, ...customPacks])
  restoreActiveBrushPreset(brushPacks())
  restoreBrushGroup(brushPacks())
}

async function loadPackFiles(): Promise<AbrFileResult[]> {
  let files: string[] = []
  try {
    ;({ files } = await window.api.listBrushPackFiles())
  } catch (err) {
    logger.warn('Failed to list brush pack files:', err)
  }
  const packs: AbrFileResult[] = []
  for (const file of files) {
    const pack = await readPackFile(file)
    if (pack) {
      packs.push(pack)
    }
  }
  return packs
}

/** One pack file, or null (logged) when it's unreadable — one bad file mustn't cost the rest. */
async function readPackFile(file: string): Promise<AbrFileResult | null> {
  try {
    const pack = JSON.parse(new TextDecoder().decode(await readFileBytes(file)))
    return pack && Array.isArray(pack.brushes) ? pack : null
  } catch (err) {
    logger.warn('Skipping unreadable brush pack file:', file, err)
    return null
  }
}

/** Every pack any older store still holds, de-duplicated by name (first store wins). */
async function loadLegacyPacks(): Promise<AbrFileResult[]> {
  const sources: AbrFileResult[][] = []
  try {
    const { legacy } = await window.api.listBrushPackFiles()
    if (legacy) {
      const data = JSON.parse(new TextDecoder().decode(await readFileBytes(legacy)))
      if (Array.isArray(data)) {
        sources.push(data)
      }
    }
  } catch (err) {
    logger.warn('Failed to read legacy brush-packs.json:', err)
  }
  try {
    const idbData = await idbGet<AbrFileResult[]>(STORAGE_KEY)
    if (Array.isArray(idbData)) {
      sources.push(idbData)
    }
  } catch (err) {
    logger.warn('Failed to load brush packs from IndexedDB:', err)
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const localData = raw ? JSON.parse(raw) : null
    if (Array.isArray(localData)) {
      sources.push(localData)
    }
  } catch (err) {
    logger.warn('Failed to restore brush packs from localStorage:', err)
  }
  const byName = new Map<string, AbrFileResult>()
  for (const pack of sources.flat()) {
    if (pack?.packName && pack.packName !== standardPack.packName && !byName.has(pack.packName)) {
      byName.set(pack.packName, pack)
    }
  }
  return [...byName.values()]
}

async function retireLegacyPacks(): Promise<void> {
  await window.api.retireLegacyBrushPacks()
  await idbDelete(STORAGE_KEY).catch(() => {})
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable — nothing to remove.
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

/** Writes one pack to its own file. Resolves false (and logs) if it couldn't be saved. */
async function persistPack(pack: AbrFileResult): Promise<boolean> {
  try {
    const path = await window.api.brushPackPath(pack.packName)
    const ok = await writeFileParts(path, [new TextEncoder().encode(JSON.stringify(pack))])
    if (!ok) {
      logger.error('Failed to save brush pack:', pack.packName)
    }
    return ok
  } catch (err) {
    logger.error('Failed to save brush pack:', pack.packName, err)
    return false
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
  void persistPack(pack)
}

/** Removes a brush pack by name. */
export function removeBrushPack(packName: string): void {
  if (packName === 'Standard Tips') {
    return
  }
  const next = brushPacks().filter((p) => p.packName !== packName)
  setBrushPacks(next)
  void window.api.deleteBrushPackFile(packName)

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
