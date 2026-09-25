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
import BrushSettingsTab from './components/BrushSettingsTab'
import type { LightingMode } from './viewport/scene'
import {
  DropdownMenu,
  IconButton,
  Toast,
  Label,
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
import { serializeProject, deserializeProject } from './utils/projectSerializer'

import {
  SlidersIcon,
  LayersIcon,
  FocusIcon,
  FolderOpenIcon,
  DownloadIcon,
  RefreshCwIcon,
  SparklesIcon,
  EdgeWearIcon,
  BookmarkIcon,
  PlusIcon,
  CubeIcon,
  ChevronDownIcon,
  CheckIcon,
  PanelRightIcon
} from './components/icons'
import ToolPanelDock from './components/ToolPanelDock'
import { panelsForTool, toolUsesPanel } from './paint/toolPanels'
import { openUvInspector, closeAllUvInspectors } from './utils/uvInspector'
import WorkstationHeader from './components/WorkstationHeader'
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
import { DEFAULT_TEXTURE_SIZE, type TextureSize } from './paint/paintEngine'
import { textTool } from './paint/textTool'
import {
  selectionGroups,
  saveSelectionGroup,
  setSelectionGroups,
  type SelectionGroup
} from './paint/selectionGroups'
import type { MeshCoatProject } from './utils/projectSerializer'
import SelectionGroupsPanel from './components/SelectionGroupsPanel'

export default function App(): JSX.Element {
  const [activeTool, setActiveTool] = createSignal<ToolMode>('brush')
  const [showHelp, setShowHelp] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [lightingMode, setLightingModeSignal] = createSignal<LightingMode>('showcase')
  const [viewMode, setViewModeSignal] = createSignal<ChannelViewMode>('material')
  const [wireframeVisible, setWireframeVisibleSignal] = createSignal(false)
  const [isolatePiece, setIsolatePieceSignal] = createSignal(false)
  const [textures, setTextures] = createSignal<string[]>([])
  /** Folder the shelf was loaded from, so it can offer its subfolders as a filter. */
  const [textureRoot, setTextureRoot] = createSignal<string | null>(null)
  const [layersVersion, setLayersVersion] = createSignal(0)
  const [piecesVersion, setPiecesVersion] = createSignal(0)
  const [showStencilPanel, setShowStencilPanel] = createSignal(false)

  /** The docked tool-panel column beside the brush settings. */
  const [showPanelDock, setShowPanelDock] = createSignal(true)
  const [showExportWizard, setShowExportWizard] = createSignal(false)

  createEffect(() => {
    // Picking a texture makes the material and crop panels relevant, so make
    // sure the dock they live in is actually on screen — but only if the active
    // tool is one that owns a material panel.
    if (brush.texturePath() && toolUsesPanel(activeTool(), 'material')) {
      setShowPanelDock(true)
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
  const [showEdgeWearWizard, setShowEdgeWearWizard] = createSignal(false)
  /** Which view the lower sidebar panel shows. */
  const [lowerTab, setLowerTab] = createSignal<'layers' | 'selections'>('layers')

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
  const [isDirty, setIsDirty] = createSignal(false)
  const [currentProjectPath, setCurrentProjectPath] = createSignal<string | null>(null)
  const [currentModelPath, setCurrentModelPath] = createSignal<string | null>(null)

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
  function projectPieces(): { name: string; layerStack: LayerStack }[] {
    const handle = viewportHandle
    if (!handle) {
      return []
    }
    const out: { name: string; layerStack: LayerStack }[] = []
    for (const info of handle.pieces()) {
      const stack = handle.getLayerStack(info.index)
      if (stack) {
        out.push({ name: info.name, layerStack: stack })
      }
    }
    return out
  }

  async function handleSaveProject(): Promise<boolean> {
    const savePieces = projectPieces()
    if (savePieces.length === 0) {
      return false
    }

    let targetPath = currentProjectPath()
    if (!targetPath) {
      targetPath = await window.api.saveFileDialog({
        defaultPath: `${modelName().replace(/\.[^/.]+$/, '')}.meshcoat`,
        filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat'] }]
      })
      if (!targetPath) {
        return false
      }
      setCurrentProjectPath(targetPath)
    }

    const content = serializeProject({
      modelPath: currentModelPath(),
      modelName: modelName(),
      pieces: savePieces,
      activePieceIndex: viewportHandle?.activePieceIndex() ?? 0
    })

    const ok = await window.api.saveProjectFile(targetPath, content)
    if (ok) {
      setIsDirty(false)
      await window.api.clearRecovery()
      await window.api.addRecentProject(targetPath, modelName(), 'project')
      showToast(`Saved project: ${targetPath.split(/[/\\]/).pop()}`, 'success')
      return true
    }
    showToast('Failed to save project', 'error')
    return false
  }

  async function handleSaveAsProject(): Promise<boolean> {
    const savePieces = projectPieces()
    if (savePieces.length === 0) {
      return false
    }

    const targetPath = await window.api.saveFileDialog({
      defaultPath: `${modelName().replace(/\.[^/.]+$/, '')}.meshcoat`,
      filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat'] }]
    })
    if (!targetPath) {
      return false
    }
    setCurrentProjectPath(targetPath)

    const content = serializeProject({
      modelPath: currentModelPath(),
      modelName: modelName(),
      pieces: savePieces,
      activePieceIndex: viewportHandle?.activePieceIndex() ?? 0
    })

    const ok = await window.api.saveProjectFile(targetPath, content)
    if (ok) {
      setIsDirty(false)
      await window.api.clearRecovery()
      await window.api.addRecentProject(targetPath, modelName(), 'project')
      showToast(`Saved project as: ${targetPath.split(/[/\\]/).pop()}`, 'success')
      return true
    }
    showToast('Failed to save project', 'error')
    return false
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
    // Every open inspector is showing pixels that are about to be disposed.
    closeAllUvInspectors()
    await handle.loadDefaultModel(size, primitive)
    setTextureSize(size)
    setModelName(primitive === 'cube' ? 'Default Cube' : 'Default Sphere')
    setCurrentModelPath(null)
    setCurrentProjectPath(null)
    setIsDirty(false)
    showToast(
      `Started new project from ${primitive === 'cube' ? 'Cube' : 'Sphere'} scratch`,
      'info'
    )
  }

  async function handleBrowseAndOpenModel(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: '3D Models', extensions: ['glb', 'gltf', 'obj', 'blend'] }]
    })
    const path = paths?.[0]
    if (!path) {
      return
    }
    try {
      await handleOpenModel(path, textureSize())
    } catch (err) {
      showToast(
        `Failed to open model: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
    }
  }

  async function handleBrowseAndOpenProject(): Promise<void> {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat', 'json'] }]
    })
    const path = paths?.[0]
    if (!path) {
      return
    }
    try {
      await handleOpenProjectFile(path)
    } catch (err) {
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
    setTextureSize((allocated ?? size) as TextureSize)
    if (allocated && allocated !== size) {
      showToast(`Painting at ${allocated}px to match the imported textures`, 'info')
    }
    setModelName(filename)
    setSelectionGroups([])
    setCurrentModelPath(path)
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
      } catch {
        // Texture folder is optional context from the project file — a
        // missing/unreadable one just means the shelf starts empty.
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

  async function handleOpenProjectFile(path: string): Promise<void> {
    const handle = await getReadyViewport()
    const content = await window.api.readProjectFile(path)
    if (!content) {
      throw new Error('Could not read project file from disk')
    }
    const { project, stackSnapshots } = await deserializeProject(content)
    await handle.loadProject(project, stackSnapshots)
    restoreSelectionGroups(project)
    setTextureSize(project.textureSize as TextureSize)
    setModelName(project.name || project.modelName)
    setCurrentModelPath(project.modelPath)
    setCurrentProjectPath(path)
    setIsDirty(false)
    await window.api.addRecentProject(path, project.name, 'project')
    showToast(`Loaded project: ${project.name}`, 'success')
  }

  /**
   * Re-imports the model from disk after it was edited elsewhere (Blender,
   * etc.), keeping every layer. Round-trips through the project format, so
   * layers land back on pieces by name exactly as opening a saved project does.
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
    try {
      const content = serializeProject({
        modelPath,
        modelName: modelName(),
        pieces: projectPieces(),
        activePieceIndex: handle.activePieceIndex()
      })
      const { project, stackSnapshots } = await deserializeProject(content)
      await handle.loadProject(project, stackSnapshots, { reload: true })
      restoreSelectionGroups(project)
      setIsDirty(true)
      showToast(`Reloaded ${modelPath.split(/[/\\]/).pop()}`, 'success')
    } catch (err) {
      console.error('Model reload failed:', err)
      showToast(`Reload failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  async function handleRestoreRecovery(recoveryData: string): Promise<void> {
    const handle = await getReadyViewport()
    const { project, stackSnapshots } = await deserializeProject(recoveryData)
    await handle.loadProject(project, stackSnapshots)
    restoreSelectionGroups(project)
    setTextureSize(project.textureSize as TextureSize)
    setModelName(project.name || project.modelName)
    setCurrentModelPath(project.modelPath)
    setCurrentProjectPath(null)
    setIsDirty(true)
    showToast(`Restored unsaved session: ${project.name}`, 'success')
  }

  function onMissingUv(names: string[]): void {
    showToast(`Missing UV0 on: ${names.join(', ')}`, 'warning')
  }

  function selectLightingMode(mode: LightingMode): void {
    setLightingModeSignal(mode)
    viewportHandle?.setLightingMode(mode)
  }

  function selectViewMode(mode: ChannelViewMode): void {
    setViewModeSignal(mode)
    viewportHandle?.setViewMode(mode)
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
      const hasTexture = Boolean(brush.texturePath())
      const count = brush.selectedFaces().size
      if (hasTexture) {
        showToast(
          count > 0
            ? `Filled ${count} face(s) on "${active.name}" with texture`
            : `Filled "${active.name}" with texture`,
          'info'
        )
      } else {
        showToast(
          count > 0
            ? `Filled ${count} face(s) on "${active.name}" with color`
            : `Filled "${active.name}" with color`,
          'info'
        )
      }
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
        showToast('Cleared face selection', 'info')
        return
      }
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault()
        viewportHandle?.invertFaceSelection()
        showToast('Inverted face selection', 'info')
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
        setShowPanelDock(true)
        break
      case '8':
      case 'p':
        setActiveTool('faceProjector')
        setShowPanelDock(true)
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
          setShowPanelDock(true)
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
          setShowPanelDock(true)
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
          const next = !showPanelDock()
          setShowPanelDock(next)
          showToast(next ? 'Tool panels shown' : 'Tool panels hidden', 'info')
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
      } catch {
        // Detection is a startup nicety — nothing to surface if it fails.
      }
    })()

    // Periodic Autosave every 60s if there are unsaved changes
    const autosaveTimer = setInterval(async () => {
      if (isDirty() && viewportHandle) {
        const stack = viewportHandle.getLayerStack()
        if (stack) {
          try {
            const data = serializeProject({
              modelPath: currentModelPath(),
              modelName: modelName(),
              pieces: projectPieces(),
              activePieceIndex: viewportHandle.activePieceIndex()
            })
            await window.api.saveRecovery(data)
          } catch (err) {
            console.error('Autosave error:', err)
          }
        }
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
   * The dock holds every tool panel now, so this menu is about the dock itself
   * plus the one panel that is a mode as well as a panel (the stencil).
   */
  const panelMenuItems = (): MenuItem[] => [
    { type: 'header', label: 'Workspace' },
    {
      label: showPanelDock() ? 'Hide Tool Panels' : 'Show Tool Panels',
      shortcut: 'C',
      icon: (p) => <PanelRightIcon size={p.size} class="text-blue-400" />,
      onClick: () => {
        setShowPanelDock((v) => !v)
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
          setShowPanelDock(true)
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
    },
    { type: 'divider' },
    {
      label: 'Frame Model in Viewport',
      shortcut: 'F',
      icon: (p) => <FocusIcon size={p.size} />,
      onClick: frameCamera
    },
    {
      label: 'Deselect Faces',
      shortcut: 'Esc',
      onClick: clearFaceSelection
    },
    {
      label: 'Save Selection as Group...',
      icon: (p) => <BookmarkIcon size={p.size} class="text-amber-400" />,
      disabled: brush.selectedFaces().size === 0,
      onClick: () => setLowerTab('selections')
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
        fileMenuItems={fileMenuItems()}
        editMenuItems={editMenuItems()}
        panelMenuItems={panelMenuItems()}
        lightingMode={lightingMode()}
        onSelectLightingMode={selectLightingMode}
        viewMode={viewMode()}
        onSelectViewMode={selectViewMode}
        showPanelDock={showPanelDock()}
        onTogglePanelDock={() => setShowPanelDock((v) => !v)}
        wireframeVisible={wireframeVisible()}
        onToggleWireframe={toggleWireframe}
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
              setShowPanelDock(true)
            }
          }}
          showStencilPanel={showStencilPanel()}
          onToggleStencilPanel={() => {
            const next = !showStencilPanel()
            setShowStencilPanel(next)
            // Only reveal the dock if the active tool is one that shows the
            // stencil panel — the eyedropper and face tools never do.
            if (next && toolUsesPanel(activeTool(), 'stencil')) {
              setShowPanelDock(true)
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

        <TextureShelf
          textures={textures()}
          textureRoot={textureRoot()}
          onPickFolder={pickTextureFolder}
          onClearFolder={clearTextureFolder}
          onToast={showToast}
          isMaskTarget={() => {
            void layersVersion()
            return !!viewportHandle?.getLayerStack()?.active?.isMask
          }}
        />

        <main class="flex-1 relative overflow-hidden bg-[var(--bg-main)]">
          <Viewport
            tool={activeTool}
            textures={textures()}
            onToolChange={(t) => setActiveTool(t)}
            onReady={(h) => {
              viewportHandle = h
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
            onWireframeChanged={setWireframeVisibleSignal}
            onIsolatePieceChanged={setIsolatePieceSignal}
          />

          <Toast toast={toast()} onClose={() => setToast(null)} />
        </main>

        {/* Right Sidebar Inspector */}
        {/* Tool panel dock: everything that used to float over the viewport,
            in one column that slides out beside the brush settings. */}
        <Show when={showPanelDock()}>
          <div class="w-[300px] min-w-[300px] max-w-[300px] h-full z-20 flex-shrink-0 animate-in slide-in-from-right-4 duration-150">
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
              stencilPanelOpen={showStencilPanel()}
            />
          </div>
        </Show>

        <aside class="w-[320px] min-w-[320px] max-w-[320px] h-full bg-[var(--bg-panel)] border-l border-[var(--border-color)] flex flex-col select-none z-20 shrink-0">
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
              <div class="h-9 px-3 flex items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel-header)]">
                <SlidersIcon size={15} class="text-[var(--accent-color)]" />
                <Label uppercase>Brush Settings</Label>
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

            <div class="h-[340px] flex flex-col bg-[var(--bg-panel)]">
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
                </Show>
              </div>

              <Show when={modelPieces().length > 1}>
                <div class="px-2.5 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-input)] flex items-center gap-1.5">
                  <div class="relative flex-1 min-w-0">
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
                          {modelPieces()[activePiece()]?.name ?? `Piece ${activePiece() + 1}`}
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
                        label: `${piece.name} (${piece.textureSize}px)`,
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
                  <IconButton
                    size="xs"
                    variant="ghost"
                    onClick={() => viewportHandle?.focusPiece()}
                    tooltip="Frame this piece"
                  >
                    <FocusIcon size={14} />
                  </IconButton>
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
                  />
                </Show>
              </div>
            </div>
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
        onFrameCamera={frameCamera}
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
            pieces={modelPieces()}
            getViewportHandle={() => viewportHandle}
            onToast={showToast}
          />
        </Show>
      </Suspense>
    </div>
  )
}
