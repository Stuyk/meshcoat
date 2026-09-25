import { createSignal, Show, For, type JSX } from 'solid-js'
import {
  AppIcon,
  RefreshCwIcon,
  WireframeIcon,
  UvPanelIcon,
  EyeOffIcon,
  SymmetryIcon,
  FocusIcon,
  SettingsIcon,
  HelpCircleIcon,
  ChevronDownIcon,
  CheckIcon
} from './icons'
import { DropdownMenu, IconButton, SegmentedControl, type MenuItem } from './ui'
import type { LightingMode } from '../viewport/scene'
import type { ChannelViewMode } from '../viewport/Viewport'
import { brush } from '../paint/brush'

export interface WorkstationHeaderProps {
  modelName: string
  isDirty: boolean
  isRestoringSession: boolean
  fileMenuItems: MenuItem[]
  editMenuItems: MenuItem[]
  selectionMenuItems: MenuItem[]
  panelMenuItems: MenuItem[]
  lightingMode: LightingMode
  onSelectLightingMode: (m: LightingMode) => void
  viewMode: ChannelViewMode
  onSelectViewMode: (m: ChannelViewMode) => void
  showPanelDock?: boolean
  onTogglePanelDock?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  wireframeVisible: boolean
  onToggleWireframe: () => void
  showUvPanel: boolean
  onToggleUvPanel: () => void
  isolatePiece: boolean
  onToggleIsolatePiece: () => void
  multiPiece: boolean
  onToggleSymmetry: () => void
  onFrameCamera: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

export interface LightingOption {
  value: LightingMode
  label: string
  subtitle: string
  color: string
  swatch: string
}

export const LIGHTING_OPTIONS: LightingOption[] = [
  {
    value: 'neutral',
    label: 'Neutral',
    subtitle: 'Balanced 5600K 3-point studio',
    color: '#94a3b8',
    swatch: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)'
  },
  {
    value: 'flat',
    label: 'Flat',
    subtitle: 'Albedo with delicate soft shadows',
    color: '#cbd5e1',
    swatch: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)'
  },
  {
    value: 'outdoor',
    label: 'Outdoor',
    subtitle: 'Sunlight & sky ambient fill',
    color: '#f59e0b',
    swatch: 'linear-gradient(135deg, #fbbf24 0%, #38bdf8 100%)'
  },
  {
    value: 'warm',
    label: 'Warm Light',
    subtitle: 'Cozy 3200K tungsten & amber glow',
    color: '#f97316',
    swatch: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)'
  },
  {
    value: 'cool',
    label: 'Cool Light',
    subtitle: 'Crisp 7500K blue hour & cyan rim',
    color: '#06b6d4',
    swatch: 'linear-gradient(135deg, #38bdf8 0%, #3b82f6 100%)'
  }
]

const VIEW_OPTIONS: { value: ChannelViewMode; label: string; title: string }[] = [
  { value: 'material', label: 'PBR', title: 'PBR Full Material: Complete composite with lighting and all channels' },
  { value: 'roughness', label: 'Rough', title: 'Inspect Roughness Channel: Grayscale preview of surface roughness' },
  { value: 'metalness', label: 'Metal', title: 'Inspect Metalness Channel: Grayscale preview of metallic mask' },
  { value: 'normal', label: 'Norm', title: 'Inspect Normal Map: Tangent space RGB normal vector map' }
]

