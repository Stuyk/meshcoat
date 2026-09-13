import { Show, createSignal, onCleanup } from 'solid-js'
import { brush, setTextureRegion, resetTextureRegion, type ToolMode } from '../paint/brush'
import { CropIcon, RefreshCwIcon, XIcon } from './icons'
import { IconButton, Slider, Label } from './ui'
import { toAssetUrl } from '../utils/assetUrl'

export interface TextureRegionHUDProps {
  /** Rendered inside the tool panel dock rather than floating over the viewport. */
  docked?: boolean
  activeTool: ToolMode
  onClose: () => void
}

type DragMode = 'move' | 'resize' | null

/**
 * Crops the source texture down to the part the brush should actually paint
 * with, live, without leaving the model.
 *
 * A texture sheet almost never holds one usable thing: a trim sheet is a dozen
 * plates, a scratch pack is forty scratches on one page. Picking a detail out
 * of it used to mean cutting a new file in an image editor and reloading the
 * shelf. The crop is applied in the paint shader (see uTextureRegion), so it
 * works for every textured tool — brush, stamp, line and fill alike — and can
 * be changed between strokes.
 */
export default function TextureRegionHUD(props: TextureRegionHUDProps) {
  let frameRef: HTMLDivElement | undefined
  const [drag, setDrag] = createSignal<DragMode>(null)

  const region = () => brush.textureRegion()

  /** Tools whose paint actually samples the shelf texture. */
  const isApplicable = (): boolean =>
    props.activeTool === 'brush' ||
    props.activeTool === 'stamp' ||
    props.activeTool === 'fill' ||
    props.activeTool === 'line'

  const isVisible = (): boolean => !!brush.texturePath() && isApplicable()

  function onPointerDown(mode: DragMode, e: PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setDrag(mode)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function onPointerMove(e: PointerEvent): void {
    const mode = drag()
    if (!mode || !frameRef) return
    const rect = frameRef.getBoundingClientRect()
    // Pointer position as a 0-1 coordinate inside the preview, which is the
    // same space the region itself is stored in — no conversion needed.
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    const r = region()

    if (mode === 'move') {
      setTextureRegion({ x: px - r.w / 2, y: py - r.h / 2 })
    } else {
      // Resize from the top-left anchor, so the corner handle follows the
      // pointer and the opposite corner stays put.
      setTextureRegion({ w: px - r.x, h: py - r.y })
    }
  }

  function onPointerUp(): void {
    setDrag(null)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  onCleanup(() => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  })

  /** Splits the sheet into an n x n grid and takes one cell — trim sheets are laid out like this. */
  function takeCell(cols: number, col: number, row: number): void {
    const size = 1 / cols
    setTextureRegion({ x: col * size, y: row * size, w: size, h: size, rotation: 0 })
  }

  return (
    <Show when={isVisible()}>
      <div
        class={
          props.docked
            ? // Docked: the dock owns the frame, so no card chrome of its own.
              'w-full flex flex-col gap-2.5 select-none'
            : 'absolute bottom-4 right-[19.5rem] z-30 w-60 p-2.5 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-md shadow-2xl flex flex-col gap-2 select-none animate-in fade-in slide-in-from-bottom-2 duration-150'
        }
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* The dock draws this panel's title, summary and actions in its own
            section header, so a second one here blurs where one panel ends
            and the next begins. */}
        <Show when={!props.docked}>
          {/* Header */}
          <div class="flex items-center justify-between pb-1.5 border-b border-zinc-800/80">
            <div class="flex items-center gap-1.5">
              <CropIcon size={13} class="text-teal-400" />
              <Label uppercase>Texture Region</Label>
            </div>
            <div class="flex items-center gap-0.5">
              <IconButton
                size="xs"
                variant="ghost"
                onClick={resetTextureRegion}
                title="Use the whole image again"
              >
                <RefreshCwIcon size={12} />
              </IconButton>
              <IconButton size="xs" variant="ghost" onClick={props.onClose} title="Hide this panel">
                <XIcon size={12} />
              </IconButton>
            </div>
          </div>
        </Show>

        {/* Interactive preview: drag the box to move it, the corner to resize. */}
        <div
          ref={frameRef}
          class="relative w-full aspect-square rounded overflow-hidden checkerboard-bg border border-zinc-750 cursor-crosshair"
          onPointerDown={(e) => {
            // Clicking empty space re-centres the crop there, which is quicker
            // than dragging across the sheet to reach a distant detail.
            if (!frameRef) return
            const rect = frameRef.getBoundingClientRect()
            setTextureRegion({
              x: (e.clientX - rect.left) / rect.width - region().w / 2,
              y: (e.clientY - rect.top) / rect.height - region().h / 2
            })
            onPointerDown('move', e)
          }}
        >
          {/* The sheet stays put — full brightness, never rotated. Only the
              selection box rotates over it, which is what "rotate the crop"
              means: the same pixels, sampled at an angle. Rotating the artwork
              instead would move every detail out from under the box. */}
          <img
            src={toAssetUrl(brush.texturePath()!)}
            alt="Brush texture"
            class="absolute inset-0 w-full h-full object-cover pointer-events-none"
            draggable={false}
          />

          {/* Selection box. Its huge outset shadow is what dims everything
              outside it, so the un-dimmed area is exactly the crop and follows
              the rotation for free — no second copy of the image to keep in
              sync. z-10 keeps the outline above the sheet. */}
          <div
            class="absolute z-10 border-2 border-teal-400 shadow-[0_0_0_9999px_rgba(9,9,11,0.62)] cursor-move"
            style={{
              left: `${region().x * 100}%`,
              top: `${region().y * 100}%`,
              width: `${region().w * 100}%`,
              height: `${region().h * 100}%`,
              transform: `rotate(${region().rotation}deg)`
            }}
            onPointerDown={(e) => onPointerDown('move', e)}
          >
            {/* Resize handle */}
            <div
              class="absolute z-20 -bottom-1.5 -right-1.5 w-3 h-3 rounded-sm bg-teal-400 border border-zinc-900 cursor-nwse-resize"
              onPointerDown={(e) => onPointerDown('resize', e)}
            />
          </div>
        </div>

        <Slider
          label="Rotation"
          value={region().rotation}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(v) => setTextureRegion({ rotation: v })}
          displayValue={(v) => `${Math.round(v)}°`}
        />

        {/* Grid quick-picks: a trim sheet or a stamp pack is laid out in cells,
            so slicing by 2x2 / 3x3 / 4x4 lands on one every time. */}
        <div class="flex items-center gap-1">
          <span class="text-[10px] text-zinc-500 uppercase tracking-wider mr-0.5">Grid</span>
          {[2, 3, 4].map((n) => (
            <button
              type="button"
              onClick={() => takeCell(n, 0, 0)}
              title={`Take the first cell of a ${n}x${n} grid, then drag it over the one you want`}
              class="flex-1 h-6 rounded bg-zinc-850 hover:bg-zinc-800 border border-zinc-700/80 text-[10px] text-zinc-300 transition-colors cursor-pointer"
            >
              {n}×{n}
            </button>
          ))}
          <span class="ml-1 font-mono text-[10px] text-zinc-500 tabular-nums">
            {Math.round(region().w * 100)}%
          </span>
        </div>
      </div>
    </Show>
  )
}
