# Changelog

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
