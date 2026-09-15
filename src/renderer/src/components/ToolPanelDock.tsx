import { For, Show, createSignal, type JSX } from 'solid-js'
import { brush, type ToolMode } from '../paint/brush'
import { stencil } from '../paint/stencil'
import MaterialTextureHUD from './MaterialTextureHUD'
import TextureRegionHUD from './TextureRegionHUD'
import FaceProjectorHUD from './FaceProjectorHUD'
import EffectHUD from './EffectHUD'
import StencilHUD from './StencilHUD'
import {
  ImagesIcon,
  CropIcon,
  DropletsIcon,
  SlidersIcon,
  RefreshCwIcon,
  Trash2Icon,
  EyeIcon,
  EyeOffIcon,
  FocusIcon
} from './icons'
import { IconButton, PanelSection, Label } from './ui'
import { setTexturePath, resetTextureRegion } from '../paint/brush'
import { setStencilVisible } from '../paint/stencil'

export interface ToolPanelDockProps {
  activeTool: ToolMode
  textures?: string[]
  isMaskTarget?: () => boolean
  onStamp: () => boolean
  onToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  onFillSelection?: () => void
  stencilPanelOpen?: boolean
}

interface PanelDef {
  id: string
  title: string
  icon: (props: { size?: number; class?: string }) => JSX.Element
  relevant: () => boolean
  summary?: () => string | null
  actions?: () => JSX.Element
  render: () => JSX.Element
}

export default function ToolPanelDock(props: ToolPanelDockProps): JSX.Element {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})

  const isTextured = (): boolean =>
    props.activeTool === 'brush' ||
    props.activeTool === 'stamp' ||
    props.activeTool === 'fill' ||
    props.activeTool === 'line' ||
    props.activeTool === 'faceProjector'

  const panels = (): PanelDef[] => [
    {
      id: 'material',
      title: 'Material Texture',
      icon: (p) => <ImagesIcon {...p} />,
      relevant: () => (isTextured() && !!brush.texturePath()) || props.activeTool === 'fill',
      actions: () => (
        <IconButton
          size="xs"
          variant="ghost"
          onClick={() => setTexturePath(null, !props.isMaskTarget?.())}
          tooltip="Remove texture (switch back to solid color)"
        >
          <Trash2Icon size={12} />
        </IconButton>
      ),
      render: () => (
        <MaterialTextureHUD
          docked
          isOpen
          onClose={() => {}}
          activeTool={props.activeTool}
          isMaskTarget={props.isMaskTarget}
        />
      )
    },
    {
      id: 'region',
      title: 'Texture Region',
      icon: (p) => <CropIcon {...p} />,
      relevant: () => isTextured() && !!brush.texturePath(),
      summary: () => {
        const r = brush.textureRegion()
        const cropped = r.x !== 0 || r.y !== 0 || r.w !== 1 || r.h !== 1
        return cropped ? `${Math.round(r.w * 100)}% crop` : 'Full image'
      },
      actions: () => (
        <IconButton
          size="xs"
          variant="ghost"
          onClick={resetTextureRegion}
          tooltip="Use the whole image again"
        >
          <RefreshCwIcon size={12} />
        </IconButton>
      ),
      render: () => <TextureRegionHUD docked activeTool={props.activeTool} onClose={() => {}} />
    },
    {
      id: 'projector',
      title: 'Face UV Projector',
      icon: (p) => <FocusIcon {...p} />,
      relevant: () =>
        props.activeTool === 'faceProjector' &&
        !!brush.texturePath() &&
        brush.selectedFaces().size > 0,
      summary: () => {
        const p = brush.faceProjection()
        const identity =
          p.offsetX === 0 && p.offsetY === 0 && p.scaleX === 1 && p.scaleY === 1 && p.rotation === 0
        const mode = p.fit ? 'Fit' : 'Tile'
        return identity ? `${mode} — default placement` : `${mode} — custom placement`
      },
      render: () => <FaceProjectorHUD docked onApply={() => props.onFillSelection?.()} />
    },
    {
      id: 'effect',
      title: 'Effects Brush',
      icon: (p) => <DropletsIcon {...p} />,
      relevant: () => props.activeTool === 'effect',
      summary: () => brush.effectMode(),
      render: () => <EffectHUD docked activeTool={props.activeTool} isOpen onClose={() => {}} />
    },
    {
      id: 'stencil',
      title: 'Screen Stencil',
      icon: (p) => <SlidersIcon {...p} />,
      relevant: () =>
        !!props.stencilPanelOpen &&
        props.activeTool !== 'fill' &&
        props.activeTool !== 'faceProjector',
      summary: () => (stencil.texturePath() ? (stencil.textureLabel() ?? 'Loaded') : 'None'),
      actions: () => (
        <Show when={stencil.texturePath()}>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => setStencilVisible(!stencil.visible())}
            tooltip={stencil.visible() ? 'Hide the stencil sheet' : 'Show the stencil sheet'}
          >
            <Show
              when={stencil.visible()}
              fallback={<EyeOffIcon size={12} class="text-[var(--text-muted)]" />}
            >
              <EyeIcon size={12} class="text-[var(--accent-color)]" />
            </Show>
          </IconButton>
        </Show>
      ),
      render: () => (
        <StencilHUD
          docked
          onStamp={props.onStamp}
          onClose={() => {}}
          onToast={props.onToast}
          textures={props.textures}
        />
      )
    }
  ]

  const active = (): PanelDef[] => panels().filter((p) => p.relevant())

  return (
    <div class="h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-color)] select-none">
      <div class="h-9 px-3 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] shrink-0">
        <Label uppercase badge={active().length}>
          Tool Panels
        </Label>
      </div>

      <div class="flex-1 overflow-y-auto">
        <For each={active()}>
          {(panel) => (
            <PanelSection
              title={panel.title}
              icon={panel.icon}
              summary={panel.summary?.()}
              actions={panel.actions?.()}
              open={!collapsed()[panel.id]}
              onToggle={() => setCollapsed((prev) => ({ ...prev, [panel.id]: !prev[panel.id] }))}
            >
              {panel.render()}
            </PanelSection>
          )}
        </For>

        <Show when={active().length === 0}>
          <div class="p-4 text-center text-xs text-[var(--text-muted)]">No active panels for this tool.</div>
        </Show>
      </div>
    </div>
  )
}
