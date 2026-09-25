import type { LightingMode } from '../viewport/scene'
import type { ChannelViewMode } from '../viewport/Viewport'
import type { ToolMode } from '../paint/brush'

export interface LayoutProfile {
  // Sidebar (Brush settings & Layers)
  sidebarWidth: number
  sidebarCollapsed: boolean
  layersHeight: number
  lowerTab: 'layers' | 'selections'

  // Bottom Texture Drawer
  textureDrawerHeight: number
  textureDrawerCollapsed: boolean

  // Tool Panel Dock (beside sidebar)
  toolPanelWidth: number
  toolPanelCollapsed: boolean
  toolPanelsSectionCollapsed: Record<string, boolean>

  // 2D UV Paint Panel
  showUvPanel: boolean
  uvPanelWidth: number
  uvPanelHeight: number
  uvPanelX: number | null
  uvPanelY: number | null

  // Viewport & Workspace settings
  lightingMode: LightingMode
  viewMode: ChannelViewMode
  wireframeVisible: boolean
  activeTool: ToolMode

  // Color & Palette tab
  paletteMode: 'swatches' | 'presets'
  activePresetId: string
}

export const PROFILE_STORAGE_KEY = 'meshcoat:layout_profile'
export const LEGACY_SIDEBAR_KEY = 'meshcoat:sidebar_size'

export const DEFAULT_PROFILE: LayoutProfile = {
  sidebarWidth: 320,
  sidebarCollapsed: false,
  layersHeight: 340,
  lowerTab: 'layers',

  textureDrawerHeight: 220,
  textureDrawerCollapsed: false,

  toolPanelWidth: 300,
  toolPanelCollapsed: false,
  toolPanelsSectionCollapsed: {},

  showUvPanel: false,
  uvPanelWidth: 560,
  uvPanelHeight: 640,
  uvPanelX: null,
  uvPanelY: null,

  lightingMode: 'neutral',
  viewMode: 'material',
  wireframeVisible: false,
  activeTool: 'brush',

  paletteMode: 'swatches',
  activePresetId: 'essentials'
}

const VALID_LIGHTING_MODES: Set<string> = new Set(['neutral', 'flat', 'outdoor', 'warm', 'cool'])
const VALID_VIEW_MODES: Set<string> = new Set(['material', 'roughness', 'metalness', 'normal'])
const VALID_TOOLS: Set<string> = new Set([
  'brush',
  'line',
  'stamp',
  'eraser',
  'fill',
  'gradient',
  'effect',
  'material',
  'eyedropper',
  'face',
  'region',
  'pan',
  'text'
])

let cachedProfile: LayoutProfile | null = null