export default function WorkstationHeader(props: WorkstationHeaderProps): JSX.Element {
  const [showFileMenu, setShowFileMenu] = createSignal(false)
  const [showEditMenu, setShowEditMenu] = createSignal(false)
  const [showSelectionMenu, setShowSelectionMenu] = createSignal(false)
  const [showPanelMenu, setShowPanelMenu] = createSignal(false)
  const [showLightingMenu, setShowLightingMenu] = createSignal(false)

  const currentLighting = () =>
    LIGHTING_OPTIONS.find((o) => o.value === props.lightingMode) ?? LIGHTING_OPTIONS[0]

  return (
    <header class="h-10 min-h-10 px-3 bg-[var(--bg-panel-header)] border-b border-[var(--border-color)] flex items-center justify-between select-none z-40 shrink-0 text-xs text-[var(--text-main)]">
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex items-center gap-2 pr-3 border-r border-[var(--border-color)] shrink-0">
          <AppIcon size={18} class="shrink-0" />
          <span class="font-bold text-xs tracking-tight text-[var(--text-main)] hidden sm:inline">
            MeshCoat
          </span>
          <span class="text-[var(--text-muted)] text-xs font-normal">/</span>
          <span
            class="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] max-w-[200px] truncate transition-colors"
            title={props.modelName}
          >
            {props.modelName}
            {props.isDirty ? ' *' : ''}
          </span>
          <Show when={props.isRestoringSession}>
            <RefreshCwIcon size={11} class="animate-spin text-[var(--accent-color)] ml-1" />
          </Show>
        </div>

        <nav class="flex items-center gap-1 shrink-0">
          <div class="relative">
            <button
              type="button"
              title="File operations (Open, Save, Export, New)"
              class={`px-2.5 py-1 rounded-[var(--ui-radius)] text-xs font-medium transition-colors cursor-pointer ${
                showFileMenu()
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              onClick={() => {
                setShowFileMenu((v) => !v)
                setShowEditMenu(false)
                setShowSelectionMenu(false)
                setShowPanelMenu(false)
                setShowLightingMenu(false)
              }}
            >
              File
            </button>
            <DropdownMenu
              isOpen={showFileMenu()}
              onClose={() => setShowFileMenu(false)}
              items={props.fileMenuItems}
            />
          </div>

          <div class="relative">
            <button
              type="button"
              title="Edit operations (Undo, Redo, Fill, Clear)"
              class={`px-2.5 py-1 rounded-[var(--ui-radius)] text-xs font-medium transition-colors cursor-pointer ${
                showEditMenu()
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              onClick={() => {
                setShowEditMenu((v) => !v)
                setShowFileMenu(false)
                setShowSelectionMenu(false)
                setShowPanelMenu(false)
                setShowLightingMenu(false)
              }}
            >
              Edit
            </button>
            <DropdownMenu
              isOpen={showEditMenu()}
              onClose={() => setShowEditMenu(false)}
              items={props.editMenuItems}
            />
          </div>

          <div class="relative">
            <button
              type="button"
              title="Face selection operations & saved groups"
              class={`px-2.5 py-1 rounded-[var(--ui-radius)] text-xs font-medium transition-colors cursor-pointer ${
                showSelectionMenu()
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              onClick={() => {
                setShowSelectionMenu((v) => !v)
                setShowFileMenu(false)
                setShowEditMenu(false)
                setShowPanelMenu(false)
                setShowLightingMenu(false)
              }}
            >
              Selection
            </button>
            <DropdownMenu
              isOpen={showSelectionMenu()}
              onClose={() => setShowSelectionMenu(false)}
              items={props.selectionMenuItems}
            />
          </div>

          <div class="relative">
            <button
              type="button"
              title="Panels & workspace window visibility"
              class={`px-2.5 py-1 rounded-[var(--ui-radius)] text-xs font-medium transition-colors cursor-pointer ${
                showPanelMenu()
                  ? 'bg-[var(--accent-color)] text-[var(--accent-text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
              }`}
              onClick={() => {
                setShowPanelMenu((v) => !v)
                setShowFileMenu(false)
                setShowEditMenu(false)
                setShowSelectionMenu(false)
                setShowLightingMenu(false)
              }}
            >
              Panels
            </button>
            <DropdownMenu
              isOpen={showPanelMenu()}
              onClose={() => setShowPanelMenu(false)}
              items={props.panelMenuItems}
            />
          </div>
        </nav>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        {/* Lighting Mode Dropdown */}
        <div class="relative">
          <button
            type="button"
            class={`flex items-center gap-2 h-7 px-2.5 rounded-[var(--ui-radius)] border text-xs transition-colors cursor-pointer select-none ${
              showLightingMenu()
                ? 'bg-[var(--bg-input-hover)] border-blue-500/50 text-[var(--text-main)] shadow-sm'
                : 'bg-[var(--bg-input)] hover:bg-[var(--bg-input-hover)] border-[var(--border-color)] text-[var(--text-main)]'
            }`}
            onClick={() => {
              setShowLightingMenu((v) => !v)
              setShowFileMenu(false)
              setShowEditMenu(false)
              setShowSelectionMenu(false)
              setShowPanelMenu(false)
            }}
            title={`Lighting: ${currentLighting().label} — ${currentLighting().subtitle}`}
          >
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs border border-white/20"
              style={{ background: currentLighting().swatch }}
            />
            <span class="font-medium">{currentLighting().label}</span>
            <ChevronDownIcon size={12} class="text-[var(--text-muted)] ml-0.5" />
          </button>

          <Show when={showLightingMenu()}>
            {/* Invisible backdrop to capture clicks outside */}
            <div class="fixed inset-0 z-40" onClick={() => setShowLightingMenu(false)} />

            <div class="absolute left-0 top-full mt-1.5 z-50 min-w-[240px] p-1.5 bg-zinc-900/98 backdrop-blur-md border border-zinc-750/90 rounded-xl shadow-2xl shadow-black/80 flex flex-col gap-0.5 select-none">
              <div class="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Lighting Preset
              </div>
              <For each={LIGHTING_OPTIONS}>
                {(item) => {
                  const isSelected = () => props.lightingMode === item.value
                  return (
                    <button
                      type="button"
                      class={`flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer group ${
                        isSelected()
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-200 hover:bg-zinc-800/80 hover:text-white'
                      }`}
                      onClick={() => {
                        props.onSelectLightingMode(item.value)
                        setShowLightingMenu(false)
                      }}
                    >
                      <span
                        class="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border border-white/25 group-hover:scale-105 transition-transform"
                        style={{ background: item.swatch }}
                      />
                      <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-xs font-semibold leading-tight">{item.label}</span>
                        <span
                          class={`text-[10px] leading-tight truncate ${
                            isSelected() ? 'text-blue-100' : 'text-zinc-400 group-hover:text-zinc-300'
                          }`}
                        >
                          {item.subtitle}
                        </span>
                      </div>
                      <Show when={isSelected()}>
                        <CheckIcon size={14} class="shrink-0 ml-1 text-white" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>


        <div class="w-px h-4 bg-[var(--border-color)]" />

        <SegmentedControl
          size="xs"
          options={VIEW_OPTIONS}
          value={props.viewMode}
          onChange={props.onSelectViewMode}
        />

        <div class="w-px h-4 bg-[var(--border-color)]" />

        <IconButton
          size="xs"
          active={props.wireframeVisible}
          onClick={props.onToggleWireframe}
          tooltip="Toggle Wireframe (W)"
        >
          <WireframeIcon size={15} />
        </IconButton>

        <IconButton
          size="xs"
          active={props.showUvPanel}
          onClick={props.onToggleUvPanel}
          tooltip="2D Paint panel: paint directly on the UV layout"
        >
          <UvPanelIcon size={15} />
        </IconButton>

        <Show when={props.multiPiece}>
          <IconButton
            size="xs"
            active={props.isolatePiece}
            onClick={props.onToggleIsolatePiece}
            tooltip={props.isolatePiece ? 'Show all pieces' : 'Isolate active piece'}
          >
            <EyeOffIcon size={15} />
          </IconButton>
        </Show>

        <button
          type="button"
          onClick={props.onToggleSymmetry}
          class={`flex items-center gap-1 px-2 py-0.5 rounded-[var(--ui-radius)] border text-[11px] font-mono transition-colors cursor-pointer ${
            brush.symmetryEnabled()
              ? 'bg-[var(--accent-color)] text-[var(--accent-text)] border-[var(--accent-color)] font-bold shadow-xs'
              : 'bg-[var(--bg-input)] text-[var(--text-muted)] border-[var(--border-color)] hover:text-[var(--text-main)] hover:border-white/20'
          }`}
          title={`Symmetry: ${brush.symmetryAxis() === 'off' ? 'OFF' : brush.symmetryAxis().toUpperCase() + ' Axis'} (Alt+X)`}
        >
          <SymmetryIcon size={13} />
          <span>{brush.symmetryAxis() === 'off' ? 'Off' : brush.symmetryAxis().toUpperCase()}</span>
        </button>

        <IconButton
          size="xs"
          variant="ghost"
          onClick={props.onFrameCamera}
          tooltip="Frame Model (F)"
        >
          <FocusIcon size={15} />
        </IconButton>

        <div class="w-px h-4 bg-[var(--border-color)]" />

        <IconButton
          size="xs"
          variant="ghost"
          onClick={props.onOpenSettings}
          tooltip="Settings"
        >
          <SettingsIcon size={15} />
        </IconButton>

        <IconButton
          size="xs"
          variant="ghost"
          onClick={props.onOpenHelp}
          tooltip="Quick Guide & Hotkeys (?)"
        >
          <HelpCircleIcon size={15} />
        </IconButton>
      </div>
    </header>
  )
}
export { WorkstationHeader }
