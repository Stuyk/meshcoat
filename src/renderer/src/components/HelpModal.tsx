import { createSignal, For, Show } from 'solid-js'
import { Modal, Button } from './ui'
import {
  HelpCircleIcon,
  KeyboardIcon,
  CompassIcon,
  BrushIcon,
  PaletteIcon,
  LayersIcon,
  SearchIcon,
  XIcon,
  LineIcon,
  EraserIcon,
  StampIcon,
  FillIcon,
  EyedropperIcon,
  SparklesIcon,
  ImagesIcon,
  SymmetryIcon,
  CubeIcon,
  EyeOffIcon
} from './icons'

type HelpTab = 'shortcuts' | 'workflow' | 'tools' | 'pbr' | 'layers'

interface ShortcutItem {
  keys: string[]
  desc: string
  category: string
}

const SHORTCUTS: ShortcutItem[] = [
  // Viewport & Navigation
  { category: 'Viewport & Navigation', keys: ['MMB'], desc: 'Orbit 3D viewport' },
  { category: 'Viewport & Navigation', keys: ['Alt', 'LMB'], desc: 'Orbit 3D viewport (alternate)' },
  { category: 'Viewport & Navigation', keys: ['Shift', 'MMB'], desc: 'Pan 3D viewport' },
  { category: 'Viewport & Navigation', keys: ['Wheel'], desc: 'Zoom in / out' },
  { category: 'Viewport & Navigation', keys: ['F'], desc: 'Frame entire model in viewport' },
  { category: 'Viewport & Navigation', keys: ['Home'], desc: 'Frame entire model (alternate)' },
  { category: 'Viewport & Navigation', keys: ['W'], desc: 'Toggle wireframe overlay' },

  // Tools & Radial Menu
  { category: 'Tools & Radial Menu', keys: ['1'], desc: 'Brush tool' },
  { category: 'Tools & Radial Menu', keys: ['B'], desc: 'Brush tool (alternate)' },
  { category: 'Tools & Radial Menu', keys: ['L'], desc: 'Line tool (straight surface strokes)' },
  { category: 'Tools & Radial Menu', keys: ['Shift', 'Click'], desc: 'Draw straight line with Brush' },
  { category: 'Tools & Radial Menu', keys: ['2'], desc: 'Eraser tool' },
  { category: 'Tools & Radial Menu', keys: ['E'], desc: 'Eraser tool (alternate)' },
  { category: 'Tools & Radial Menu', keys: ['3'], desc: 'Stamp decal tool' },
  { category: 'Tools & Radial Menu', keys: ['T'], desc: 'Stamp decal tool (alternate)' },
  { category: 'Tools & Radial Menu', keys: ['4'], desc: 'Fill bucket tool' },
  { category: 'Tools & Radial Menu', keys: ['G'], desc: 'Fill bucket tool (alternate)' },
  { category: 'Tools & Radial Menu', keys: ['5'], desc: 'Eyedropper / Color picker' },
  { category: 'Tools & Radial Menu', keys: ['I'], desc: 'Eyedropper (alternate)' },
  { category: 'Tools & Radial Menu', keys: ['6'], desc: 'Face selection tool' },
  { category: 'Tools & Radial Menu', keys: ['V'], desc: 'Face selection tool (alternate)' },
  { category: 'Tools & Radial Menu', keys: ['7'], desc: 'Effect brush (cycle modes)' },
  { category: 'Tools & Radial Menu', keys: ['U'], desc: 'Effect brush (alternate)' },
  { category: 'Tools & Radial Menu', keys: ['S'], desc: 'Toggle Screen Stencil overlay' },
  { category: 'Tools & Radial Menu', keys: ['Space'], desc: 'Open Radial Pie Menu at cursor' },

  // Brush Controls & Adjustments
  { category: 'Brush Controls & Adjustments', keys: ['['], desc: 'Decrease brush radius' },
  { category: 'Brush Controls & Adjustments', keys: [']'], desc: 'Increase brush radius' },
  { category: 'Brush Controls & Adjustments', keys: ['R'], desc: 'Rotate brush angle (+15°)' },
  { category: 'Brush Controls & Adjustments', keys: ['Shift', 'R'], desc: 'Rotate brush angle (-15°)' },
  { category: 'Brush Controls & Adjustments', keys: ['X'], desc: 'Swap Mask B/W or toggle Solid/Texture' },
  { category: 'Brush Controls & Adjustments', keys: ['Alt', 'X'], desc: 'Cycle symmetry axis (Off → X → Y → Z)' },

  // Geometry & Face Selection
  { category: 'Geometry & Face Selection', keys: ['Ctrl', 'A'], desc: 'Select all faces on active piece' },
  { category: 'Geometry & Face Selection', keys: ['Ctrl', 'D'], desc: 'Deselect all faces' },
  { category: 'Geometry & Face Selection', keys: ['Escape'], desc: 'Clear face selection / cancel modal' },
  { category: 'Geometry & Face Selection', keys: ['Ctrl', 'I'], desc: 'Invert face selection' },
  { category: 'Geometry & Face Selection', keys: ['Ctrl', 'Drag'], desc: 'Paint-select multiple faces' },
  { category: 'Geometry & Face Selection', keys: ['Double LMB'], desc: 'Select connected UV island (in Face tool)' },

  // Multi-Piece Models
  { category: 'Multi-Piece Models', keys: ['Tab'], desc: 'Next model piece / texture set' },
  { category: 'Multi-Piece Models', keys: ['Shift', 'Tab'], desc: 'Previous model piece / texture set' },
  { category: 'Multi-Piece Models', keys: ['Double LMB'], desc: 'Select piece under cursor (in paint tools)' },

  // History & Application
  { category: 'History & Application', keys: ['Ctrl', 'N'], desc: 'New project / Welcome wizard' },
  { category: 'History & Application', keys: ['Ctrl', 'O'], desc: 'Open 3D model file' },
  { category: 'History & Application', keys: ['Ctrl', 'S'], desc: 'Save project' },
  { category: 'History & Application', keys: ['Ctrl', 'Shift', 'S'], desc: 'Save project as' },
  { category: 'History & Application', keys: ['Ctrl', 'Shift', 'E'], desc: 'Open Export Textures wizard' },
  { category: 'History & Application', keys: ['Ctrl', 'E'], desc: 'Open Export Textures wizard (alternate)' },
  { category: 'History & Application', keys: ['Ctrl', 'Z'], desc: 'Undo last stroke or layer edit' },
  { category: 'History & Application', keys: ['Ctrl', 'Y'], desc: 'Redo previously undone action' },
  { category: 'History & Application', keys: ['Ctrl', 'Shift', 'Z'], desc: 'Redo (alternate)' },
  { category: 'History & Application', keys: ['?'], desc: 'Toggle this Help & Shortcuts guide' }
]

