# Changelog

## v3.0.0

### Added
- **Gradient Tool (D)** ([#6](https://github.com/Stuyk/slip-texture-paint/issues/6)): Drag across the model to paint a color ramp onto whatever is visible under the line. Any number of stops with their own color, position and opacity; linear or radial; past the ends the ramp either extends or clips. Shift snaps to 45°. Uses the brush opacity and stays inside a face selection.
- **2D Paint Panel** ([#28](https://github.com/Stuyk/slip-texture-paint/issues/28)): A floating, resizable panel showing the active piece's texture laid flat with a UV wireframe overlay. Painting in it lays texture-space dabs — exact circles on the sheet, sized in pixels — with a brush ring cursor, size / opacity / hardness controls, pan and zoom, and a texel readout. Fill, eyedropper and face selection work there too.
- **Brush Randomness** ([#7](https://github.com/Stuyk/slip-texture-paint/issues/7), [#14](https://github.com/Stuyk/slip-texture-paint/issues/14)): Hue, saturation and lightness jitter join angle and size jitter, and a switch re-rolls the variation every dab or once per stroke. A Chaos toggle turns on a mix of all of them in one click.
- **Copy Layer to Another Piece** ([#21](https://github.com/Stuyk/slip-texture-paint/issues/21)): Copy a layer onto another piece of the model, with optional horizontal / vertical flips for mirrored UV islands. Lines up when both pieces share an unwrap; different texture sizes are resampled.
- **Hide Selection Highlight** ([#33](https://github.com/Stuyk/slip-texture-paint/issues/33)): An eye toggle beside the "masked" status chip hides the selection outline without clearing the selection, with a viewport banner while it's hidden. Any change to the selection shows it again.
- **Custom Palettes from Saved Colors** ([#30](https://github.com/Stuyk/slip-texture-paint/issues/30)): Saved colors and palettes now live in a global settings file instead of browser storage, and "To Palette" turns your saved colors into a named preset under My Palettes, which can be renamed or deleted.
- **Force Canvas Resolution on Import** ([#20](https://github.com/Stuyk/slip-texture-paint/issues/20)): An "Always use this resolution" option in the start wizard stops a model's existing material maps (typically a `.blend`'s) from overriding the chosen canvas size.

### Changed
- **Color Picker Redesign**: A taller color field, full-width hue slider, a hex field that also takes `rgb()`, `hsl()` and color names, labelled RGB/HSV value fields, and a before/after swatch that reverts on click. Everything stays inside its panel.
- **Wheel Menu Colors** ([#31](https://github.com/Stuyk/slip-texture-paint/issues/31)): The wheel menu shows your saved colors and a palette picker instead of a fixed color list.
- **Stencil Texture Search** ([#26](https://github.com/Stuyk/slip-texture-paint/issues/26)): The stencil panel's project textures are searchable and show a capped, lazily loaded result grid, and a button uses the brush's current texture as the stencil.
- **Resizable Sidebar and Layers** ([#22](https://github.com/Stuyk/slip-texture-paint/issues/22)): Drag the bar between brush settings and layers to resize the layers panel (double-click toggles half height), and drag the sidebar's left edge to widen it. Sizes are remembered.
- **Collapsible Stylus Settings**: Stylus pressure, projector depth and max angle live in a collapsible "Stylus & Projection" section.

- **Layout**: The texture drawer is now bottom bound. All panels are collapseable.

### Fixed
- **Color Picker Rejected Pasted Colors** ([#29](https://github.com/Stuyk/slip-texture-paint/issues/29)): The hex field truncated input to six characters and added a second `#`, so pasting `#ff0000` failed.
- **UV Island Selection Picked the Wrong Faces** ([#27](https://github.com/Stuyk/slip-texture-paint/issues/27)): Island detection assumed non-indexed geometry, which imported GLB and `.blend` models aren't. Islands are now found by shared edges, which also keeps mirrored and corner-touching islands apart.
- **Stencil Stamp Ignored Transparency** ([#19](https://github.com/Stuyk/slip-texture-paint/issues/19)): A brush-style PNG (black with the shape in alpha) stamped solid black, or not at all in Color Mask mode. Images with transparency now use it as their shape, and grayscale cut-outs switch to Color Mask automatically.
- **Stencil Stamp and Hidden Geometry** ([#25](https://github.com/Stuyk/slip-texture-paint/issues/25)): The occlusion pass drew back faces the viewport culls, so looking through a single-sided shell rejected the stamp on both surfaces. It now matches each mesh's own culling, and other visible pieces block the stamp as they block your view.

## v2.5.0

### Added
- **Layer Inspector**: Click a layer's thumbnail to pop that sheet out into its own window at full resolution — zoom, pan, and a readout of the texel and UV under the cursor. The panel header button does the same for the flattened result.
- **Fill Region Placement**: The Fill tool chooses whether the selected texture region covers the area being filled or tiles across it.
- **Fill Rotation**: Rotates the placed copy inside the filled area, with exact entry and quarter-turn snaps. Separate from the region's own rotation, which spins what the crop reads.

### Changed
- **Per-Tool Panels**: Each tool declares its own panel set instead of panels deciding from OR'd tool lists, so no tool inherits panels from another. Eyedropper and Face Select no longer show the stencil panel.
- **Modifiers Read as Modifiers**: The screen stencil and edge wear wizard moved out of the tool strip into their own group with an outlined toggle style, so an enabled stencil no longer looks like a second selected tool. The stencil button disables on tools that don't use it.

### Fixed
- **Fill Face Ignored the Texture Region**: Clicking to fill tiled the crop from the sheet's origin instead of fitting it to the face, so one region read differently from face to face. Viewport fills now use the same placement as the panel's Fill button.
- **Occlusion Depth Pass Included the Backdrop**: three renders `scene.background` through `overrideMaterial`, which filled the depth map at the backdrop's distance and quietly stopped the occlusion test rejecting anything near a silhouette.

## v2.4.0

### Added
- **Text Tool (Y)**: Select faces, type, and apply. Text renders to a transparent decal placed by the Face UV Projector. Font, alignment, bold/italic, spacing, fill, and outline, with a live preview. Baked into the layer, not re-editable.
- **Font Picker**: Modal listing the system's installed fonts, each previewed in its own face, with search.

### Fixed
- **Tool Panel Focus**: Panels no longer rebuild their DOM on every state change, which stole focus from fields while typing.
- **Brush Texture Memory**: The previous GPU texture is released on every texture swap.

## v2.3.0

### Added
- **Selection Groups**: Save face selections by name and reselect them from the new Selections tab. Stored in the project file.
- **Reload Model from Disk**: File menu option to re-import an edited model while keeping layers.
- **Texture Subfolders**: Texture folders load their subfolders, with a dropdown to filter by folder.
- **Nav Cube Snap**: Click a face of the top-right cube to snap the camera to that view.
- **Texture Region Angle Input**: Type an exact rotation or snap to 0°/90°/180°/-90°.

### Changed
- **Distinct Icons**: Material Channels, Edge Wear, and Brush Library each have their own icon.

## v2.2.4

### Fixed
- **Exported Textures Mirrored on glTF Models**: glTF puts the UV origin at the top-left, and a `.blend` inherits that through the Blender bridge — so a map painted on one exported vertically flipped against the source asset's own UVs. UVs are now normalized to a bottom-left origin at import, matching the space the app paints and exports in. Projects saved before this are migrated on load.

## v2.2.3

### Fixed
- **Layer Opacity Slider Contrast**: The slider track no longer matches the selected layer's background, so the filled portion is readable at a glance.
- **Recent Textures Cap**: The Used shelf keeps every texture painted with, instead of only the last five.
- **Reopening .blend Projects**: A `.meshcoat` project whose source model is a `.blend` now re-runs the Blender conversion on load instead of failing to open.
- **Large .abr Imports**: Brush samples are decoded only when a brush actually references them, rather than rasterizing the whole pack on import.

## v2.2.2

### Added
- **Brush Tip Support for Eraser, Stamp, and Effects Brushes**: Custom `.abr` and preset brush tips can now be selected and applied to the Eraser, Stamp, and Effects (Blur, Sharpen, Smudge, Pixelate) tools.
- **Unified 3D Reticle Silhouettes**: The 3D cursor reticle and mirror symmetry gizmo now display active brush tip outlines across all brush, stamp, eraser, and effects tools.
- **Docked Tool Panel Brush Access**: Added direct brush tip preview, reset, and library access buttons to the Effects Brush HUD and Material Texture / Stamp panels.
- **Expanded Bottom Dock Indicators**: Added hardness and rotation indicators to the bottom dock for Eraser and Effects tools.
- **Rotation Gizmo**: In the top right, introduced a 3D gizmo to grab and rotate. Handy for pen users.

### Fixed
- **Stamp Tool Falloff**: Fixed stamp mode falloff calculation to prevent untextured stamp dabs from flooding the mesh with flat color.
- **Stamp Reticle Orientation**: The stamp reticle now rotates in sync with brush angle adjustments.

## v2.2.0

A face-texturing release. The headline is the Face UV Projector — select faces, place a texture on them with its own offset, scale and rotation, and watch it on the model before committing — built for the trim-sheet and PSX-style workflows where a texture goes *on a face*, not across an unwrap. Alongside it, clipboard textures and a tool dock that no longer talks about panels you aren't using.

### Added
- **Face UV Projector** (`P` / `8`), a TrenchBroom-style face texturing tool. Select faces, pick a texture, and place it with its own offset, scale and rotation — independent of however the model's own UVs happen to be laid out — then Apply to Selection to bake it into the active layer. It gets its own toolbar button rather than being folded into Face Select or Fill: those tools' click behavior (paint, or start a fill drag) fights with "click a face to preview and place a texture on it", and hanging the panel off an unrelated tool's relevance made it appear and vanish unpredictably. The Texture Region and Material Texture panels both apply to it, so the crop picker, tiling and repeat controls work exactly as they do for every other textured tool.
- **Live 3D preview of the projected fill.** The placement shows on the selected faces themselves, through the same math the bake uses (`facePreviewShader.ts` mirrors the fill branch of `paintShader.ts`), so what you see before clicking Apply is what lands in the atlas after. It renders lit and tone-mapped like the rest of the model rather than as a flat swatch, and a "Preview — not applied yet" badge at the top of the viewport is what marks it unbaked — a dimmed render would just read as a bad texture.
- **Fit to selection**, the projector's default placement mode. One copy of the (cropped) texture is stretched across the selection's UV bounding box — "put this image on this face", which is what the tool is usually for. The alternative, **Tile**, is the old behavior: the crop repeats across the mesh's raw UVs at the shelf tiling scale, which is what a material wants rather than a picture. Fit bypasses the tiling scale, the crop's aspect correction (which would letterbox the stretch back out of the box you asked it to fill) and the repeat mode, clipping instead of wrapping once offset or scale push part of the copy past the edge. Its offset and scale sliders are inverted relative to Tile's, because they are sizing a visible decal rather than describing how much UV a copy covers — Scale X up makes the image bigger, Offset Y up moves it up.
- **Paste a texture from the clipboard.** A new **Pasted** tab in the texture shelf takes whatever image is on the system clipboard — a browser crop, a screenshot, a tile out of a reference sheet — with the Paste Image button or `Ctrl+V` while the tab is open, and selects it immediately. It stays a PNG data URL in memory with nothing written to disk, which every path that consumes a texture already accepts, so a pasted image is usable as a brush, stamp, fill or projector texture on arrival. Cards are labelled `Pasted N` with their pixel dimensions; the tab's trash button discards the selected one, or the whole tab when nothing is selected. Session-only and capped at 24, deliberately: this is the "get a 64x64 tile onto the model now" loop that PSX-style texturing lives on, not an asset library.

### Changed
- **The tool panel dock shows only what applies.** Panels that aren't relevant to the current tool and state are simply absent. They used to be listed dimmed at the bottom with the reason each was inactive — which in practice meant a permanent block of text about things you weren't doing, in a column whose whole job is the thing you are.
- **Face selection works under the projector tool.** Click and drag-select faces, shift-click to extend, and the hover outline behaves as it does under Face Select; `Alt` stays camera orbit rather than the eyedropper, same as Face Select.
- **No more `any` in the UI layer.** App, the status bar, and the Material Texture and Texture Region panels lost their untyped icon maps, `as any` segmented-control casts and untyped `window` globals in favour of real types, and the two silently-swallowed `catch {}` blocks now say what they're swallowing and why.

### Fixed
- **The Face UV Projector preview rendered almost black.** Four separate causes, each of which alone looked like the same bug: the preview mesh shares exact vertex positions with the model underneath, so roughly half its texels lost the depth test and showed the unlit surface instead; it drew as an unlit swatch through a tone-mapping curve tuned for lit PBR output, on a model where everything around it was shaded; a small on-screen selection made the GPU pick a heavily-downsampled mip level, averaging a busy texture down to a dark blob; and it blended with the surface beneath it. The preview is now a `MeshStandardMaterial` that takes the scene's lights, environment and tone mapping — with the model's own roughness, metalness and environment intensity copied onto it and the model's real (smooth) normals fed into the preview geometry, so it shades like the faces it covers instead of faceting against them — drawn without the depth test and sampled from a mipmap-less clone of the texture.
- **Pasted textures would have taken the recents list down with them.** The Used shelf persists to `localStorage`; a handful of base64 data URLs is megabytes and blows the quota, losing the whole list. Data and blob URLs are no longer recorded there.

## v2.1.0

A workspace and texture-painting pass: every floating panel moved into one dock, texture brushes gained a crop-and-repeat model that behaves the same on any model scale, and the bucket became the point-and-click tool it always should have been.

### Added
- **Tool panel dock.** Every panel that used to float over the viewport (Material Texture, Texture Region, Effects Brush, Screen Stencil) now lives in one slide-out column beside the brush settings, as accordion sections. Each picked its own corner before, overlapped the others and the model, and appeared or vanished on state the artist couldn't see; closing one was close to a one-way door. The dock shows the panels that apply to the current tool and state, open, with a live summary in each header (the texture's filename, the crop percentage, the effect mode), and lists the rest dimmed with the reason they're inactive rather than hiding them. Toggle the column with `C` or the header button; the Panels menu covers the same ground.
- **Texture region picker.** A dock panel that crops the source texture down to the part the brush should actually paint with, live, without leaving the model. Drag the box to move it, the corner handle to resize, a slider to rotate it, or slice the sheet into a 2x2 / 3x3 / 4x4 grid and take one cell. A texture sheet almost never holds one usable thing — a trim sheet is a dozen plates, a scratch pack is forty scratches on a page — and picking a detail out previously meant cutting a new file in an image editor and reloading the shelf. The crop lives in the paint shader, so it applies to every textured tool (brush, stamp, line and bucket fill) and to a material set's roughness/metalness/normal maps in register with its base color. Tiled modes repeat the crop as their own little pattern; a stamp or brush-tip decal clamps instead, since its 0-1 range is the decal's extent. Selecting a different texture resets the region, which only ever described the image it was drawn on.
- **Placement and Repeat modes for textured brushes**, replacing the old UV / Triplanar / Tip control, which named the implementation rather than the result. **Placement** is Surface (the picture lands on the surface you point at, following its UVs), World (pattern fixed in space, for dressing a whole model in a seamless material) or Cursor (one copy per dab, centred and rotated with the brush). **Repeat** is Tile, Mirror (every other copy flips, so a non-tiling crop has no seam) or Once (a single copy and nothing outside it — brush to reveal a decal, masked rather than clamped so border texels don't smear). Surface is now the default: world-aligned projection was, and it meant the brush revealed whatever part of the pattern happened to sit at that spot rather than painting the thing the artist picked. All repeat math happens in region space, so the selected crop is the unit that repeats and its corner is the tile origin.
- **Stencil from clipboard.** A button in the stencil panel (and `Ctrl+V` while it's open) loads whatever image is on the system clipboard — a browser crop, a screenshot, a render from another app — straight into the stencil, with no detour through a file on disk. It arrives as a PNG data URL, which every path that consumes a stencil already accepts, and drops into transform mode like any other freshly loaded stencil.
- **Frame the selection with `F`.** With faces selected, `F` (and the status bar's frame button) now frames those faces rather than the whole model — selecting a handful of triangles and pressing F almost always means "get me closer to those". Bounds come from the same local-space triangle buffer the highlight overlay uses, taken to world space through the piece's own matrix. A single flat triangle has almost no bounding radius, so the focus distance has a floor relative to the model size rather than dropping the camera inside the face.
- **Drag to fill faces.** In Fill Face mode, hold and sweep: every triangle the cursor crosses is filled. Each face fills once per drag (a drag streams the same triangle across many pointer samples, and each fill is a full render pass), and the whole sweep is a single undo step rather than one per face.
- **Model-relative brush size.** Brush radius is in world units, so its usable range depends entirely on how big the model is: 0.01 is a fine detail brush on a character and wider than the whole of a gemstone. The viewport now reports the model's radius to the brush, the slider's range and step derive from it, the presets are fractions (so "Medium" means the same thing on a gem and a building), and the current radius rescales when a model loads — no more landing on a brush that covers everything with the slider already bottomed out.
- **Bigger, clearer selection feedback.** WebGL cannot draw a line thicker than one pixel, so a face outline was all the emphasis a selection could get — against a painted texture, almost none. Hovered and selected faces now carry a translucent wash under a brighter outline, and both outlines draw without the depth test so they hold at full strength along curvature instead of dropping in and out.

### Changed
- **Simpler welcome wizard.** The import tab is now pick a model, pick a resolution, go. Existing PBR channel slots, the per-component mapping switcher and the texture shelf preload moved behind a collapsed "Advanced" disclosure — with a badge showing how many maps are assigned, so a user who never opens it still sees that maps came along, and automatic sibling-texture detection still runs and reports itself either way. The per-tab import button is gone; the footer button is the only one, and it carries the full label.
- **The bucket is a point-and-click tool.** Everything that shapes a dab — radius, hardness, stylus pressure, spacing, tip rotation, jitter — is hidden for the fill tool, and right-drag no longer resizes a radius nothing reads. The 3D reticle is gone too: the tool already has a mouse cursor of its own and the hovered-face outline shows what a click will affect, so a ring floating at the hit point was a third cursor for a tool with no footprint. That cursor is now a small dot rather than a 24px bucket illustration, which was hiding the very face being aimed at.
- **One accordion component.** `PanelSection` — already used by Brush Settings and Material Channels — gained the dock's card treatment (a gap between sections, a solid header bar with an accent edge, a body set darker than both) and optional controlled open state plus a live summary. The dock and the right-hand panels are now the same component and cannot drift apart.
- **Tiling scale is per placement, and stated in its own units.** "Scale" means repeats across the UV square in Surface placement and repeats per world unit in World placement; one number carried between them made a freshly chosen material look like it was not tiling at all. Each placement remembers its own value, and the slider label names the unit.
- **Texture names only, never paths.** Every texture label shows its filename. The previous code split paths on `/` alone, which left a Windows path (`C:\Users\me\textures\rock.png`) intact as the "filename" — so the texture shelf, the search filter, the stencil picker and the wear wizard all showed full paths on Windows while looking fine elsewhere.

### Fixed
- **The 3D cursor previewed the wrong image.** The brush-tip silhouette and the full-colour stamp ghost both showed the whole texture sheet while the stroke painted a cropped region of it, so a cropped stamp was aimed blind. Both now apply the same crop the paint shader does — the silhouette samples through it, and the colour ghost drives it through the texture's own offset/repeat/rotation, which three's built-in materials honour and the paint shader ignores, so the preview is cropped without changing a single painted texel.
- **Texture region Y was mirrored.** The picker measures y from the top of the image (how it is displayed); texture space measures v from the bottom, and an image loaded with flipY puts its top row at v = 1. The crop therefore sampled the mirrored row: drag the box over the top-left detail and the brush painted the bottom-left one. Converted once, where the region reaches the shader.
- **Duplicating a layer filled its background.** `copyOnto` cleared the destination buffer with whatever clear colour the renderer was last left with by some other pass. When that was opaque, the duplicate started as a solid sheet, and the premultiplied blend that follows only adds where the source has coverage — so the backing survived everywhere the original was transparent. Both copy paths (duplicate and merge down) now clear to transparent explicitly and restore the previous colour.
- **Adding a layer selected two layers at once.** Layer ids came from a module-level counter, which a hot reload resets while the live stack keeps its layers — handing a new layer the id the background already had, so both matched `activeId`. Ids are only ever compared within their own stack, so they are now derived from the layers present, which also cannot collide with the ids a restored project brings back.
- **Tool cursors left over from the previous tool.** Every branch of the gizmo update re-listed each preview mesh and hid the ones it did not want, so a tool that forgot one inherited it — which is how the fill bucket ended up wearing the brush's tip preview at a brush radius that means nothing to it. All previews are switched off once, then each tool turns on only what it needs.
- **Scale slider froze after choosing a material set.** `setTextureScale` read signals internally and is called from inside an effect, so that effect came to depend on the scale and reset it on every drag.
- **Menus painted underneath the floating panels.** The header is a flex item with its own z-index, which makes it a stacking context — so a `z-50` dropdown inside it composited as the header's z against its siblings. The header now sits above the panel column.

## v2.0.0

### Added
- **PBR material painting**, alongside — not instead of — the existing flat-texture workflow. The brush is a *material* brush in the Substance sense: one stroke writes every enabled channel at once and in perfect register, so gold is a single brush (yellow base color + 0.1 roughness + 1.0 metalness), not three passes to line up by hand.
  - **Four channels** — Base Color, Roughness, Metalness, and a tangent-space Normal map — each toggled independently in a new Material Channels panel, with value sliders and eight ready-made material presets (Polished Gold, Brushed Steel, Rusted Iron, Copper, Glossy Plastic, Matte Rubber, Rough Wood, Wet Clay).
  - **Relief from the dab itself.** The normal channel takes its slope from whatever shapes the stroke — a custom tip's alpha, a stamped image's alpha, or the round falloff when neither is set. The gradient is measured in the brush's own plane (which follows the cursor and rotates with the stroke) and then re-expressed in the mesh's UV tangent frame, which is the frame a tangent-space normal map is actually read in; without that conversion the relief would light as though pointing somewhere else entirely. Negative strength engraves instead of embossing.
  - **Lazy per-channel allocation.** A layer allocates a channel's ping-pong pair only when a stroke actually writes to it, and its undo snapshots carry only the channels it has. A flat-color project therefore costs exactly what it always did in both VRAM and undo depth, instead of paying four times over for channels nobody painted.
  - **Every existing tool is channel-aware**: brush, line, stamp, bucket fill (whole model and per-face), symmetry, face restriction, screen stencils, and the effects brush (which filters every channel a layer has, so a blurred stroke doesn't leave razor-sharp roughness underneath it). The eraser takes coverage back out of the PBR channels rather than stamping zeros over them. Mask layers stay grayscale coverage only, as before.
- **Image-based lighting.** A prefiltered `RoomEnvironment` is now the scene's environment map. Roughness and metalness are only legible against a varied environment — a metal surface renders as whatever it reflects, and under directional lights alone a painted metalness map would read as dark grey paint. Each lighting preset weights the environment differently; Flat mode keeps it low so raw texture color stays judgeable.
- **Showcase lighting mode**, a fourth preset for judging material response rather than form. Roughness and metalness are read off reflections — a metal shows whatever surrounds it, and gloss reads as how sharply those surroundings appear in the surface — so direct lights, which give a surface nothing to reflect but a few hot spots, are exactly the wrong rig for checking a PBR material. Showcase hands the lighting to the environment (2.4x) and drops the direct rig to a single raking key, kept only because a grazing angle is what makes normal-map relief legible; a darker ground keeps highlights from competing with the backdrop.
- **Channel view modes** in the top bar: the full shaded material, or one isolated map (Color / Rough / Metal / Normal) shown unlit and untone-mapped, so values can be read straight off the surface.
- **PBR texture set export** (File menu): one PNG per painted channel — `_BaseColor`, `_Roughness`, `_Metallic`, `_Normal` — plus the packed **ORM** map (R = ambient occlusion, G = roughness, B = metalness) that Unreal, Unity and glTF expect. Channels nobody painted are skipped rather than written out as flat defaults.
- **Painting with PBR texture sets.** A folder of loose files — `rock_BaseColor.png`, `rock_Roughness.png`, `rock_Normal.png` — is grouped back into the material it came from by filename convention, and shows in the shelf as one card badged with the channels it covers. Pick it and paint: every channel the set ships is written in one stroke, through the same projection, in register. There is nothing to configure — selecting a set switches its channels on, resets the value sliders to neutral, and sizes tiling to the model (the 8x pattern-stamp default packs a material into unreadable moiré on anything small). The sliders remain live as multipliers over the maps, and the channel switches now sit behind an Advanced disclosure rather than in the way. Suffix spellings from Substance, Quixel, Poliigon, ambientCG and Blender are all recognised; a lone suffixed file with no siblings stays the plain stamp image it is.
- **`.tga` texture support.** Chromium can't decode TGA in an `<img>`, so the shelf used to filter it out — which silently dropped the colour channel of any pack shipping a `.tga` albedo beside `.png` data maps. TGAs now load through three's `TGALoader` for painting, with the thumbnail borrowing a sibling map.

- **Direct Blender (`.blend`) File Import**:
  - Direct import of native `.blend` files through both the Welcome / Import Wizard and standard Open Model dialog (`Ctrl+O`).
  - **Headless Blender CLI Bridge**: runs background conversion via detected Blender binary (`--background --python-expr`) exporting evaluated geometries (including modifiers and tangent frames) to glTF 2.0 with Draco/MeshOptimizer compression support, importing directly into MeshCoat's multi-component PBR pipeline in milliseconds.
  - **Smart Blender Detection**: automatically detects Blender across standard installation paths, custom Linux programs folders (`~/programs/blender*`), PATH, macOS App bundles, and Windows Program Files.
  - **Blender 3D Bridge Settings**: user-configurable Blender executable path with instant version testing, auto-detect button, file system browser, and persistent storage in user preferences. Startup prompt alerts the user if Blender is not yet found, with a dismissible option.
- **Multi-piece model support**: models containing multiple distinct meshes/objects (characters with clothes/accessories, weapons, modular vehicles) are now partitioned into separate paintable pieces, each maintaining its own independent layer stack, resolution, and undo history:
  - **Quick Piece Switching**: toggle active pieces via `Tab` / `Shift+Tab`, through the dropdown in the top header or layer panel, or by double-clicking meshes directly in the 3D viewport.
  - **Isolate Active Piece (`EyeOff` button)**: hide unselected pieces to easily paint inside tight crevices or interior geometry without visual obstruction. Switching pieces while isolation is active automatically isolates the new selection.
- **Unified Texture Export Wizard (`Ctrl+Shift+E` / `Ctrl+E`)**:
  - Replaced fragmented File menu export options with a single, comprehensive export modal.
  - **Piece Export Modes**: supports exporting **Individual Pieces** (`[Model]_[Piece]_[Channel].png`) or a **Single Image (Shared UV / Atlas)** composite (`[Model]_[Channel].png`) across all pieces.
  - **Channel Selection & Presets**: individual toggles for Base Color, Packed ORM, Roughness, Metalness, and Normal maps, with one-click presets for *PBR + ORM*, *Color Only*, and *All Unpacked*.
  - **Resolution Overrides**: export at native resolution or rescale to 1024px, 2048px, or 4096px.
  - **Live Preview & Safety Tooltip**: live badge and filename list showing exact files to be written, paired with an engine workflow disclaimer.
- **Modernized Welcome & Import Wizard**:
  - Replaced legacy modal with a cohesive 3-tab layout: **Import 3D Model & PBR**, **Quick Start Primitives**, and **Recent Projects**.
  - **Multi-Component 3D Model Support**:
    - Automatically inspects model meshes upon file selection to detect single vs multi-piece models.
    - **Mode Switcher**: easily toggle between **Shared Texture Map (Single Atlas)** (maps one texture set across all model pieces) and **Per-Component Maps** (dedicated channel slots per mesh piece).
    - **Component Selector Pills**: fast navigation across model pieces (`[Body (3 maps)]`, `[Armor (2 maps)]`, `[Helmet]`) with quick "Copy to all components" action.
    - **Smart Component Auto-Discovery**: matches sibling texture filenames containing component names (e.g. `Character_Body_BaseColor.png` matches `Body`) and auto-assigns channels per piece.
  - **Full PBR Texture Ingestion**: dedicated channel slots for Base Color, Roughness, Metalness, Tangent Normal, and Packed ORM (Occlusion/Roughness/Metallic).
  - **Automatic Sibling Map Detection**: automatically inspects model directories on pick and auto-populates matching channel textures based on standard naming conventions (`_BaseColor`, `_Roughness`, `_Normal`, `_ORM`, etc.).
  - **Packed ORM Auto-Unpacking**: splits green (Roughness) and blue (Metalness) channels automatically from ORM maps upon model load.
  - **Interactive Previews**: live thumbnail previews for assigned texture slots with quick swap and remove controls.
  - **Quick Start Primitives**: one-click creation with resolution selectors for **UV Sphere** (equirectangular) and **UV Unwrapped Cube** (custom 6-face non-overlapping 3×2 island layout).
  - **Preload Texture Library Folder**: optional directory picker to populate the Texture Shelf with brush stamps and materials on project startup.
  - **Auto-Recovery Banner & Recents**: persistent autosave restoration with relative timestamps, layer count summaries, and clearable recent history.
- **Direct 3D Model Open (`Ctrl+O`)**: open 3D model files (`.glb`, `.gltf`, `.obj`) directly via shortcut or the File menu without needing to go through the Welcome Wizard.
- **Multi-tab Help & Documentation Modal (`?`)**:
  - **Keyboard Shortcuts**: categorized table with real-time search, badge filters, and updated hotkey listings.
  - **Documentation & Workflows**: comprehensive guides covering PBR Material Painting, Multi-Piece Meshes & Isolation, Procedural Edge Wear & Crevice Grime, Screen Stencil Projection, Effects Brush, and Texture Exporting.
- **Cast shadows in Showcase lighting.** The key light casts a soft PCF shadow onto an invisible ground catcher placed at the model's lowest point (not at y = 0, so a model authored off the origin still gets a contact shadow). The shadow camera and the catcher are refitted to the model's bounds on every load and framing, so the same rig works for a 0.1-unit prop and a 50-unit building. Shadows stay off in the working presets: a shadow darkens the very texels being judged, and the depth pass costs a second scene render every frame.
- **Recursive Flyout Submenus in Dropdown Menus**: `DropdownMenu` now supports nested `submenu` items with mouse hover bridges, `ChevronRightIcon` indicators, and section headers.

### Changed
- **Showcase is now the default lighting preset.** It is the rig that shows what was actually painted; the others are for working under.
- **Material and Color merged into one viewport view mode.** The shaded Material view already shows base color, lit, which is what painting is judged against — a separate Color button competed with it for no gain. The remaining isolated views are Rough, Metal and Normal; base color is still exported and stored as its own channel, and Flat lighting still gives unlit color.
- Project files are now **version 3**, carrying one texture set per model piece (`pieces`). Version 1 and 2 files load as a single-piece project, and piece 0 is still mirrored at the top level so an older build can open a version 3 file.
- Project files are now **version 2**, carrying per-layer PBR channels. Version 1 files load unchanged — their layers simply have no PBR channels, which is indistinguishable from a version 2 project nobody painted PBR into.
- **File Menu Layout**: redesigned to eliminate cramped and vertically wrapped text. Increased menu width (`min-w-[240px] w-max`), expanded item heights to `h-8` (32px), added `whitespace-nowrap` on all labels, and moved texture drawer management into a clean `Texture Library >` flyout submenu.
- Export pipeline now performs direct WebGL render target exports for single-piece native resolution passes, bypassing redundant offscreen canvas and image decode overhead.
- Removed outdated flat-color material presets in favor of clean channel controls and procedural textures.

### Fixed
- **Atlas export wrote only one piece.** A flat fill — every layer's background included — covers the whole UV square opaquely, so "Single Image (Shared UV)" stacked each piece's opaque sheet over the last and the file came out as whichever piece happened to be drawn last, usually a flat neutral square. Each piece is now clipped to its own UV coverage mask before compositing, with the untouched parts of the sheet resolving to the channel's neutral value (transparent base color, white roughness, black metalness, flat normal).
- **Imported base color maps were discarded.** The import wizard passed the base color as a channel map, but the paint shader samples base color only through the brush texture path — a `baseColor` entry in `channelMaps` is dropped by design — so an imported color map filled flat white. Base color now goes in as the fill's texture, at 1:1 UV scale, in its own pass so an albedo's alpha can't eat into the roughness/metalness/normal fill. Data maps are also forced to a linear color space, since decoding them as sRGB bends every value they carry.
- **Pieces sharing one material instance.** OBJ and glTF routinely export several objects against the same material, and each piece binds its own composite and channel maps to it — so the last piece built won and every other piece rendered someone else's texture, which read as "painting does nothing". Each piece now gets a private clone of its material.
- **Overlapping pieces blocked all paint.** The occlusion depth pass treated every piece as an occluder, so a part overlapping (or shelled over) the piece being painted rejected the whole stroke. The pass now captures only the active piece; a dab still can't wrap around the back of that piece.
- **Crash on launch after the showcase default landed** — the lighting preset was applied before the shadow catcher it configures had been declared.
- **Exporting images did nothing**: resolved lifecycle issue where `ExportWizardModal` mounted before `viewportHandle` was ready, causing export attempts to silently exit.
- **Chromium CORS error on data URL exports**: fixed `loadImage` in `exportTexture.ts` which erroneously set `crossOrigin = 'anonymous'` on `data:image/png` URLs, triggering CORS security failures during composite and ORM exports.


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
