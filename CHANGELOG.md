# Changelog

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
