import { Show, type JSX } from 'solid-js'
import {
  BrushIcon,
  LineIcon,
  StampIcon,
  EraserIcon,
  FillIcon,
  DropletsIcon,
  ImagesIcon,
  EyedropperIcon,
  MousePointerIcon,
  CompassIcon,
  FocusIcon,
  TextIcon,
  EdgeWearIcon
} from './icons'
import { IconButton } from './ui'
import type { ToolMode } from '../paint/brush'
import { stencil } from '../paint/stencil'
import { toolUsesPanel } from '../paint/toolPanels'

export interface WorkstationShelfProps {
  activeTool: ToolMode
  onSelectTool: (t: ToolMode) => void
  showStencilPanel: boolean
  onToggleStencilPanel: () => void
  showEdgeWearWizard: boolean
  onToggleEdgeWearWizard: () => void
  onFrameCamera: () => void
}

export default function WorkstationShelf(props: WorkstationShelfProps): JSX.Element {
  return (
    <nav
      class="w-11 min-w-11 max-w-11 bg-[var(--bg-panel)] border-r border-[var(--border-color)] flex flex-col items-center py-2.5 gap-1.5 z-20 select-none shrink-0"
      aria-label="Workstation Tools"
    >
      {/* Tools: exactly one of these is ever selected, and it fills with accent. */}
      <div class="flex flex-col items-center gap-1.5" role="group" aria-label="Active tool">
        <IconButton
          size="sm"
          active={props.activeTool === 'brush'}
          onClick={() => props.onSelectTool('brush')}
          shortcut="B"
          tooltip="Paint Brush (B)"
        >
          <BrushIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'line'}
          onClick={() => props.onSelectTool('line')}
          shortcut="L"
          tooltip="Line Tool (L)"
        >
          <LineIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'stamp'}
          onClick={() => props.onSelectTool('stamp')}
          shortcut="T"
          tooltip="Texture Stamp (T)"
        >
          <StampIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'eraser'}
          onClick={() => props.onSelectTool('eraser')}
          shortcut="E"
          tooltip="Eraser (E)"
        >
          <EraserIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'fill'}
          onClick={() => props.onSelectTool('fill')}
          shortcut="G"
          tooltip="Fill Bucket (G)"
        >
          <FillIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'effect'}
          onClick={() => props.onSelectTool('effect')}
          shortcut="U"
          tooltip="Effects Brush — Blur / Sharpen / Smudge (U)"
        >
          <DropletsIcon size={18} />
        </IconButton>

        <div class="w-6 h-px bg-[var(--border-color)] my-1" />

        <IconButton
          size="sm"
          active={props.activeTool === 'eyedropper'}
          onClick={() => props.onSelectTool('eyedropper')}
          shortcut="I"
          tooltip="Color Eyedropper (I)"
        >
          <EyedropperIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'faceSelect'}
          onClick={() => props.onSelectTool('faceSelect')}
          shortcut="V"
          tooltip="Face Selection Mask (V)"
        >
          <MousePointerIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'text'}
          onClick={() => props.onSelectTool('text')}
          shortcut="Y"
          tooltip="Text on Faces (Y)"
        >
          <TextIcon size={18} />
        </IconButton>

        <IconButton
          size="sm"
          active={props.activeTool === 'faceProjector'}
          onClick={() => props.onSelectTool('faceProjector')}
          shortcut="P"
          tooltip="Face UV Projector (P)"
        >
          <CompassIcon size={18} />
        </IconButton>
      </div>

      {/*
        Modifiers, not tools. These run ALONGSIDE the selected tool rather than
        replacing it, so they get the outlined `toggled` look and live below
        their own divider — sharing the tool strip's filled `active` style made
        an enabled stencil read as a second selected tool.
      */}
      <div class="w-6 h-px bg-[var(--border-color)] my-1" />

      <div class="flex flex-col items-center gap-1.5" role="group" aria-label="Modifiers">
        <IconButton
          size="sm"
          toggled={props.showStencilPanel}
          disabled={!toolUsesPanel(props.activeTool, 'stencil')}
          onClick={props.onToggleStencilPanel}
          shortcut="S"
          tooltip={
            toolUsesPanel(props.activeTool, 'stencil')
              ? 'Screen Stencil — paints through a projected image, on top of the current tool (S)'
              : `Screen Stencil is not used by the ${props.activeTool} tool`
          }
          class="relative"
        >
          <ImagesIcon size={18} />
          <Show when={stencil.texturePath()}>
            <span
              class="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--accent-color)] ring-1 ring-black"
              title="A stencil image is loaded"
            />
          </Show>
        </IconButton>

        <IconButton
          size="sm"
          toggled={props.showEdgeWearWizard}
          onClick={props.onToggleEdgeWearWizard}
          tooltip="Edge Wear & Chipping Wizard"
        >
          <EdgeWearIcon size={18} class="text-amber-400" />
        </IconButton>
      </div>

      <div class="w-6 h-px bg-[var(--border-color)] my-1" />

      <IconButton
        size="sm"
        variant="ghost"
        onClick={props.onFrameCamera}
        shortcut="F"
        tooltip="Frame Model (F)"
      >
        <FocusIcon size={18} />
      </IconButton>
    </nav>
  )
}
export { WorkstationShelf }
