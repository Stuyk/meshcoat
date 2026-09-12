# Changelog

## v1.2.0

### Added
- **Effects brush (`U`)** — one tool with four modes, since they share a dab footprint and differ only in the filter applied under it:
  - **Blur** — box filter over the texels beneath the dab.
  - **Sharpen** — unsharp mask, pushing each texel away from its blurred neighbourhood.
  - **Smudge** — drags color along the stroke. The pull direction comes from consecutive hit UVs (valid because the UV map is locally affine across a single dab), so it follows the hand rather than a fixed axis. A large UV jump means the stroke crossed an island seam, where dragging would smear two unrelated parts of the model together, so that step is dropped.
  - **Pixelate** — snaps to a block grid, sampling each block's center so the result stays stable as the brush passes over it instead of shimmering.

  It reworks paint already on the active layer rather than adding color, so the color and texture settings don't apply; radius, hardness, opacity, spacing, face selection and pen pressure all work as they do for the paint brush. Per-mode controls (strength, kernel radius, block size, drag length) appear in Brush Settings when the tool is active. Filtering happens in premultiplied alpha — the only space where averaging neighbouring texels is correct, since filtering straight-alpha color drags the meaningless RGB of fully transparent texels into the result and produces dark halos at every stroke and island edge.
- **Crevice / Cavity Dirt generator**: the Edge Wear Wizard gained a Generator switch — "Edge Wear" chips convex ridges and exposed corners as before, "Crevice Dirt" targets the *concave* edge population instead, settling grime and ambient shadow into interior folds and valleys. Convex and concave edges are disjoint sets of the same mesh edges, so `computeEdgeCurvature` now emits both a convex curvature and a concave one per edge and the shader picks between them. Four cavity presets ship with it: Ambient Occlusion, Crevice Dirt, Heavy Grime, and Cel Crease Shade. Open borders count as exposed ridges and are never treated as crevices.
- **Smoothness (AO Look) control** for both generators: at 100% the procedural noise drops out entirely and the falloff ramp squares, leaving a clean curvature gradient — an ambient-occlusion pass rather than grunge. Cavity presets lean smooth, wear presets stay noisy.
- **Screen-space stencil** (the Mari / Mudbox workflow), opened from the left toolbar: load an image that pins to the *viewport* rather than the surface, orbit the model underneath it, then either **Stamp Onto Model** to project it on in one shot or paint through it with the brush. Because the projection is fixed to the screen, photos and patterns land undistorted on curved geometry — the thing the tangent-space Stamp tool can't do. Brightness drives where paint lands (a cut-out PNG's alpha multiplies in), with an Invert toggle to paint through the dark areas instead. The stamp is a true decal pass: every visible texel inside the stencil rect takes the image at once, gated by the camera-visibility test so the projection can't wrap through the model and reprint itself mirrored on the far side, and confined by any active face selection. It can stamp the image's own colors and alpha (a photo or logo) or use its brightness as a mask and stamp the current paint color through it (plain black-and-white stencil artwork, which is opaque everywhere and would otherwise stamp as a solid rectangle). The panel carries size, rotation, overlay opacity, and a Transform Stencil mode in which dragging positions the sheet, the wheel scales it, and Shift+wheel rotates it. The DOM overlay and the paint shader are driven from the same rect, so what you line up is what paints.
- **Stylus / pen pressure sensitivity**: `PointerEvent.pressure` now maps to brush radius and opacity, each independently toggleable, with a Min Pressure Floor so a light touch still marks. Dab spacing follows the pressure-adjusted radius, so the thin part of a tapered stroke doesn't leave gaps sized for the full-pressure brush. Whether pressure applies is decided by `pointerType`, not by the pressure value — a mouse never scales, a pen always does. Tablets that report pressure 0 on the contact event itself have that sample skipped, so a stroke starts from the first reading that reflects what the artist actually pressed rather than opening with a full-strength dab.
- **Shift+click straight-line snapping** on the Brush, Eraser, and Stamp: connects the previous dab to the new click with an interpolated straight line, without switching to the Line tool. The interpolation walks *screen* space and raycasts each step back onto the mesh rather than lerping world positions — a world-space line would tunnel through curved geometry and paint the far side — so the line follows the surface being looked at and stops cleanly at silhouettes.

### Fixed
- **Undo/redo turned the whole model opaque black**. Three.js defines `OPAQUE` for any material with `transparent === false` and `blending === NormalBlending` — exactly `MeshBasicMaterial`'s defaults — and its `opaque_fragment` shader chunk then hard-sets `diffuseColor.a = 1.0`. Every layer copy went through such a material, so restoring a snapshot destroyed its alpha channel: transparent texels, stored premultiplied as `(0,0,0,0)`, came back as `(0,0,0,1)` — opaque black — turning each restored layer into a solid black sheet over everything beneath it. Layer copies now use a passthrough shader with `NoBlending`, which writes RGBA verbatim. The same corruption applied to the Edge Wear preview snapshot/revert path, which shared those helpers.

