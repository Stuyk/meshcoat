# Changelog

## v1.1.0

### Added
- **Project persistence (`.meshcoat`)**: save and load full multi-layer painting projects including model path, blend modes, opacities, and canvas-compressed PNG layer buffers with full fidelity.
- **Auto-recovery and rolling backups**: background autosave every 60 seconds saves to `<userData>/backups/autosave.json`, with a rolling history of the 5 most recent timestamped backups.
- **Unsaved changes indicator**: title bar and document title append `*` whenever unsaved edits exist; `Ctrl+S` (`Cmd+S`) saves the project and clears the indicator, and `Ctrl+Shift+S` triggers "Save Project As...".
- **Welcome / Start Wizard**: all-in-one startup dialog (also accessible via `Ctrl+N` / `File -> New / Welcome Wizard...`) featuring:
  - Unsaved session detection with one-click "Restore Session" or "Discard".
  - "Start From Scratch" instant creation with a default sphere at customizable resolutions (512×512 to 8192×8192).
  - "Load 3D Model & Textures" form allowing simultaneous model and initial base texture map import.
  - Quick open for `.meshcoat` files.
  - Recent files list with elapsed time indicators and a one-click clear button.
- **In-app interactive color picker**: custom 2D Saturation-Value canvas gradient, 1D Hue slider, live editable HEX and RGB inputs, color comparison swatches, and system eyedropper tool.
- **Saved swatches & curated preset palettes**: "My Swatches" grid persistent across sessions, alongside 7 built-in palette presets (Essentials, Retro 16 Pico-8, Skin & Organic, Metals & Weathering, Nature & Landscape, Cyberpunk & Neon, Values 0–100%).
- **Palette import and export**: support for loading and saving palettes in `.hex`, GIMP `.gpl`, Paint.NET text, and `.json` formats.
- **Floating Material Texture HUD**: dedicated floating HUD card in the bottom-right corner of the viewport when painting with an active texture, providing thumbnail preview, UV / Triplanar / Tip projection selector, tiling scale slider, and one-click return to solid color.
- **Reusable SolidJS UI component library**: created unified components in `src/renderer/src/components/ui/` (`Modal`, `Button`, `IconButton`, `Slider`, `SegmentedControl`, `SearchInput`, `PanelSection`, `DropdownMenu`, `Badge`, `Toast`, `ColorPicker`).

### Changed
- **TailwindCSS v4 migration**: modernized entire styling architecture with TailwindCSS, replacing over 10,000 lines of legacy monolithic CSS and dead styles with a clean, low-contrast neutral slate theme.
- **Standardized border radius**: unified border radiuses across all dialogs, cards, buttons, inputs, and tabs to 6px (`rounded-md`).
- Extended texture painting tiling scale range from `0x` up to `16x` across brush settings, status bar readouts, and hotkeys (`Shift + [` / `Shift + ]` and `Shift + Wheel`).
- Removed the symmetry mirror toggle from the Stroke Dynamics panel to declutter brush controls (symmetry remains easily accessible via top nav, pie menu, and `Alt+X`).
- Relocated "+ Add Layer" action directly into the right inspector section header and removed the redundant nested tab header bar in LayersTab.
- Moved the active 3D model name directly into the application window title bar, eliminating the floating center header box.
- Made color swatch buttons in palette grids compact (`w-6 h-6`) and renamed palette export action to "Export" to prevent text overflow.

### Fixed
- **Inverted Triplanar texture scaling**: Triplanar projection was dividing coordinates by `uTextureScale` instead of multiplying, causing higher scales to zoom into the texture while UV mode zoomed out; Triplanar now multiplies coordinates consistently with UV projection.
- **Paint color preview line artifact**: section header color preview collapsed into a thin 2px line in CSS; converted to an explicit circular color swatch.
- **Space radial menu auto-closing**: Space key was closing immediately on key release; converted into a toggle with a backdrop shield to prevent accidental closure while adjusting HUD controls.
- **Collapsible chevron click blocking**: removed pointer capture blockage from panel chevrons, allowing clicks directly on the chevron to toggle expansion.
- **Start Wizard completion freeze**: fixed modal `close()` guard that prevented the wizard from closing and resetting loading state upon successful project or model import.
- Handled async viewport initialization gracefully so early clicks during startup await viewport readiness rather than silently failing.
- **Paint bleeding through to occluded geometry behind the brushed face**: the paint shader only masked strokes by world-space distance and surface-normal facing, so a face directly behind the one under the cursor (e.g. an inner wall) got painted too if it happened to face the same general direction. Added a camera-space depth occlusion pass (`occlusionDepth.ts`) that rejects fragments not actually visible from the paint camera, comparing linear view-space depth (not raw NDC depth, whose precision collapses at typical painting distances) so occlusion is detected reliably regardless of camera distance.

## v1.0.2

### Added
- **Layer blend modes**: every standard blend mode (Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge/Burn, Hard/Soft Light, Difference, Exclusion, Linear Burn/Dodge, Subtract, Divide, Hue, Saturation, Color, Luminosity) via a proper per-pixel compositing shader, with full undo/redo support. Selectable from a compact dropdown on each (non-mask) layer row.

