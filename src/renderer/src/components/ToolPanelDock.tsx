import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { brush, type ToolMode } from '../paint/brush'
import { textTool } from '../paint/textTool'
import { stencil } from '../paint/stencil'
import { panelsForTool, type ToolPanelId } from '../paint/toolPanels'
import MaterialTextureHUD from './MaterialTextureHUD'
import TextureRegionHUD from './TextureRegionHUD'
import FaceProjectorHUD from './FaceProjectorHUD'
import TextHUD from './TextHUD'
import EffectHUD from './EffectHUD'
import StencilHUD from './StencilHUD'
import GradientHUD from './GradientHUD'
import { gradient } from '../paint/gradient'
import {
  ImagesIcon,
  CropIcon,
  DropletsIcon,
  SlidersIcon,
  RefreshCwIcon,
  Trash2Icon,
  EyeIcon,
  EyeOffIcon,
  FocusIcon,
  TextIcon,
  GradientIcon
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
  title: string
  icon: (props: { size?: number; class?: string }) => JSX.Element
  summary?: () => string | null
  actions?: () => JSX.Element
  render: () => JSX.Element
}

export default function ToolPanelDock(props: ToolPanelDockProps): JSX.Element {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})

  /**
   * Built once, not per render. `For` tracks items by reference, so rebuilding
   * these objects on every change would tear down and recreate each panel's
   * DOM — which pulls focus out of any field inside one. The Text tool's box
   * edits its own texture on every keystroke, so that turned typing into a
   * stream of tool hotkeys. Every field here is a closure over signals, so the
   * panels stay reactive without being rebuilt.
   *
   * These are renderers only. Which tool shows which panel lives in
   * `paint/toolPanels.ts` — panels never test `activeTool` to decide their own
   * visibility, because that is how they ended up shared across every tool.
   */
  const PANELS: Record<ToolPanelId, PanelDef> = {
    material: {
      title: 'Material Texture',
      icon: (p) => <ImagesIcon {...p} />,
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
    region: {
      title: 'Texture Region',
      icon: (p) => <CropIcon {...p} />,
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
      render: () => <TextureRegionHUD docked onClose={() => {}} />
    },
    text: {
      title: 'Text',
      icon: (p) => <TextIcon {...p} />,
      summary: () => textTool.options().text.split('\n')[0] || 'Empty',
      render: () => <TextHUD docked onApply={() => props.onFillSelection?.()} />
    },
    projector: {
      title: 'Face UV Projector',
      icon: (p) => <FocusIcon {...p} />,
      summary: () => {
        const p = brush.faceProjection()
        const identity =
          p.offsetX === 0 && p.offsetY === 0 && p.scaleX === 1 && p.scaleY === 1 && p.rotation === 0
        const mode = p.fit ? 'Fit' : 'Tile'
        return identity ? `${mode} — default placement` : `${mode} — custom placement`
      },
      render: () => <FaceProjectorHUD docked onApply={() => props.onFillSelection?.()} />
    },
    effect: {
      title: 'Effects Brush',
      icon: (p) => <DropletsIcon {...p} />,
      summary: () => brush.effectMode(),
      render: () => <EffectHUD docked isOpen onClose={() => {}} />
    },
    gradient: {
      title: 'Gradient',
      icon: (p) => <GradientIcon {...p} />,
      summary: () =>
        `${gradient.stops().length} stops · ${gradient.shape()} · ${gradient.ends()}`,
      render: () => <GradientHUD />
    },
    stencil: {
      title: 'Screen Stencil',
      icon: (p) => <SlidersIcon {...p} />,
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
  }

  const activeIds = createMemo<ToolPanelId[]>(() =>
    panelsForTool(props.activeTool, {
      hasTexture: !!brush.texturePath(),
      hasFaceSelection: brush.selectedFaces().size > 0,
      stencilPanelOpen: !!props.stencilPanelOpen
    })
  )

  return (
    <div class="h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-color)] select-none">
      <div class="h-9 px-3 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel-header)] shrink-0">
        <Label uppercase badge={activeIds().length}>
          Tool Panels
        </Label>
      </div>

      <div class="flex-1 overflow-y-auto">
        <For each={activeIds()}>
          {(id) => {
            const panel = PANELS[id]
            return (
              <PanelSection
                title={panel.title}
                icon={panel.icon}
                summary={panel.summary?.()}
                actions={panel.actions?.()}
                open={!collapsed()[id]}
                onToggle={() => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))}
              >
                {panel.render()}
              </PanelSection>
            )
          }}
        </For>

        <Show when={activeIds().length === 0}>
          <div class="p-4 text-center text-xs text-[var(--text-muted)]">
            No active panels for this tool.
          </div>
        </Show>
      </div>
    </div>
  )
}
