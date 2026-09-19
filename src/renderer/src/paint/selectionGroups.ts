import { createSignal } from 'solid-js'

/**
 * A face selection saved under a name, so a mask that took a minute of
 * Ctrl-dragging (the visor, the trim, the underside) comes back in one click.
 *
 * Face indices only mean something on the mesh they were picked on, so each
 * group remembers its piece by name — the same key the project file uses to
 * match saved layers back onto a reloaded model.
 */
export interface SelectionGroup {
  name: string
  piece: string
  faces: number[]
}

const [groups, setGroupsRaw] = createSignal<readonly SelectionGroup[]>([])

export const selectionGroups = groups

/** Groups saved against one piece, in the order they were made. */
export function groupsForPiece(piece: string): SelectionGroup[] {
  return groups().filter((g) => g.piece === piece)
}

/** Saves (or overwrites, by name within the piece) a selection group. */
export function saveSelectionGroup(name: string, piece: string, faces: Iterable<number>): void {
  const entry: SelectionGroup = {
    name,
    piece,
    faces: [...faces].sort((a, b) => a - b)
  }
  const rest = groups().filter((g) => !(g.piece === piece && g.name === name))
  setGroupsRaw([...rest, entry])
}

export function deleteSelectionGroup(name: string, piece: string): void {
  setGroupsRaw(groups().filter((g) => !(g.piece === piece && g.name === name)))
}

/** Replaces every group — used when a project loads or a new model replaces the old one. */
export function setSelectionGroups(next: SelectionGroup[]): void {
  setGroupsRaw(next)
}