export default function HelpModal(props: { isOpen: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = createSignal<HelpTab>('shortcuts')
  const [searchQuery, setSearchQuery] = createSignal('')

  const filteredShortcuts = () => {
    const q = searchQuery().trim().toLowerCase()
    if (!q) return SHORTCUTS
    return SHORTCUTS.filter(
      (s) =>
        s.desc.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.keys.some((k) => k.toLowerCase().includes(q))
    )
  }

  const groupedCategories = () => {
    const list = filteredShortcuts()
    const categories: Record<string, ShortcutItem[]> = {}
    for (const item of list) {
      if (!categories[item.category]) categories[item.category] = []
      categories[item.category].push(item)
    }
    return categories
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="MeshCoat Guide & Documentation"
      icon={(p) => <HelpCircleIcon size={p.size} class="text-blue-400" />}
      size="2xl"
      footer={
        <div class="flex items-center justify-between w-full">
          <span class="text-[11px] text-zinc-500">
            Press <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono text-[10px]">Esc</kbd> or click outside to dismiss
          </span>
          <Button variant="primary" onClick={props.onClose}>
            Got It
          </Button>
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        {/* Navigation Tabs */}
        <div class="flex items-center gap-1.5 p-1 bg-zinc-950/80 border border-zinc-800/80 rounded-xl overflow-x-auto select-none">
          <button
            type="button"
            class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab() === 'shortcuts'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
            onClick={() => setActiveTab('shortcuts')}
          >
            <KeyboardIcon size={15} />
            <span>Shortcuts</span>
          </button>

          <button
            type="button"
            class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab() === 'workflow'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
            onClick={() => setActiveTab('workflow')}
          >
            <CompassIcon size={15} />
            <span>Workflow</span>
          </button>

          <button
            type="button"
            class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab() === 'tools'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
            onClick={() => setActiveTab('tools')}
          >
            <BrushIcon size={15} />
            <span>Tools & Brushes</span>
          </button>

          <button
            type="button"
            class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab() === 'pbr'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
            onClick={() => setActiveTab('pbr')}
          >
            <PaletteIcon size={15} />
            <span>PBR Channels</span>
          </button>

          <button
            type="button"
            class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab() === 'layers'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
            onClick={() => setActiveTab('layers')}
          >
            <LayersIcon size={15} />
            <span>Layers & Masks</span>
          </button>
        </div>

        {/* Tab 1: Shortcuts */}
        <Show when={activeTab() === 'shortcuts'}>
          <div class="flex flex-col gap-3">
            {/* Search Input */}
            <div class="relative flex items-center">
              <SearchIcon size={15} class="absolute left-3 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search shortcuts by key, action, or tool name (e.g. brush, wireframe, mask)..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full pl-9 pr-9 py-2 rounded-lg bg-zinc-950/70 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/40 transition-all"
              />
              <Show when={searchQuery()}>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  class="absolute right-2.5 p-1 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                  title="Clear search"
                >
                  <XIcon size={14} />
                </button>
              </Show>
            </div>

            {/* Shortcuts Grid */}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <For each={Object.entries(groupedCategories())}>
                {([category, items]) => (
                  <div class="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl flex flex-col gap-2">
                    <div class="flex items-center justify-between border-b border-zinc-800/80 pb-1.5">
                      <h3 class="text-xs font-semibold text-zinc-200 tracking-wide">{category}</h3>
                      <span class="text-[10px] text-zinc-500 font-mono">{items.length} keys</span>
                    </div>
                    <div class="space-y-1.5">
                      <For each={items}>
                        {(item) => (
                          <div class="flex items-center justify-between gap-2 py-0.5 text-xs">
                            <div class="flex items-center gap-1 shrink-0 font-mono text-[11px]">
                              <For each={item.keys}>
                                {(k, idx) => (
                                  <>
                                    <Show when={idx() > 0}>
                                      <span class="text-zinc-500 text-[10px]">+</span>
                                    </Show>
                                    <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/80 text-zinc-200 text-[11px] font-medium shadow-xs">
                                      {k}
                                    </kbd>
                                  </>
                                )}
                              </For>
                            </div>
                            <span class="text-zinc-400 text-right text-[11px] leading-snug">{item.desc}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show when={Object.keys(groupedCategories()).length === 0}>
              <div class="p-8 text-center bg-zinc-950/40 border border-zinc-800 rounded-xl">
                <p class="text-xs text-zinc-400">No shortcuts matched &ldquo;{searchQuery()}&rdquo;</p>
                <button
                  type="button"
                  class="mt-2 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer"
                  onClick={() => setSearchQuery('')}
                >
                  Clear search query
                </button>
              </div>
            </Show>
          </div>
        </Show>

        {/* Tab 2: Workflow & Concepts */}
        <Show when={activeTab() === 'workflow'}>
          <div class="flex flex-col gap-4 text-xs text-zinc-300 leading-relaxed">
            {/* Hero Overview */}
            <div class="p-4 bg-gradient-to-r from-blue-950/40 via-zinc-900/60 to-zinc-950/60 border border-blue-500/20 rounded-xl flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <CompassIcon size={18} class="text-blue-400" />
                <h3 class="text-sm font-semibold text-zinc-100">Welcome to MeshCoat</h3>
              </div>
              <p class="text-zinc-300 text-xs">
                MeshCoat is a high-performance 3D surface painting suite designed for texturing low, mid, and high-poly 3D models directly in your viewport. It projects strokes from the camera onto the 3D surface, painting across UV seams smoothly without manual 2D texture unfolding.
              </p>
            </div>

            {/* End-to-End Workflow */}
            <div class="flex flex-col gap-2.5">
              <h3 class="text-xs font-bold text-zinc-200 uppercase tracking-wider">End-to-End Painting Workflow</h3>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                  <div class="flex items-center gap-2 font-semibold text-zinc-200">
                    <span class="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center text-[10px] font-mono font-bold">1</span>
                    <h4>Import 3D Model</h4>
                  </div>
                  <p class="text-[11px] text-zinc-400">
                    Load any <code class="text-blue-400">.obj</code>, <code class="text-blue-400">.gltf</code>, or <code class="text-blue-400">.glb</code> asset via File &gt; Open 3D Model. Models can contain single or multiple meshes with UV0 coordinates.
                  </p>
                </div>

                <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                  <div class="flex items-center gap-2 font-semibold text-zinc-200">
                    <span class="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center text-[10px] font-mono font-bold">2</span>
                    <h4>Configure Resolution</h4>
                  </div>
                  <p class="text-[11px] text-zinc-400">
                    Choose from 512px to 4096px texture resolution. For multi-piece models, each mesh piece maintains its own independent texture set and layer stack.
                  </p>
                </div>

                <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                  <div class="flex items-center gap-2 font-semibold text-zinc-200">
                    <span class="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center text-[10px] font-mono font-bold">3</span>
                    <h4>Paint in 3D</h4>
                  </div>
                  <p class="text-[11px] text-zinc-400">
                    Use Brush, Line, Stamped Decals, or Stencils. Strokes project in tangent-space, automatically bleeding across UV borders to prevent seam gaps.
                  </p>
                </div>

                <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                  <div class="flex items-center gap-2 font-semibold text-zinc-200">
                    <span class="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center text-[10px] font-mono font-bold">4</span>
                    <h4>PBR Channels</h4>
                  </div>
                  <p class="text-[11px] text-zinc-400">
                    Paint Base Color, Roughness, Metalness, Normal, and Ambient Occlusion. Inspect individual channels in the top bar with hotkeys.
                  </p>
                </div>

                <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                  <div class="flex items-center gap-2 font-semibold text-zinc-200">
                    <span class="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center text-[10px] font-mono font-bold">5</span>
                    <h4>Layers & Masks</h4>
                  </div>
                  <p class="text-[11px] text-zinc-400">
                    Layer blend modes (Multiply, Screen, Overlay, etc.), non-destructive layer masks, and procedural edge wear generator for realistic weathering.
                  </p>
                </div>

                <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                  <div class="flex items-center gap-2 font-semibold text-zinc-200">
                    <span class="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center text-[10px] font-mono font-bold">6</span>
                    <h4>Export & Auto-Save</h4>
                  </div>
                  <p class="text-[11px] text-zinc-400">
                    Export PNG maps or packed ORM textures (AO, Roughness, Metalness). MeshCoat automatically saves recovery backups every 60 seconds.
                  </p>
                </div>
              </div>
            </div>

            {/* 3D Projection vs 2D Painting */}
            <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
              <h3 class="text-xs font-semibold text-zinc-200">How 3D Projection Painting Works</h3>
              <p class="text-zinc-400 text-[11px]">
                When painting on complex geometry, 2D UV seams often cut across visible surfaces (such as across character faces or curved mechanical parts). MeshCoat executes screen-to-surface raycasting combined with an occlusion depth buffer. This ensures paint only applies to front-facing geometry without bleeding onto backfaces or hidden shells, and texel dilation keeps seam edges seamless at any camera angle.
              </p>
            </div>
          </div>
        </Show>

        {/* Tab 3: Tools & Painting Guide */}
        <Show when={activeTab() === 'tools'}>
          <div class="flex flex-col gap-3 text-xs text-zinc-300">
            <p class="text-[11px] text-zinc-400">
              MeshCoat provides 8 specialized viewport tools, along with Screen Stencils, Symmetry Mirroring, and the Radial Pie Menu.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Brush Tool */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-blue-600/20 text-blue-400"><BrushIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Brush Tool</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">1 / B</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Projects smooth circular or textured dabs onto 3D geometry. Customize Radius, Opacity, Hardness (edge falloff), Flow (dab rate), Spacing, Jitter, and Scatter. Supports tiled pattern textures with adjustable scale.
                </p>
              </div>

              {/* Line Tool */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-purple-600/20 text-purple-400"><LineIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Line Tool</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">L</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Draws straight strokes between two points. Raycasts along the screen-space path to hug curved surfaces without cutting through internal geometry. Can also be invoked with <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">Shift + Click</kbd> while using the brush.
                </p>
              </div>

              {/* Eraser Tool */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-red-600/20 text-red-400"><EraserIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Eraser Tool</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">2 / E</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Non-destructively reduces alpha on the active layer. Allows carving out highlights or cleaning up edges without affecting layers underneath.
                </p>
              </div>

              {/* Stamp Tool */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-400"><StampIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Stamp Decal</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">3 / T</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Projects decals, logos, and emblems onto surfaces. Shows a live on-surface preview orientation ring. Adjust size, angle, and opacity before stamping down.
                </p>
              </div>

              {/* Fill Bucket */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-amber-600/20 text-amber-400"><FillIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Fill Bucket</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">4 / G</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Floods geometry with color or repeating texture. When face selection is active, it fills only the selected faces; otherwise it floods the whole active mesh piece.
                </p>
              </div>

              {/* Eyedropper */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-cyan-600/20 text-cyan-400"><EyedropperIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Eyedropper</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">5 / I</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Samples colors directly from the 3D surface with a precision magnification loupe preview showing RGB hex values. Also samples active PBR channel data.
                </p>
              </div>

              {/* Face Selection */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400"><CubeIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Face Selection</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">6 / V</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Isolates sub-mesh triangles. <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">Double-click</kbd> selects a connected UV island. <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">Ctrl + Drag</kbd> paint-selects faces. Constrains all paint operations exclusively to selected geometry.
                </p>
              </div>

              {/* Effect Brush */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-pink-600/20 text-pink-400"><SparklesIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Effect Brush</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">7 / U</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Filters texels directly on the active layer in premultiplied alpha space. Modes include <span class="text-zinc-200 font-medium">Blur</span> (soften seams), <span class="text-zinc-200 font-medium">Sharpen</span> (enhance details), <span class="text-zinc-200 font-medium">Smudge</span> (blend strokes), and <span class="text-zinc-200 font-medium">Pixelate</span>.
                </p>
              </div>

              {/* Screen Stencil */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-teal-600/20 text-teal-400"><ImagesIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Screen Stencil</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">S</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Floats a 2D guide image over the viewport. Use <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">Alt + LMB</kbd> to drag and <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">Alt + RMB</kbd> to scale and rotate. Paint through it to project intricate patterns directly onto geometry.
                </p>
              </div>

              {/* Radial Pie Menu */}
              <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-orange-600/20 text-orange-400"><SymmetryIcon size={16} /></div>
                    <h4 class="font-semibold text-zinc-100">Radial Pie Menu</h4>
                  </div>
                  <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">Space</kbd>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Tap Space to open a radial menu right at your cursor. Flick your mouse towards any tool wedge or color swatch for instant hands-free switching without moving to the toolbar.
                </p>
              </div>
            </div>
          </div>
        </Show>

        {/* Tab 4: PBR Channels */}
        <Show when={activeTab() === 'pbr'}>
          <div class="flex flex-col gap-3.5 text-xs text-zinc-300 leading-relaxed">
            <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
              <h3 class="text-xs font-semibold text-zinc-100">What is Physically Based Rendering (PBR)?</h3>
              <p class="text-zinc-400 text-[11px]">
                PBR simulates real-world interactions between light rays and physical surfaces. Instead of baking lights or shadows into colors, surfaces are defined by independent physical attributes: Base Color, Roughness, Metalness, Normal maps, and Ambient Occlusion.
              </p>
            </div>

            <div class="space-y-2.5">
              <h3 class="text-xs font-bold text-zinc-200 uppercase tracking-wider">The 5 Core PBR Channels</h3>

              <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-zinc-200">Base Color (Albedo)</span>
                  <span class="text-[10px] px-2 py-0.5 rounded bg-blue-950 text-blue-400 font-mono">sRGB</span>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Represents the pure diffuse color of dielectrics (plastics, wood, cloth) or the specular reflectance tint of raw metals. It should never contain lighting, shadows, or ambient occlusion.
                </p>
              </div>

              <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-zinc-200">Roughness</span>
                  <span class="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">Linear (0.0 - 1.0)</span>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Controls microsurface irregularity. A value of <code class="text-zinc-200">0.0</code> creates a mirror-glossy reflection, while <code class="text-zinc-200">1.0</code> produces completely diffuse, matte reflections with broad light scattering.
                </p>
              </div>

              <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-zinc-200">Metalness</span>
                  <span class="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">Linear (0.0 or 1.0)</span>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Defines whether the surface is non-metallic/dielectric (<code class="text-zinc-200">0.0</code>) or raw conductive metal (<code class="text-zinc-200">1.0</code>). Metals have zero diffuse reflection and tint their specular highlights using the Base Color.
                </p>
              </div>

              <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-zinc-200">Normal Map</span>
                  <span class="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-400 font-mono">Tangent Space RGB</span>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Perturbs the surface normal per texel to fake high-frequency geometric detail like bevels, panel lines, bumps, and scratches without increasing vertex count.
                </p>
              </div>

              <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-zinc-200">Ambient Occlusion (AO)</span>
                  <span class="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">Grayscale</span>
                </div>
                <p class="text-[11px] text-zinc-400">
                  Simulates contact shadows in crevices, folds, and recessed corners where ambient environmental light struggles to reach.
                </p>
              </div>
            </div>

            {/* Packed ORM */}
            <div class="p-3.5 bg-gradient-to-r from-purple-950/30 to-zinc-950/60 border border-purple-500/30 rounded-xl flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <h3 class="text-xs font-semibold text-zinc-100">Packed ORM Textures (Export)</h3>
                <span class="text-[10px] text-purple-300 font-mono">Game Engine Ready</span>
              </div>
              <p class="text-[11px] text-zinc-400">
                MeshCoat can pack three channels into a single texture to optimize VRAM and draw calls for Unreal Engine, Unity, Godot, and Blender:
              </p>
              <div class="grid grid-cols-3 gap-2 text-center text-[10px] font-mono mt-1">
                <div class="p-2 rounded bg-red-950/40 border border-red-800/40 text-red-300">
                  <span class="font-bold">RED</span>: Ambient Occlusion
                </div>
                <div class="p-2 rounded bg-green-950/40 border border-green-800/40 text-green-300">
                  <span class="font-bold">GREEN</span>: Roughness
                </div>
                <div class="p-2 rounded bg-blue-950/40 border border-blue-800/40 text-blue-300">
                  <span class="font-bold">BLUE</span>: Metalness
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* Tab 5: Layers & Masks */}
        <Show when={activeTab() === 'layers'}>
          <div class="flex flex-col gap-3.5 text-xs text-zinc-300 leading-relaxed">
            {/* Layer Stack Structure */}
            <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
              <h3 class="text-xs font-semibold text-zinc-100">Layer Stack Management</h3>
              <p class="text-zinc-400 text-[11px]">
                Layers stack from bottom to top. The topmost visible layer renders over underlying layers according to its opacity and blend mode.
              </p>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] mt-1">
                <div class="p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                  <span class="font-semibold text-zinc-200">Normal</span>: Default alpha blend
                </div>
                <div class="p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                  <span class="font-semibold text-zinc-200">Multiply</span>: Darkens / dirt & shadows
                </div>
                <div class="p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                  <span class="font-semibold text-zinc-200">Screen</span>: Lightens / specular glows
                </div>
                <div class="p-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                  <span class="font-semibold text-zinc-200">Overlay</span>: High contrast blending
                </div>
              </div>
            </div>

            {/* Layer Masks */}
            <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <h3 class="text-xs font-semibold text-zinc-100">Non-Destructive Layer Masks</h3>
                <span class="text-[10px] text-zinc-400 font-mono">White reveals · Black hides</span>
              </div>
              <p class="text-zinc-400 text-[11px]">
                Attach a mask to any layer to selectively hide or reveal areas without deleting paint. Press <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">X</kbd> while editing a mask to instantly swap between White (Reveal) and Black (Hide).
              </p>
            </div>

            {/* Edge Wear Generator */}
            <div class="p-3.5 bg-gradient-to-r from-amber-950/30 to-zinc-950/60 border border-amber-500/30 rounded-xl flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <SparklesIcon size={16} class="text-amber-400" />
                  <h3 class="text-xs font-semibold text-zinc-100">Procedural Edge Wear Wizard</h3>
                </div>
                <span class="text-[10px] text-amber-300 font-mono">Curvature Detection</span>
              </div>
              <p class="text-zinc-400 text-[11px]">
                Analyzes mesh geometric curvature to generate realistic chipped edges, worn paint on sharp corners, and grime in recessed crevices. Tune Radius, Contrast, Noise Scale, and Threshold with live viewport feedback, then commit as a new layer or mask.
              </p>
            </div>

            {/* Multi-Piece Models & Isolation */}
            <div class="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <EyeOffIcon size={16} class="text-blue-400" />
                  <h3 class="text-xs font-semibold text-zinc-100">Multi-Piece Models &amp; Isolation</h3>
                </div>
                <span class="text-[10px] text-blue-300 font-mono">Top Bar Quick Control</span>
              </div>
              <p class="text-zinc-400 text-[11px]">
                When painting complex characters or vehicles containing multiple pieces (e.g. Head, Torso, Gear), click the <span class="text-zinc-200 font-medium">Isolate Active Piece</span> button in the top bar to hide all other meshes. This lets you work inside tight crevices without obstruction. Switching pieces via <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">Tab</kbd> or the layer panel dropdown automatically isolates the newly active piece!
              </p>
            </div>
          </div>
        </Show>
      </div>
    </Modal>
  )
}
