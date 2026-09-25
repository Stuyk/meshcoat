<p align="center">
  <img src="build/icon.png" alt="MeshCoat Icon" width="128" height="128" />
</p>

<h1 align="center">MeshCoat</h1>

<p align="center">
  <strong>Fast, focused 3D model texture painter for game developers and 3D artists.</strong>
</p>

<p align="center">
  <a href="https://github.com/stuyk/meshcoat/releases">
    <img src="https://img.shields.io/badge/Download-MeshCoat-0084ff?style=for-the-badge" alt="Download MeshCoat" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-GPL--3.0-10b981?style=for-the-badge" alt="GPL-3.0 License" />
  </a>
</p>

Most 3D texturing packages have turned into bloated, multi-gigabyte suites locked behind monthly subscriptions just to paint a texture on a low-poly mesh.

MeshCoat is fast, local-first, and free. Load your 3D model, pick your canvas resolution, and paint directly onto your mesh in seconds. No cloud accounts, no monthly fees, and zero telemetry. Just your models and your textures, 100% offline and yours to keep.

<p align="center">
  <img src="docs/screenshots/image2.png" alt="Painting a PBR material stroke on a 3D sphere in MeshCoat" width="49%" />
  <img src="docs/screenshots/image1.png" alt="PBR texture shelf drawer with automatic material set grouping" width="49%" />
</p>
<p align="center">
  <img src="docs/screenshots/image3.png" alt="Screen-space viewport stencil projection HUD" width="49%" />
  <img src="docs/screenshots/image5.png" alt="Unified texture export wizard with packed ORM maps" width="49%" />
</p>
<p align="center">
  <img src="docs/screenshots/image4.png" alt="Photoshop .ABR brush preset library manager" width="49%" />
</p>

---

## Core Capabilities

- **Simultaneous 4-Channel PBR Painting:** The brush is a *material brush*. Author **Base Color, Roughness, Metalness, and Tangent-Space Normal relief** in a single coordinated stroke. Gold is one brush (yellow albedo + 0.1 roughness + 1.0 metalness), never three separate passes to align by hand.
- **Hardware-Accelerated UV Projection:** Directional camera-space projection with depth testing and normal angle falloff. Paint projects directly onto UVs without bleeding through thin walls (ears, fingers, armor plates) or occluded backfaces.
- **Multi-Piece Models & Texture Sets:** Support for multi-mesh `.glb`, `.gltf`, and `.blend` files. Every submesh piece maintains an independent layer stack, canvas resolution, and 100-step undo history. Quickly isolate pieces to reach interior folds.
- **2D UV Canvas & Split View:** Pop out a dedicated 2D paint panel to paint pixel-exact dabs directly on the flattened UV unwrap with wireframe overlays and live texel density readouts.
- **Direct Blender 3D Bridge (`.blend`):** Directly open `.blend` files in MeshCoat via our built-in headless Blender CLI bridge. Re-import updated geometry seamlessly while retaining all paint layers.
- **Photoshop `.ABR` Brush Ingestion:** Load standard Photoshop `.abr` brush collections directly. Features tip previews, dynamic spacing, angle jitter, and automatic normal relief generation.
- **Face UV Projector (Trim Sheets):** TrenchBroom-style face texturing. Select polygon faces and project decals or trim sheets with live 3D preview, offset, rotation, and fit-to-selection scaling.
- **Procedural Curvature & Edge Wear:** Built-in curvature analysis engines. "Edge Wear" isolates convex ridges for paint chipping; "Crevice Dirt" targets concave folds for grime, grease, and ambient occlusion.
- **Screen-Space Viewport Stencil:** Pin any image to the camera viewport (the Mari/Mudbox workflow). Orbit your model beneath it and paint through it, or use "Stamp Onto Model" for instant decal application.
- **Packed ORM Game Engine Export:** One-click export for Unreal Engine 5, Unity (URP/HDRP), Godot 4, and glTF with automatically packed Occlusion-Roughness-Metallic maps.
- **Non-Destructive Layers & Masks:** Full layer stack with standard blend modes (Normal, Multiply, Screen, Overlay, etc.), opacity controls, and dedicated grayscale layer masks.
- **Clipboard Decal Ingestion (`Ctrl+V`):** Copy any screenshot or web crop and press `Ctrl+V` to paste it directly into your texture shelf or screen stencil without saving files to disk.
- **Symmetry & Mirror Painting:** Real-time mirror painting across X, Y, or Z axes with customizable plane offsets.
- **Wacom & Stylus Pressure:** Full graphics tablet support mapping pen pressure independently to brush radius, opacity, and hardness falloff.
- **100% Offline & Private:** Zero telemetry, no analytics, no network calls. Runs strictly on your local machine.

