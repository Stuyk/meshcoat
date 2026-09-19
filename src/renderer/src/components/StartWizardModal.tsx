import { createSignal, createEffect, Show, For } from 'solid-js'
import * as THREE from 'three'
import { Modal, Button, Badge } from './ui'
import {
  CubeIcon,
  FolderOpenIcon,
  AppIcon,
  SparklesIcon,
  ClockIcon,
  RefreshCwIcon,
  XIcon,
  ImagesIcon,
  LayersIcon,
  FolderIcon,
  CopyIcon,
  ChevronDownIcon
} from './icons'
import { DEFAULT_TEXTURE_SIZE, type TextureSize } from '../paint/paintEngine'
import { parseChannelSuffix, type MaterialMapSlot } from '../paint/materialSets'
import { loadModel } from '../viewport/modelLoader'
import type { InitialPbrTextures, InitialTexturePayload } from '../viewport/Viewport'

type RecentEntry = Awaited<ReturnType<typeof window.api.getRecentProjects>>[number]

/** The only channels an InitialPbrTextures map actually holds — parseChannelSuffix also reports 'ao'/'height', which this wizard doesn't collect. */
const PBR_SLOT_KEYS: readonly (keyof InitialPbrTextures)[] = [
  'baseColor',
  'roughness',
  'metalness',
  'normal',
  'orm'
]

function hasAnyChannel(textures: InitialPbrTextures): boolean {
  return PBR_SLOT_KEYS.some((key) => !!textures[key])
}

/** Fills `targets[parsed.channel]` with `filePath` if that's a slot this wizard collects and it isn't already filled. */
function assignChannelIfEmpty(
  parsed: { channel: MaterialMapSlot },
  filePath: string,
  targets: InitialPbrTextures
): void {
  const key = parsed.channel as keyof InitialPbrTextures
  if (!PBR_SLOT_KEYS.includes(key) || targets[key]) {
    return
  }
  targets[key] = filePath
}

/** Every channel among `files` whose stem satisfies `matchesStem`, first match per channel wins. */
function detectMatchingTextures(
  files: string[],
  matchesStem: (stem: string) => boolean
): InitialPbrTextures {
  const detected: InitialPbrTextures = {}
  for (const filePath of files) {
    const parsed = parseChannelSuffix(filePath)
    if (!parsed || !matchesStem(parsed.stem.toLowerCase())) {
      continue
    }
    assignChannelIfEmpty(parsed, filePath, detected)
  }
  return detected
}

function matchesModelStem(stem: string, modelStem: string): boolean {
  return (
    stem === modelStem ||
    modelStem.startsWith(stem) ||
    stem.startsWith(modelStem) ||
    stem.replace(/[-_]/g, '') === modelStem.replace(/[-_]/g, '')
  )
}

function matchesPieceStem(stem: string, pieceName: string, cleanPieceName: string): boolean {
  const cleanStem = stem.replace(/[^a-z0-9]/g, '')
  return (
    cleanStem.includes(cleanPieceName) ||
    cleanPieceName.includes(cleanStem) ||
    stem === pieceName.toLowerCase()
  )
}

/** Per-piece texture detection (Pass 1): each piece name is matched independently against every file's stem. */
function detectPerPieceTextures(
  pieceNames: string[],
  files: string[]
): { detectedPieces: Record<string, InitialPbrTextures>; perPieceCount: number } {
  const detectedPieces: Record<string, InitialPbrTextures> = {}
  let perPieceCount = 0

  for (const pieceName of pieceNames) {
    const cleanPieceName = pieceName.toLowerCase().replace(/[^a-z0-9]/g, '')
    const pTextures = detectMatchingTextures(files, (stem) =>
      matchesPieceStem(stem, pieceName, cleanPieceName)
    )
    if (!hasAnyChannel(pTextures)) {
      continue
    }
    detectedPieces[pieceName] = pTextures
    perPieceCount += PBR_SLOT_KEYS.filter((key) => !!pTextures[key]).length
  }

  return { detectedPieces, perPieceCount }
}

/** Fallback (Pass 3): when every texture in the folder shares one stem, they're assumed to belong to this one model regardless of name. */
function detectSingleStemTextures(files: string[]): InitialPbrTextures {
  const stems = new Set<string>()
  for (const filePath of files) {
    const parsed = parseChannelSuffix(filePath)
    if (parsed) {
      stems.add(parsed.stem.toLowerCase())
    }
  }
  if (stems.size !== 1) {
    return {}
  }
  return detectMatchingTextures(files, () => true)
}

const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'blend']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'tga']

const SIZE_DESCRIPTIONS: Record<TextureSize, { label: string; desc: string }> = {
  512: { label: '512×512', desc: 'Fastest preview' },
  1024: { label: '1024×1024', desc: 'Standard' },
  2048: { label: '2048×2048', desc: 'High-Res (Recommended)' },
  4096: { label: '4096×4096', desc: 'Ultra 4K production' },
  8192: { label: '8192×8192', desc: 'Extreme 8K detail' }
}

export type WizardTab = 'model' | 'primitives' | 'recents'
export type TextureMappingMode = 'shared' | 'per-piece'

export interface StartWizardModalProps {
  isOpen: boolean
  onClose: () => void
  onStartScratch: (textureSize: TextureSize, primitive?: 'sphere' | 'cube') => Promise<void>
  onOpenModel: (
    modelPath: string,
    textureSize: TextureSize,
    initialTextures?: InitialTexturePayload | null,
    textureFolderPath?: string | null
  ) => Promise<void>
  onOpenProjectFile: (filePath: string) => Promise<void>
  onRestoreRecovery: (recoveryData: string) => Promise<void>
}

