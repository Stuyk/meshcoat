import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import * as THREE from 'three'
import HelpModal from './components/HelpModal'
import SettingsModal from './components/SettingsModal'
import NewProjectModal from './components/NewProjectModal'
import BrushManagerModal from './components/BrushManagerModal'
import EdgeWearWizard from './components/EdgeWearWizard'
import Viewport, { type ViewportHandle } from './viewport/Viewport'
import TextureShelf from './components/TextureShelf'
import StatusBar from './components/BottomDock'
import { brushPresets, initBrushPresets } from './paint/brushPresets'
import LayersTab from './components/LayersTab'
import BrushSettingsTab from './components/BrushSettingsTab'
import type { LightingMode } from './viewport/scene'
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
  CubeIcon,
  FocusIcon,
  FolderOpenIcon,
  DownloadIcon,
  XIcon,
  RefreshCwIcon,
  MousePointerIcon,
  AppIcon,
  SparklesIcon,
  LineIcon,
  SymmetryIcon
} from './components/icons'
import {
  brush,
  setTexturePath,
  clearFaceSelection,
  setTextureScale,
  stepRadius,
  type ToolMode
} from './paint/brush'
import { DEFAULT_TEXTURE_SIZE, type TextureSize } from './paint/paintEngine'

const LIGHTING_MODES: { mode: LightingMode; label: string; Icon: typeof StudioLightIcon }[] = [
  { mode: 'studio', label: 'Studio lighting', Icon: StudioLightIcon },
  { mode: 'flat', label: 'Flat lighting (true texture color)', Icon: FlatLightIcon },
  { mode: 'outdoor', label: 'Outdoor lighting', Icon: OutdoorLightIcon }
]

