import { For, Show, createSignal, createEffect, on, type JSX } from 'solid-js'
import { brush } from '../paint/brush'
import { groupsForPiece, deleteSelectionGroup, type SelectionGroup } from '../paint/selectionGroups'
import { Trash2Icon } from './icons'
import { Button, IconButton, TextInput } from './ui'

export interface SelectionGroupsPanelProps {
  /** Name of the active piece — groups are listed and saved against it. */
  pieceName: string
  onSave: (name: string) => void
  onRecall: (group: SelectionGroup) => void
}

/**
 * The Selections tab: names the current face selection and lists the groups
 * already saved on this piece, one click to bring each back.
 */
export default function SelectionGroupsPanel(props: SelectionGroupsPanelProps): JSX.Element {
  const [name, setName] = createSignal('')
  const groups = (): SelectionGroup[] => groupsForPiece(props.pieceName)
  const selectionCount = (): number => brush.selectedFaces().size

  // Suggest the next free name whenever the list or piece changes.
  createEffect(
    on([() => groups().length, () => props.pieceName], ([count]) =>
      setName(`Selection ${count + 1}`)
    )
  )

  const canSave = (): boolean => selectionCount() > 0 && name().trim().length > 0
  const overwrites = (): boolean => groups().some((g) => g.name === name().trim())

  function save(): void {
    if (canSave()) {
      props.onSave(name().trim())
    }
  }

  return (
    <div class="flex flex-col h-full text-xs">
      <div class="p-2.5 flex flex-col gap-1.5 border-b border-[var(--border-color)] shrink-0">
        <div class="flex items-center gap-1.5">
          <TextInput
            class="flex-1"
            size="xs"
            value={name()}
            onInput={setName}
            maxLength={64}
            placeholder="Group name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
          />
          <Button variant="primary" size="xs" disabled={!canSave()} onClick={save}>
            {overwrites() ? 'Overwrite' : 'Save'}
          </Button>
        </div>
        <span class="text-[11px] text-[var(--text-muted)]">
          {selectionCount() > 0
            ? `Saves the ${selectionCount()} selected face${selectionCount() === 1 ? '' : 's'}.`
            : 'Select faces (V, or Ctrl+drag) to save them as a group.'}
        </span>
      </div>

      <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        <Show
          when={groups().length > 0}
          fallback={
            <div class="p-2 text-[11px] text-[var(--text-muted)] italic">
              No saved groups on this piece yet.
            </div>
          }
        >
          <For each={groups()}>
            {(group) => (
              <div class="flex items-center gap-2 px-2 py-1 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] hover:border-[var(--accent-color)]/60">
                <button
                  type="button"
                  class="flex-1 min-w-0 text-left truncate text-[var(--text-main)] hover:text-[var(--accent-color)] cursor-pointer"
                  title="Reselect these faces"
                  onClick={() => props.onRecall(group)}
                >
                  {group.name}
                </button>
                <span class="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                  {group.faces.length}
                </span>
                <IconButton
                  size="xs"
                  variant="ghost"
                  title={`Delete ${group.name}`}
                  onClick={() => deleteSelectionGroup(group.name, group.piece)}
                >
                  <Trash2Icon size={12} class="text-[var(--text-muted)] hover:text-red-400" />
                </IconButton>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