export default function StartWizardModal(props: StartWizardModalProps) {
  const [activeTab, setActiveTab] = createSignal<WizardTab>('model')
  const [showAdvanced, setShowAdvanced] = createSignal(false)
  const [modelPath, setModelPath] = createSignal<string | null>(null)

  // Multi-component inspection
  const [components, setComponents] = createSignal<string[]>([])
  const [selectedPieceIndex, setSelectedPieceIndex] = createSignal<number>(0)
  const [mappingMode, setMappingMode] = createSignal<TextureMappingMode>('shared')
  const [pieceTextures, setPieceTextures] = createSignal<Record<string, InitialPbrTextures>>({})

  // Shared PBR texture channel slots
  const [baseColorPath, setBaseColorPath] = createSignal<string | null>(null)
  const [roughnessPath, setRoughnessPath] = createSignal<string | null>(null)
  const [metalnessPath, setMetalnessPath] = createSignal<string | null>(null)
  const [normalPath, setNormalPath] = createSignal<string | null>(null)
  const [ormPath, setOrmPath] = createSignal<string | null>(null)

  // Texture library folder (optional shelf preload)
  const [textureFolderPath, setTextureFolderPath] = createSignal<string | null>(null)

  const [textureSize, setTextureSize] = createSignal<TextureSize>(DEFAULT_TEXTURE_SIZE)
  const [primitiveSize, setPrimitiveSize] = createSignal<TextureSize>(DEFAULT_TEXTURE_SIZE)

  const [autoDetectedCount, setAutoDetectedCount] = createSignal<number>(0)
  const [autoDetectedPiecesCount, setAutoDetectedPiecesCount] = createSignal<number>(0)
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [recents, setRecents] = createSignal<RecentEntry[]>([])
  const [recoveryData, setRecoveryData] = createSignal<{
    data: string
    timestamp: number
    name?: string
    layers?: number
  } | null>(null)

  // Refresh recent projects and check recovery on open
  createEffect(() => {
    if (props.isOpen) {
      void refreshRecents()
      void checkRecovery()
    }
  })

  async function refreshRecents(): Promise<void> {
    try {
      const items = await window.api.getRecentProjects()
      setRecents(items || [])
    } catch {}
  }

  async function checkRecovery(): Promise<void> {
    try {
      const rec = await window.api.loadRecovery()
      if (rec && rec.data) {
        try {
          const parsed = JSON.parse(rec.data)
          setRecoveryData({
            data: rec.data,
            timestamp: rec.timestamp,
            name: parsed.name || parsed.modelName || 'Untitled Project',
            layers: Array.isArray(parsed.layers) ? parsed.layers.length : undefined
          })
        } catch {
          setRecoveryData(null)
        }
      } else {
        setRecoveryData(null)
      }
    } catch {
      setRecoveryData(null)
    }
  }

  function resetForm(): void {
    setModelPath(null)
    setComponents([])
    setSelectedPieceIndex(0)
    setMappingMode('shared')
    setPieceTextures({})
    setBaseColorPath(null)
    setRoughnessPath(null)
    setMetalnessPath(null)
    setNormalPath(null)
    setOrmPath(null)
    setTextureFolderPath(null)
    setAutoDetectedCount(0)
    setAutoDetectedPiecesCount(0)
    setTextureSize(DEFAULT_TEXTURE_SIZE)
    setPrimitiveSize(DEFAULT_TEXTURE_SIZE)
    setIsLoading(false)
    setError(null)
  }

  function handleUserClose(): void {
    if (isLoading()) {
      return
    }
    resetForm()
    props.onClose()
  }

  function finishAndClose(): void {
    resetForm()
    props.onClose()
  }

  function clearPbrMaps(): void {
    setBaseColorPath(null)
    setRoughnessPath(null)
    setMetalnessPath(null)
    setNormalPath(null)
    setOrmPath(null)
    setPieceTextures({})
    setAutoDetectedCount(0)
    setAutoDetectedPiecesCount(0)
  }

  const currentPieceName = () => components()[selectedPieceIndex()] || 'Piece 1'

  function getPieceTextures(name: string): InitialPbrTextures {
    return pieceTextures()[name] || {}
  }

  function getPieceMapCount(name: string): number {
    const tex = pieceTextures()[name]
    if (!tex) {
      return 0
    }
    return Object.values(tex).filter(Boolean).length
  }

  function setPieceChannel(
    name: string,
    channel: keyof InitialPbrTextures,
    path: string | null
  ): void {
    setPieceTextures((prev) => ({
      ...prev,
      [name]: {
        ...(prev[name] || {}),
        [channel]: path
      }
    }))
  }

  function copyCurrentPieceToAll(): void {
    const current = getPieceTextures(currentPieceName())
    const updated: Record<string, InitialPbrTextures> = {}
    for (const name of components()) {
      updated[name] = { ...current }
    }
    setPieceTextures(updated)
  }

  const isPerPieceMode = () => components().length > 1 && mappingMode() === 'per-piece'

  const activeBaseColor = () =>
    isPerPieceMode() ? getPieceTextures(currentPieceName()).baseColor : baseColorPath()

  const activeRoughness = () =>
    isPerPieceMode() ? getPieceTextures(currentPieceName()).roughness : roughnessPath()

  const activeMetalness = () =>
    isPerPieceMode() ? getPieceTextures(currentPieceName()).metalness : metalnessPath()

  const activeNormal = () =>
    isPerPieceMode() ? getPieceTextures(currentPieceName()).normal : normalPath()

  const activeOrm = () => (isPerPieceMode() ? getPieceTextures(currentPieceName()).orm : ormPath())

  const activeBaseColorFilename = () => activeBaseColor()?.split(/[/\\]/).pop() ?? ''
  const activeRoughnessFilename = () => activeRoughness()?.split(/[/\\]/).pop() ?? ''
  const activeMetalnessFilename = () => activeMetalness()?.split(/[/\\]/).pop() ?? ''
  const activeNormalFilename = () => activeNormal()?.split(/[/\\]/).pop() ?? ''
  const activeOrmFilename = () => activeOrm()?.split(/[/\\]/).pop() ?? ''

  function assignSlot(slot: keyof InitialPbrTextures, path: string | null): void {
    if (isPerPieceMode()) {
      setPieceChannel(currentPieceName(), slot, path)
    } else {
      if (slot === 'baseColor') {
        setBaseColorPath(path)
      } else if (slot === 'roughness') {
        setRoughnessPath(path)
      } else if (slot === 'metalness') {
        setMetalnessPath(path)
      } else if (slot === 'normal') {
        setNormalPath(path)
      } else if (slot === 'orm') {
        setOrmPath(path)
      }
    }
  }

  async function inspectModelPieces(path: string): Promise<string[]> {
    try {
      let ext = path.split('.').pop() ?? ''
      let actualPath = path

      if (ext.toLowerCase() === 'blend') {
        const res = await window.api.convertBlendFile(path)
        if (!res.success || !res.glbPath) {
          setError(res.error || 'Failed to convert .blend file with Blender.')
          return []
        }
        actualPath = res.glbPath
        ext = 'glb'
      }

      const url = window.api.assetUrl(actualPath)
      const loaded = await loadModel(url, ext)
      const names = loaded.meshes.map((m) => m.name)

      // Clean up temporary Three.js objects
      loaded.root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.geometry?.dispose()
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose())
          } else {
            mesh.material?.dispose()
          }
        }
      })
      return names
    } catch (err) {
      console.error('Failed to inspect model pieces:', err)
      return []
    }
  }

  async function scanFolderForTextures(modelFilePath: string, pieceNames: string[]): Promise<void> {
    const slash = Math.max(modelFilePath.lastIndexOf('/'), modelFilePath.lastIndexOf('\\'))
    if (slash < 0) {
      return
    }
    const folder = modelFilePath.slice(0, slash)
    const fullFileName = modelFilePath.slice(slash + 1)
    const dot = fullFileName.lastIndexOf('.')
    const modelStem = (dot > 0 ? fullFileName.slice(0, dot) : fullFileName).toLowerCase()

    try {
      const files = await window.api.listTexturesInFolder(folder)
      if (!files || files.length === 0) {
        return
      }

      // Pass 1: Multi-component matching (if model has > 1 piece)
      if (pieceNames.length > 1) {
        const applied = applyDetectedPieceTextures(detectPerPieceTextures(pieceNames, files))
        if (applied) {
          return
        }
      }

      // Pass 2: Shared texture set matching model stem
      let detected = detectMatchingTextures(files, (stem) => matchesModelStem(stem, modelStem))
      // Pass 3: If nothing matched the model's own name, fall back to
      // whatever single stem the whole folder agrees on.
      if (!hasAnyChannel(detected)) {
        detected = detectSingleStemTextures(files)
      }

      applyDetectedSharedTextures(detected)
    } catch (err) {
      console.error('Failed to scan model folder for sibling textures:', err)
    }
  }

  /** Publishes a per-piece detection result to the wizard's state; returns whether anything was actually found. */
  function applyDetectedPieceTextures(result: {
    detectedPieces: Record<string, InitialPbrTextures>
    perPieceCount: number
  }): boolean {
    if (result.perPieceCount === 0) {
      return false
    }
    setPieceTextures(result.detectedPieces)
    setMappingMode('per-piece')
    setAutoDetectedCount(result.perPieceCount)
    setAutoDetectedPiecesCount(Object.keys(result.detectedPieces).length)
    return true
  }

  /** Publishes a shared-map detection result to the wizard's state, skipping slots the artist already filled in by hand. */
  function applyDetectedSharedTextures(detected: InitialPbrTextures): void {
    let count = 0
    if (detected.baseColor && !baseColorPath()) {
      setBaseColorPath(detected.baseColor)
      count++
    }
    if (detected.roughness && !roughnessPath()) {
      setRoughnessPath(detected.roughness)
      count++
    }
    if (detected.metalness && !metalnessPath()) {
      setMetalnessPath(detected.metalness)
      count++
    }
    if (detected.normal && !normalPath()) {
      setNormalPath(detected.normal)
      count++
    }
    if (detected.orm && !ormPath()) {
      setOrmPath(detected.orm)
      count++
    }
    if (count > 0) {
      setAutoDetectedCount(count)
      setAutoDetectedPiecesCount(0)
      setMappingMode('shared')
    }
  }

  async function browseModel(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: '3D Models', extensions: MODEL_EXTENSIONS }]
    })
    const path = paths?.[0]
    if (path) {
      setModelPath(path)
      setError(null)
      const pieceNames = await inspectModelPieces(path)
      setComponents(pieceNames)
      setSelectedPieceIndex(0)
      if (pieceNames.length > 1) {
        setMappingMode('shared') // default to shared, auto-discovery will switch to per-piece if piece maps found
      }
      void scanFolderForTextures(path, pieceNames)
    }
  }

  async function browseTextureSlot(slot: keyof InitialPbrTextures): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'Textures', extensions: IMAGE_EXTENSIONS }]
    })
    const path = paths?.[0]
    if (path) {
      setError(null)
      assignSlot(slot, path)
    }
  }

  async function browseTextureFolder(): Promise<void> {
    const files = await window.api.pickTextureFolder()
    if (files && files.length > 0) {
      // The listing includes subfolders, so the first file's directory isn't
      // necessarily the picked one — ask for the folder itself.
      setTextureFolderPath(await window.api.getTextureFolderRoot())
    }
  }

  async function browseProjectFile(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat', 'json'] }]
    })
    const path = paths?.[0]
    if (path) {
      setIsLoading(true)
      setError(null)
      try {
        await props.onOpenProjectFile(path)
        finishAndClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      }
    }
  }

  async function handleStartPrimitive(primitive: 'sphere' | 'cube'): Promise<void> {
    setIsLoading(true)
    setError(null)
    try {
      await props.onStartScratch(primitiveSize(), primitive)
      finishAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsLoading(false)
    }
  }

  async function handleOpenModel(): Promise<void> {
    const path = modelPath()
    if (!path) {
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      let initialPayload: InitialTexturePayload | null = null

      if (components().length > 1 && mappingMode() === 'per-piece') {
        const pieces = pieceTextures()
        const hasAny = Object.values(pieces).some((p) => Object.values(p).some(Boolean))
        if (hasAny) {
          initialPayload = {
            mode: 'per-piece',
            pieces
          }
        }
      } else {
        const shared: InitialPbrTextures = {
          baseColor: baseColorPath(),
          roughness: roughnessPath(),
          metalness: metalnessPath(),
          normal: normalPath(),
          orm: ormPath()
        }
        const hasAny = Object.values(shared).some(Boolean)
        if (hasAny) {
          initialPayload = {
            mode: 'shared',
            textures: shared
          }
        }
      }

      await props.onOpenModel(path, textureSize(), initialPayload, textureFolderPath())
      finishAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsLoading(false)
    }
  }

  async function handleRestoreRecovery(): Promise<void> {
    const rec = recoveryData()
    if (!rec) {
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      await props.onRestoreRecovery(rec.data)
      finishAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsLoading(false)
    }
  }

  async function handleDiscardRecovery(): Promise<void> {
    await window.api.clearRecovery()
    setRecoveryData(null)
  }

  async function handleClearRecents(): Promise<void> {
    await window.api.clearRecentProjects()
    setRecents([])
  }

  const modelFilename = () => modelPath()?.split(/[/\\]/).pop() ?? ''
  const folderDisplayName = () => textureFolderPath()?.split(/[/\\]/).pop() ?? ''

  const configuredPbrCount = () => {
    if (components().length > 1 && mappingMode() === 'per-piece') {
      let count = 0
      for (const p of Object.values(pieceTextures())) {
        count += Object.values(p).filter(Boolean).length
      }
      return count
    }
    return [baseColorPath(), roughnessPath(), metalnessPath(), normalPath(), ormPath()].filter(
      Boolean
    ).length
  }

  const formatTimeAgo = (time: number): string => {
    const diff = Math.max(0, Date.now() - time)
    const mins = Math.floor(diff / 60000)
    if (mins < 1) {
      return 'Just now'
    }
    if (mins < 60) {
      return `${mins}m ago`
    }
    const hours = Math.floor(mins / 60)
    if (hours < 24) {
      return `${hours}h ago`
    }
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleUserClose}
      title="Welcome to MeshCoat"
      icon={(p) => <AppIcon size={p.size} />}
      size="2xl"
      footer={
        <div class="flex items-center justify-between w-full">
          <Button
            variant="ghost"
            onClick={browseProjectFile}
            disabled={isLoading()}
            class="text-xs"
          >
            <FolderOpenIcon size={14} />
            <span>Open .meshcoat File...</span>
          </Button>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleUserClose}
              disabled={isLoading()}
              class="text-xs"
            >
              Close
            </Button>
            <Show when={activeTab() === 'model'}>
              <Button
                variant="primary"
                onClick={handleOpenModel}
                disabled={!modelPath() || isLoading()}
                class="text-xs font-medium"
              >
                <CubeIcon size={14} />
                <span>
                  {isLoading()
                    ? 'Importing Model...'
                    : modelPath()
                      ? `Import ${modelFilename()} & Start Painting`
                      : 'Choose a 3D Model to Proceed'}
                </span>
              </Button>
            </Show>
          </div>
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        {/* Error Alert */}
        <Show when={error()}>
          <div class="p-3 bg-red-950/60 border border-red-800 rounded-lg text-xs text-red-300 flex items-center justify-between">
            <span>{error()}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              class="text-red-400 hover:text-red-200 cursor-pointer"
            >
              <XIcon size={14} />
            </button>
          </div>
        </Show>

        {/* 1. Auto-Recovery Banner (if unsaved backup exists) */}
        <Show when={recoveryData()}>
          <div class="p-3.5 bg-amber-950/40 border border-amber-800/80 rounded-xl flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                <RefreshCwIcon size={18} />
              </div>
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-semibold text-amber-200 truncate">
                    Unsaved Session Detected: {recoveryData()?.name}
                  </span>
                  <Badge variant="amber" size="xs">
                    Autosave
                  </Badge>
                </div>
                <span class="text-[11px] text-zinc-400">
                  {recoveryData()?.layers !== undefined
                    ? `${recoveryData()?.layers} layer(s) • `
                    : ''}
                  Saved {formatTimeAgo(recoveryData()!.timestamp)}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="xs" onClick={handleDiscardRecovery}>
                Discard
              </Button>
              <Button
                variant="primary"
                size="xs"
                onClick={handleRestoreRecovery}
                disabled={isLoading()}
              >
                Restore Session
              </Button>
            </div>
          </div>
        </Show>

        {/* 2. Wizard Navigation Tabs */}
        <div class="flex items-center gap-1.5 p-1 bg-zinc-950/70 border border-zinc-850 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('model')}
            class={`flex items-center justify-center gap-2 flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeTab() === 'model'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/40'
            }`}
          >
            <CubeIcon
              size={14}
              class={activeTab() === 'model' ? 'text-blue-400' : 'text-zinc-500'}
            />
            <span>Import 3D Model & PBR</span>
            <Show when={configuredPbrCount() > 0}>
              <Badge variant="primary" size="xs">
                {configuredPbrCount()} map{configuredPbrCount() > 1 ? 's' : ''}
              </Badge>
            </Show>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('primitives')}
            class={`flex items-center justify-center gap-2 flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeTab() === 'primitives'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/40'
            }`}
          >
            <SparklesIcon
              size={14}
              class={activeTab() === 'primitives' ? 'text-blue-400' : 'text-zinc-500'}
            />
            <span>Quick Start Primitives</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('recents')}
            class={`flex items-center justify-center gap-2 flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeTab() === 'recents'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/40'
            }`}
          >
            <ClockIcon
              size={14}
              class={activeTab() === 'recents' ? 'text-blue-400' : 'text-zinc-500'}
            />
            <span>Recent Projects</span>
            <Show when={recents().length > 0}>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">
                {recents().length}
              </span>
            </Show>
          </button>
        </div>

        {/* 3. TAB CONTENT */}

        {/* TAB 1: 3D Model & PBR Importer */}
        <Show when={activeTab() === 'model'}>
          <div class="flex flex-col gap-4 max-h-[62vh] overflow-y-auto pr-1">
            {/* Step 1: 3D Model Selection */}
            <div class="flex flex-col gap-2 p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-zinc-200">1. Select 3D Model Mesh</span>
                <span class="text-[11px] text-zinc-500">Supports .glb, .gltf, .obj, .blend</span>
              </div>

              <Show
                when={modelPath()}
                fallback={
                  <button
                    type="button"
                    onClick={browseModel}
                    class="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-dashed border-zinc-700 hover:border-blue-500/80 bg-zinc-950/40 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer group"
                  >
                    <div class="p-2.5 rounded-full bg-blue-600/10 text-blue-400 group-hover:scale-110 transition-transform">
                      <CubeIcon size={22} />
                    </div>
                    <div class="flex flex-col items-center">
                      <span class="font-medium text-zinc-200">Choose 3D Model File</span>
                      <span class="text-[11px] text-zinc-500">Click to browse your hard drive</span>
                    </div>
                  </button>
                }
              >
                <div class="flex items-center justify-between p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="p-2.5 rounded-md bg-blue-600/20 text-blue-400 shrink-0">
                      <CubeIcon size={16} />
                    </div>
                    <div class="flex flex-col min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-semibold text-zinc-200 truncate">
                          {modelFilename()}
                        </span>
                        <Show when={components().length > 0}>
                          <Badge variant="outline" size="xs">
                            {components().length} component{components().length > 1 ? 's' : ''}
                          </Badge>
                        </Show>
                      </div>
                      <span class="text-[10px] text-zinc-500 truncate" title={modelPath() || ''}>
                        {modelPath()}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="xs" onClick={browseModel}>
                      Change
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setModelPath(null)
                        setComponents([])
                        clearPbrMaps()
                      }}
                      class="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
                      title="Clear model"
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                </div>
              </Show>

              {/* Auto-detected notification banner */}
              <Show when={autoDetectedCount() > 0}>
                <div class="flex items-center justify-between p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/60 text-[11px] text-emerald-300">
                  <div class="flex items-center gap-2">
                    <SparklesIcon size={13} class="text-emerald-400 shrink-0" />
                    <span>
                      Auto-detected{' '}
                      <strong>
                        {autoDetectedCount()} PBR texture map{autoDetectedCount() > 1 ? 's' : ''}
                      </strong>
                      {autoDetectedPiecesCount() > 0
                        ? ` across ${autoDetectedPiecesCount()} components`
                        : ' in model directory'}
                      !
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearPbrMaps}
                    class="text-[10px] text-emerald-400 hover:text-emerald-200 underline cursor-pointer"
                  >
                    Clear Auto-detected
                  </button>
                </div>
              </Show>
            </div>

            {/* Step 2: Canvas Resolution */}
            <div class="flex flex-col gap-1.5 p-3 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-zinc-200">2. Canvas Resolution</span>
                <span class="text-[10px] text-zinc-500">Affects layer detail & VRAM usage</span>
              </div>
              <div class="grid grid-cols-4 gap-1.5">
                {([1024, 2048, 4096, 8192] as TextureSize[]).map((sz) => {
                  const isSelected = () => textureSize() === sz
                  return (
                    <button
                      type="button"
                      onClick={() => setTextureSize(sz)}
                      class={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all cursor-pointer ${
                        isSelected()
                          ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-semibold shadow-sm'
                          : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/40'
                      }`}
                    >
                      <span class="text-xs font-mono">{SIZE_DESCRIPTIONS[sz].label}</span>
                      <span class="text-[9px] text-zinc-500 truncate">
                        {SIZE_DESCRIPTIONS[sz].desc}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Advanced import options.
                Collapsed by default: the common path is "pick a model, pick a
                resolution, go", and a wall of channel slots in front of that
                implies decisions a new user does not have to make. Anyone
                bringing existing maps along knows to look for them. */}
            <div class="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                class="flex items-center gap-2 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <span class={`transition-transform ${showAdvanced() ? '' : '-rotate-90'}`}>
                  <ChevronDownIcon size={13} />
                </span>
                <span>Advanced — existing PBR maps, per-component mapping, texture shelf</span>
                <Show when={configuredPbrCount() > 0}>
                  <span class="px-1.5 py-0.5 rounded bg-blue-600/20 border border-blue-500/40 text-[10px] text-blue-300">
                    {configuredPbrCount()} map{configuredPbrCount() === 1 ? '' : 's'}
                  </span>
                </Show>
              </button>

              <Show when={showAdvanced()}>
                {/* Step 2: PBR Texture Channels & Multi-Component Mapping */}
                <div class="flex flex-col gap-3 p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-semibold text-zinc-200">Existing PBR Maps</span>
                      <span class="text-[10px] text-zinc-500">(Base layer map assignments)</span>
                    </div>
                    <Show when={configuredPbrCount() > 0}>
                      <button
                        type="button"
                        onClick={clearPbrMaps}
                        class="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                      >
                        Clear All Maps
                      </button>
                    </Show>
                  </div>

                  {/* Multi-Component Mode Switcher & Component Selector */}
                  <Show when={components().length > 1}>
                    <div class="flex flex-col gap-2.5 p-3 rounded-lg bg-zinc-950/70 border border-zinc-800">
                      <div class="flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2 min-w-0">
                          <LayersIcon size={14} class="text-blue-400 shrink-0" />
                          <span class="text-xs font-semibold text-zinc-200 truncate">
                            Multi-Component Model ({components().length} Pieces)
                          </span>
                        </div>
                        <div class="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[11px] shrink-0">
                          <button
                            type="button"
                            onClick={() => setMappingMode('shared')}
                            class={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                              mappingMode() === 'shared'
                                ? 'bg-blue-600/30 text-blue-300 font-semibold border border-blue-500/40'
                                : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            Shared Texture Map (Atlas)
                          </button>
                          <button
                            type="button"
                            onClick={() => setMappingMode('per-piece')}
                            class={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                              mappingMode() === 'per-piece'
                                ? 'bg-blue-600/30 text-blue-300 font-semibold border border-blue-500/40'
                                : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            Per-Component Maps
                          </button>
                        </div>
                      </div>

                      {/* Mode explanation */}
                      <Show when={mappingMode() === 'shared'}>
                        <p class="text-[11px] text-zinc-400">
                          The textures below will be mapped across all{' '}
                          <strong>{components().length} pieces</strong> simultaneously (ideal when
                          model pieces share a single UV atlas image).
                        </p>
                      </Show>

                      {/* Per-piece component selector pills */}
                      <Show when={mappingMode() === 'per-piece'}>
                        <div class="flex flex-col gap-1.5 pt-1">
                          <div class="flex items-center justify-between">
                            <span class="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                              Select Component to Configure:
                            </span>
                            <Show when={getPieceMapCount(currentPieceName()) > 0}>
                              <button
                                type="button"
                                onClick={copyCurrentPieceToAll}
                                class="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-200 cursor-pointer"
                                title="Apply this component's textures to all other components"
                              >
                                <CopyIcon size={11} />
                                <span>Copy to all components</span>
                              </button>
                            </Show>
                          </div>

                          <div class="flex items-center gap-1.5 overflow-x-auto pb-1">
                            <For each={components()}>
                              {(name, index) => {
                                const count = getPieceMapCount(name)
                                const isSelected = () => selectedPieceIndex() === index()
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedPieceIndex(index())}
                                    class={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all shrink-0 cursor-pointer ${
                                      isSelected()
                                        ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                        : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                                    }`}
                                  >
                                    <span class="truncate max-w-[120px]">{name}</span>
                                    <span
                                      class={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                        isSelected()
                                          ? 'bg-blue-800 text-blue-200'
                                          : count > 0
                                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                                            : 'bg-zinc-800 text-zinc-500'
                                      }`}
                                    >
                                      {count > 0 ? `${count} map${count > 1 ? 's' : ''}` : 'empty'}
                                    </span>
                                  </button>
                                )
                              }}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* Subheader when configuring a specific component */}
                  <Show when={isPerPieceMode()}>
                    <div class="flex items-center justify-between px-1 text-xs">
                      <span class="text-zinc-300 font-medium">
                        Configuring maps for component:{' '}
                        <strong class="text-blue-300 font-semibold">{currentPieceName()}</strong>
                      </span>
                      <span class="text-[11px] text-zinc-500 font-mono">
                        {getPieceMapCount(currentPieceName())} channel map
                        {getPieceMapCount(currentPieceName()) !== 1 ? 's' : ''} assigned
                      </span>
                    </div>
                  </Show>

                  {/* Texture Channel Grid */}
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {/* 1. Base Color */}
                    <div class="flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/50 border border-zinc-850">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-medium text-zinc-300">
                          Base Color / Albedo
                        </span>
                        <Badge variant={activeBaseColor() ? 'success' : 'default'} size="xs">
                          {activeBaseColor() ? 'Assigned' : 'Empty'}
                        </Badge>
                      </div>
                      <Show
                        when={activeBaseColor()}
                        fallback={
                          <button
                            type="button"
                            onClick={() => browseTextureSlot('baseColor')}
                            class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all"
                          >
                            <ImagesIcon size={12} class="text-zinc-500" />
                            <span>Browse Base Color...</span>
                          </button>
                        }
                      >
                        <div class="flex items-center justify-between gap-2 p-1 rounded bg-zinc-900/60 border border-zinc-800">
                          <div class="flex items-center gap-2 min-w-0">
                            <img
                              src={window.api.assetUrl(activeBaseColor()!)}
                              alt="Base Color Preview"
                              class="w-7 h-7 rounded object-cover border border-zinc-750 shrink-0 bg-zinc-950"
                            />
                            <span
                              class="text-[11px] text-zinc-200 truncate"
                              title={activeBaseColorFilename()}
                            >
                              {activeBaseColorFilename()}
                            </span>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => browseTextureSlot('baseColor')}
                            >
                              Change
                            </Button>
                            <button
                              type="button"
                              onClick={() => assignSlot('baseColor', null)}
                              class="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                            >
                              <XIcon size={12} />
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>

                    {/* 2. Roughness */}
                    <div class="flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/50 border border-zinc-850">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-medium text-zinc-300">Roughness Map</span>
                        <Badge variant={activeRoughness() ? 'success' : 'default'} size="xs">
                          {activeRoughness() ? 'Assigned' : 'Empty'}
                        </Badge>
                      </div>
                      <Show
                        when={activeRoughness()}
                        fallback={
                          <button
                            type="button"
                            onClick={() => browseTextureSlot('roughness')}
                            class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all"
                          >
                            <ImagesIcon size={12} class="text-zinc-500" />
                            <span>Browse Roughness...</span>
                          </button>
                        }
                      >
                        <div class="flex items-center justify-between gap-2 p-1 rounded bg-zinc-900/60 border border-zinc-800">
                          <div class="flex items-center gap-2 min-w-0">
                            <img
                              src={window.api.assetUrl(activeRoughness()!)}
                              alt="Roughness Preview"
                              class="w-7 h-7 rounded object-cover border border-zinc-750 shrink-0 bg-zinc-950"
                            />
                            <span
                              class="text-[11px] text-zinc-200 truncate"
                              title={activeRoughnessFilename()}
                            >
                              {activeRoughnessFilename()}
                            </span>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => browseTextureSlot('roughness')}
                            >
                              Change
                            </Button>
                            <button
                              type="button"
                              onClick={() => assignSlot('roughness', null)}
                              class="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                            >
                              <XIcon size={12} />
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>

                    {/* 3. Metalness */}
                    <div class="flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/50 border border-zinc-850">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-medium text-zinc-300">Metalness Map</span>
                        <Badge variant={activeMetalness() ? 'success' : 'default'} size="xs">
                          {activeMetalness() ? 'Assigned' : 'Empty'}
                        </Badge>
                      </div>
                      <Show
                        when={activeMetalness()}
                        fallback={
                          <button
                            type="button"
                            onClick={() => browseTextureSlot('metalness')}
                            class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all"
                          >
                            <ImagesIcon size={12} class="text-zinc-500" />
                            <span>Browse Metalness...</span>
                          </button>
                        }
                      >
                        <div class="flex items-center justify-between gap-2 p-1 rounded bg-zinc-900/60 border border-zinc-800">
                          <div class="flex items-center gap-2 min-w-0">
                            <img
                              src={window.api.assetUrl(activeMetalness()!)}
                              alt="Metalness Preview"
                              class="w-7 h-7 rounded object-cover border border-zinc-750 shrink-0 bg-zinc-950"
                            />
                            <span
                              class="text-[11px] text-zinc-200 truncate"
                              title={activeMetalnessFilename()}
                            >
                              {activeMetalnessFilename()}
                            </span>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => browseTextureSlot('metalness')}
                            >
                              Change
                            </Button>
                            <button
                              type="button"
                              onClick={() => assignSlot('metalness', null)}
                              class="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                            >
                              <XIcon size={12} />
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>

                    {/* 4. Normal Map */}
                    <div class="flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/50 border border-zinc-850">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-medium text-zinc-300">Normal Map</span>
                        <Badge variant={activeNormal() ? 'success' : 'default'} size="xs">
                          {activeNormal() ? 'Assigned' : 'Empty'}
                        </Badge>
                      </div>
                      <Show
                        when={activeNormal()}
                        fallback={
                          <button
                            type="button"
                            onClick={() => browseTextureSlot('normal')}
                            class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all"
                          >
                            <ImagesIcon size={12} class="text-zinc-500" />
                            <span>Browse Normal Map...</span>
                          </button>
                        }
                      >
                        <div class="flex items-center justify-between gap-2 p-1 rounded bg-zinc-900/60 border border-zinc-800">
                          <div class="flex items-center gap-2 min-w-0">
                            <img
                              src={window.api.assetUrl(activeNormal()!)}
                              alt="Normal Map Preview"
                              class="w-7 h-7 rounded object-cover border border-zinc-750 shrink-0 bg-zinc-950"
                            />
                            <span
                              class="text-[11px] text-zinc-200 truncate"
                              title={activeNormalFilename()}
                            >
                              {activeNormalFilename()}
                            </span>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => browseTextureSlot('normal')}
                            >
                              Change
                            </Button>
                            <button
                              type="button"
                              onClick={() => assignSlot('normal', null)}
                              class="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                            >
                              <XIcon size={12} />
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>

                    {/* 5. Packed ORM Map (Full width) */}
                    <div class="md:col-span-2 flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/50 border border-zinc-850">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <span class="text-[11px] font-medium text-zinc-300">
                            Packed ORM Map (Occlusion / Roughness / Metallic)
                          </span>
                          <span class="text-[10px] text-zinc-500">
                            Unpacks Green & Blue channels
                          </span>
                        </div>
                        <Badge variant={activeOrm() ? 'purple' : 'default'} size="xs">
                          {activeOrm() ? 'Packed ORM' : 'Optional'}
                        </Badge>
                      </div>
                      <Show
                        when={activeOrm()}
                        fallback={
                          <button
                            type="button"
                            onClick={() => browseTextureSlot('orm')}
                            class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all"
                          >
                            <ImagesIcon size={12} class="text-purple-400" />
                            <span>Browse Packed ORM / ARM Texture...</span>
                          </button>
                        }
                      >
                        <div class="flex items-center justify-between gap-2 p-1 rounded bg-zinc-900/60 border border-zinc-800">
                          <div class="flex items-center gap-2 min-w-0">
                            <img
                              src={window.api.assetUrl(activeOrm()!)}
                              alt="ORM Map Preview"
                              class="w-7 h-7 rounded object-cover border border-zinc-750 shrink-0 bg-zinc-950"
                            />
                            <span
                              class="text-[11px] text-zinc-200 truncate"
                              title={activeOrmFilename()}
                            >
                              {activeOrmFilename()}
                            </span>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => browseTextureSlot('orm')}
                            >
                              Change
                            </Button>
                            <button
                              type="button"
                              onClick={() => assignSlot('orm', null)}
                              class="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                            >
                              <XIcon size={12} />
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </div>
                </div>
                {/* Step 3: Texture Library Folder (Optional Preload) */}
                <div class="flex flex-col gap-1.5 p-3 rounded-xl border border-zinc-800 bg-zinc-900/40">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-zinc-200">
                      Preload Texture Shelf Folder
                    </span>
                    <span class="text-[10px] text-zinc-500">Optional brush texture stamps</span>
                  </div>
                  <Show
                    when={textureFolderPath()}
                    fallback={
                      <button
                        type="button"
                        onClick={browseTextureFolder}
                        class="flex items-center justify-center gap-2 p-2 rounded-lg border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/30 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all"
                      >
                        <FolderIcon size={13} class="text-zinc-500" />
                        <span>Choose Texture Stamps / Materials Folder...</span>
                      </button>
                    }
                  >
                    <div class="flex items-center justify-between p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                      <div class="flex items-center gap-2 min-w-0">
                        <FolderIcon size={14} class="text-amber-400 shrink-0" />
                        {/* Folder name only: the full path is long, wraps the row
                        and tells the artist nothing they don't already know. */}
                        <span class="text-xs font-medium text-zinc-200 truncate">
                          {folderDisplayName()}
                        </span>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="xs" onClick={browseTextureFolder}>
                          Change
                        </Button>
                        <button
                          type="button"
                          onClick={() => setTextureFolderPath(null)}
                          class="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                        >
                          <XIcon size={12} />
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* TAB 2: Quick Start Primitives */}
        <Show when={activeTab() === 'primitives'}>
          <div class="flex flex-col gap-4 max-h-[62vh] overflow-y-auto pr-1">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs text-zinc-400">
                Choose a pre-unwrapped testing primitive to start painting immediately with zero
                setup:
              </span>
              {/* Resolution selector for primitives */}
              <div class="flex items-center gap-1">
                <span class="text-[11px] text-zinc-500 mr-1">Canvas:</span>
                {([1024, 2048, 4096] as TextureSize[]).map((sz) => (
                  <button
                    type="button"
                    onClick={() => setPrimitiveSize(sz)}
                    class={`px-2 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer ${
                      primitiveSize() === sz
                        ? 'bg-blue-600/20 border border-blue-500 text-blue-300 font-semibold'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Primitive 1: Sphere */}
              <div
                onClick={() => handleStartPrimitive('sphere')}
                class="flex flex-col justify-between p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-850/50 hover:border-blue-500/50 transition-all cursor-pointer group shadow-sm"
              >
                <div class="flex flex-col gap-3">
                  <div class="w-12 h-12 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <SparklesIcon size={24} />
                  </div>
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-zinc-100 group-hover:text-white">
                        UV Sphere
                      </span>
                      <Badge variant="primary" size="xs">
                        Equirectangular
                      </Badge>
                    </div>
                    <p class="text-xs text-zinc-400 leading-relaxed">
                      Continuous smooth geometry with no seam overlap. Best for organic painting,
                      characters, skin, soft gradients, and brush testing.
                    </p>
                  </div>
                </div>

                <div class="pt-5 flex items-center justify-between">
                  <span class="text-[10px] text-zinc-500 font-mono">48 Lat × 32 Long</span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isLoading()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleStartPrimitive('sphere')
                    }}
                  >
                    {isLoading() ? 'Starting...' : 'Start Painting Sphere'}
                  </Button>
                </div>
              </div>

              {/* Primitive 2: Cube */}
              <div
                onClick={() => handleStartPrimitive('cube')}
                class="flex flex-col justify-between p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-850/50 hover:border-purple-500/50 transition-all cursor-pointer group shadow-sm"
              >
                <div class="flex flex-col gap-3">
                  <div class="w-12 h-12 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <CubeIcon size={24} />
                  </div>
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-zinc-100 group-hover:text-white">
                        Unwrapped Cube
                      </span>
                      <Badge variant="purple" size="xs">
                        6 Non-Overlap Faces
                      </Badge>
                    </div>
                    <p class="text-xs text-zinc-400 leading-relaxed">
                      Custom 3×2 non-overlapping UV island layout for each face. Perfect for
                      hard-surface painting, crates, stamps, decals, and geometric props.
                    </p>
                  </div>
                </div>

                <div class="pt-5 flex items-center justify-between">
                  <span class="text-[10px] text-zinc-500 font-mono">6 Faces • 3×2 UV grid</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isLoading()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleStartPrimitive('cube')
                    }}
                  >
                    {isLoading() ? 'Starting...' : 'Start Painting Cube'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* TAB 3: Recent Projects */}
        <Show when={activeTab() === 'recents'}>
          <div class="flex flex-col gap-3 max-h-[62vh] overflow-y-auto pr-1">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs text-zinc-400">
                Pick up right where you left off or load an existing project file:
              </span>
              <Show when={recents().length > 0}>
                <button
                  type="button"
                  onClick={handleClearRecents}
                  class="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors"
                >
                  Clear History
                </button>
              </Show>
            </div>

            {/* Quick Open Project Button */}
            <button
              type="button"
              onClick={browseProjectFile}
              class="flex items-center gap-3 p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40 hover:bg-zinc-850/60 hover:border-zinc-700 transition-all text-left cursor-pointer group"
            >
              <div class="p-2.5 rounded-lg bg-purple-600/20 text-purple-400 group-hover:scale-105 transition-transform shrink-0">
                <FolderOpenIcon size={18} />
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold text-zinc-200 group-hover:text-white">
                  Open .meshcoat Project File...
                </span>
                <span class="text-[11px] text-zinc-500 truncate">
                  Load layered project files with layer blend modes, masks, and piece stacks
                </span>
              </div>
            </button>

            {/* Recent Items List */}
            <div class="flex flex-col gap-1.5">
              <Show
                when={recents().length > 0}
                fallback={
                  <div class="py-12 text-center text-xs text-zinc-500 italic bg-zinc-950/30 rounded-xl border border-zinc-900">
                    No recent files recorded yet.
                  </div>
                }
              >
                <For each={recents()}>
                  {(item) => {
                    const filename =
                      item.name || item.projectPath.split(/[/\\]/).pop() || 'Untitled'
                    const isProject =
                      item.type === 'project' || item.projectPath.endsWith('.meshcoat')
                    return (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsLoading(true)
                          try {
                            if (isProject) {
                              await props.onOpenProjectFile(item.projectPath)
                            } else {
                              await props.onOpenModel(item.projectPath, DEFAULT_TEXTURE_SIZE)
                            }
                            finishAndClose()
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err))
                            setIsLoading(false)
                          }
                        }}
                        class="flex items-center justify-between p-3 rounded-lg bg-zinc-950/50 hover:bg-zinc-850/70 border border-zinc-850 hover:border-zinc-750 transition-all text-left group cursor-pointer"
                      >
                        <div class="flex items-center gap-3 min-w-0">
                          {isProject ? (
                            <div class="p-2 rounded bg-purple-500/10 text-purple-400 shrink-0">
                              <LayersIcon size={15} />
                            </div>
                          ) : (
                            <div class="p-2 rounded bg-blue-500/10 text-blue-400 shrink-0">
                              <CubeIcon size={15} />
                            </div>
                          )}
                          <div class="flex flex-col min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-xs font-semibold text-zinc-200 group-hover:text-white truncate">
                                {filename}
                              </span>
                              <Badge variant={isProject ? 'purple' : 'primary'} size="xs">
                                {isProject ? 'Project' : 'Model'}
                              </Badge>
                            </div>
                            <span
                              class="text-[10px] text-zinc-500 truncate"
                              title={item.projectPath}
                            >
                              {item.projectPath}
                            </span>
                          </div>
                        </div>
                        <span class="text-[10px] text-zinc-500 shrink-0 ml-2 font-mono">
                          {formatTimeAgo(item.openedAt)}
                        </span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Modal>
  )
}
