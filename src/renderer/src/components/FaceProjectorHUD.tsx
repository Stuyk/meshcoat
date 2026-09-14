import type { JSX } from 'solid-js'
import { brush, setFaceProjection, resetFaceProjection } from '../paint/brush'
import { RefreshCwIcon, FocusIcon } from './icons'
import { Slider, Button, SegmentedControl, Label } from './ui'

export interface FaceProjectorHUDProps {
  /** Rendered inside the tool panel dock rather than floating over the viewport. */
  docked?: boolean
  /** Bakes the current texture + projection into the active layer, on the current face selection. */
  onApply: () => void
}

/**
 * TrenchBroom-style face texturing: with a face selection active, this places
 * the (optionally cropped) shelf texture on those faces with its own offset,
 * scale and rotation — independent of however the model's own UVs happen to
 * be laid out — instead of the fill tool's usual "start at the mesh's raw UV
 * origin" placement. Adjust the sliders, then Apply to bake it into the layer.
 */
export default function FaceProjectorHUD(props: FaceProjectorHUDProps): JSX.Element {
  const proj = (): ReturnType<typeof brush.faceProjection> => brush.faceProjection()

  return (
    <div
      class={
        props.docked
          ? 'w-full flex flex-col gap-2.5 select-none'
          : 'absolute bottom-4 right-[19.5rem] z-30 w-60 p-2.5 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-md shadow-2xl flex flex-col gap-2 select-none animate-in fade-in slide-in-from-bottom-2 duration-150'
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p class="text-[10px] text-zinc-500 leading-snug">
        Applies to the {brush.selectedFaces().size} selected face
        {brush.selectedFaces().size === 1 ? '' : 's'}. Placement is independent of the model's own
        UVs.
      </p>

      {/*
        Fit is the default because it is what the tool is usually for: one copy
        of the (cropped) texture stretched over the faces you picked, like a
        decal. Tile falls back to the shelf's tiling scale across the mesh's raw
        UV, which is what you want for a material rather than a picture.
      */}
      <Label
        uppercase
        description={
          proj().fit
            ? 'One copy stretched over the selection'
            : `Repeats at the shelf tiling scale (${brush.textureScale().toFixed(1)}x)`
        }
      >
        Placement
      </Label>
      <SegmentedControl
        size="xs"
        class="w-full"
        value={proj().fit ? 'fit' : 'tile'}
        options={[
          {
            value: 'fit',
            label: 'Fit to selection',
            title: 'Stretch one copy of the texture across the selected faces'
          },
          {
            value: 'tile',
            label: 'Tile',
            title: "Repeat the texture across the mesh's own UVs at the shelf tiling scale"
          }
        ]}
        onChange={(v) => setFaceProjection({ fit: v === 'fit' })}
      />

      <div class="grid grid-cols-2 gap-2">
        <Slider
          label="Offset X"
          value={proj().offsetX}
          min={-2}
          max={2}
          step={0.01}
          onChange={(v) => setFaceProjection({ offsetX: v })}
          displayValue={(v) => v.toFixed(2)}
        />
        <Slider
          label="Offset Y"
          value={proj().offsetY}
          min={-2}
          max={2}
          step={0.01}
          onChange={(v) => setFaceProjection({ offsetY: v })}
          displayValue={(v) => v.toFixed(2)}
        />
        <Slider
          label="Scale X"
          value={proj().scaleX}
          min={0.05}
          max={8}
          step={0.05}
          onChange={(v) => setFaceProjection({ scaleX: v })}
          displayValue={(v) => v.toFixed(2)}
        />
        <Slider
          label="Scale Y"
          value={proj().scaleY}
          min={0.05}
          max={8}
          step={0.05}
          onChange={(v) => setFaceProjection({ scaleY: v })}
          displayValue={(v) => v.toFixed(2)}
        />
      </div>

      <Slider
        label="Rotation"
        value={proj().rotation}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(v) => setFaceProjection({ rotation: v })}
        displayValue={(v) => `${Math.round(v)}°`}
      />

      <div class="flex items-center gap-1.5 pt-1">
        <Button variant="primary" size="sm" class="flex-1" onClick={props.onApply}>
          <FocusIcon size={12} />
          Apply to Selection
        </Button>
        <Button variant="ghost" size="sm" onClick={resetFaceProjection} title="Back to identity">
          <RefreshCwIcon size={12} />
        </Button>
      </div>
    </div>
  )
}