export function sanitizeProfile(parsed: Record<string, unknown> | Partial<LayoutProfile>): LayoutProfile {
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1920
  const winH = typeof window !== 'undefined' ? window.innerHeight : 1080

  const sidebarW = Number(parsed.sidebarWidth)
  const sidebarWidth =
    sidebarW > 0
      ? Math.round(Math.min(Math.max(280, sidebarW), Math.max(280, winW * 0.6)))
      : DEFAULT_PROFILE.sidebarWidth

  const layersH = Number(parsed.layersHeight)
  const layersHeight =
    layersH > 0
      ? Math.round(Math.min(Math.max(160, layersH), Math.max(160, winH - 150)))
      : DEFAULT_PROFILE.layersHeight

  const drawerH = Number(parsed.textureDrawerHeight)
  const textureDrawerHeight =
    drawerH > 0
      ? Math.round(Math.min(Math.max(140, drawerH), Math.max(140, winH * 0.7)))
      : DEFAULT_PROFILE.textureDrawerHeight

  const toolW = Number(parsed.toolPanelWidth)
  const toolPanelWidth =
    toolW > 0
      ? Math.round(Math.min(Math.max(240, toolW), Math.max(240, winW * 0.5)))
      : DEFAULT_PROFILE.toolPanelWidth

  const uvW = Number(parsed.uvPanelWidth)
  const uvPanelWidth =
    uvW > 0
      ? Math.round(Math.min(Math.max(320, uvW), Math.max(320, winW - 40)))
      : DEFAULT_PROFILE.uvPanelWidth

  const uvH = Number(parsed.uvPanelHeight)
  const uvPanelHeight =
    uvH > 0
      ? Math.round(Math.min(Math.max(300, uvH), Math.max(300, winH - 60)))
      : DEFAULT_PROFILE.uvPanelHeight

  let uvPanelX: number | null = null
  if (typeof parsed.uvPanelX === 'number' && !Number.isNaN(parsed.uvPanelX)) {
    uvPanelX = Math.round(Math.max(0, Math.min(parsed.uvPanelX, winW - 100)))
  }

  let uvPanelY: number | null = null
  if (typeof parsed.uvPanelY === 'number' && !Number.isNaN(parsed.uvPanelY)) {
    uvPanelY = Math.round(Math.max(0, Math.min(parsed.uvPanelY, winH - 60)))
  }

  // Validate modes
  let lighting = String(parsed.lightingMode || DEFAULT_PROFILE.lightingMode)
  if (lighting === 'studio') lighting = 'neutral'
  if (lighting === 'showcase') lighting = 'warm'
  const lightingMode: LightingMode = VALID_LIGHTING_MODES.has(lighting)
    ? (lighting as LightingMode)
    : DEFAULT_PROFILE.lightingMode

  const viewMode: ChannelViewMode =
    typeof parsed.viewMode === 'string' && VALID_VIEW_MODES.has(parsed.viewMode)
      ? (parsed.viewMode as ChannelViewMode)
      : DEFAULT_PROFILE.viewMode

  const activeTool: ToolMode =
    typeof parsed.activeTool === 'string' && VALID_TOOLS.has(parsed.activeTool)
      ? (parsed.activeTool as ToolMode)
      : DEFAULT_PROFILE.activeTool

  const lowerTab =
    parsed.lowerTab === 'selections' ? 'selections' : DEFAULT_PROFILE.lowerTab

  const paletteMode =
    parsed.paletteMode === 'presets' ? 'presets' : DEFAULT_PROFILE.paletteMode

  const activePresetId =
    typeof parsed.activePresetId === 'string' && parsed.activePresetId.trim().length > 0
      ? parsed.activePresetId
      : DEFAULT_PROFILE.activePresetId

  const toolPanelsSectionCollapsed: Record<string, boolean> =
    parsed.toolPanelsSectionCollapsed && typeof parsed.toolPanelsSectionCollapsed === 'object'
      ? (parsed.toolPanelsSectionCollapsed as Record<string, boolean>)
      : {}

  return {
    sidebarWidth,
    sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
    layersHeight,
    lowerTab,
    textureDrawerHeight,
    textureDrawerCollapsed: Boolean(parsed.textureDrawerCollapsed),
    toolPanelWidth,
    toolPanelCollapsed: Boolean(parsed.toolPanelCollapsed),
    toolPanelsSectionCollapsed,
    showUvPanel: Boolean(parsed.showUvPanel),
    uvPanelWidth,
    uvPanelHeight,
    uvPanelX,
    uvPanelY,
    lightingMode,
    viewMode,
    wireframeVisible: Boolean(parsed.wireframeVisible),
    activeTool,
    paletteMode,
    activePresetId
  }
}

/**
 * Loads the user's layout profile, sanitizing values within valid screen bounds.
 */
export function loadLayoutProfile(): LayoutProfile {
  if (cachedProfile) {
    return { ...cachedProfile }
  }

  let parsed: Record<string, unknown> = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PROFILE_STORAGE_KEY) : null
    if (raw) {
      parsed = JSON.parse(raw)
    } else if (typeof localStorage !== 'undefined') {
      // Check legacy sidebar size key
      const legacyRaw = localStorage.getItem(LEGACY_SIDEBAR_KEY)
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw)
        if (legacy.width) parsed.sidebarWidth = Number(legacy.width)
        if (legacy.layers) parsed.layersHeight = Number(legacy.layers)
      }
    }
  } catch {
    parsed = {}
  }

  cachedProfile = sanitizeProfile(parsed)
  return { ...cachedProfile }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Saves changes into the layout profile and persists to localStorage.
 */
export function saveLayoutProfile(patch: Partial<LayoutProfile>): void {
  const current = loadLayoutProfile()
  cachedProfile = sanitizeProfile({ ...current, ...patch })

  // Sync to legacy key for compatibility
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        LEGACY_SIDEBAR_KEY,
        JSON.stringify({
          width: cachedProfile.sidebarWidth,
          layers: cachedProfile.layersHeight
        })
      )
    }
  } catch {
    // Ignore storage quota errors
  }

  // Debounce the full profile storage slightly to batch rapid drag events
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    try {
      if (cachedProfile && typeof localStorage !== 'undefined') {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(cachedProfile))
      }
    } catch {
      // Ignore quota errors
    }
  }, 50)
}

/**
 * Immediately flushes any pending profile write to localStorage.
 */
export function flushLayoutProfile(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (cachedProfile && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(cachedProfile))
    } catch {
      // Ignore quota errors
    }
  }
}