### Changed
- The brush's projector footprint and camera-visibility test now live in one shared GLSL module (`brushMask.ts`) used by both the paint shader and the new effects shader. These are the two pieces of this app that have been got wrong the most times; a second copy in a second shader would have drifted from the first the next time either was tuned. Behaviour is unchanged — same math, same uniform names.
- Layer copy/snapshot/restore now reuse persistent GPU objects instead of allocating a Scene, Mesh, and PlaneGeometry per call — undo and redo run one of these per layer, which adds up on a deep history at large canvas sizes.

## v1.1.1

### Added
- **Brush projector depth ("Depth (Bleed Through)" slider)**: controls how far a dab reaches along the surface normal, as a percentage of the brush radius (default 35%, presets Thin / Default / Wrap). Lower it when paint reaches the far side of a thin wall or the opposite fold of a crease; raise it to wrap further over sharp edges and tight curvature.
- **Brush "Max Angle" slider**: widest angle between the surface normal and the brush normal that still takes paint (default 85°), replacing the previous fixed facing cutoff. The contribution ramps to zero approaching the cutoff, so a stroke across curvature no longer shows a hard ring where it ends.
- **Fill tool "Fill Face" mode**: fill only the single clicked face instead of the whole model / active face selection, switchable from the floating HUD (which now also appears for the Fill tool with no texture selected). The status bar hint reflects the active mode.
- **Edge Wear "bake to new layer" live preview**: previewing in new-layer mode now composites a transient ghost layer on top rather than mutating the active layer, so what you see during preview is what gets committed.
- **Edge Wear new-layer background choice**: the baked layer can start transparent (default) or opaque black. Switching the target mode or background retriggers the live preview immediately.
- Paint diagnostics on the DevTools console: `slipDebug.uvOverlap()` reports what fraction of covered texels carry two or more triangles (overlapping/mirrored UVs mean two faces physically share texels — painting one necessarily paints the other, which looks like bleed-through but is a model problem), and `slipDebug.occlusion()` reports whether the occlusion depth pass is producing data.

### Changed
- The brush is now modeled as a **projector** rather than a sphere. Each texel is transformed into the brush's local frame (tangent/bitangent spanning the tangent plane, normal as the third axis); the round dab comes from the radial distance in that plane, and penetration is bounded separately along the normal. Radius and depth are now independent, which is what lets a wide brush paint a thin wall.
- The brush tangent basis is now computed on every dab, not only for stamps, tips, and rotated brushes — the projector bounds are evaluated in that frame, so a stale basis left from an earlier dab would misshape the dab and mis-measure its penetration.
- The occlusion depth pass was rebuilt (see Fixed) and is now the secondary visibility test, covering the case the projector bounds can't: a front-facing surface hidden behind another part of the model.
- Segmented control options now flex to fill their track and no longer wrap their labels.

### Fixed
- **Paint bleeding through to geometry behind the brushed face** (v1.1.0's fix was incomplete — it addressed visibility while leaving the underlying cause in place). The shader masked strokes by `length(worldPos - brushPos)`, a *sphere*: a sphere of radius r paints everything within r in every direction, so it unavoidably caught the far side of any shell thinner than r, the inside of any tube narrower than r, and the neighbouring fold of any crease. No visibility test can undo that, because from the brush's point of view those texels genuinely are in range. Bounding penetration along the surface normal separately from the dab radius removes the cause.
- **Occlusion depth pass rendered the entire scene**, including the brush cursor ring and tip quad (which sit exactly on the hit point), the face-highlight and wireframe overlays (children of the model mesh itself), the symmetry guide plane, and the grid. All of them wrote depth in front of the surface being painted, so the test rejected the very texels it was meant to allow. The pass now renders only the model meshes, hiding and restoring everything else.
- **Occlusion depth comparison was unreliable at any camera distance**: it reconstructed view-space Z from a non-linear 24-bit depth buffer spanning near 0.01 to far 1000, where a fixed bias is worth millimetres at one distance and metres at another. The pass now writes linear camera-space distance into a half-float target, so the comparison and its bias are both in world units. Unwritten texels clear to the far plane, so background can no longer read as an occluder, and the map matches the canvas aspect ratio so its texels line up with what the camera rasterized.
- **Symmetry strokes were rejected wholesale** once occlusion testing was active: the mirrored dab lands on the far side of the model, which is by definition not visible from the paint camera. Mirrored dabs now skip the camera visibility test.
- **Models with inverted normals would take no paint at all** under the camera-facing test. The sign is now derived per dab from the face actually under the cursor, which is demonstrably one the user can see.
- **Empty layers rendered opaque thumbnails**: the thumbnail pass inherited the renderer's ambient clear color (typically opaque black) instead of clearing transparent, so a layer with no content showed a solid filled square that implied it had some.
- Edge Wear texture scale defaulted to `1.0`, which read as an extreme zoom against the rest of the app's tiling convention; it now defaults to `8.0`.

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