---

## Tool Suite

| Tool | Shortcut | Description |
| --- | --- | --- |
| **Brush** | `B` / `1` | Freehand 3D material painter. Writes BaseColor, Roughness, Metalness, and Normal relief simultaneously. Supports custom alphas, jitter, and stylus pressure. |
| **PBR Eraser** | `E` / `2` | Non-destructive coverage removal. Subtracts layer alpha to reveal underlying layers without corrupting PBR channels. |
| **Texture Stamp** | `T` / `3` | Single-dab decal projection. Places cropped textures or alphas onto 3D surfaces with rotation (`R`/`Shift+R`) and scale control. |
| **Fill Bucket** | `G` / `4` | Flood fill solid colors, cropped textures, or full PBR material sets across the model, face selections, or clicked triangles (with click-and-drag sweep filling). |
| **Line Tool** | `L` | Straight surface-interpolated lines. Walks screen space and raycasts back onto the mesh surface to prevent tunneling through curved geometry. |
| **Gradient Ramp** | `D` | Multi-stop color ramps painted directly onto the surface. Supports linear and radial ramps, unlimited color stops, opacity blending, and 45° Shift-snapping. |
| **Effects Brush** | `U` / `7` | Surface filter brush that reworks existing paint across four modes: Directional Smudge, Gaussian Blur, Sharpen, and retro PSX Pixelate. |
| **Eyedropper** | `I` / `5` | 3D surface sampler. Samples color and material parameters directly from the viewport, including from non-active mesh pieces. |
| **Face Selection** | `V` / `6` | Surface masking engine. Restricts painting and filling strictly to selected triangles. `Alt+Click` selects connected UV islands. |
| **Face UV Projector** | `P` / `8` | TrenchBroom-style face texturing. Projects texture regions onto selected faces with live lit 3D preview, offset, rotation, and fit-to-selection scaling. |
| **Text on Faces** | `Y` | Direct typography tool. Type text, choose installed system fonts with live search, configure fill and outline, and bake as decals onto faces. |
| **Screen Stencil** | `S` | Floating camera-plane stencil overlay. Paint through reference images onto your model or stamp decals in one pass without UV distortion. |
| **Edge Wear & Dirt** | *Panel* | Procedural mesh curvature analysis wizard. Generates realistic edge wear on convex ridges and crevice dirt in concave recesses with live 3D preview. |

---

## Game Engine Integration (Packed ORM)

MeshCoat automatically packages your authored channels into engine-standard packed textures on export (`Ctrl+E`):

```
┌────────────────────────────────────────────────────────┐
│                   PACKED ORM TEXTURE                   │
├───────────────────┬───────────────────┬────────────────┤
│    RED Channel    │   GREEN Channel   │  BLUE Channel  │
│ Ambient Occlusion │   Roughness Map   │ Metallic Mask  │
│   (Cavity / AO)   │  (Linear Scalar)  │ (Linear Mask)  │
└───────────────────┴───────────────────┴────────────────┘
```

- **Unreal Engine 5:** Plug `_ORM.png` directly into your material graph: Red &rarr; Ambient Occlusion, Green &rarr; Roughness, Blue &rarr; Metallic. Set Texture Group to *Masks (no sRGB)*.
- **Unity (URP / HDRP):** Compatible with the Universal Lit Mask Map format. Export packed ORM or individual unpacked channels matching your pipeline.
- **Godot 4.x:** Enable *Roughness > Texture Channel = Green* and *Metallic > Texture Channel = Blue* in `StandardMaterial3D` to use MeshCoat's ORM map with zero manual channel splitting.
- **Blender 3D:** Direct `.blend` integration via headless CLI bridge. Unpack ORM via a *Separate Color* node into Principled BSDF inputs.

---

## Supported File Formats

- **3D Models:** `.glb`, `.gltf`, `.obj`, `.blend` (via automatic Blender CLI bridge)
- **Texture Maps:** `.png`, `.jpg`, `.jpeg`, `.webp`, `.tga` (via built-in TGA loader)
- **Brush Packs:** Adobe Photoshop `.abr` brush libraries
- **Palettes:** `.hex`, GIMP `.gpl`, Paint.NET palette text, `.json`
- **Native Projects:** `.meshcoat` (full multi-piece PBR layer stacks with rolling backups)

---

## Complete Hotkey Reference

