import {
  createSignal,
  createEffect,
  on,
  onMount,
  onCleanup,
  Show,
  Suspense,
  lazy,
  type JSX
} from 'solid-js'
import * as THREE from 'three'
import Viewport, {
  type ViewportHandle,
  type ChannelViewMode,
  type InitialTexturePayload,
  type PieceInfo
} from './viewport/Viewport'
import { CHANNEL_SPECS, type PaintChannel } from './paint/channels'
import TextureShelf from './components/TextureShelf'
import StatusBar from './components/BottomDock'
import { brushPresets, initBrushPresets } from './paint/brushPresets'
import LayersTab from './components/LayersTab'
import type { LayerStack } from './paint/layers'
import { GpuContextLostError } from './paint/gpuResources'
import BrushSettingsTab from './components/BrushSettingsTab'
import type { LightingMode } from './viewport/scene'
import {
  DropdownMenu,
  IconButton,
  Toast,
  Label,
  TextInput,
  type MenuItem,
  type ToastData
} from './components/ui'

// Lazy-loaded modals
const HelpModal = lazy(() => import('./components/HelpModal'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const StartWizardModal = lazy(() => import('./components/StartWizardModal'))
const BrushManagerModal = lazy(() => import('./components/BrushManagerModal'))
const EdgeWearWizard = lazy(() => import('./components/EdgeWearWizard'))
const ExportWizardModal = lazy(() => import('./components/ExportWizardModal'))
import {
  captureProject,
  encodeProject,
  deserializeProject,
  type CapturedProject
} from './utils/projectSerializer'
import { writeFileParts, readFileBytes, streamParts } from './utils/fileIo'

import {
  SlidersIcon,
  LayersIcon,
  FolderOpenIcon,
  FolderIcon,
  DownloadIcon,
  RefreshCwIcon,
  FitIcon,
  SparklesIcon,
  EdgeWearIcon,
  BookmarkIcon,
  PlusIcon,
  CubeIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  Edit2Icon,
  PanelRightIcon
} from './components/icons'
import ToolPanelDock from './components/ToolPanelDock'
import { panelsForTool, toolUsesPanel } from './paint/toolPanels'
import { openUvInspector, closeAllUvInspectors } from './utils/uvInspector'
import WorkstationHeader from './components/WorkstationHeader'
import UvPaintPanel from './components/UvPaintPanel'
import WorkstationShelf from './components/WorkstationShelf'
import { EFFECT_MODES, EFFECT_MODE_LABELS } from './paint/effectShader'
import {
  setStencilVisible,
  setStencilTransforming,
  setStencilTexturePath,
  resetStencilTransform
} from './paint/stencil'
import {
  brush,
  setTexturePath,
  clearFaceSelection,
  setSelectedFaces,
  setGeneratedTexturePath,
  resetTextureRegion,
  setTextureScale,
  stepRadius,
  type ToolMode
} from './paint/brush'
import { DEFAULT_TEXTURE_SIZE, TEXTURE_SIZE_OPTIONS, type TextureSize } from './paint/paintEngine'
import { textTool } from './paint/textTool'
import {
  selectionGroups,
  saveSelectionGroup,
  setSelectionGroups,
  type SelectionGroup
} from './paint/selectionGroups'
import type { MeshCoatProject } from './utils/projectSerializer'
import SelectionGroupsPanel from './components/SelectionGroupsPanel'
import UnsavedChangesModal from './components/UnsavedChangesModal'
import { loadLayoutProfile, saveLayoutProfile } from './utils/layoutProfile'
import { createLogger } from './utils/logger'

const logger = createLogger('app')

export default function App(): JSX.Element {
  const initialProfile = loadLayoutProfile()

  const [activeTool, setActiveToolSignal] = createSignal<ToolMode>(initialProfile.activeTool)
  const setActiveTool = (tool: ToolMode): void => {
    setActiveToolSignal(tool)
    saveLayoutProfile({ activeTool: tool })
  }

  const [showHelp, setShowHelp] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [lightingMode, setLightingModeSignal] = createSignal<LightingMode>(initialProfile.lightingMode)
  const [viewMode, setViewModeSignal] = createSignal<ChannelViewMode>(initialProfile.viewMode)
  const [wireframeVisible, setWireframeVisibleSignal] = createSignal(initialProfile.wireframeVisible)
  const [isolatePiece, setIsolatePieceSignal] = createSignal(false)
  const [showUvPanel, setShowUvPanelSignal] = createSignal(initialProfile.showUvPanel)
  const setShowUvPanel = (show: boolean | ((prev: boolean) => boolean)): void => {
    setShowUvPanelSignal((prev) => {
      const next = typeof show === 'function' ? show(prev) : show
      saveLayoutProfile({ showUvPanel: next })
      return next
    })
  }

  const [textureDrawerCollapsed, setTextureDrawerCollapsedSignal] = createSignal(
    initialProfile.textureDrawerCollapsed
  )
  const setTextureDrawerCollapsed = (collapsed: boolean | ((prev: boolean) => boolean)): void => {
    setTextureDrawerCollapsedSignal((prev) => {
      const next = typeof collapsed === 'function' ? collapsed(prev) : collapsed
      saveLayoutProfile({ textureDrawerCollapsed: next })
      return next
    })
  }

  const [textureDrawerHeight, setTextureDrawerHeightSignal] = createSignal(
    initialProfile.textureDrawerHeight
  )
  const setTextureDrawerHeight = (height: number | ((prev: number) => number)): void => {
    setTextureDrawerHeightSignal((prev) => {
      const next = typeof height === 'function' ? height(prev) : height
      saveLayoutProfile({ textureDrawerHeight: next })
      return next
    })
  }

  function startTextureDrawerResize(e: PointerEvent): void {
    e.preventDefault()
    const startY = e.clientY
    const startH = textureDrawerHeight()
    const onMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY
      const nextH = Math.max(140, Math.min(window.innerHeight * 0.6, startH + deltaY))
      setTextureDrawerHeight(nextH)
      saveLayoutProfile({ textureDrawerHeight: nextH })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // --- Right sidebar sizing (issue #22) ---------------------------------
  const SIDEBAR_DEFAULT_WIDTH = 320
  const LAYERS_DEFAULT_HEIGHT = 340
  const SIDEBAR_SIZE_KEY = 'meshcoat:sidebar_size'
  let sidebarRef: HTMLElement | undefined

  const [sidebarWidth, setSidebarWidth] = createSignal(initialProfile.sidebarWidth)
  const [sidebarCollapsed, setSidebarCollapsedSignal] = createSignal(
    initialProfile.sidebarCollapsed
  )
  const setSidebarCollapsed = (collapsed: boolean | ((prev: boolean) => boolean)): void => {
    setSidebarCollapsedSignal((prev) => {
      const next = typeof collapsed === 'function' ? collapsed(prev) : collapsed
      saveLayoutProfile({ sidebarCollapsed: next })
      return next
    })
  }
  const [layersHeightRaw, setLayersHeight] = createSignal(initialProfile.layersHeight)
  const [windowHeight, setWindowHeight] = createSignal(window.innerHeight)
  const onWindowResize = (): void => {
    setWindowHeight(window.innerHeight)
  }
  window.addEventListener('resize', onWindowResize)
  onCleanup(() => window.removeEventListener('resize', onWindowResize))
  /** Keeps at least ~150px of brush settings above the layers, whatever the window size. */
  const layersHeight = (): number => {
    void windowHeight()
    const total = sidebarRef?.clientHeight ?? window.innerHeight
    return Math.round(Math.min(Math.max(160, layersHeightRaw()), Math.max(160, total - 150)))
  }
  function setSidebarSize(next: { width?: number; layers?: number }): void {
    if (next.width !== undefined) {
      const clampedWidth = Math.round(Math.min(Math.max(280, next.width), window.innerWidth * 0.5))
      setSidebarWidth(clampedWidth)
      saveLayoutProfile({ sidebarWidth: clampedWidth })
    }
    if (next.layers !== undefined) {
      setLayersHeight(next.layers)
      saveLayoutProfile({ layersHeight: next.layers })
    }
    try {
      localStorage.setItem(
        SIDEBAR_SIZE_KEY,
        JSON.stringify({ width: sidebarWidth(), layers: layersHeightRaw() })
      )
    } catch {
      // Layout sizes are a per-machine convenience.
    }
  }
  function dragWith(e: PointerEvent, cursor: string, onMove: (ev: PointerEvent) => void): void {
    e.preventDefault()
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = cursor
    const up = (): void => {
      document.body.style.cursor = prevCursor
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
  }
  function startSidebarResize(e: PointerEvent): void {
    const startX = e.clientX
    const startW = sidebarWidth()
    dragWith(e, 'col-resize', (ev) => setSidebarSize({ width: startW + (startX - ev.clientX) }))
  }
  function startLayersResize(e: PointerEvent): void {
    const startY = e.clientY
    const startH = layersHeight()
    dragWith(e, 'row-resize', (ev) => setSidebarSize({ layers: startH + (startY - ev.clientY) }))
  }
  function toggleLayersHalf(): void {
    const half = Math.round((sidebarRef?.clientHeight ?? window.innerHeight) / 2)
    setSidebarSize({
      layers: Math.abs(layersHeight() - half) < 20 ? LAYERS_DEFAULT_HEIGHT : half
    })
  }
  const [textures, setTextures] = createSignal<string[]>([])
  /** Folder the shelf was loaded from, so it can offer its subfolders as a filter. */
  const [textureRoot, setTextureRoot] = createSignal<string | null>(null)
  const [layersVersion, setLayersVersion] = createSignal(0)
  const [piecesVersion, setPiecesVersion] = createSignal(0)
  const [showStencilPanel, setShowStencilPanel] = createSignal(false)

  /** Whether the docked tool-panel column beside the brush settings is collapsed. */
  const [toolPanelCollapsed, setToolPanelCollapsedSignal] = createSignal(
    initialProfile.toolPanelCollapsed
  )
  const setToolPanelCollapsed = (collapsed: boolean | ((prev: boolean) => boolean)): void => {
    setToolPanelCollapsedSignal((prev) => {
      const next = typeof collapsed === 'function' ? collapsed(prev) : collapsed
      saveLayoutProfile({ toolPanelCollapsed: next })
      return next
    })
  }
  const [toolPanelWidth, setToolPanelWidth] = createSignal(initialProfile.toolPanelWidth)

  function startToolPanelResize(e: PointerEvent): void {
    const startX = e.clientX
    const startW = toolPanelWidth()
    dragWith(e, 'col-resize', (ev) => {
      const deltaX = startX - ev.clientX
      const clamped = Math.round(Math.min(Math.max(200, startW + deltaX), window.innerWidth * 0.4))
      setToolPanelWidth(clamped)
      saveLayoutProfile({ toolPanelWidth: clamped })
    })
  }
  const [showExportWizard, setShowExportWizard] = createSignal(false)

  createEffect(() => {
    // Picking a texture makes the material and crop panels relevant, so make
    // sure the dock they live in is actually on screen — but only if the active
    // tool is one that owns a material panel.
    if (brush.texturePath() && toolUsesPanel(activeTool(), 'material')) {
      setToolPanelCollapsed(false)
    }
  })

  createEffect(() => {
    const show = showStencilPanel()
    setStencilVisible(show)
    if (!show) {
      setStencilTransforming(false)
    }
  })

  /**
   * Pops a layer's own sheet out into its own window at full resolution.
   *
   * Keyed per piece + layer, so inspecting the same layer twice refocuses that
   * window instead of opening another, while two different layers can sit open
   * side by side for comparison. `render` is re-run on the popout's Refresh
   * button, which is what makes it useful while painting: paint a stroke, hit
   * Refresh, see exactly which texels moved.
   */
  function inspectLayer(layer: { id: number; name: string; isMask?: boolean }): void {
    const handle = viewportHandle
    if (!handle) {
      return
    }
    const pieceIndex = handle.activePieceIndex()
    const size = handle.pieces()[pieceIndex]?.textureSize
    const ok = openUvInspector({
      key: `meshcoat-layer-${pieceIndex}-${layer.id}`,
      title: layer.name,
      subtitle: [
        activePieceName() || `Piece ${pieceIndex + 1}`,
        layer.isMask ? 'mask coverage' : 'base color',
        size ? `${size}x${size}` : null
      ]
        .filter(Boolean)
        .join('  ·  '),
      render: () => handle.exportLayerPng(layer.id, 'baseColor', pieceIndex)
    })
    if (!ok) {
      showToast('Could not open the inspector window', 'error')
    }
  }

  /** Same, for the flattened stack — what the model actually shows. */
  function inspectFlattened(): void {
    const handle = viewportHandle
    if (!handle) {
      return
    }
    const pieceIndex = handle.activePieceIndex()
    const size = handle.pieces()[pieceIndex]?.textureSize
    const ok = openUvInspector({
      key: `meshcoat-flattened-${pieceIndex}`,
      title: 'Flattened',
      subtitle: [
        activePieceName() || `Piece ${pieceIndex + 1}`,
        'all layers composited',
        size ? `${size}x${size}` : null
      ]
        .filter(Boolean)
        .join('  ·  '),
      render: () => handle.exportBaseColorPng(pieceIndex)
    })
    if (!ok) {
      showToast('Could not open the inspector window', 'error')
    }
  }

  const currentLayerCount = (): number => {
    void layersVersion()
    return viewportHandle?.getLayerStack()?.layers.length ?? 1
  }
  const canUndo = (): boolean => {
    void layersVersion()
    return viewportHandle?.canUndo() ?? false
  }
  const canRedo = (): boolean => {
    void layersVersion()
    return viewportHandle?.canRedo() ?? false
  }

  /** Texture sets of the loaded model — one per mesh piece. */
  const modelPieces = (): PieceInfo[] => {
    void piecesVersion()
    return viewportHandle?.pieces() ?? []
  }
  const activePiece = (): number => {
    void piecesVersion()
    return viewportHandle?.activePieceIndex() ?? 0
  }

  /**
   * The Text tool paints with a texture the app generates rather than one off
   * the shelf, so entering it swaps the brush texture for the rendered string
   * (re-rendered on every edit) and leaving puts the artist's own texture back.
   */
  let textureBeforeText: string | null = null
  createEffect(
    on([activeTool, () => textTool.dataUrl()], ([tool, dataUrl], prev) => {
      const wasText = prev?.[0] === 'text'
      if (tool === 'text') {
        if (!wasText) {
          textureBeforeText = brush.texturePath()
          // A crop drawn on a shelf image means nothing on a line of text.
          resetTextureRegion()
          // The shader tints the texture by the paint color; the text carries
          // its own color, so white leaves it as rendered.
          brush.setColor('#ffffff')
        }
        setGeneratedTexturePath(dataUrl)
      } else if (wasText) {
        setGeneratedTexturePath(textureBeforeText)
        textureBeforeText = null
      }
    })
  )

  const [toast, setToast] = createSignal<ToastData | null>(null)
  const [showPieceMenu, setShowPieceMenu] = createSignal(false)
  const [pieceAliasDraft, setPieceAliasDraft] = createSignal<string | null>(null)
  /** The piece the rename was started on — the active piece can change mid-edit. */
  let pieceAliasTarget = 0
  function startPieceAlias(): void {
    pieceAliasTarget = activePiece()
    setPieceAliasDraft(modelPieces()[pieceAliasTarget]?.alias ?? '')
  }
  function commitPieceAlias(): void {
    const draft = pieceAliasDraft()
    // Blur commits too, so an untouched edit must not mark the project dirty.
    const current = modelPieces()[pieceAliasTarget]?.alias ?? ''
    if (draft !== null && draft.trim() !== current) {
      viewportHandle?.renamePiece(pieceAliasTarget, draft)
      setPiecesVersion((v) => v + 1)
      setIsDirty(true)
    }
    setPieceAliasDraft(null)
  }
  const [showEdgeWearWizard, setShowEdgeWearWizard] = createSignal(false)
  /** Which view the lower sidebar panel shows. */
  const [lowerTab, setLowerTabSignal] = createSignal<'layers' | 'selections'>(initialProfile.lowerTab)
  const setLowerTab = (tab: 'layers' | 'selections'): void => {
    setLowerTabSignal(tab)
    saveLayoutProfile({ lowerTab: tab })
  }

  const activePieceName = (): string => modelPieces()[activePiece()]?.name ?? ''

  /** Switches to the group's piece if needed, then restores its faces. */
  function recallSelectionGroup(group: SelectionGroup): void {
    const piece = modelPieces().find((p) => p.name === group.piece)
    if (!piece) {
      showToast(`"${group.name}" belongs to a piece this model no longer has`, 'warning')
      return
    }
    if (piece.index !== activePiece()) {
      // Switching pieces clears the selection, so it has to happen first.
      viewportHandle?.setActivePiece(piece.index)
    }
    // Guard against a model whose topology changed since the group was saved.
    const faces = group.faces.filter((f) => f >= 0 && f < piece.faceCount)
    setSelectedFaces(faces)
    showToast(`Selected "${group.name}" (${faces.length} faces)`, 'info')
  }

  function saveCurrentSelectionGroup(name: string): void {
    saveSelectionGroup(name, activePieceName(), brush.selectedFaces())
    setIsDirty(true)
    showToast(`Saved selection group "${name}"`, 'success')
  }

  /** Loads the groups a project file carries (none for older files). */
  function restoreSelectionGroups(project: MeshCoatProject): void {
    setSelectionGroups(
      (project.pieces ?? []).flatMap((piece) =>
        (piece.selectionGroups ?? []).map((g) => ({
          name: g.name,
          piece: piece.name,
          faces: g.faces
        }))
      )
    )
  }
  const [modelName, setModelName] = createSignal('Default Model')
  const [textureSize, setTextureSize] = createSignal<TextureSize>(DEFAULT_TEXTURE_SIZE)
  const [showStartWizard, setShowStartWizard] = createSignal(true)
  const [isDirty, setIsDirtyRaw] = createSignal(false)
  /**
   * Bumped on every edit. A save captures the project, then spends a while
   * encoding and writing it; comparing this afterwards tells whether edits
   * landed meanwhile, in which case the project has to stay dirty.
   */
  let editGeneration = 0
  /** Shown in the header while a save is writing, so a hitch reads as the save (#53). */
  const [saveActivity, setSaveActivity] = createSignal<'save' | 'autosave' | null>(null)
  const setIsDirty = (dirty: boolean): void => {
    if (dirty) {
      editGeneration++
    }
    setIsDirtyRaw(dirty)
  }
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = createSignal(false)
  const [isSavingBeforeClose, setIsSavingBeforeClose] = createSignal(false)
  const [currentProjectPath, setCurrentProjectPath] = createSignal<string | null>(null)
  const [currentModelPath, setCurrentModelPath] = createSignal<string | null>(null)
  /** Other known locations of the model, carried in the project file (#52). */
  const [modelPathAlternates, setModelPathAlternates] = createSignal<string[]>([])

  const [isRestoringSession, setIsRestoringSession] = createSignal(false)

  let viewportHandle: ViewportHandle | undefined
  let toastTimer: number | undefined
  let lastFolderLoaded = false
  let sessionRestoreStarted = false

  async function ensureLastTextureFolderLoaded(): Promise<void> {
    if (lastFolderLoaded || textures().length > 0) {
      return
    }
    lastFolderLoaded = true
    const paths = await window.api.loadLastTextureFolder()
    if (paths && paths.length > 0) {
      setTextureRoot(await window.api.getTextureFolderRoot())
      setTextures(paths)
    }
  }

  async function restoreSessionInBackground(): Promise<void> {
    if (sessionRestoreStarted) {
      return
    }
    sessionRestoreStarted = true
    setIsRestoringSession(true)
    try {
      await Promise.all([ensureLastTextureFolderLoaded(), initBrushPresets()])
    } finally {
      setIsRestoringSession(false)
    }
  }

  function showToast(
    text: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    durationMs = 3500
  ): void {
    // What the artist was told is the best breadcrumb when reading a log back.
    if (type === 'error' || type === 'warning') {
      logger.warn(`Toast (${type}): ${text}`)
    }
    if (toastTimer) {
      clearTimeout(toastTimer)
    }
    const id = Date.now()
    setToast({ id, text, type })
    toastTimer = window.setTimeout(() => {
      if (toast()?.id === id) {
        setToast(null)
      }
    }, durationMs)
  }

  let initialMountDone = false
  const bumpLayers = (): void => {
    setLayersVersion((v) => v + 1)
    if (initialMountDone) {
      setIsDirty(true)
    }
  }

  /**
   * Every paintable piece paired with its stack, in the order the viewport
   * holds them — the shape both saving and exporting work in.
   */
  function projectPieces(): { name: string; alias?: string; layerStack: LayerStack }[] {
    const handle = viewportHandle
    if (!handle) {
      return []
    }
    const out: { name: string; alias?: string; layerStack: LayerStack }[] = []
    for (const info of handle.pieces()) {
      const stack = handle.getLayerStack(info.index)
      if (stack) {
        out.push({ name: info.name, alias: info.alias, layerStack: stack })
      }
    }
    return out
  }

  /**
   * The project as it is right now, or null (with a toast) when the layers
   * can't be read — after a GPU context loss every layer reads back blank,
   * and writing that would overwrite the last good save.
   */
  function captureForSave(savePieces: ReturnType<typeof projectPieces>): CapturedProject | null {
    try {
      return captureProject({
        modelPath: currentModelPath(),
        modelName: modelName(),
        pieces: savePieces,
        activePieceIndex: viewportHandle?.activePieceIndex() ?? 0,
        modelPathAlternates: modelPathAlternates()
      })
    } catch (err) {
      logger.error('Failed to capture project for saving:', err)
      showToast(
        err instanceof GpuContextLostError
          ? 'Not saved: the graphics context was lost, so the layers can no longer be read. Your last save and autosave are untouched — reload to restore.'
          : 'Failed to save project',
        'error'
      )
      return null
    }
  }

  /** Captures, encodes and writes the project to `targetPath`. */
  async function writeProject(targetPath: string, toastPrefix: string): Promise<boolean> {
    const savePieces = projectPieces()
    if (savePieces.length === 0) {
      return false
    }
    // Captured before anything awaits, so edits made while it encodes and
    // writes belong to the next save — and leave the project dirty.
    const captured = captureForSave(savePieces)
    if (!captured) {
      return false
    }
    const capturedGeneration = editGeneration
    const started = performance.now()
    setSaveActivity('save')
    try {
      const ok = await writeFileParts(targetPath, await encodeProject(captured))
      if (!ok) {
        showToast('Failed to save project', 'error')
        return false
      }
    } catch (err) {
      logger.error('Failed to save project:', targetPath, err)
      showToast(`Failed to save project: ${err instanceof Error ? err.message : String(err)}`, 'error')
      return false
    } finally {
      setSaveActivity(null)
    }
    logger.info(`Saved project ${targetPath} in ${Math.round(performance.now() - started)}ms`)
    setCurrentProjectPath(targetPath)
    if (editGeneration === capturedGeneration) {
      setIsDirty(false)
      await window.api.clearRecovery()
    }
    await window.api.addRecentProject(targetPath, modelName(), 'project')
    showToast(`${toastPrefix}: ${targetPath.split(/[/\\]/).pop()}`, 'success')
    return true
  }

  function projectSaveDialog(): Promise<string | null> {
    return window.api.saveFileDialog({
      defaultPath: `${modelName().replace(/\.[^/.]+$/, '')}.meshcoat`,
      filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat'] }],
      key: 'project',
      nearPath: currentModelPath()
    })
  }

  async function handleSaveProject(): Promise<boolean> {
    if (projectPieces().length === 0) {
      return false
    }
    const targetPath = currentProjectPath() ?? (await projectSaveDialog())
    return targetPath ? writeProject(targetPath, 'Saved project') : false
  }

  async function handleSaveAsProject(): Promise<boolean> {
    if (projectPieces().length === 0) {
      return false
    }
    const targetPath = await projectSaveDialog()
    return targetPath ? writeProject(targetPath, 'Saved project as') : false
  }

  function handleRequestClose(): void {
    if (isDirty()) {
      setShowUnsavedChangesModal(true)
      return
    }
    window.api.confirmClose()
  }

  async function handleSaveBeforeClose(): Promise<void> {
    setIsSavingBeforeClose(true)
    try {
      const ok = await handleSaveProject()
      if (ok) {
        setShowUnsavedChangesModal(false)
        window.api.confirmClose()
      }
    } finally {
      setIsSavingBeforeClose(false)
    }
  }

  function handleDiscardAndClose(): void {
    setShowUnsavedChangesModal(false)
    window.api.confirmClose()
  }

  async function getReadyViewport(): Promise<ViewportHandle> {
    if (viewportHandle) {
      return viewportHandle
    }
    const start = Date.now()
    while (!viewportHandle && Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 50))
    }
    if (!viewportHandle) {
      throw new Error('3D Viewport is still initializing, please wait a moment and try again.')
    }
    return viewportHandle
  }

  async function handleStartScratch(
    size: TextureSize,
    primitive: 'sphere' | 'cube' = 'sphere'
  ): Promise<void> {
    const handle = await getReadyViewport()
    logger.info(`New scratch project: ${primitive} at ${size}px`)
    // Every open inspector is showing pixels that are about to be disposed.
    closeAllUvInspectors()
    await handle.loadDefaultModel(size, primitive)
    setTextureSize(size)
    setModelName(primitive === 'cube' ? 'Default Cube' : 'Default Sphere')
    setCurrentModelPath(null)
    setModelPathAlternates([])
    setCurrentProjectPath(null)
    setIsDirty(false)
    showToast(
      `Started new project from ${primitive === 'cube' ? 'Cube' : 'Sphere'} scratch`,
      'info'
    )
  }

  async function handleBrowseAndOpenModel(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: '3D Models', extensions: ['glb', 'gltf', 'obj', 'blend'] }],
      key: 'model'
    })
    const path = paths?.[0]
    if (!path) {
      return
    }
    try {
      await handleOpenModel(path, textureSize())
    } catch (err) {
      logger.error('Failed to open model:', path, err)
      showToast(
        `Failed to open model: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
    }
  }

  async function handleBrowseAndOpenProject(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat', 'json'] }],
      key: 'project'
    })
    const path = paths?.[0]
    if (!path) {
      return
    }
    try {
      await handleOpenProjectFile(path)
    } catch (err) {
      logger.error('Failed to open project:', path, err)
      showToast(
        `Failed to open project: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
    }
  }

  async function handleOpenModel(
    path: string,
    size: TextureSize,
    initialTextures?: InitialTexturePayload | null,
    textureFolderPath?: string | null,
    forceTextureSize = false
  ): Promise<void> {
    const handle = await getReadyViewport()
    let extension = path.split('.').pop() ?? ''
    const filename = path.split(/[/\\]/).pop() ?? 'Loaded Model'
    let actualPath = path
    logger.info(`Opening model ${path} at ${size}px${forceTextureSize ? ' (forced)' : ''}`)

    if (extension.toLowerCase() === 'blend') {
      showToast(`Converting ${filename} via Blender...`, 'info')
      const res = await window.api.convertBlendFile(path)
      if (!res.success || !res.glbPath) {
        throw new Error(res.error || 'Failed to convert .blend file with Blender.')
      }
      actualPath = res.glbPath
      extension = 'glb'
    }

    const url = window.api.assetUrl(actualPath)
    closeAllUvInspectors()
    await handle.loadFromUrl(url, extension, size, initialTextures, { forceTextureSize })
    // The viewport may have overridden the requested size: imported maps are
    // painted at their own resolution, and a many-piece model is scaled down to
    // fit the GPU. Report what was actually allocated.
    const allocated = handle.pieces()[0]?.textureSize
    logger.info(
      `Model loaded: ${filename}, ${handle.pieces().length} piece(s), painting at ${allocated ?? size}px`
    )
    setTextureSize((allocated ?? size) as TextureSize)
    if (allocated && allocated !== size) {
      showToast(`Painting at ${allocated}px to match the imported textures`, 'info')
    }
    setModelName(filename)
    setSelectionGroups([])
    setCurrentModelPath(path)
    setModelPathAlternates([])
    setCurrentProjectPath(null)
    setIsDirty(false)
    await window.api.addRecentProject(path, filename, 'model')

    if (textureFolderPath) {
      try {
        const files = await window.api.listTexturesInFolder(textureFolderPath, true)
        if (files && files.length > 0) {
          setTextureRoot(textureFolderPath)
          setTextures(files)
        }
      } catch (err) {
        // Texture folder is optional context from the project file — a
        // missing/unreadable one just means the shelf starts empty.
        logger.warn('Could not list texture folder:', textureFolderPath, err)
      }
    }

    let pbrCount = 0
    if (typeof initialTextures === 'string') {
      pbrCount = 1
    } else if (typeof initialTextures === 'object' && initialTextures) {
      if ('mode' in initialTextures && initialTextures.mode === 'per-piece') {
        for (const maps of Object.values(initialTextures.pieces)) {
          pbrCount += Object.values(maps).filter(Boolean).length
        }
      } else if ('mode' in initialTextures && initialTextures.mode === 'shared') {
        pbrCount = Object.values(initialTextures.textures).filter(Boolean).length
      } else {
        pbrCount = Object.values(initialTextures).filter(Boolean).length
      }
    }

    showToast(
      `Loaded model ${filename}${pbrCount > 0 ? ` with ${pbrCount} PBR map${pbrCount > 1 ? 's' : ''}` : ''}`,
      'success'
    )
  }

  /**
   * Finds the project's model on this machine (#52). A project shared between
   * collaborators carries a path from someone else's disk, so this tries, in
   * order: the saved path, every location it was relinked to before, and the
   * model's file name next to the project file — then asks.
   *
   * Mutates `project.modelPath` to what was found and returns whether that
   * differs from the saved path (the project then needs saving to keep it).
   */
  async function resolveModelPath(
    project: MeshCoatProject,
    projectPath: string | null
  ): Promise<boolean> {
    const saved = project.modelPath
    if (!saved) {
      return false
    }
    const fileName = saved.split(/[/\\]/).pop() ?? saved
    const projectDir = projectPath ? projectPath.slice(0, projectPath.search(/[/\\][^/\\]*$/)) : null
    const sep = projectPath?.includes('\\') ? '\\' : '/'
    const candidates = [
      saved,
      ...(project.modelPathAlternates ?? []),
      ...(projectDir !== null ? [`${projectDir}${sep}${fileName}`] : [])
    ]
    let found = await window.api.findExistingFile(candidates)
    if (!found) {
      logger.warn('Model not found at any known location:', candidates)
      const locate = window.confirm(
        `The model for this project wasn't found:\n\n${saved}\n\n` +
          'Locate it? Its new location is saved with the project, alongside the original.'
      )
      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'glb'
      const picked = locate
        ? await window.api.openFileDialog({
            filters: [
              { name: fileName, extensions: [ext] },
              { name: '3D Models', extensions: ['glb', 'gltf', 'obj', 'blend'] }
            ],
            key: 'model'
          })
        : null
      found = picked?.[0] ?? null
      if (!found) {
        throw new Error(`Model not found: ${saved}`)
      }
    }
    // Every location that has worked anywhere, minus the one in use now.
    const known = [saved, ...(project.modelPathAlternates ?? [])]
    project.modelPathAlternates = [...new Set(known)].filter((p) => p !== found)
    project.modelPath = found
    if (found !== saved) {
      logger.info(`Relinked model ${saved} -> ${found}`)
    }
    return found !== saved
  }

  /** Applies a just-loaded project's metadata to the app state. */
  function adoptLoadedProject(project: MeshCoatProject, projectPath: string | null): void {
    restoreSelectionGroups(project)
    setTextureSize(project.textureSize as TextureSize)
    setModelName(project.name || project.modelName)
    setCurrentModelPath(project.modelPath)
    setModelPathAlternates(project.modelPathAlternates ?? [])
    setCurrentProjectPath(projectPath)
  }

  async function handleOpenProjectFile(path: string): Promise<void> {
    const handle = await getReadyViewport()
    logger.info('Opening project', path)
    const bytes = await readFileBytes(path)
    const { project, stackSnapshots } = await deserializeProject(bytes)
    logger.info(
      `Read project ${path}: format v${project.version}, ${(bytes.byteLength / 1048576).toFixed(1)} MB`
    )
    const relinked = await resolveModelPath(project, path)
    await handle.loadProject(project, stackSnapshots)
    logger.info(
      `Project loaded: ${project.name}, model ${project.modelPath}, ${project.textureSize}px`
    )
    adoptLoadedProject(project, path)
    setIsDirty(relinked)
    await window.api.addRecentProject(path, project.name, 'project')
    showToast(
      relinked
        ? `Loaded project: ${project.name} — model relinked, save to keep the new location`
        : `Loaded project: ${project.name}`,
      'success'
    )
  }

  /** The live project, captured without encoding — for rebuilding it in place. */
  function captureLive(): CapturedProject {
    return captureProject({
      modelPath: currentModelPath(),
      modelName: modelName(),
      pieces: projectPieces(),
      activePieceIndex: viewportHandle?.activePieceIndex() ?? 0,
      modelPathAlternates: modelPathAlternates()
    })
  }

  /**
   * Re-imports the model from disk after it was edited elsewhere (Blender,
   * etc.), keeping every layer. Goes through the same load as opening a saved
   * project, so layers land back on pieces by name.
   */
  async function handleReloadModel(): Promise<void> {
    const modelPath = currentModelPath()
    const handle = viewportHandle
    if (!modelPath || !handle) {
      showToast('No model file to reload — open one from disk first', 'warning')
      return
    }
    const ok = window.confirm(
      'Reload the model from disk?\n\n' +
        'Your layers are kept, but they are stored against the UV layout. ' +
        'If you changed the UVs, existing paint will no longer line up. ' +
        'Undo history is cleared.'
    )
    if (!ok) {
      return
    }
    logger.info('Reloading model from disk:', modelPath)
    try {
      const { project, stackSnapshots } = captureLive()
      await handle.loadProject(project, stackSnapshots, { reload: true })
      restoreSelectionGroups(project)
      setIsDirty(true)
      showToast(`Reloaded ${modelPath.split(/[/\\]/).pop()}`, 'success')
    } catch (err) {
      logger.error('Model reload failed:', err)
      showToast(`Reload failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  /**
   * Changes the texture resolution of every piece, or just one (#54). Layers
   * are resampled, not cleared: restoring a snapshot onto a stack of another
   * size already scales it (PaintEngine.restoreFromCpuSnapshot). Upscaling
   * can't add detail that was never painted, but keeps every layer, name and
   * mask so painting can carry on at the new size.
   */
  async function handleResizeTextures(size: TextureSize, pieceIndex: number | null): Promise<void> {
    const handle = viewportHandle
    if (!handle) {
      return
    }
    const target = pieceIndex === null ? 'all pieces' : `"${modelPieces()[pieceIndex]?.name}"`
    const ok = window.confirm(
      `Resize ${target} to ${size}px?\n\n` +
        'Every layer is resampled to the new size. Scaling up keeps the current detail ' +
        'rather than adding any; scaling down loses detail. Undo history is cleared.'
    )
    if (!ok) {
      return
    }
    try {
      const { project, stackSnapshots } = captureLive()
      project.pieces?.forEach((piece, i) => {
        if (pieceIndex === null || i === pieceIndex) {
          piece.textureSize = size
        }
      })
      project.textureSize = project.pieces?.[0]?.textureSize ?? size
      logger.info(`Resizing ${target} to ${size}px`)
      await handle.loadProject(project, stackSnapshots, { reload: true })
      restoreSelectionGroups(project)
      setTextureSize(project.textureSize as TextureSize)
      setIsDirty(true)
      showToast(`Resized ${target} to ${size}px`, 'success')
    } catch (err) {
      logger.error('Resize failed:', err)
      showToast(
        err instanceof GpuContextLostError
          ? 'Resize failed: the graphics context was lost. Reload to restore your last save.'
          : `Resize failed: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
    }
  }

  async function handleRestoreRecovery(recoveryData: ArrayBuffer): Promise<void> {
    const handle = await getReadyViewport()
    logger.info('Restoring autosave')
    const { project, stackSnapshots } = await deserializeProject(recoveryData)
    await resolveModelPath(project, null)
    await handle.loadProject(project, stackSnapshots)
    adoptLoadedProject(project, null)
    setIsDirty(true)
    showToast(`Restored unsaved session: ${project.name}`, 'success')
  }

  function onMissingUv(names: string[]): void {
    showToast(`Missing UV0 on: ${names.join(', ')}`, 'warning')
  }

  function selectLightingMode(mode: LightingMode): void {
    setLightingModeSignal(mode)
    viewportHandle?.setLightingMode(mode)
    saveLayoutProfile({ lightingMode: mode })
  }

  function selectViewMode(mode: ChannelViewMode): void {
    setViewModeSignal(mode)
    viewportHandle?.setViewMode(mode)
    saveLayoutProfile({ viewMode: mode })
    if (mode !== 'material' && !viewportHandle?.paintedChannels().includes(mode as PaintChannel)) {
      // Nothing has been painted into that channel, so there is no map to
      // inspect — say so rather than leaving the artist staring at the shaded
      // view wondering why the button did nothing.
      showToast(`No ${CHANNEL_SPECS[mode as PaintChannel].label} painted yet`, 'info')
    }
  }

  function toggleWireframe(): void {
    const next = !wireframeVisible()
    setWireframeVisibleSignal(next)
    viewportHandle?.setWireframeVisible(next)
    saveLayoutProfile({ wireframeVisible: next })
  }

  function toggleIsolatePiece(): void {
    const next = !isolatePiece()
    setIsolatePieceSignal(next)
    viewportHandle?.setIsolateActivePiece(next)
    showToast(
      next ? 'Isolate piece: ON (others hidden)' : 'Isolate piece: OFF (all visible)',
      'info'
    )
  }

  function frameCamera(): void {
    viewportHandle?.focusModel()
  }

  function handleOpenExportWizard(): void {
    setShowExportWizard(true)
  }

  async function pickTextureFolder(): Promise<void> {
    const paths = await window.api.pickTextureFolder()
    if (paths && paths.length > 0) {
      setTextureRoot(await window.api.getTextureFolderRoot())
      setTextures(paths)
      showToast(`Loaded ${paths.length} textures`, 'info')
    }
  }

  function clearTextureFolder(): void {
    setTextures([])
    setTextureRoot(null)
    setTexturePath(null)
    showToast('Cleared texture shelf', 'info')
  }

  async function handleImportTextures(): Promise<void> {
    await pickTextureFolder()
  }

  function handleClearActiveLayer(): void {
    const stack = viewportHandle?.getLayerStack()
    const active = stack?.active
    if (active && stack) {
      stack.clearLayer(active.id)
      bumpLayers()
      showToast(`Cleared "${active.name}"`, 'info')
    }
  }

  function handleFillActiveLayer(): void {
    const stack = viewportHandle?.getLayerStack()
    const active = stack?.active
    if (active) {
      if (viewportHandle) {
        viewportHandle.fillActive()
      } else {
        active.engine.fill(new THREE.Color(brush.color()))
        stack?.recomposite()
      }
      bumpLayers()
      const what = brush.texturePath() ? 'texture' : 'color'
      const count = brush.selectedFaces().size
      const lassoed = viewportHandle?.hasPixelSelection() ?? false
      const where =
        count > 0
          ? `${count} face(s)${lassoed ? ' (inside the lasso)' : ''} on "${active.name}"`
          : lassoed
            ? `the lasso selection on "${active.name}"`
            : `"${active.name}"`
      showToast(`Filled ${where} with ${what}`, 'info')
    }
  }

  function handleUndo(): void {
    if (!viewportHandle?.canUndo()) {
      return
    }
    viewportHandle.undo()
    bumpLayers()
    showToast('Undo', 'info', 1200)
  }

  function handleRedo(): void {
    if (!viewportHandle?.canRedo()) {
      return
    }
    viewportHandle.redo()
    bumpLayers()
    showToast('Redo', 'info', 1200)
  }

  /** Ctrl+G groups the active layer into a new folder; Ctrl+Shift+G ungroups its folder. */
  function toggleActiveLayerFolder(ungroup: boolean): void {
    const stack = viewportHandle?.getLayerStack()
    const layer = stack?.active
    if (!stack || !layer) {
      return
    }
    if (ungroup && layer.folderId !== undefined) {
      stack.ungroupFolder(layer.folderId)
      bumpLayers()
      showToast('Ungrouped folder', 'info')
    } else if (!ungroup && layer.folderId === undefined) {
      const folder = stack.groupIntoFolder(layer.id)
      bumpLayers()
      showToast(`Grouped "${layer.name}" into ${folder?.name ?? 'a folder'}`, 'info')
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (showHelp() || showSettings() || showStartWizard() || brushPresets.isManagerOpen()) {
      return
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }

    const isCtrl = e.ctrlKey || e.metaKey

    if (isCtrl) {
      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) {
          void handleSaveAsProject()
        } else {
          void handleSaveProject()
        }
        return
      }
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setShowExportWizard(true)
        return
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setShowStartWizard(true)
        return
      }
      // Ctrl+V pastes a clipboard image straight into the stencil, but only
      // while that panel is open — anywhere else it stays the browser's paste.
      if (e.key.toLowerCase() === 'v' && showStencilPanel()) {
        e.preventDefault()
        void (async () => {
          const image = await window.api.readClipboardImage()
          if (!image) {
            showToast('No image on the clipboard — copy one first', 'warning')
            return
          }
          setStencilTexturePath(image.dataUrl, `Clipboard ${image.width}x${image.height}`)
          resetStencilTransform()
          setStencilTransforming(true)
          showToast(`Stencil pasted from clipboard (${image.width}x${image.height})`, 'success')
        })()
        return
      }
      if (e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void handleBrowseAndOpenModel()
        return
      }
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
        return
      }
      if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
        return
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault()
        viewportHandle?.selectAllFaces()
        const count = viewportHandle?.getTotalFaces() ?? 0
        if (count > 0) {
          showToast(`Selected all ${count} faces`, 'info')
        }
        return
      }
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault()
        clearFaceSelection()
        viewportHandle?.clearPixelSelection()
        showToast('Cleared selection', 'info')
        return
      }
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault()
        // The lasso selection is the one being inverted while it's in use, or
        // when it is the only selection there is.
        if (
          activeTool() === 'lasso' ||
          (viewportHandle?.hasPixelSelection() && brush.selectedFaces().size === 0)
        ) {
          viewportHandle?.invertPixelSelection()
          showToast('Inverted lasso selection', 'info')
        } else {
          viewportHandle?.invertFaceSelection()
          showToast('Inverted face selection', 'info')
        }
        return
      }
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault()
        toggleActiveLayerFolder(e.shiftKey)
        return
      }
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const next = !textureDrawerCollapsed()
        setTextureDrawerCollapsed(next)
        showToast(next ? 'Texture drawer collapsed' : 'Texture drawer expanded', 'info')
        return
      }
      return
    }

    switch (e.key.toLowerCase()) {
      case '1':
      case 'b':
        setActiveTool('brush')
        break
      case 'l':
        setActiveTool('line')
        break
      case 'd':
        setActiveTool('gradient')
        break
      case 'q':
        setActiveTool('lasso')
        setToolPanelCollapsed(false)
        break
      case 'k':
        setActiveTool('clone')
        setToolPanelCollapsed(false)
        break
      case '2':
      case 'e':
        setActiveTool('eraser')
        break
      case '3':
      case 't':
        setActiveTool('stamp')
        break
      case '4':
      case 'g':
        setActiveTool('fill')
        break
      case '5':
      case 'i':
        setActiveTool('eyedropper')
        break
      case '6':
      case 'v':
        setActiveTool('faceSelect')
        break
      case '9':
      case 'y':
        setActiveTool('text')
        setToolPanelCollapsed(false)
        break
      case '8':
      case 'p':
        setActiveTool('faceProjector')
        setToolPanelCollapsed(false)
        break
      case '7':
      case 'u':
        if (activeTool() === 'effect') {
          const nextMode =
            EFFECT_MODES[(EFFECT_MODES.indexOf(brush.effectMode()) + 1) % EFFECT_MODES.length]
          brush.setEffectMode(nextMode)
          showToast(`Effect: ${EFFECT_MODE_LABELS[nextMode]}`, 'info', 1000)
        } else {
          setActiveTool('effect')
          setToolPanelCollapsed(false)
        }
        break
      case 's': {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          if (!toolUsesPanel(activeTool(), 'stencil')) {
            showToast(`The ${activeTool()} tool does not use the screen stencil`, 'info', 1200)
            break
          }
          setShowStencilPanel((v) => !v)
          setToolPanelCollapsed(false)
        }
        break
      }
      case 'r': {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          const delta = e.shiftKey ? -15 : 15
          const next = (brush.brushRotation() + delta + 360) % 360
          brush.setBrushRotation(next)
          showToast(`Brush Angle: ${next}°`, 'info', 1000)
        }
        break
      }
      case 'x': {
        if (e.altKey) {
          const axes: ('off' | 'x' | 'y' | 'z')[] = ['off', 'x', 'y', 'z']
          const next = axes[(axes.indexOf(brush.symmetryAxis()) + 1) % axes.length]
          brush.setSymmetryAxis(next)
          showToast(
            next !== 'off' ? `Symmetry: ${next.toUpperCase()} Axis` : 'Symmetry: OFF',
            'info'
          )
          break
        }
        const stack = viewportHandle?.getLayerStack()
        const activeLayer = stack?.active
        if (activeLayer?.isMask) {
          const current = brush.color().toLowerCase()
          if (current === '#ffffff' || current === '#fff') {
            brush.setColor('#000000')
            showToast('Mask Color: Black (Hide)', 'info')
          } else {
            brush.setColor('#ffffff')
            showToast('Mask Color: White (Reveal)', 'info')
          }
          break
        }
        if (brush.texturePath()) {
          setTexturePath(null)
          showToast('Switched to Solid Color mode', 'info')
        } else {
          showToast('Solid Color active', 'info')
        }
        break
      }
      case 'c': {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          const next = !toolPanelCollapsed()
          setToolPanelCollapsed(next)
          showToast(next ? 'Tool panels collapsed' : 'Tool panels expanded', 'info')
        }
        break
      }
      case 'escape':
        clearFaceSelection()
        break
      case '[':
        if (activeTool() === 'fill' || (brush.texturePath() && e.shiftKey)) {
          setTextureScale(Math.max(0, parseFloat((brush.textureScale() - 0.25).toFixed(2))))
          showToast(`Tiling: ${brush.textureScale()}x`, 'info')
        } else {
          stepRadius(-1)
        }
        break
      case ']':
        if (activeTool() === 'fill' || (brush.texturePath() && e.shiftKey)) {
          setTextureScale(Math.min(16, parseFloat((brush.textureScale() + 0.25).toFixed(2))))
          showToast(`Tiling: ${brush.textureScale()}x`, 'info')
        } else {
          stepRadius(1)
        }
        break
      case '?':
        setShowHelp((v) => !v)
        break
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown)
    const offBeforeClose = window.api.onBeforeClose(() => handleRequestClose())
    onCleanup(offBeforeClose)
    if (typeof window !== 'undefined') {
      ;(
        window as unknown as {
          __app: {
            setActiveTool: typeof setActiveTool
            setShowEdgeWearWizard: typeof setShowEdgeWearWizard
            toggleWireframe: typeof toggleWireframe
            setTextures: typeof setTextures
            showToast: typeof showToast
          }
        }
      ).__app = {
        setActiveTool,
        setShowEdgeWearWizard,
        toggleWireframe,
        setTextures,
        showToast
      }
    }

    // Check if Blender is available for .blend imports on startup
    void (async () => {
      try {
        const dismissed = await window.api.isBlenderPromptDismissed()
        if (dismissed) {
          return
        }
        const detected = await window.api.detectBlender()
        if (!detected.path) {
          showToast(
            'Blender not detected. Configure Blender in Settings to import .blend files directly.',
            'info'
          )
        }
      } catch (err) {
        // Detection is a startup nicety — nothing to surface to the artist if it fails.
        logger.warn('Blender detection failed:', err)
      }
    })()

    // Periodic Autosave every 60s if there are unsaved changes. Only the
    // capture blocks input now; PNG encoding runs off the main thread and the
    // file streams to disk in chunks. A large project can still take longer
    // than the interval, so a tick that finds the previous autosave still in
    // flight skips rather than stacking a second copy on top of it.
    let autosaveInFlight = false
    const autosaveTimer = setInterval(async () => {
      if (autosaveInFlight || !isDirty() || !viewportHandle?.getLayerStack()) {
        return
      }
      autosaveInFlight = true
      setSaveActivity('autosave')
      let writeId: number | null = null
      try {
        const started = performance.now()
        const captured = captureLive()
        const captureMs = Math.round(performance.now() - started)
        const parts = await encodeProject(captured)
        writeId = await window.api.beginFileWrite(await window.api.recoveryTarget())
        const bytes = await streamParts(writeId, parts)
        const ok = await window.api.commitRecovery(writeId)
        writeId = null
        const totalMs = Math.round(performance.now() - started)
        const sizeMb = (bytes / 1048576).toFixed(1)
        if (ok) {
          logger.info(`Autosave: ${sizeMb} MB, capture ${captureMs}ms (blocking), total ${totalMs}ms`)
        } else {
          logger.error(`Autosave commit failed (${sizeMb} MB) — see main log`)
        }
      } catch (err) {
        // A lost GPU context lands here too: nothing readable to save, and
        // the last good autosave stays untouched.
        logger.error('Autosave error:', err)
        if (writeId !== null) {
          await window.api.abortFileWrite(writeId).catch(() => {})
        }
      } finally {
        autosaveInFlight = false
        setSaveActivity((a) => (a === 'autosave' ? null : a))
      }
    }, 60000)

    onCleanup(() => clearInterval(autosaveTimer))
  })
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  createEffect(() => {
    if (typeof document !== 'undefined') {
      const dirtyPrefix = isDirty() ? '* ' : ''
      document.title = `${dirtyPrefix}${modelName()} — MeshCoat`
    }
  })

  /**
   * Every floating panel, with a tick next to the ones on screen. Each of these
   * has a close button of its own, and before this menu existed closing one was
   * a one-way door — nothing in the UI could bring it back.
   */
  /**
   * Panels can be collapsed/hidden or expanded/shown, never fully removed.
   */
  const panelMenuItems = (): MenuItem[] => [
    { type: 'header', label: 'Workspace' },
    {
      label: textureDrawerCollapsed() ? 'Show Texture Drawer' : 'Hide Texture Drawer',
      shortcut: 'Ctrl+B',
      icon: (p) => <FolderOpenIcon size={p.size} class="text-amber-400" />,
      onClick: () => {
        setTextureDrawerCollapsed((v) => !v)
      }
    },
    {
      label: toolPanelCollapsed() ? 'Show Tool Panels' : 'Hide Tool Panels',
      shortcut: 'C',
      icon: (p) => <PanelRightIcon size={p.size} class="text-blue-400" />,
      onClick: () => {
        setToolPanelCollapsed((v) => !v)
      }
    },
    {
      label: sidebarCollapsed() ? 'Show Sidebar (Brush & Layers)' : 'Hide Sidebar (Brush & Layers)',
      icon: (p) => <LayersIcon size={p.size} class="text-purple-400" />,
      onClick: () => {
        setSidebarCollapsed((v) => !v)
      }
    },
    {
      label: showStencilPanel() ? 'Disable Screen Stencil' : 'Enable Screen Stencil',
      shortcut: 'S',
      icon: (p) =>
        showStencilPanel() ? <CheckIcon size={p.size} class="text-teal-400" /> : <span />,
      onClick: () => {
        const next = !showStencilPanel()
        setShowStencilPanel(next)
        if (next) {
          setToolPanelCollapsed(false)
        }
      }
    }
  ]

  const fileMenuItems = (): MenuItem[] => [
    {
      label: 'New Project / Wizard...',
      shortcut: 'Ctrl+N',
      icon: (p) => <SparklesIcon size={p.size} class="text-blue-400" />,
      onClick: () => setShowStartWizard(true)
    },
    {
      label: 'Open 3D Model...',
      shortcut: 'Ctrl+O',
      icon: (p) => <FolderOpenIcon size={p.size} />,
      onClick: () => void handleBrowseAndOpenModel()
    },
    {
      label: 'Reload Model from Disk',
      icon: (p) => <RefreshCwIcon size={p.size} />,
      disabled: !currentModelPath(),
      onClick: () => void handleReloadModel()
    },
    {
      label: 'Open Project File...',
      icon: (p) => <FolderOpenIcon size={p.size} />,
      onClick: () => void handleBrowseAndOpenProject()
    },
    {
      label: 'Resize Textures',
      icon: (p) => <FitIcon size={p.size} />,
      submenu: [
        { type: 'header', label: modelPieces().length > 1 ? 'All pieces' : 'Texture size' },
        ...TEXTURE_SIZE_OPTIONS.map(
          (size): MenuItem => ({
            label: `${size}px`,
            onClick: () => void handleResizeTextures(size, null)
          })
        ),
        ...(modelPieces().length > 1
          ? [
              { type: 'divider' } as MenuItem,
              {
                type: 'header',
                label: `Active piece (${modelPieces()[activePiece()]?.textureSize ?? '?'}px)`
              } as MenuItem,
              ...TEXTURE_SIZE_OPTIONS.map(
                (size): MenuItem => ({
                  label: `${size}px`,
                  onClick: () => void handleResizeTextures(size, activePiece())
                })
              )
            ]
          : [])
      ]
    },
    { type: 'divider' },
    {
      label: 'Save Project',
      shortcut: 'Ctrl+S',
      icon: (p) => <DownloadIcon size={p.size} />,
      onClick: () => void handleSaveProject()
    },
    {
      label: 'Save Project As...',
      shortcut: 'Ctrl+Shift+S',
      onClick: () => void handleSaveAsProject()
    },
    { type: 'divider' },
    {
      label: 'Export Textures...',
      shortcut: 'Ctrl+Shift+E',
      icon: (p) => <DownloadIcon size={p.size} class="text-blue-400" />,
      onClick: handleOpenExportWizard
    },
    {
      label: 'Texture Library',
      icon: (p) => <FolderOpenIcon size={p.size} />,
      submenu: [
        {
          label: 'Load Texture Folder...',
          icon: (p) => <FolderOpenIcon size={p.size} />,
          onClick: handleImportTextures
        },
        ...(textures().length > 0
          ? [
              { type: 'divider' } as MenuItem,
              {
                label: 'Clear Texture Drawer',
                icon: (p) => <RefreshCwIcon size={p.size} />,
                onClick: clearTextureFolder
              } as MenuItem
            ]
          : [])
      ]
    }
  ]

  const editMenuItems = (): MenuItem[] => [
    {
      label: 'Undo',
      shortcut: 'Ctrl+Z',
      disabled: !canUndo(),
      onClick: handleUndo
    },
    {
      label: 'Redo',
      shortcut: 'Ctrl+Y',
      disabled: !canRedo(),
      onClick: handleRedo
    },
    { type: 'divider' },
    {
      label: 'Clear Active Layer',
      onClick: handleClearActiveLayer
    },
    {
      label: brush.texturePath()
        ? brush.selectedFaces().size > 0
          ? 'Fill Selection with Texture'
          : 'Fill Active Layer with Texture'
        : brush.selectedFaces().size > 0
          ? 'Fill Selection with Color'
          : 'Fill Active Layer with Color',
      shortcut: 'G',
      onClick: handleFillActiveLayer
    },
    { type: 'divider' },
    {
      label: 'Edge Wear & Highlights...',
      icon: (p) => <EdgeWearIcon size={p.size} class="text-amber-400" />,
      onClick: () => setShowEdgeWearWizard(true)
    }
  ]

  const selectionMenuItems = (): MenuItem[] => [
    {
      label: 'Select All Faces',
      shortcut: 'Ctrl+A',
      onClick: () => {
        viewportHandle?.selectAllFaces()
        const count = viewportHandle?.getTotalFaces() ?? 0
        if (count > 0) {
          showToast(`Selected all ${count} faces`, 'info')
        }
      }
    },
    {
      label: 'Deselect',
      shortcut: 'Esc',
      disabled: brush.selectedFaces().size === 0,
      onClick: () => {
        clearFaceSelection()
        showToast('Cleared face selection', 'info')
      }
    },
    {
      label: 'Invert Selection',
      shortcut: 'Ctrl+I',
      onClick: () => {
        viewportHandle?.invertFaceSelection()
        showToast('Inverted face selection', 'info')
      }
    },
    { type: 'divider' },
    {
      label: 'Save Selection as Group...',
      icon: (p) => <BookmarkIcon size={p.size} class="text-amber-400" />,
      disabled: brush.selectedFaces().size === 0,
      onClick: () => {
        const count = selectionGroups().filter((g) => g.piece === activePieceName()).length
        const defaultName = `Selection ${count + 1}`
        const name = window.prompt('Enter selection group name:', defaultName)
        if (name && name.trim()) {
          saveCurrentSelectionGroup(name.trim())
        }
      }
    },
    {
      label: 'Selection Groups',
      icon: (p) => <BookmarkIcon size={p.size} />,
      disabled: selectionGroups().length === 0,
      submenu: [
        ...selectionGroups().map((g): MenuItem => ({
          label: modelPieces().length > 1 ? `${g.name} — ${g.piece}` : g.name,
          onClick: () => recallSelectionGroup(g)
        })),
        { type: 'divider' },
        { label: 'Manage Groups...', onClick: () => setLowerTab('selections') }
      ]
    }
  ]

  return (
    <div class="flex flex-col h-screen w-screen bg-[var(--bg-main)] text-[var(--text-main)] select-none overflow-hidden font-sans">
      <WorkstationHeader
        modelName={modelName()}
        isDirty={isDirty()}
        isRestoringSession={isRestoringSession()}
        saveActivity={saveActivity()}
        fileMenuItems={fileMenuItems()}
        editMenuItems={editMenuItems()}
        selectionMenuItems={selectionMenuItems()}
        panelMenuItems={panelMenuItems()}
        lightingMode={lightingMode()}
        onSelectLightingMode={selectLightingMode}
        viewMode={viewMode()}
        onSelectViewMode={selectViewMode}
        showPanelDock={!toolPanelCollapsed()}
        onTogglePanelDock={() => setToolPanelCollapsed((v) => !v)}
        sidebarCollapsed={sidebarCollapsed()}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        wireframeVisible={wireframeVisible()}
        onToggleWireframe={toggleWireframe}
        showUvPanel={showUvPanel()}
        onToggleUvPanel={() => setShowUvPanel((v) => !v)}
        isolatePiece={isolatePiece()}
        onToggleIsolatePiece={toggleIsolatePiece}
        multiPiece={modelPieces().length > 1}
        onToggleSymmetry={() => {
          const axes: ('off' | 'x' | 'y' | 'z')[] = ['off', 'x', 'y', 'z']
          const next = axes[(axes.indexOf(brush.symmetryAxis()) + 1) % axes.length]
          brush.setSymmetryAxis(next)
          showToast(
            next !== 'off' ? `Symmetry: ${next.toUpperCase()} Axis` : 'Symmetry: OFF',
            'info'
          )
        }}
        onFrameCamera={frameCamera}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
      />

      <div class="flex-1 flex overflow-hidden relative">
        <WorkstationShelf
          activeTool={activeTool()}
          onSelectTool={(t) => {
            setActiveTool(t)
            // Open the dock only if the tool it switched to actually owns
            // panels right now (see paint/toolPanels.ts).
            if (
              panelsForTool(t, {
                hasTexture: !!brush.texturePath(),
                hasFaceSelection: brush.selectedFaces().size > 0,
                stencilPanelOpen: showStencilPanel()
              }).length > 0
            ) {
              setToolPanelCollapsed(false)
            }
          }}
          showStencilPanel={showStencilPanel()}
          onToggleStencilPanel={() => {
            const next = !showStencilPanel()
            setShowStencilPanel(next)
            // Only reveal the dock if the active tool is one that shows the
            // stencil panel — the eyedropper and face tools never do.
            if (next && toolUsesPanel(activeTool(), 'stencil')) {
              setToolPanelCollapsed(false)
            }
          }}
          showEdgeWearWizard={showEdgeWearWizard()}
          onToggleEdgeWearWizard={() => {
            if (showEdgeWearWizard()) {
              viewportHandle?.cancelEdgeWearPreview()
              setShowEdgeWearWizard(false)
            } else {
              setShowEdgeWearWizard(true)
            }
          }}
          onFrameCamera={frameCamera}
        />

        <div class="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <main class="flex-1 relative overflow-hidden bg-[var(--bg-main)]">
          <Show when={brush.selectionHighlightHidden()}>
            <div class="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/95 text-black text-xs font-semibold shadow-lg pointer-events-auto">
              <span>
                Selection highlight hidden — painting is still limited to{' '}
                {brush.selectedFaces().size} face{brush.selectedFaces().size === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                class="px-2 py-0.5 rounded-full bg-black/80 text-amber-300 hover:bg-black cursor-pointer"
                onClick={() => brush.setSelectionHighlightHidden(false)}
              >
                Show
              </button>
            </div>
          </Show>
          <Show when={showUvPanel() && modelPieces().length > 0 && viewportHandle}>
            <UvPaintPanel
              api={viewportHandle!.uvPanel}
              version={layersVersion()}
              pieceIndex={activePiece()}
              textureSize={modelPieces()[activePiece()]?.textureSize ?? textureSize()}
              tool={activeTool()}
              onClose={() => setShowUvPanel(false)}
            />
          </Show>
          <Viewport
            tool={activeTool}
            textures={textures()}
            onToast={showToast}
            onToolChange={(t) => setActiveTool(t)}
            onReady={(h) => {
              viewportHandle = h
              h.setLightingMode(lightingMode())
              h.setViewMode(viewMode())
              h.setWireframeVisible(wireframeVisible())
              void restoreSessionInBackground()
              setTimeout(() => {
                initialMountDone = true
                setIsDirty(false)
              }, 150)
            }}
            onMissingUv={onMissingUv}
            onLayersChanged={bumpLayers}
            onPiecesChanged={() => {
              setPiecesVersion((v) => v + 1)
              setLayersVersion((v) => v + 1)
              if (modelPieces().length <= 1 && isolatePiece()) {
                setIsolatePieceSignal(false)
                viewportHandle?.setIsolateActivePiece(false)
              }
            }}
            onWireframeChanged={(visible) => {
              setWireframeVisibleSignal(visible)
              saveLayoutProfile({ wireframeVisible: visible })
            }}
            onIsolatePieceChanged={setIsolatePieceSignal}
          />

          <Toast toast={toast()} onClose={() => setToast(null)} />
        </main>

        {/* Bottom Texture Drawer */}
        <div
          class="relative flex flex-col shrink-0 select-none z-20 overflow-hidden box-border"
          style={{ height: textureDrawerCollapsed() ? '36px' : `${textureDrawerHeight()}px` }}
        >
          {/* Top edge drag handle to resize the drawer */}
          <Show when={!textureDrawerCollapsed()}>
            <div
              class="absolute -top-1 left-0 right-0 h-2 z-30 cursor-row-resize hover:bg-[var(--accent-color)]/50 active:bg-[var(--accent-color)]"
              title="Drag to resize texture drawer (double-click to reset)"
              onPointerDown={startTextureDrawerResize}
              onDblClick={() => setTextureDrawerHeight(220)}
            />
          </Show>
          <TextureShelf
            textures={textures()}
            textureRoot={textureRoot()}
            onPickFolder={pickTextureFolder}
            onClearFolder={clearTextureFolder}
            onToast={showToast}
            collapsed={textureDrawerCollapsed()}
            onToggleCollapse={() => setTextureDrawerCollapsed((v) => !v)}
            isMaskTarget={() => {
              void layersVersion()
              return !!viewportHandle?.getLayerStack()?.active?.isMask
            }}
          />
        </div>
      </div>

      {/* Right Sidebar Inspector */}
        {/* Tool panel dock: everything that used to float over the viewport,
            in one column that slides out beside the brush settings. */}
        <div class="h-full z-20 flex-shrink-0">
          <ToolPanelDock
            activeTool={activeTool()}
            textures={textures()}
            isMaskTarget={() => {
              void layersVersion()
              return !!viewportHandle?.getLayerStack()?.active?.isMask
            }}
            onStamp={() => viewportHandle?.stampStencil() ?? false}
            onToast={showToast}
            onFillSelection={handleFillActiveLayer}
            onInvertPixelSelection={() => viewportHandle?.invertPixelSelection()}
            onClearPixelSelection={() => viewportHandle?.clearPixelSelection()}
            onClearCloneSource={() => viewportHandle?.clearCloneSource()}
            stencilPanelOpen={showStencilPanel()}
            collapsed={toolPanelCollapsed()}
            onToggleCollapse={() => setToolPanelCollapsed((v) => !v)}
            width={toolPanelWidth()}
            onStartResize={startToolPanelResize}
            onResetWidth={() => {
              setToolPanelWidth(300)
              saveLayoutProfile({ toolPanelWidth: 300 })
            }}
          />
        </div>

        <aside
          ref={sidebarRef}
          class="relative h-full bg-[var(--bg-panel)] border-l border-[var(--border-color)] flex flex-col select-none z-20 shrink-0"
          style={{ width: sidebarCollapsed() ? '32px' : `${sidebarWidth()}px` }}
        >
          {/* Left edge: drag to widen the whole sidebar. */}
          <Show when={!sidebarCollapsed()}>
            <div
              class="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 z-30 cursor-col-resize hover:bg-[var(--accent-color)]/50 active:bg-[var(--accent-color)]"
              title="Drag to resize the sidebar (double-click to reset)"
              onPointerDown={startSidebarResize}
              onDblClick={() => setSidebarSize({ width: SIDEBAR_DEFAULT_WIDTH })}
            />
          </Show>
          <Show
            when={!sidebarCollapsed()}
            fallback={
              <div
                class="h-full w-8 min-w-8 max-w-8 flex flex-col items-center bg-[var(--bg-panel-header)] select-none z-20 cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand Sidebar (Brush & Layers)"
              >
                <div class="h-9 flex items-center justify-center shrink-0">
                  <IconButton
                    size="xs"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSidebarCollapsed(false)
                    }}
                    tooltip="Expand Sidebar (Brush & Layers)"
                  >
                    <ChevronLeftIcon size={14} />
                  </IconButton>
                </div>
                <div class="flex-1 flex flex-col items-center justify-center gap-2 py-4">
                  <div class="flex flex-col items-center gap-2">
                    <SlidersIcon size={14} class="text-[var(--accent-color)]" />
                    <LayersIcon size={14} class="text-purple-400" />
                  </div>
                  <span
                    class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
                    style={{ 'writing-mode': 'vertical-rl', transform: 'rotate(180deg)' }}
                  >
                    Brush & Layers
                  </span>
                  <Show when={currentLayerCount() > 0}>
                    <span class="w-4 h-4 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-bold flex items-center justify-center">
                      {currentLayerCount()}
                    </span>
                  </Show>
                </div>
              </div>
            }
          >
            <Show
              when={!showEdgeWearWizard()}
              fallback={
                <Suspense fallback={null}>
                  <EdgeWearWizard
                    isOpen={showEdgeWearWizard()}
                    initialColor={brush.color()}
                    textures={textures()}
                    onClose={() => setShowEdgeWearWizard(false)}
                    onPreview={(params, asNewLayer, newLayerBackground) =>
                      viewportHandle?.previewEdgeWear(params, asNewLayer, newLayerBackground)
                    }
                    onCancel={() => viewportHandle?.cancelEdgeWearPreview()}
                    onCommit={(params, asNewLayer, newLayerBackground) => {
                      viewportHandle?.commitEdgeWear(params, asNewLayer, newLayerBackground)
                      bumpLayers()
                      const label = params.mode === 'cavity' ? 'Crevice Dirt' : 'Edge Wear'
                      showToast(
                        asNewLayer
                          ? `Created "${label}" layer`
                          : `Applied ${label.toLowerCase()} to active layer`,
                        'success'
                      )
                    }}
                  />
                </Suspense>
              }
            >
              <div class="flex-1 overflow-y-auto border-b border-[var(--border-color)]">
                <div class="h-9 px-3 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] shrink-0">
                  <div class="flex items-center gap-2">
                    <SlidersIcon size={15} class="text-[var(--accent-color)]" />
                    <Label uppercase>Brush Settings</Label>
                  </div>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    onClick={() => setSidebarCollapsed(true)}
                    tooltip="Collapse Sidebar (Brush & Layers)"
                  >
                    <ChevronRightIcon size={14} />
                  </IconButton>
                </div>
              <BrushSettingsTab
                activeTool={activeTool()}
                isMaskTarget={() => {
                  void layersVersion()
                  const a = viewportHandle?.getLayerStack()?.active
                  return !!a?.isMask
                }}
                onToast={showToast}
                onSelectEyedropper={() => setActiveTool('eyedropper')}
              />
            </div>

            {/* Splitter: drag to give the layers more room; double-click toggles half height. */}
            <div
              class="h-1.5 shrink-0 cursor-row-resize bg-[var(--border-color)]/40 hover:bg-[var(--accent-color)]/50 active:bg-[var(--accent-color)]"
              title="Drag to resize the layers panel (double-click: half height / default)"
              onPointerDown={startLayersResize}
              onDblClick={toggleLayersHalf}
            />
            <div
              class="flex flex-col bg-[var(--bg-panel)] shrink-0"
              style={{ height: `${layersHeight()}px` }}
            >
              <div class="h-9 px-3 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] shrink-0">
                <div class="flex items-center gap-3 h-full">
                  <button
                    type="button"
                    onClick={() => setLowerTab('layers')}
                    class={`h-full flex items-center gap-2 border-b-2 cursor-pointer ${
                      lowerTab() === 'layers'
                        ? 'border-purple-400'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <LayersIcon size={15} class="text-purple-400" />
                    <Label uppercase badge={currentLayerCount()}>
                      Layers
                    </Label>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLowerTab('selections')}
                    title="Saved face selection groups"
                    class={`h-full flex items-center gap-2 border-b-2 cursor-pointer ${
                      lowerTab() === 'selections'
                        ? 'border-amber-400'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <BookmarkIcon size={14} class="text-amber-400" />
                    <Label
                      uppercase
                      badge={selectionGroups().filter((g) => g.piece === activePieceName()).length}
                    >
                      Selections
                    </Label>
                  </button>
                </div>
                <Show when={lowerTab() === 'layers'}>
                  <>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const stack = viewportHandle?.getLayerStack()
                      if (stack) {
                        stack.addLayer()
                        bumpLayers()
                      }
                    }}
                    tooltip="Add new painting layer"
                  >
                    <PlusIcon size={14} />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const stack = viewportHandle?.getLayerStack()
                      if (stack) {
                        stack.groupIntoFolder(stack.activeId)
                        bumpLayers()
                      }
                    }}
                    tooltip="Group the selected layer into a new folder (Ctrl+G)"
                  >
                    <FolderIcon size={14} />
                  </IconButton>
                  </>
                </Show>
              </div>

              <Show when={modelPieces().length > 1}>
                <div class="px-2.5 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-input)] flex items-center gap-1.5">
                  <Show when={pieceAliasDraft() !== null}>
                    <TextInput
                      size="xs"
                      value={pieceAliasDraft() ?? ''}
                      onInput={(val) => setPieceAliasDraft(val)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitPieceAlias()
                        }
                        if (e.key === 'Escape') {
                          setPieceAliasDraft(null)
                        }
                      }}
                      onBlur={commitPieceAlias}
                      placeholder={modelPieces()[pieceAliasTarget]?.name}
                      autofocus
                      class="flex-1 min-w-0"
                    />
                    <IconButton
                      size="xs"
                      variant="ghost"
                      onClick={commitPieceAlias}
                      tooltip="Confirm rename (leave empty to restore the mesh name)"
                    >
                      <CheckIcon size={13} />
                    </IconButton>
                  </Show>
                  <div
                    class="relative flex-1 min-w-0"
                    classList={{ hidden: pieceAliasDraft() !== null }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowPieceMenu((v) => !v)}
                      class={`w-full flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-[var(--ui-radius)] bg-[var(--bg-panel)] border text-xs transition-colors cursor-pointer text-left ${
                        showPieceMenu()
                          ? 'border-[var(--accent-color)] text-[var(--text-main)] ring-1 ring-[var(--accent-color)]/30'
                          : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-white/20 hover:text-[var(--text-main)]'
                      }`}
                      title="Piece being painted — double-click a piece in the viewport, or press Tab, to switch"
                    >
                      <div class="flex items-center gap-1.5 min-w-0 flex-1">
                        <CubeIcon size={13} class="text-purple-400 shrink-0" />
                        <span class="truncate font-medium">
                          {modelPieces()[activePiece()]?.label ?? `Piece ${activePiece() + 1}`}
                        </span>
                        <span class="text-[11px] text-[var(--text-muted)] font-mono shrink-0">
                          {modelPieces()[activePiece()]?.textureSize ?? 2048}px
                        </span>
                      </div>
                      <ChevronDownIcon
                        size={12}
                        class={`text-[var(--text-muted)] shrink-0 transition-transform duration-150 ${
                          showPieceMenu() ? 'rotate-180 text-[var(--text-main)]' : ''
                        }`}
                      />
                    </button>
                    <DropdownMenu
                      isOpen={showPieceMenu()}
                      onClose={() => setShowPieceMenu(false)}
                      items={modelPieces().map((piece) => ({
                        type: 'item' as const,
                        label: `${piece.label} (${piece.textureSize}px)`,
                        icon: () =>
                          piece.index === activePiece() ? (
                            <CheckIcon size={14} class="text-[var(--accent-color)]" />
                          ) : (
                            <CubeIcon size={14} class="text-zinc-500" />
                          ),
                        onClick: () => {
                          viewportHandle?.setActivePiece(piece.index)
                        }
                      }))}
                    />
                  </div>
                  <Show when={pieceAliasDraft() === null}>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setShowPieceMenu(false)
                        startPieceAlias()
                      }}
                      tooltip="Rename piece"
                    >
                      <Edit2Icon size={12} />
                    </IconButton>
                  </Show>
                </div>
              </Show>
              <div class="flex-1 overflow-hidden">
                <Show
                  when={lowerTab() === 'layers'}
                  fallback={
                    <SelectionGroupsPanel
                      pieceName={activePieceName()}
                      onSave={saveCurrentSelectionGroup}
                      onRecall={recallSelectionGroup}
                    />
                  }
                >
                  <LayersTab
                    getStack={() => viewportHandle?.getLayerStack()}
                    version={layersVersion()}
                    onChange={bumpLayers}
                    hideHeader={true}
                    onInspectLayer={inspectLayer}
                    onInspectFlattened={inspectFlattened}
                    pieces={modelPieces()}
                    activePiece={activePiece()}
                    getPieceStack={(i) => viewportHandle?.getLayerStack(i)}
                    onToast={showToast}
                  />
                </Show>
              </div>
            </div>
          </Show>
          </Show>
        </aside>
      </div>

      {/* Skinny Bottom Status Bar */}
      <StatusBar
        tool={activeTool()}
        textureSize={textureSize()}
        modelName={modelName()}
        selectedFaceCount={brush.selectedFaces().size}
        onOpenHelp={() => setShowHelp(true)}
        onClearFaceSelection={clearFaceSelection}
      />

      {/* Lazy Modals */}
      <Suspense fallback={null}>
        <StartWizardModal
          isOpen={showStartWizard()}
          onClose={() => setShowStartWizard(false)}
          onStartScratch={handleStartScratch}
          onOpenModel={handleOpenModel}
          onOpenProjectFile={handleOpenProjectFile}
          onRestoreRecovery={handleRestoreRecovery}
        />
        <UnsavedChangesModal
          isOpen={showUnsavedChangesModal()}
          modelName={modelName()}
          saving={isSavingBeforeClose()}
          onSave={handleSaveBeforeClose}
          onDiscard={handleDiscardAndClose}
          onCancel={() => setShowUnsavedChangesModal(false)}
        />
        <HelpModal isOpen={showHelp()} onClose={() => setShowHelp(false)} />
        <SettingsModal
          isOpen={showSettings()}
          onClose={() => setShowSettings(false)}
          onToast={showToast}
        />
        <BrushManagerModal
          isOpen={brushPresets.isManagerOpen()}
          onClose={() => brushPresets.closeManager()}
        />
        <Show when={showExportWizard()}>
          <ExportWizardModal
            isOpen={showExportWizard()}
            onClose={() => setShowExportWizard(false)}
            modelName={modelName()}
            modelPath={currentModelPath()}
            pieces={modelPieces()}
            getViewportHandle={() => viewportHandle}
            onToast={showToast}
          />
        </Show>
      </Suspense>
    </div>
  )
}