type RightPanelTab = 'brush' | 'layers' | 'split'

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
  const currentActiveLayerName = () => {
    void layersVersion()
    return viewportHandle?.getLayerStack()?.active?.name ?? 'Base'
  }
  const [toast, setToast] = createSignal<{ id: number; text: string; type: 'info' | 'success' | 'warning' | 'error' } | null>(null)
  const [showFileMenu, setShowFileMenu] = createSignal(false)
  const [showEditMenu, setShowEditMenu] = createSignal(false)
  const [showEdgeWearWizard, setShowEdgeWearWizard] = createSignal(false)
  const [modelName, setModelName] = createSignal('Default Model')
  const [rightPanelTab, setRightPanelTab] = createSignal<RightPanelTab>('split')
  const [textureSize, setTextureSize] = createSignal<TextureSize>(DEFAULT_TEXTURE_SIZE)
  const [showNewProjectModal, setShowNewProjectModal] = createSignal(false)

  let viewportHandle: ViewportHandle | undefined
  let colorPickerRef: HTMLInputElement | undefined
  let toastTimer: number | undefined
  let lastFolderLoaded = false

  async function ensureLastTextureFolderLoaded(): Promise<void> {
    if (lastFolderLoaded || textures().length > 0) return
    lastFolderLoaded = true
    const paths = await window.api.loadLastTextureFolder()
    if (paths && paths.length > 0) {
      setTextures(paths)
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

  const bumpLayers = (): void => {
    setLayersVersion((v) => v + 1)
  }

  async function pickTextureFolder(): Promise<void> {
    const paths = await window.api.pickTextureFolder()
    if (paths) {
      setTextures(paths)
      showToast(`Loaded ${paths.length} textures`, 'info')
    }
  }

  function clearTextureFolder(): void {
    setTextures([])
    setTexturePath(null)
    showToast('Cleared texture drawer', 'info')
  }

  /** Import model via New Project wizard (sets both model and resolution). */
  async function importModelFromWizard(path: string, size: TextureSize): Promise<void> {
    if (!viewportHandle) return
    const extension = path.split('.').pop() ?? ''
    const filename = path.split('/').pop() ?? 'Loaded Model'
    const url = window.api.assetUrl(path)
    await viewportHandle.loadFromUrl(url, extension, size)
    setTextureSize(size)
    setModelName(filename)
    showToast(`Loaded model ${filename} (${size}×${size})`, 'success')
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

  async function handleImportTextures(): Promise<void> {
    setShowFileMenu(false)
    await pickTextureFolder()
  }

  function handleClearActiveLayer(): void {
    setShowEditMenu(false)
    const stack = viewportHandle?.getLayerStack()
    const active = stack?.active
    if (active) {
      active.engine.clear()
      stack?.recomposite()
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

  function onKeyDown(e: KeyboardEvent): void {
    if (showHelp() || showSettings() || showNewProjectModal() || brushPresets.isManagerOpen()) return
    // Don't trigger tool switching if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    const isCtrl = e.ctrlKey || e.metaKey

    if (isCtrl) {
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
        if (activeTool() === 'fill') {
          setTextureScale(Math.max(0.1, parseFloat((brush.textureScale() - 0.25).toFixed(2))))
        } else {
          stepRadius(-1)
        }
        break
      case ']':
        if (activeTool() === 'fill') {
          setTextureScale(Math.min(10, parseFloat((brush.textureScale() + 0.25).toFixed(2))))
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
    initBrushPresets()
    window.addEventListener('keydown', onKeyDown)
    // Defer loading the texture folder so 3D viewport mounts and renders first
    setTimeout(() => {
      ensureLastTextureFolderLoaded()
    }, 800)

    if (typeof window !== 'undefined') {
      ;(window as any).__app = {
        setActiveTool,
        setRightPanelTab,
        setShowEdgeWearWizard,
        toggleWireframe,
        setTextures,
        showToast
      }
    }
  })
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  return (
    <div id="app">
      {/* Top Application Header */}
      <header class="top-bar">
        <div class="top-bar-left">
          {/* App Branding */}
          <div class="brand-badge-box">
            <AppIcon size={24} class="brand-app-icon" />
            <span class="brand-title">MeshCoat</span>
          </div>

          {/* Menus */}
          <div class="top-bar-menus">
            {/* File Menu */}
            <div class="menu-wrap">
              <button
                class="menu-btn"
                classList={{ active: showFileMenu() }}
                onClick={() => {
                  setShowFileMenu((v) => !v)
                  setShowEditMenu(false)
                }}
              >
                File
              </button>
              <Show when={showFileMenu()}>
                <div class="menu-backdrop" onClick={() => setShowFileMenu(false)} />
                <div class="menu-dropdown">
                  <button
                    class="menu-item"
                    onClick={() => {
                      setShowFileMenu(false)
                      setShowNewProjectModal(true)
                    }}
                  >
                    <CubeIcon size={14} />
                    <span>New Project...</span>
                    <span class="menu-item-shortcut">Ctrl+N</span>
                  </button>
                  <div class="menu-divider" />
                  <button class="menu-item" onClick={handleImportTextures}>
                    <FolderOpenIcon size={14} />
                    <span>Load Texture Folder...</span>
                  </button>
                  <div class="menu-divider" />
                  <button class="menu-item" onClick={exportTexturePng}>
                    <DownloadIcon size={14} />
                    <span>Export Texture (PNG)...</span>
                  </button>
                  <Show when={textures().length > 0}>
                    <div class="menu-divider" />
                    <button class="menu-item" onClick={() => { setShowFileMenu(false); clearTextureFolder(); }}>
                      <RefreshCwIcon size={14} />
                      <span>Clear Texture Drawer</span>
                    </button>
                  </Show>
                </div>
              </Show>
            </div>

            {/* Edit Menu */}
            <div class="menu-wrap">
              <button
                class="menu-btn"
                classList={{ active: showEditMenu() }}
                onClick={() => {
                  setShowEditMenu((v) => !v)
                  setShowFileMenu(false)
                }}
              >
                Edit
              </button>
              <Show when={showEditMenu()}>
                <div class="menu-backdrop" onClick={() => setShowEditMenu(false)} />
                <div class="menu-dropdown">
                  <button class="menu-item" onClick={handleClearActiveLayer}>
                    <span>Clear Active Layer</span>
                  </button>
                  <button class="menu-item" onClick={handleFillActiveLayer}>
                    <span>
                      {brush.texturePath()
                        ? (brush.selectedFaces().size > 0 ? 'Fill Selection with Texture' : 'Fill Active Layer with Texture')
                        : (brush.selectedFaces().size > 0 ? 'Fill Selection with Color' : 'Fill Active Layer with Color')}
                    </span>
                    <span class="menu-item-shortcut">G</span>
                  </button>
                  <div class="menu-divider" />
                  <button
                    class="menu-item"
                    onClick={() => {
                      setShowEditMenu(false)
                      setShowEdgeWearWizard(true)
                    }}
                  >
                    <SparklesIcon size={14} class="text-amber-400" />
                    <span>Generate Edge Wear & Highlights...</span>
                  </button>
                  <div class="menu-divider" />
                  <button class="menu-item" onClick={() => { setShowEditMenu(false); frameCamera(); }}>
                    <FocusIcon size={14} />
                    <span>Frame Model in Viewport</span>
                    <span class="menu-item-shortcut">F</span>
                  </button>
                  <button class="menu-item" onClick={() => { setShowEditMenu(false); clearFaceSelection(); }}>
                    <span>Deselect Faces</span>
                    <span class="menu-item-shortcut">Esc</span>
                  </button>
                </div>
              </Show>
            </div>
          </div>
        </div>

        {/* Center Document HUD (Model & Resolution) */}
        <div class="top-bar-center">
          <div class="document-hud-pill">
            <span class="model-name-chip" title={modelName()}>
              <CubeIcon size={13} class="text-blue-400" />
              <span>{modelName()}</span>
            </span>
            <span class="hud-divider" />
            <span class="hud-meta-chip tabular">
              {textureSize()} × {textureSize()}
            </span>
          </div>
        </div>

        {/* Top Right Quick Controls */}
        <div class="top-bar-actions">
          {/* Segmented Lighting Selector */}
          <div class="segmented-lighting-control" title="Lighting preset">
            {LIGHTING_MODES.map(({ mode, label, Icon }) => (
              <button
                class="segmented-lighting-btn"
                classList={{ active: lightingMode() === mode }}
                title={label}
                onClick={() => selectLightingMode(mode)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>

          <div class="top-bar-vdivider" />

          {/* Wireframe Button */}
          <button
            class="action-icon-btn"
            classList={{ active: wireframeVisible() }}
            title="Toggle wireframe overlay (W)"
            onClick={toggleWireframe}
          >
            <WireframeIcon size={24} />
          </button>

          {/* Symmetry Mirror (Off, X, Y, Z) */}
          <div class="symmetry-segmented-group" title="Symmetry Mirror (Alt+X to cycle / toggle)">
            <button
              class="action-icon-btn symmetry-btn"
              classList={{ active: brush.symmetryEnabled() }}
              title={`Symmetry: ${brush.symmetryAxis() === 'off' ? 'OFF' : brush.symmetryAxis().toUpperCase() + ' Axis'} (Alt+X to cycle)`}
              onClick={() => {
                const axes: ('off' | 'x' | 'y' | 'z')[] = ['off', 'x', 'y', 'z']
                const next = axes[(axes.indexOf(brush.symmetryAxis()) + 1) % axes.length]
                brush.setSymmetryAxis(next)
                showToast(next !== 'off' ? `Symmetry: ${next.toUpperCase()} Axis` : 'Symmetry: OFF', 'info')
              }}
            >
              <SymmetryIcon size={22} />
              <span class="sym-badge">
                {brush.symmetryAxis() === 'off' ? 'Off' : brush.symmetryAxis().toUpperCase()}
              </span>
            </button>
            <div class="sym-axis-quick-row">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <button
                  type="button"
                  class="sym-axis-mini-btn"
                  classList={{ active: brush.symmetryAxis() === axis }}
                  title={`Set Symmetry to ${axis.toUpperCase()} Axis`}
                  onClick={() => {
                    const next = brush.symmetryAxis() === axis ? 'off' : axis
                    brush.setSymmetryAxis(next)
                    showToast(next !== 'off' ? `Symmetry: ${next.toUpperCase()} Axis` : 'Symmetry: OFF', 'info')
                  }}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Focus / Frame Model Button */}
          <button
            class="action-icon-btn"
            title="Frame model in center (F)"
            onClick={frameCamera}
          >
            <FocusIcon size={24} />
          </button>

          <div class="top-bar-vdivider" />

          {/* Settings & Help */}
          <button
            class="action-icon-btn"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon size={24} />
          </button>

          <button
            class="action-icon-btn"
            title="Quick guide & hotkeys (?)"
            onClick={() => setShowHelp(true)}
          >
            <HelpCircleIcon size={24} />
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div class="main-layout">
        {/* Left Toolbar */}
        <nav class="left-toolbar" aria-label="Painting tools">
          {/* Group 1: Paint & Drawing Tools */}
          <div class="tool-group">
            <button
              class="toolbar-tool-btn"
              classList={{ active: activeTool() === 'brush' }}
              title="Paint Brush (B)"
              onClick={() => setActiveTool('brush')}
            >
              <BrushIcon size={24} />
              <span class="tool-shortcut-chip">B</span>
            </button>

            <button
              class="toolbar-tool-btn"
              classList={{ active: activeTool() === 'line' }}
              title="Line Tool (L) - drag straight strokes on 3D surface"
              onClick={() => setActiveTool('line')}
            >
              <LineIcon size={24} />
              <span class="tool-shortcut-chip">L</span>
            </button>

            <button
              class="toolbar-tool-btn"
              classList={{ active: activeTool() === 'stamp' }}
              title="Texture Stamp (T)"
              onClick={() => setActiveTool('stamp')}
            >
              <StampIcon size={24} />
              <span class="tool-shortcut-chip">T</span>
            </button>

            <button
              class="toolbar-tool-btn"
              classList={{ active: activeTool() === 'eraser' }}
              title="Eraser (E)"
              onClick={() => setActiveTool('eraser')}
            >
              <EraserIcon size={24} />
              <span class="tool-shortcut-chip">E</span>
            </button>

            <button
              class="toolbar-tool-btn"
              classList={{ active: activeTool() === 'fill' }}
              title="Fill Bucket (G)"
              onClick={() => setActiveTool('fill')}
            >
              <FillIcon size={24} />
              <span class="tool-shortcut-chip">G</span>
            </button>
          </div>

          <div class="toolbar-divider" />

          {/* Group 2: Sampling & Selection */}
          <div class="tool-group">
            <button
              class="toolbar-tool-btn"
              classList={{ active: activeTool() === 'eyedropper' }}
              title="Color Eyedropper (I)"
              onClick={() => setActiveTool('eyedropper')}
            >
              <EyedropperIcon size={24} />
              <span class="tool-shortcut-chip">I</span>
            </button>

            <button
              class="toolbar-tool-btn"
              classList={{ active: activeTool() === 'faceSelect' }}
              title="Face Select (V) - click/shift-click faces to confine strokes"
              onClick={() => setActiveTool('faceSelect')}
            >
              <MousePointerIcon size={24} />
              <span class="tool-shortcut-chip">V</span>
            </button>
          </div>

          <div class="toolbar-divider" />

          {/* Group 3: Viewport & Shelf Actions */}
          <div class="tool-group">
            <button
              class="toolbar-tool-btn"
              title="Frame Model / Center (F)"
              onClick={frameCamera}
            >
              <FocusIcon size={24} />
              <span class="tool-shortcut-chip">F</span>
            </button>

            <button
              class="toolbar-tool-btn"
              classList={{ active: showEdgeWearWizard() }}
              title="Edge Wear & Chipping Wizard"
              onClick={() => {
                if (showEdgeWearWizard()) {
                  viewportHandle?.cancelEdgeWearPreview()
                  setShowEdgeWearWizard(false)
                } else {
                  setShowEdgeWearWizard(true)
                }
              }}
            >
              <SparklesIcon size={24} class="text-amber-400" />
            </button>
          </div>

          {/* Toolbar Bottom Section: Active Color Swatch */}
          <div class="toolbar-bottom-section">
            <button
              class="toolbar-color-swatch-btn"
              style={{ background: brush.color() }}
              title={`Current Color: ${brush.color().toUpperCase()} (Click to pick)`}
              onClick={() => colorPickerRef?.click()}
            />
            <input
              ref={colorPickerRef}
              type="color"
              class="sr-only-picker"
              value={brush.color()}
              onInput={(e) => brush.setColor(e.currentTarget.value)}
            />
          </div>
        </nav>

        {/* Vertical Texture Drawer (Next to Left Toolbar - Always Open) */}
        <TextureShelf
          textures={textures()}
          onPickFolder={pickTextureFolder}
          onClearFolder={clearTextureFolder}
        />

        {/* 3D Viewport Area */}
        <main class="viewport">
          <Viewport
            tool={activeTool}
            textures={textures()}
            onToolChange={(t) => setActiveTool(t)}
            onReady={(h) => (viewportHandle = h)}
            onMissingUv={onMissingUv}
            onLayersChanged={bumpLayers}
            onWireframeChanged={setWireframeVisibleSignal}
          />

          {/* Floating Toast Notification */}
          <Show when={toast()}>
            {(t) => (
              <div class={`floating-toast ${t().type}`} onClick={() => setToast(null)}>
                <span class="toast-dot" />
                <span class="toast-message">{t().text}</span>
                <button class="toast-close" title="Dismiss">
                  <XIcon size={13} />
                </button>
              </div>
            )}
          </Show>
        </main>

        {/* Right Sidebar Inspector (Brush & Layers or Edge Wear Wizard) */}
        <aside class="right-panel" classList={{ 'edge-wear-active': showEdgeWearWizard() }}>
          <Show
            when={!showEdgeWearWizard()}
            fallback={
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
            }
          >
            {/* Panel Navigation Tabs */}
            <div class="right-panel-tab-bar">
              <button
                class="panel-view-tab"
                classList={{ active: rightPanelTab() === 'brush' }}
                onClick={() => setRightPanelTab('brush')}
              >
                <SlidersIcon size={20} />
                <span>Brush</span>
              </button>

              <button
                class="panel-view-tab"
                classList={{ active: rightPanelTab() === 'layers' }}
                onClick={() => setRightPanelTab('layers')}
              >
                <LayersIcon size={20} />
                <span>Layers</span>
                <span class="tab-count-pill tabular">
                  {currentLayerCount()}
                </span>
              </button>

              <button
                class="panel-view-tab"
                classList={{ active: rightPanelTab() === 'split' }}
                onClick={() => setRightPanelTab('split')}
                title="View both Brush and Layers"
              >
                <span>Split</span>
              </button>
            </div>

            {/* Panel Content Body */}
            <div class="right-panel-scroll-body">
              {/* Split View */}
              <Show when={rightPanelTab() === 'split'}>
                <section class="panel-collapsible-section">
                  <div class="panel-section-header">
                    <div class="section-title-wrap">
                      <SlidersIcon size={20} />
                      <span>Brush Settings</span>
                    </div>
                  </div>
                  <BrushSettingsTab
                    activeTool={activeTool()}
                    isMaskTarget={() => {
                      void layersVersion()
                      const a = viewportHandle?.getLayerStack()?.active
                      return !!a?.isMask
                    }}
                  />
                </section>

                <section class="panel-collapsible-section layers-section">
                  <div class="panel-section-header">
                    <div class="section-title-wrap">
                      <LayersIcon size={20} />
                      <span>Layers</span>
                    </div>
                  </div>
                  <LayersTab
                    getStack={() => viewportHandle?.getLayerStack()}
                    version={layersVersion()}
                    onChange={bumpLayers}
                  />
                </section>
              </Show>

              {/* Brush Only View */}
              <Show when={rightPanelTab() === 'brush'}>
                <BrushSettingsTab
                  activeTool={activeTool()}
                  isMaskTarget={() => {
                    void layersVersion()
                    const a = viewportHandle?.getLayerStack()?.active
                    return !!a?.isMask
                  }}
                />
              </Show>

              {/* Layers Only View */}
              <Show when={rightPanelTab() === 'layers'}>
                <LayersTab
                  getStack={() => viewportHandle?.getLayerStack()}
                  version={layersVersion()}
                  onChange={bumpLayers}
                />
              </Show>
            </div>
          </Show>
        </aside>
      </div>

      {/* Skinny Bottom Status & Hotkeys Bar (VS Code style) */}
      <StatusBar
        tool={activeTool()}
        lightingMode={lightingMode()}
        wireframeVisible={wireframeVisible()}
        textureSize={textureSize()}
        modelName={modelName()}
        activeLayerName={currentActiveLayerName()}
        layerCount={currentLayerCount()}
        selectedFaceCount={brush.selectedFaces().size}
        onToggleWireframe={toggleWireframe}
        onCycleLighting={() => {
          const modes: LightingMode[] = ['studio', 'flat', 'outdoor']
          const nextIndex = (modes.indexOf(lightingMode()) + 1) % modes.length
          selectLightingMode(modes[nextIndex])
        }}
        onOpenHelp={() => setShowHelp(true)}
        onClearFaceSelection={clearFaceSelection}
        onFrameCamera={frameCamera}
      />

      {/* Modals */}
      <NewProjectModal
        isOpen={showNewProjectModal()}
        onClose={() => setShowNewProjectModal(false)}
        onImport={importModelFromWizard}
      />
      <HelpModal isOpen={showHelp()} onClose={() => setShowHelp(false)} />
      <SettingsModal isOpen={showSettings()} onClose={() => setShowSettings(false)} />
      <BrushManagerModal
        isOpen={brushPresets.isManagerOpen()}
        onClose={() => brushPresets.closeManager()}
      />
    </div>
  )
}
