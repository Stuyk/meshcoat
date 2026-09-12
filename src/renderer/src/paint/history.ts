import { createSignal, type Accessor } from 'solid-js'
import type { LayerStack, StackSnapshot } from './layers'

/** Long history by design (per user spec) — capped only to bound memory, not to feel short. */
const MAX_HISTORY = 100
/** Each snapshot copies every layer's full-res texture — cap total GPU memory
 * spent on undo history (per stack) rather than a fixed entry count, since a
 * few layers at 8192px would otherwise happily allocate gigabytes. */
const MAX_HISTORY_BYTES = 768 * 1024 * 1024
const MIN_HISTORY = 10

/**
 * Undo/redo for a LayerStack. Records full GPU-side snapshots of every layer's
 * pixel content plus stack metadata (order, visibility, opacity, mask links).
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

  /** Call immediately before a mutation commits, to snapshot the pre-mutation state. */
  record(): void {
    for (const snap of this.redoStack) this.layerStack.disposeSnapshot(snap)
    this.redoStack = []
    this.undoStack.push(this.layerStack.captureState())

    const perSnapshotBytes = this.layerStack.layers.length * this.layerStack.textureSize ** 2 * 4
    const byteCap = Math.max(MIN_HISTORY, Math.floor(MAX_HISTORY_BYTES / Math.max(1, perSnapshotBytes)))
    const entryCap = Math.min(MAX_HISTORY, byteCap)
    while (this.undoStack.length > entryCap) {
      const dropped = this.undoStack.shift()
      if (dropped) this.layerStack.disposeSnapshot(dropped)
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
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(this.layerStack.captureState())
    this.layerStack.restoreState(prev)
    this.layerStack.disposeSnapshot(prev)
    this.bump()
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.layerStack.captureState())
    this.layerStack.restoreState(next)
    this.layerStack.disposeSnapshot(next)
    this.bump()
  }

  /** Drops all history (e.g. on loading a new model/project). */
  reset(): void {
    for (const snap of this.undoStack) this.layerStack.disposeSnapshot(snap)
    for (const snap of this.redoStack) this.layerStack.disposeSnapshot(snap)
    this.undoStack = []
    this.redoStack = []
    this.bump()
  }

  dispose(): void {
    this.reset()
  }
}
