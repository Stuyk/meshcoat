import { createSignal, Show, type JSX } from 'solid-js'
import {
  AppIcon,
  RefreshCwIcon,
  PanelRightIcon,
  WireframeIcon,
  EyeOffIcon,
  SymmetryIcon,
  FocusIcon,
  SettingsIcon,
  HelpCircleIcon
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
  panelMenuItems: MenuItem[]
  lightingMode: LightingMode
  onSelectLightingMode: (m: LightingMode) => void
  viewMode: ChannelViewMode
  onSelectViewMode: (m: ChannelViewMode) => void
  showPanelDock: boolean
  onTogglePanelDock: () => void
  wireframeVisible: boolean
  onToggleWireframe: () => void
  isolatePiece: boolean
  onToggleIsolatePiece: () => void
  multiPiece: boolean
  onToggleSymmetry: () => void
  onFrameCamera: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

const LIGHTING_OPTIONS: { value: LightingMode; label: string; title: string }[] = [
  { value: 'studio', label: 'Studio', title: 'Studio Lighting: Balanced three-point setup with soft key light and fill' },
  { value: 'flat', label: 'Flat', title: 'Flat Lighting: Unshaded albedo view without lighting or shadows' },
  { value: 'outdoor', label: 'Outdoor', title: 'Outdoor Lighting: High-contrast directional sunlight with sky fill' },
  { value: 'showcase', label: 'Showcase', title: 'Showcase Lighting: Dramatic rim lighting for inspecting material details' }
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
  const [showPanelMenu, setShowPanelMenu] = createSignal(false)

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
                setShowPanelMenu(false)
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
                setShowPanelMenu(false)
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
        <SegmentedControl
          size="xs"
          options={LIGHTING_OPTIONS}
          value={props.lightingMode}
          onChange={props.onSelectLightingMode}
        />

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
          active={props.showPanelDock}
          onClick={props.onTogglePanelDock}
          tooltip="Toggle Tool Panels (C)"
        >
          <PanelRightIcon size={15} />
        </IconButton>

        <IconButton
          size="xs"
          active={props.wireframeVisible}
          onClick={props.onToggleWireframe}
          tooltip="Toggle Wireframe (W)"
        >
          <WireframeIcon size={15} />
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