### Painting & Tool Selection
| Key | Action |
| --- | --- |
| `1` / `B` | Activate Brush tool |
| `2` / `E` | Activate PBR Eraser tool |
| `3` / `T` | Activate Texture Stamp tool |
| `4` / `G` | Activate Fill Bucket tool |
| `L` | Activate Line tool |
| `D` | Activate Gradient Ramp tool |
| `7` / `U` | Activate Effects Brush (Smudge, Blur, Sharpen, Pixelate) |
| `5` / `I` | Activate Eyedropper (sample color & material from surface) |
| `6` / `V` | Activate Face Selection mask tool |
| `P` / `8` | Activate Face UV Projector (trim-sheet placement) |
| `Y` | Activate Text on Faces tool |
| `S` | Toggle Screen-Space Stencil HUD |

### Brush Controls & Modifiers
| Key | Action |
| --- | --- |
| `[` / `]` | Decrease / increase brush radius (or tiling scale with Fill/Shift) |
| `RMB` + Drag X | Interactively resize brush radius in viewport |
| `Shift` + `RMB` + Drag Y | Interactively adjust brush opacity and hardness falloff |
| `Shift` + Click | Draw straight surface line from last dab (Brush, Stamp, Eraser) |
| `R` / `Shift` + `R` | Rotate brush tip or decal stamp &plusmn;15 degrees |
| `X` | Swap solid color and texture (on mask layer: black &harr; white) |
| `Alt` + `X` | Cycle symmetry mirror axis (Off &rarr; X &rarr; Y &rarr; Z) |
| `Ctrl` + `V` | Paste clipboard image directly into texture shelf or stencil |
| `Space` (Hold) | Open Radial Pie Menu at cursor for fast tool and color picks |

### Viewport Navigation
| Key | Action |
| --- | --- |
| `Alt` + `LMB` | Orbit 3D camera around pivot |
| `Alt` + `MMB` | Pan 3D camera in view plane |
| `Alt` + `RMB` or `Wheel` | Smooth zoom camera in / out |
| `F` | Frame model in view (or frame active face selection) |
| `W` | Toggle topology wireframe overlay |
| `Tab` / `Shift` + `Tab` | Switch to next / previous mesh piece (multi-piece models) |
| `Double Click` | Select the mesh piece directly under cursor |
| `C` | Toggle slide-out Tool Panel Dock |

### Selection & Project Management
| Key | Action |
| --- | --- |
| `Ctrl` + Click / Drag | Select / isolate faces on any active tool |
| `Ctrl` + `Shift` + Drag | Deselect faces on any active tool |
| `Alt` + Click | Select connected UV island (shared-edge topology) |
| `Ctrl` + `A` | Select all faces of the active mesh piece |
| `Ctrl` + `I` | Invert face selection mask |
| `Ctrl` + `D` / `Esc` | Clear active face selection mask |
| `Ctrl` + `N` | Open Welcome / Model & PBR Import Wizard |
| `Ctrl` + `O` | Open 3D model directly (`.glb`, `.gltf`, `.obj`, `.blend`) |
| `Ctrl` + `S` | Save MeshCoat project (`.meshcoat` with rolling backups) |
| `Ctrl` + `Shift` + `S` | Save MeshCoat Project As... |
| `Ctrl` + `E` | Open Unified Texture Export Wizard (PBR maps & packed ORM) |
| `Ctrl` + `Z` | Undo last stroke, fill, generator run, or layer edit (100 steps) |
| `Ctrl` + `Y` / `Ctrl+Shift+Z` | Redo previously undone operation |
| `?` | Open in-app Help, Hotkey search, and Documentation |

---

## Quick Start & Development

MeshCoat is built with TypeScript, Electron, Three.js, SolidJS, and Bun.

```bash
# Clone the repository
git clone https://github.com/stuyk/meshcoat.git
cd meshcoat

# Install dependencies with Bun
bun install

# Run in local development workstation mode
bun run dev
```

### Packaging Standalone Binaries

```bash
bun run build:linux  # AppImage, deb, tar.gz
bun run build:win    # NSIS installer, portable .exe
bun run build:mac    # DMG, zip
bun run build:all    # All target platforms
```

---

## Architecture & Stack

- **Runtime & Desktop Shell:** Electron 39, Node 22, Bun
- **Frontend & UI Layer:** SolidJS, Tailwind CSS v4, Lucide Icons
- **3D Graphics & Viewport:** Three.js, WebGL2, custom hardware UV projection GLSL shaders
- **Build System:** electron-vite, Vite, TypeScript

---

## License

MeshCoat is free software licensed under the **GNU General Public License v3.0 or later** (GPL-3.0-or-later). See [LICENSE](LICENSE) for details.