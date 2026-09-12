import { createSignal, createEffect, onMount, onCleanup, Show, Suspense, lazy } from 'solid-js'
import * as THREE from 'three'
import Viewport, { type ViewportHandle } from './viewport/Viewport'
import TextureShelf from './components/TextureShelf'
import StatusBar from './components/BottomDock'
import { brushPresets, initBrushPresets } from './paint/brushPresets'
import LayersTab from './components/LayersTab'
import BrushSettingsTab from './components/BrushSettingsTab'
import type { LightingMode } from './viewport/scene'
import { DropdownMenu, IconButton, SegmentedControl, Toast, type MenuItem, type ToastData } from './components/ui'

// Lazy-loaded modals
const HelpModal = lazy(() => import('./components/HelpModal'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const StartWizardModal = lazy(() => import('./components/StartWizardModal'))
const BrushManagerModal = lazy(() => import('./components/BrushManagerModal'))
const EdgeWearWizard = lazy(() => import('./components/EdgeWearWizard'))
import { serializeProject, deserializeProject } from './utils/projectSerializer'

import {
  BrushIcon,
  StampIcon,
  EraserIcon,
  FillIcon,
  EyedropperIcon,
  SlidersIcon,
  LayersIcon,
  SettingsIcon,
  HelpCircleIcon,
  StudioLightIcon,
  FlatLightIcon,
  OutdoorLightIcon,
  WireframeIcon,
  FocusIcon,
  FolderOpenIcon,
  DownloadIcon,
  RefreshCwIcon,
  MousePointerIcon,
  AppIcon,
  SparklesIcon,
  LineIcon,
  SymmetryIcon,
  PlusIcon
} from './components/icons'
import MaterialTextureHUD from './components/MaterialTextureHUD'
import {
  brush,
  setTexturePath,
  clearFaceSelection,
  setTextureScale,
  stepRadius,
  type ToolMode
} from './paint/brush'
import { DEFAULT_TEXTURE_SIZE, type TextureSize } from './paint/paintEngine'

const LIGHTING_MODES: { value: LightingMode; label: string; icon: (props: { size?: number }) => any }[] = [
  { value: 'studio', label: 'Studio', icon: (p) => <StudioLightIcon size={p.size ?? 14} /> },
  { value: 'flat', label: 'Flat', icon: (p) => <FlatLightIcon size={p.size ?? 14} /> },
  { value: 'outdoor', label: 'Outdoor', icon: (p) => <OutdoorLightIcon size={p.size ?? 14} /> }
]

export default function App() {
  const [activeTool, setActiveTool] = createSignal<ToolMode>('brush')
  const [showHelp, setShowHelp] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [lightingMode, setLightingModeSignal] = createSignal<LightingMode>('studio')
  const [wireframeVisible, setWireframeVisibleSignal] = createSignal(false)
  const [textures, setTextures] = createSignal<string[]>([])
  const [layersVersion, setLayersVersion] = createSignal(0)

  const currentLayerCount = () => {
    void layersVersion()
    return viewportHandle?.getLayerStack()?.layers.length ?? 1
  }
  const canUndo = () => {
    void layersVersion()
    return viewportHandle?.canUndo() ?? false
  }
  const canRedo = () => {
    void layersVersion()
    return viewportHandle?.canRedo() ?? false
  }

  const [toast, setToast] = createSignal<ToastData | null>(null)
  const [showFileMenu, setShowFileMenu] = createSignal(false)
  const [showEditMenu, setShowEditMenu] = createSignal(false)
  const [showEdgeWearWizard, setShowEdgeWearWizard] = createSignal(false)
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
    if (lastFolderLoaded || textures().length > 0) return
    lastFolderLoaded = true
    const paths = await window.api.loadLastTextureFolder()
    if (paths && paths.length > 0) {
      setTextures(paths)
    }
  }

  async function restoreSessionInBackground(): Promise<void> {
    if (sessionRestoreStarted) return
    sessionRestoreStarted = true
    setIsRestoringSession(true)
    try {
      await Promise.all([ensureLastTextureFolderLoaded(), initBrushPresets()])
    } finally {
      setIsRestoringSession(false)
    }
  }

  function showToast(text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', durationMs = 3500): void {
    if (toastTimer) clearTimeout(toastTimer)
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

  async function handleSaveProject(): Promise<boolean> {
    setShowFileMenu(false)
    const layerStack = viewportHandle?.getLayerStack()
    if (!layerStack) return false

    let targetPath = currentProjectPath()
    if (!targetPath) {
      targetPath = await window.api.saveFileDialog({
        defaultPath: `${modelName().replace(/\.[^/.]+$/, '')}.meshcoat`,
        filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat'] }]
      })
      if (!targetPath) return false
      setCurrentProjectPath(targetPath)
    }

    const content = serializeProject({
      modelPath: currentModelPath(),
      modelName: modelName(),
      layerStack
    })

    const ok = await window.api.saveProjectFile(targetPath, content)
    if (ok) {
      setIsDirty(false)
      await window.api.clearRecovery()
      await window.api.addRecentProject(targetPath, modelName(), 'project')
      showToast(`Saved project: ${targetPath.split(/[/\\]/).pop()}`, 'success')
      return true
    } else {
      showToast('Failed to save project', 'error')
      return false
    }
  }

  async function handleSaveAsProject(): Promise<boolean> {
    setShowFileMenu(false)
    const layerStack = viewportHandle?.getLayerStack()
    if (!layerStack) return false

    const targetPath = await window.api.saveFileDialog({
      defaultPath: `${modelName().replace(/\.[^/.]+$/, '')}.meshcoat`,
      filters: [{ name: 'MeshCoat Project', extensions: ['meshcoat'] }]
    })
    if (!targetPath) return false
    setCurrentProjectPath(targetPath)

    const content = serializeProject({
      modelPath: currentModelPath(),
      modelName: modelName(),
      layerStack
    })

    const ok = await window.api.saveProjectFile(targetPath, content)
    if (ok) {
      setIsDirty(false)
      await window.api.clearRecovery()
      await window.api.addRecentProject(targetPath, modelName(), 'project')
      showToast(`Saved project as: ${targetPath.split(/[/\\]/).pop()}`, 'success')
      return true
    } else {
      showToast('Failed to save project', 'error')
      return false
    }
  }

  async function getReadyViewport(): Promise<ViewportHandle> {
    if (viewportHandle) return viewportHandle
    const start = Date.now()
    while (!viewportHandle && Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 50))
    }
    if (!viewportHandle) {
      throw new Error('3D Viewport is still initializing, please wait a moment and try again.')
    }
    return viewportHandle
  }

  async function handleStartScratch(size: TextureSize): Promise<void> {
    const handle = await getReadyViewport()
    await handle.loadDefaultModel(size)
    setTextureSize(size)
    setModelName('Default Sphere')
    setCurrentModelPath(null)
    setCurrentProjectPath(null)
    setIsDirty(false)
    showToast('Started new project from scratch', 'info')
  }

  async function handleOpenModel(
    path: string,
    size: TextureSize,
    initialTexturePath?: string | null
  ): Promise<void> {
    const handle = await getReadyViewport()
    const extension = path.split('.').pop() ?? ''
    const filename = path.split(/[/\\]/).pop() ?? 'Loaded Model'
    const url = window.api.assetUrl(path)
    const initialTexUrl = initialTexturePath ? window.api.assetUrl(initialTexturePath) : null
    await handle.loadFromUrl(url, extension, size, initialTexUrl)
    setTextureSize(size)
    setModelName(filename)
    setCurrentModelPath(path)
    setCurrentProjectPath(null)
    setIsDirty(false)
    await window.api.addRecentProject(path, filename, 'model')
    showToast(`Loaded model ${filename}${initialTexturePath ? ' with texture' : ''}`, 'success')
  }

  async function handleOpenProjectFile(path: string): Promise<void> {
    const handle = await getReadyViewport()
    const content = await window.api.readProjectFile(path)
    if (!content) throw new Error('Could not read project file from disk')
    const { project, stackSnapshot } = await deserializeProject(content)
    await handle.loadProject(project, stackSnapshot)
    setTextureSize(project.textureSize as TextureSize)
    setModelName(project.name || project.modelName)
    setCurrentModelPath(project.modelPath)
    setCurrentProjectPath(path)
    setIsDirty(false)
    await window.api.addRecentProject(path, project.name, 'project')
    showToast(`Loaded project: ${project.name}`, 'success')
  }

  async function handleRestoreRecovery(recoveryData: string): Promise<void> {
    const handle = await getReadyViewport()
    const { project, stackSnapshot } = await deserializeProject(recoveryData)
    await handle.loadProject(project, stackSnapshot)
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

  function toggleWireframe(): void {
    const next = !wireframeVisible()
    setWireframeVisibleSignal(next)
    viewportHandle?.setWireframeVisible(next)
  }

  function frameCamera(): void {
    viewportHandle?.focusModel()
  }

  async function exportTexturePng(): Promise<void> {
    setShowFileMenu(false)
    const dataUrl = viewportHandle?.exportBaseColorPng()
    if (!dataUrl) return
    const filePath = await window.api.saveFileDialog({
      defaultPath: `${modelName().replace(/\.[^/.]+$/, '')}_BaseColor.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (!filePath) return
    await window.api.savePng(filePath, dataUrl)
    showToast(`Exported: ${filePath.split('/').pop()}`, 'success')
  }

  async function pickTextureFolder(): Promise<void> {
    const paths = await window.api.pickTextureFolder()
    if (paths && paths.length > 0) {
      setTextures(paths)
      showToast(`Loaded ${paths.length} textures`, 'info')
    }
  }

  function clearTextureFolder(): void {
    setTextures([])
    setTexturePath(null)
    showToast('Cleared texture shelf', 'info')
  }

  async function handleImportTextures(): Promise<void> {
    setShowFileMenu(false)
    await pickTextureFolder()
  }

  function handleClearActiveLayer(): void {
    setShowEditMenu(false)
    const stack = viewportHandle?.getLayerStack()
    const active = stack?.active
    if (active && stack) {
      stack.clearLayer(active.id)
      bumpLayers()
      showToast(`Cleared "${active.name}"`, 'info')
    }
  }

  function handleFillActiveLayer(): void {
    setShowEditMenu(false)
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
    if (!viewportHandle?.canUndo()) return
    viewportHandle.undo()
    bumpLayers()
    showToast('Undo', 'info', 1200)
  }

  function handleRedo(): void {
    if (!viewportHandle?.canRedo()) return
    viewportHandle.redo()
    bumpLayers()
    showToast('Redo', 'info', 1200)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (showHelp() || showSettings() || showStartWizard() || brushPresets.isManagerOpen()) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

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
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setShowStartWizard(true)
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
        if (count > 0) showToast(`Selected all ${count} faces`, 'info')
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
          showToast(next !== 'off' ? `Symmetry: ${next.toUpperCase()} Axis` : 'Symmetry: OFF', 'info')
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
      ;(window as any).__app = {
        setActiveTool,
        setShowEdgeWearWizard,
        toggleWireframe,
        setTextures,
        showToast
      }
    }

    // Periodic Autosave every 60s if there are unsaved changes
    const autosaveTimer = setInterval(async () => {
      if (isDirty() && viewportHandle) {
        const stack = viewportHandle.getLayerStack()
        if (stack) {
          try {
            const data = serializeProject({
              modelPath: currentModelPath(),
              modelName: modelName(),
              layerStack: stack
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

  const fileMenuItems = (): MenuItem[] => [
    {
      label: 'New / Welcome Wizard...',
      shortcut: 'Ctrl+N',
      icon: (p) => <SparklesIcon size={p.size} class="text-blue-400" />,
      onClick: () => setShowStartWizard(true)
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
      label: 'Load Texture Folder...',
      icon: (p) => <FolderOpenIcon size={p.size} />,
      onClick: handleImportTextures
    },
    { type: 'divider' },
    {
      label: 'Export Texture (PNG)...',
      icon: (p) => <DownloadIcon size={p.size} />,
      onClick: exportTexturePng
    },
    ...(textures().length > 0
      ? ([
          { type: 'divider' } as MenuItem,
          {
            label: 'Clear Texture Drawer',
            icon: (p) => <RefreshCwIcon size={p.size} />,
            onClick: clearTextureFolder
          } as MenuItem
        ])
      : [])
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
        ? brush.selectedFaces().size > 0 ? 'Fill Selection with Texture' : 'Fill Active Layer with Texture'
        : brush.selectedFaces().size > 0 ? 'Fill Selection with Color' : 'Fill Active Layer with Color',
      shortcut: 'G',
      onClick: handleFillActiveLayer
    },
    { type: 'divider' },
    {
      label: 'Generate Edge Wear & Highlights...',
      icon: (p) => <SparklesIcon size={p.size} class="text-amber-400" />,
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
    }
  ]

  return (
    <div class="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 select-none overflow-hidden font-sans">
      {/* Top Application Header */}
      <header class="h-11 min-h-11 px-3.5 bg-zinc-950 border-b border-zinc-850 flex items-center justify-between select-none z-30 flex-shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          {/* App Branding & Document Title */}
          <div class="flex items-center gap-2 pr-3 border-r border-zinc-800 min-w-0">
            <AppIcon size={20} class="flex-shrink-0" />
            <span class="text-xs font-bold tracking-tight text-zinc-100 flex-shrink-0">MeshCoat</span>
            <span class="text-zinc-600 text-xs font-normal select-none">/</span>
            <span class="text-xs font-medium text-zinc-300 max-w-[220px] truncate" title={modelName()}>
              {modelName()}{isDirty() ? ' *' : ''}
            </span>
            <Show when={isRestoringSession()}>
              <div class="flex items-center gap-1 text-zinc-500 font-mono text-[10px] flex-shrink-0" title="Restoring session textures">
                <RefreshCwIcon size={10} class="animate-spin text-zinc-400" />
              </div>
            </Show>
          </div>

          {/* Menus */}
          <div class="flex items-center gap-1 flex-shrink-0">
            {/* File Menu */}
            <div class="relative">
              <button
                type="button"
                class={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  showFileMenu()
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900'
                }`}
                onClick={() => {
                  setShowFileMenu((v) => !v)
                  setShowEditMenu(false)
                }}
              >
                File
              </button>
              <DropdownMenu
                isOpen={showFileMenu()}
                onClose={() => setShowFileMenu(false)}
                items={fileMenuItems()}
              />
            </div>

            {/* Edit Menu */}
            <div class="relative">
              <button
                type="button"
                class={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  showEditMenu()
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900'
                }`}
                onClick={() => {
                  setShowEditMenu((v) => !v)
                  setShowFileMenu(false)
                }}
              >
                Edit
              </button>
              <DropdownMenu
                isOpen={showEditMenu()}
                onClose={() => setShowEditMenu(false)}
                items={editMenuItems()}
              />
            </div>
          </div>
        </div>

        {/* Top Right Quick Controls */}
        <div class="flex items-center gap-2">
          {/* Segmented Lighting Selector */}
          <SegmentedControl
            size="xs"
            options={LIGHTING_MODES}
            value={lightingMode()}
            onChange={selectLightingMode}
          />

          <div class="w-px h-4 bg-zinc-800 mx-0.5" />

          {/* Wireframe Button */}
          <IconButton
            size="sm"
            active={wireframeVisible()}
            onClick={toggleWireframe}
            title="Toggle wireframe overlay (W)"
          >
            <WireframeIcon size={16} />
          </IconButton>

          {/* Symmetry Mirror Toggle */}
          <div class="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            <button
              type="button"
              class={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                brush.symmetryEnabled()
                  ? 'bg-blue-600/20 text-blue-400 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => {
                const axes: ('off' | 'x' | 'y' | 'z')[] = ['off', 'x', 'y', 'z']
                const next = axes[(axes.indexOf(brush.symmetryAxis()) + 1) % axes.length]
                brush.setSymmetryAxis(next)
                showToast(next !== 'off' ? `Symmetry: ${next.toUpperCase()} Axis` : 'Symmetry: OFF', 'info')
              }}
              title={`Symmetry: ${brush.symmetryAxis() === 'off' ? 'OFF' : brush.symmetryAxis().toUpperCase() + ' Axis'} (Alt+X)`}
            >
              <SymmetryIcon size={14} />
              <span class="font-mono text-[10px] uppercase">
                {brush.symmetryAxis() === 'off' ? 'Off' : brush.symmetryAxis()}
              </span>
            </button>
          </div>

          {/* Frame Model */}
          <IconButton
            size="sm"
            variant="ghost"
            onClick={frameCamera}
            title="Frame model in viewport (F)"
          >
            <FocusIcon size={16} />
          </IconButton>

          <div class="w-px h-4 bg-zinc-800 mx-0.5" />

          {/* Settings & Help */}
          <IconButton
            size="sm"
            variant="ghost"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <SettingsIcon size={16} />
          </IconButton>

          <IconButton
            size="sm"
            variant="ghost"
            onClick={() => setShowHelp(true)}
            title="Quick guide & hotkeys (?)"
          >
            <HelpCircleIcon size={16} />
          </IconButton>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div class="flex-1 flex overflow-hidden relative">
        {/* Left Toolbar Dock */}
        <nav
          class="w-12 min-w-12 max-w-12 bg-zinc-950 border-r border-zinc-850 flex flex-col items-center py-2.5 gap-1.5 z-20 select-none flex-shrink-0"
          aria-label="Painting tools"
        >
          {/* Painting Tools */}
          <IconButton
            size="md"
            active={activeTool() === 'brush'}
            onClick={() => setActiveTool('brush')}
            shortcut="B"
            title="Paint Brush (B)"
          >
            <BrushIcon size={18} />
          </IconButton>

          <IconButton
            size="md"
            active={activeTool() === 'line'}
            onClick={() => setActiveTool('line')}
            shortcut="L"
            title="Line Tool (L)"
          >
            <LineIcon size={18} />
          </IconButton>

          <IconButton
            size="md"
            active={activeTool() === 'stamp'}
            onClick={() => setActiveTool('stamp')}
            shortcut="T"
            title="Texture Stamp (T)"
          >
            <StampIcon size={18} />
          </IconButton>

          <IconButton
            size="md"
            active={activeTool() === 'eraser'}
            onClick={() => setActiveTool('eraser')}
            shortcut="E"
            title="Eraser (E)"
          >
            <EraserIcon size={18} />
          </IconButton>

          <IconButton
            size="md"
            active={activeTool() === 'fill'}
            onClick={() => setActiveTool('fill')}
            shortcut="G"
            title="Fill Bucket (G)"
          >
            <FillIcon size={18} />
          </IconButton>

          <div class="w-6 h-px bg-zinc-800 my-1" />

          {/* Sampler & Selection */}
          <IconButton
            size="md"
            active={activeTool() === 'eyedropper'}
            onClick={() => setActiveTool('eyedropper')}
            shortcut="I"
            title="Color Eyedropper (I)"
          >
            <EyedropperIcon size={18} />
          </IconButton>

          <IconButton
            size="md"
            active={activeTool() === 'faceSelect'}
            onClick={() => setActiveTool('faceSelect')}
            shortcut="V"
            title="Face Selection Mask (V)"
          >
            <MousePointerIcon size={18} />
          </IconButton>

          <div class="w-6 h-px bg-zinc-800 my-1" />

          {/* Viewport & Wizard Actions */}
          <IconButton
            size="md"
            variant="ghost"
            onClick={frameCamera}
            shortcut="F"
            title="Frame Model (F)"
          >
            <FocusIcon size={18} />
          </IconButton>

          <IconButton
            size="md"
            active={showEdgeWearWizard()}
            onClick={() => {
              if (showEdgeWearWizard()) {
                viewportHandle?.cancelEdgeWearPreview()
                setShowEdgeWearWizard(false)
              } else {
                setShowEdgeWearWizard(true)
              }
            }}
            title="Edge Wear & Chipping Wizard"
          >
            <SparklesIcon size={18} class="text-amber-400" />
          </IconButton>
        </nav>

        {/* Vertical Texture Shelf Drawer */}
        <TextureShelf
          textures={textures()}
          onPickFolder={pickTextureFolder}
          onClearFolder={clearTextureFolder}
          isMaskTarget={() => {
            void layersVersion()
            return !!viewportHandle?.getLayerStack()?.active?.isMask
          }}
        />

        {/* 3D Viewport Main Area */}
        <main class="flex-1 relative overflow-hidden bg-zinc-950">
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
            onWireframeChanged={setWireframeVisibleSignal}
          />

          {/* Floating Material Texture HUD Card (bottom-right of viewport) */}
          <MaterialTextureHUD
            activeTool={activeTool()}
            isMaskTarget={() => {
              void layersVersion()
              return !!viewportHandle?.getLayerStack()?.active?.isMask
            }}
          />

          {/* Floating Toast Notification */}
          <Toast toast={toast()} onClose={() => setToast(null)} />
        </main>

        {/* Right Sidebar Inspector */}
        <aside class="w-[320px] min-w-[320px] max-w-[320px] h-full bg-zinc-900 border-l border-zinc-800 flex flex-col select-none z-20 flex-shrink-0">
          <Show
            when={!showEdgeWearWizard()}
            fallback={
              <Suspense fallback={null}>
                <EdgeWearWizard
                  isOpen={showEdgeWearWizard()}
                  initialColor={brush.color()}
                  textures={textures()}
                  onClose={() => setShowEdgeWearWizard(false)}
                  onPreview={(params) => viewportHandle?.previewEdgeWear(params)}
                  onCancel={() => viewportHandle?.cancelEdgeWearPreview()}
                  onCommit={(params, asNewLayer) => {
                    viewportHandle?.commitEdgeWear(params, asNewLayer)
                    bumpLayers()
                    showToast(asNewLayer ? 'Created "Edge Wear" layer' : 'Applied edge wear to active layer', 'success')
                  }}
                />
              </Suspense>
            }
          >
            {/* Top Half: Brush Settings (Scrollable) */}
            <div class="flex-1 overflow-y-auto border-b border-zinc-800">
              <div class="h-9 px-3.5 flex items-center gap-2 border-b border-zinc-800 bg-zinc-850/50">
                <SlidersIcon size={15} class="text-blue-400" />
                <span class="text-xs font-semibold text-zinc-200 tracking-tight">Brush Settings</span>
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

            {/* Bottom Half: Layers (Fixed Height / Resizable) */}
            <div class="h-[320px] flex flex-col bg-zinc-950/30">
              <div class="h-9 px-3.5 flex items-center justify-between border-b border-zinc-800 bg-zinc-850/50 flex-shrink-0">
                <div class="flex items-center gap-2">
                  <LayersIcon size={15} class="text-purple-400" />
                  <span class="text-xs font-semibold text-zinc-200 tracking-tight">Layers</span>
                  <span class="px-1.5 py-0.2 rounded bg-zinc-800 border border-zinc-700/60 font-mono text-[10px] text-zinc-400 tabular-nums">
                    {currentLayerCount()}
                  </span>
                </div>
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
                  title="Add new painting layer"
                >
                  <PlusIcon size={14} />
                </IconButton>
              </div>
              <div class="flex-1 overflow-hidden">
                <LayersTab
                  getStack={() => viewportHandle?.getLayerStack()}
                  version={layersVersion()}
                  onChange={bumpLayers}
                  hideHeader={true}
                />
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
        <SettingsModal isOpen={showSettings()} onClose={() => setShowSettings(false)} />
        <BrushManagerModal
          isOpen={brushPresets.isManagerOpen()}
          onClose={() => brushPresets.closeManager()}
        />
      </Suspense>
    </div>
  )
}
