import { For, Show, createSignal, type JSX } from 'solid-js'
import { brush, type ToolMode } from '../paint/brush'
import { stencil } from '../paint/stencil'
import MaterialTextureHUD from './MaterialTextureHUD'
import TextureRegionHUD from './TextureRegionHUD'
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
  EyeOffIcon
} from './icons'
import { IconButton, PanelSection, Label } from './ui'
import { setTexturePath, resetTextureRegion } from '../paint/brush'
import { setStencilVisible } from '../paint/stencil'

export interface ToolPanelDockProps {
  activeTool: ToolMode
  /** Textures for the stencil's project-texture picker. */
  textures?: string[]
  isMaskTarget?: () => boolean
  onStamp: () => boolean
  onToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void
}

interface PanelDef {
  id: string
  title: string
  icon: (props: { size?: number; class?: string }) => JSX.Element
  /** Does this panel have anything to say for the current tool and state? */
  relevant: () => boolean
  /** Why it is not relevant, shown in the dimmed list so the panel isn't just missing. */
  requires: string
  /** A short live summary in the section header — what this panel is set to right now. */
  summary?: () => string | null
  /** Buttons for this panel, hosted in the section header the dock draws. */
  actions?: () => JSX.Element
  render: () => JSX.Element
}

/**
 * One home for every tool panel, in a column beside the brush settings.
 *
 * These used to float over the viewport: each one picked its own corner, they
 * overlapped each other and the model, closing one was hard to undo, and which
 * ones appeared depended on state the artist couldn't see. Docking them turns
 * that into a single predictable place, where the panels that apply to what you
 * are doing right now are open and the rest are listed, dimmed, with the reason
 * they're inactive.
 */
export default function ToolPanelDock(props: ToolPanelDockProps) {
  // Collapsed state per section, remembered for the session. Panels open
  // themselves when they first become relevant; an explicit collapse sticks.
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})

  const isTextured = (): boolean =>
    props.activeTool === 'brush' ||
    props.activeTool === 'stamp' ||
    props.activeTool === 'fill' ||
    props.activeTool === 'line'

  const panels = (): PanelDef[] => [
    {
      id: 'material',
      title: 'Material Texture',
      icon: (p) => <ImagesIcon {...p} />,
      relevant: () => (isTextured() && !!brush.texturePath()) || props.activeTool === 'fill',
      requires: 'Pick a texture or material from the shelf',
      actions: () => (
        <IconButton
          size="xs"
          variant="ghost"
          onClick={() => setTexturePath(null, !props.isMaskTarget?.())}
          title="Remove texture (switch back to solid color)"
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
      requires: 'Pick a texture to crop',
      summary: () => {
        const r = brush.textureRegion()
        const cropped = r.x !== 0 || r.y !== 0 || r.w !== 1 || r.h !== 1
        return cropped ? `${Math.round(r.w * 100)}% crop` : 'Full image'
      },
      actions: () => (
        <IconButton size="xs" variant="ghost" onClick={resetTextureRegion} title="Use the whole image again">
          <RefreshCwIcon size={12} />
        </IconButton>
      ),
      render: () => <TextureRegionHUD docked activeTool={props.activeTool} onClose={() => {}} />
    },
    {
      id: 'effect',
      title: 'Effects Brush',
      icon: (p) => <DropletsIcon {...p} />,
      relevant: () => props.activeTool === 'effect',
      requires: 'Switch to the Effects brush (U)',
      summary: () => brush.effectMode(),
      render: () => <EffectHUD docked activeTool={props.activeTool} isOpen onClose={() => {}} />
    },
    {
      id: 'stencil',
      title: 'Screen Stencil',
      icon: (p) => <SlidersIcon {...p} />,
      // Never tool-specific: a stencil gates whichever paint tool is active.
      relevant: () => true,
      requires: '',
      summary: () => (stencil.texturePath() ? (stencil.textureLabel() ?? 'Loaded') : 'None'),
      actions: () => (
        <Show when={stencil.texturePath()}>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => setStencilVisible(!stencil.visible())}
            title={stencil.visible() ? 'Hide the stencil sheet' : 'Show the stencil sheet'}
          >
            <Show when={stencil.visible()} fallback={<EyeOffIcon size={12} class="text-zinc-500" />}>
              <EyeIcon size={12} class="text-teal-400" />
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
  const inactive = (): PanelDef[] => panels().filter((p) => !p.relevant())

  return (
    <div class="h-full flex flex-col bg-zinc-900 border-l border-zinc-800 select-none">
      <div class="h-9 px-3.5 flex items-center justify-between border-b border-zinc-800 bg-zinc-850/50 flex-shrink-0">
        <Label uppercase badge={active().length}>Tool Panels</Label>
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

        {/* The rest, named rather than absent: a panel that silently disappears
            reads as a bug, and the artist can't tell what would bring it back. */}
        <Show when={inactive().length > 0}>
          <div class="p-3 flex flex-col gap-1.5">
            <Label uppercase class="text-zinc-600">
              Not available here
            </Label>
            <For each={inactive()}>
              {(panel) => (
                <div class="flex items-center gap-2 text-[11px] text-zinc-600" title={panel.requires}>
                  {panel.icon({ size: 12, class: 'shrink-0' })}
                  <span>{panel.title}</span>
                  <span class="ml-auto text-[10px] text-zinc-700 truncate">{panel.requires}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
