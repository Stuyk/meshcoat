import { Show, type JSX } from 'solid-js'
import { clone } from '../paint/clone'
import { Button, SegmentedControl, ToggleSwitch } from './ui'

/** Clone stamp settings. Size, hardness, opacity and tip come from the brush settings. */
export default function CloneHUD(props: { onClearSource: () => void }): JSX.Element {
  return (
    <div class="flex flex-col gap-3 p-3 text-xs">
      <SegmentedControl
        size="xs"
        options={[
          { value: 'all', label: 'All Layers', title: 'Copy what you see — the flattened stack' },
          { value: 'layer', label: 'Current Layer', title: 'Copy only the active layer' }
        ]}
        value={clone.sample()}
        onChange={clone.setSample}
        class="w-full justify-between"
      />
      <ToggleSwitch
        checked={clone.aligned()}
        onChange={clone.setAligned}
        label="Aligned"
        description="Each stroke carries on from where the last one left off"
      />
      <Show
        when={clone.hasSource()}
        fallback={
          <span class="text-[10px] text-amber-300/90 leading-snug">
            Alt+click the model to pick where to copy from.
          </span>
        }
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-[var(--text-muted)] leading-snug">
            Source set — Alt+click to move it.
          </span>
          <Button variant="outline" size="xs" onClick={props.onClearSource}>
            Clear
          </Button>
        </div>
      </Show>
      <span class="text-[10px] text-[var(--text-muted)] leading-snug">
        Copies in screen space, so it works across UV seams and between islands. Copies base color
        only.
      </span>
    </div>
  )
}
