import { Show, type JSX } from 'solid-js'
import { lasso } from '../paint/pixelSelection'
import { Button, SegmentedControl } from './ui'

/**
 * Lasso tool settings. The selection itself lives on the active piece (see
 * pixelSelection.ts); this panel picks how the next shape is drawn and acts
 * on the one already made.
 */
export default function LassoHUD(props: {
  onInvert: () => void
  onClear: () => void
  onFill: () => void
}): JSX.Element {
  return (
    <div class="flex flex-col gap-3 p-3 text-xs">
      <SegmentedControl
        size="xs"
        options={[
          { value: 'freehand', label: 'Freehand', title: 'Drag a path; release to close it' },
          {
            value: 'polygon',
            label: 'Polygon',
            title: 'Click to place corners; double-click, Enter or click the first corner to close'
          }
        ]}
        value={lasso.shape()}
        onChange={lasso.setShape}
        class="w-full justify-between"
      />

      <div class="grid grid-cols-3 gap-1.5">
        <Button
          variant="outline"
          size="xs"
          onClick={props.onInvert}
          title="Select what isn't selected (Ctrl+I)"
        >
          Invert
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={!lasso.hasSelection()}
          onClick={props.onClear}
          title="Clear the selection (Ctrl+D)"
        >
          Clear
        </Button>
        <Button
          variant="accent"
          size="xs"
          disabled={!lasso.hasSelection()}
          onClick={props.onFill}
          title="Fill the selection on the active layer with the current color or texture"
        >
          Fill
        </Button>
      </div>

      <Show
        when={lasso.hasSelection()}
        fallback={
          <span class="text-[10px] text-[var(--text-muted)] leading-snug">
            Draw around the area to paint. The shape is cut into the model from this view, so only
            what you can see gets selected — orbit afterwards and it stays put.
          </span>
        }
      >
        <span class="text-[10px] text-[var(--text-muted)] leading-snug">
          Every tool paints only inside the selection. Shift adds to it, Ctrl subtracts, a plain
          click clears it.
        </span>
      </Show>
    </div>
  )
}