### Changed
- Redesigned layer cards: flatter surfaces, a left accent bar for the active layer instead of a glow/box-shadow, tighter icon and button sizing throughout, and better-aligned opacity/blend/action rows.
- Undo history snapshots moved from GPU render targets to CPU (system RAM) buffers, and the memory budget that caps history depth was raised accordingly (RAM tolerates overshoot far better than VRAM, with no driver-level context-loss risk).
- `recomposite()` (the per-layer compositing pass) now reuses persistent GPU objects instead of allocating a new Scene/Mesh/Material per layer per call — this ran on every paint dab and every opacity/visibility tick.
- Layer thumbnails now cache per layer and only re-render/re-encode when that specific layer's content actually changed, instead of regenerating every layer's thumbnail on any unrelated change.
- Opacity/visibility slider drags now record one undo step per gesture (on drag start) instead of one per tick.
- Texture Shelf is now virtualized — only the rows near the visible viewport are mounted, so a folder of thousands of textures loads and scrolls instantly instead of mounting/decoding every image up front.
- Several rarely-used modules (Help/Settings/New Project/Brush Manager modals, the Edge Wear Wizard, and the GLTF/OBJ model loaders) are now lazy-loaded instead of bundled into the app's initial parse, shaving real weight off boot time.
- Removed the Chromium flag that disabled the frame-rate limit — it was uncapping the render loop entirely, pinning the GPU at 100% even with a static scene at idle.
- `PaintEngine`'s coverage-mask GPU pass is now built lazily on first actual paint/fill/edge-wear, instead of for every layer at creation time.

### Fixed
- **Layers panel fully rebuilt itself on every change**: the layer list cloned a fresh object per layer on every update, which made Solid's reconciliation treat every row as brand-new and tear down/rebuild the entire panel's DOM (every card, thumbnail, and input) on any layer mutation — including mid-drag on the opacity slider, which silently ended the drag by replacing the element under the pointer. Layer objects are now stable references, so only what actually changed re-renders.
- A memory-budget floor for undo history could still force gigabyte-plus snapshots on a large canvas with several layers regardless of the configured cap, risking silent allocation failures — the cap is now purely budget-driven with a floor of 1.
- Several `LayerStack` mutators recorded an undo snapshot before checking whether the action would actually do anything, so an invalid/no-op call (e.g. a stale id) still consumed a history slot and a GPU/CPU snapshot.
- Selecting a texture while painting a mask layer reset paint color to white even though masks never use textures, silently changing the mask's hide/reveal color out from under the user.
- The "Used" texture tab tracked textures on mere selection (browsing) rather than actual use, and the README overstated its behavior; both now reflect real paint/stamp/fill usage.

## v1.0.1

### Added
- Undo/redo for every paint stroke, fill, and layer operation (`Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`), with a long GPU-snapshot history (up to 100 steps) and Edit menu entries.
- "Used" tab in the Texture Shelf showing recently painted/stamped/filled textures for quick re-selection, alongside "All".
- Background restore of the previous texture folder and brush presets after the app has fully booted, with a "Restoring session…" spinner instead of blocking startup.
- macOS builds added to CI (alongside existing Linux/Windows), producing signed-unsigned `.dmg`/`.zip` artifacts.

### Changed
- Selecting a texture now resets paint color to white, so tinting doesn't leak onto textures unexpectedly.
- Layers panel is now resizable (drag its bottom-right corner) and defaults to 40% of the right panel's height; it no longer scrolls out of view.
- Right panel is now always in split view (Brush Settings + Layers); the Brush/Layers/Split tab switcher was removed.
- Brush Settings panel scrolls independently of the Layers panel.
- "Stroke Dynamics" moved to the bottom of the Brush Settings panel.
- Mask workflow simplified: removed "Add New Mask" and "Add Mask Above" — a single toggle button now switches a layer between texture and mask mode. Masks no longer auto-attach to whatever layer happens to sit below them; a layer must be explicitly moved into position under a mask to clip to it.
- Removed several redundant/no-op UI elements: top-bar resolution readout, bottom-bar layer/light/wireframe indicators, and the left-toolbar color swatch (all duplicated controls that already exist elsewhere).
- Removed the "Brush Tips" quick-pick section from Brush Settings (redundant with the Brush Library modal).

### Fixed
- **Texture fill scale**: filling a face selection with a texture used a different scale convention than filling the whole model or painting with the brush, so the same scale value produced wildly different tile sizes depending on selection size. Fill now uses the same raw-UV tiling convention everywhere.
- **Paint bleeding across sharp edges**: painting near a cube corner or hard edge could smear full-strength paint onto the adjacent, near-perpendicular face. The brush's facing check now fades out smoothly instead of cutting off exactly at 90°, so edges no longer bleed.
- **Radial pie menu double-highlight**: a leftover CSS `:hover` rule and the angle-based hover calculation could disagree near sector boundaries, lighting up two tools at once. The CSS hover rule was removed so only the pointer-angle calculation drives the highlight; a stale-hover leak when the cursor left the wheel for the HUD card below was also fixed.
- **Radial pie menu mis-centering**: the menu's flex container had no explicit width, so its layout was stretched by the wider HUD card beneath it, shifting the wheel's visual center away from the cursor position the hover math was computed against. The wheel now renders exactly centered on the cursor.
- `vitest` exiting non-zero with no test files, failing CI before any tests exist.
