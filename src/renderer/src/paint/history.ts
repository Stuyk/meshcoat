import { createSignal, type Accessor } from 'solid-js'
import type { LayerStack, StackSnapshot } from './layers'
import { GpuContextLostError } from './gpuResources'

/** Long history by design (per user spec) — capped only to bound memory, not to feel short. */
const MAX_HISTORY = 100
/** Each snapshot holds every layer's full-res pixels in system RAM (see
 * PaintEngine.createCpuSnapshot(); layers that didn't change share buffers
 * with the previous entry) — cap total memory spent on undo history
 * (per stack) rather than a fixed entry count, since a few layers at 8192px
 * would otherwise happily allocate gigabytes.
 *
 * The cap is purely budget-driven with a floor of 1 (never *forced* higher
 * regardless of snapshot size) — a large canvas with many layers legitimately
 * gets a shorter history rather than blowing past the budget by multiples.
 * RAM tolerates that overshoot far better than VRAM ever did (no driver-level
 * context-loss risk, and the OS can page it out under pressure), which is why
 * this budget is set well above the old GPU-memory one. */
const MAX_HISTORY_BYTES = 3 * 1024 * 1024 * 1024

/**
 * Bytes actually held by a run of snapshots. A layer that didn't change
 * between records hands back the very same buffers (see
 * PaintEngine.createCpuSnapshot), so those are counted once — and every PBR
 * channel buffer is counted, not just base color.
 */
function historyBytes(snapshots: readonly StackSnapshot[]): number {
  const seen = new Set<Uint8Array>()
  let total = 0
  const add = (data: Uint8Array | undefined): void => {
    if (data && !seen.has(data)) {
      seen.add(data)
      total += data.byteLength
    }
  }
  for (const snapshot of snapshots) {
    for (const layer of snapshot.layers) {
      add(layer.pixels.data)
      for (const data of Object.values(layer.pixels.channels ?? {})) {
        add(data)
      }
    }
  }
  return total
}

/**
 * Undo/redo for a LayerStack. Records every layer's pixel content to a CPU
 * (system RAM) buffer plus stack metadata (order, visibility, opacity, mask
 * links) — kept off the GPU so a deep history on a large canvas competes for
 * plentiful system RAM instead of scarce, crash-prone VRAM.
 * `record()` must be called immediately before a mutation commits, since it
 * captures the *pre*-mutation state onto the undo stack.
 */
export class HistoryManager {
  private undoStack: StackSnapshot[] = []
  private redoStack: StackSnapshot[] = []
  private readonly versionSignal = createSignal(0)

  constructor(private readonly layerStack: LayerStack) {}

  /** Reactive counter that changes on every record/undo/redo — subscribe to refresh undo/redo UI state. */
  get version(): Accessor<number> {
    return this.versionSignal[0]
  }

  private bump(): void {
    this.versionSignal[1]((v) => v + 1)
  }

  /**
   * Snapshots the stack, or returns null once the GPU context is lost: the
   * pixels can't be read back any more, and a blank snapshot restored later
   * would wipe the layers.
   */
  private capture(): StackSnapshot | null {
    try {
      return this.layerStack.captureState()
    } catch (err) {
      if (err instanceof GpuContextLostError) {
        return null
      }
      throw err
    }
  }

  /** Call immediately before a mutation commits, to snapshot the pre-mutation state. */
  record(): void {
    const snapshot = this.capture()
    if (!snapshot) {
      return
    }
    for (const snap of this.redoStack) {
      this.layerStack.disposeSnapshot(snap)
    }
    this.redoStack = []
    this.undoStack.push(snapshot)

    // Never below one entry, regardless of how large a single snapshot is.
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > MAX_HISTORY || historyBytes(this.undoStack) > MAX_HISTORY_BYTES)
    ) {
      const dropped = this.undoStack.shift()
      if (dropped) {
        this.layerStack.disposeSnapshot(dropped)
      }
    }
    this.bump()
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  undo(): void {
    if (this.undoStack.length === 0) {
      return
    }
    const current = this.capture()
    if (!current) {
      return
    }
    const prev = this.undoStack.pop()!
    this.redoStack.push(current)
    this.layerStack.restoreState(prev)
    this.layerStack.disposeSnapshot(prev)
    this.bump()
  }

  redo(): void {
    if (this.redoStack.length === 0) {
      return
    }
    const current = this.capture()
    if (!current) {
      return
    }
    const next = this.redoStack.pop()!
    this.undoStack.push(current)
    this.layerStack.restoreState(next)
    this.layerStack.disposeSnapshot(next)
    this.bump()
  }

  /** Drops all history (e.g. on loading a new model/project). */
  reset(): void {
    for (const snap of this.undoStack) {
      this.layerStack.disposeSnapshot(snap)
    }
    for (const snap of this.redoStack) {
      this.layerStack.disposeSnapshot(snap)
    }
    this.undoStack = []
    this.redoStack = []
    this.bump()
  }

  dispose(): void {
    this.reset()
  }
}
