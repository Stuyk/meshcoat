import type { ToolMode } from './brush'

/**
 * Every dockable tool panel that exists. Panels are rendered by
 * `ToolPanelDock`; this module only decides *which* tool shows which ones.
 */
export type ToolPanelId = 'material' | 'region' | 'text' | 'projector' | 'effect' | 'stencil'

/**
 * Extra runtime state a panel needs before it is worth showing. These are
 * about data availability, never about which tool is active — the tool is
 * already decided by `TOOL_PANELS`.
 */
export type ToolPanelRequirement = 'texture' | 'faceSelection' | 'stencilPanelOpen'

export interface ToolPanelEntry {
  id: ToolPanelId
  requires?: ToolPanelRequirement[]
}

export interface ToolPanelContext {
  hasTexture: boolean
  hasFaceSelection: boolean
  stencilPanelOpen: boolean
}

/**
 * The single source of truth for tool panel layout. Each tool owns its own
 * ordered list, so adding or removing a panel for one tool can never leak
 * into another. Panels used to decide this themselves with OR-ed tool lists
 * (`tool === 'brush' || tool === 'stamp' || ...`), which meant every new tool
 * silently inherited panels from unrelated tools.
 */
export const TOOL_PANELS: Record<ToolMode, readonly ToolPanelEntry[]> = {
  brush: [
    { id: 'material', requires: ['texture'] },
    { id: 'region', requires: ['texture'] },
    { id: 'stencil', requires: ['stencilPanelOpen'] }
  ],
  line: [
    { id: 'material', requires: ['texture'] },
    { id: 'region', requires: ['texture'] },
    { id: 'stencil', requires: ['stencilPanelOpen'] }
  ],
  stamp: [
    { id: 'material', requires: ['texture'] },
    { id: 'region', requires: ['texture'] },
    { id: 'stencil', requires: ['stencilPanelOpen'] }
  ],
  eraser: [{ id: 'stencil', requires: ['stencilPanelOpen'] }],
  fill: [{ id: 'material' }, { id: 'region', requires: ['texture'] }],
  eyedropper: [],
  faceSelect: [],
  effect: [{ id: 'effect' }, { id: 'stencil', requires: ['stencilPanelOpen'] }],
  faceProjector: [
    { id: 'material', requires: ['texture'] },
    { id: 'region', requires: ['texture'] },
    { id: 'projector', requires: ['texture', 'faceSelection'] }
  ],
  text: [{ id: 'text' }, { id: 'projector', requires: ['texture', 'faceSelection'] }]
}

const SATISFIED: Record<ToolPanelRequirement, (ctx: ToolPanelContext) => boolean> = {
  texture: (ctx) => ctx.hasTexture,
  faceSelection: (ctx) => ctx.hasFaceSelection,
  stencilPanelOpen: (ctx) => ctx.stencilPanelOpen
}

/** Panel ids the given tool shows right now, in display order. */
export function panelsForTool(tool: ToolMode, ctx: ToolPanelContext): ToolPanelId[] {
  return TOOL_PANELS[tool]
    .filter((entry) => (entry.requires ?? []).every((req) => SATISFIED[req](ctx)))
    .map((entry) => entry.id)
}

/** Whether any tool can ever show this panel — used by the dock toggle. */
export function toolUsesPanel(tool: ToolMode, id: ToolPanelId): boolean {
  return TOOL_PANELS[tool].some((entry) => entry.id === id)
}
