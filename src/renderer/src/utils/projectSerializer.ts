import type { LayerStack, StackSnapshot } from '../paint/layers'
import type { CpuPixelSnapshot } from '../paint/paintEngine'
import type { BlendMode } from '../paint/blendShader'
import { PBR_CHANNELS, type PbrChannel } from '../paint/channels'

export interface SerializedLayer {
  id: number
  name: string
  visible: boolean
  opacity: number
  isMask?: boolean
  clippedToMaskId?: number
  blendMode?: BlendMode
  /** Base color. Named `dataUrl` since version 1, kept as-is so v1 files load. */
  dataUrl: string
  /**
   * PBR channels, present only for layers that carry them (version 2+). A
   * flat-texture project saves exactly the file it always did.
   */
  channelDataUrls?: Partial<Record<PbrChannel, string>>
}

/**
 * Project file format.
 *
 *   1 — base color only
 *   2 — adds per-layer PBR channels (roughness / metalness / normal)
 *   3 — one texture set per model piece (`pieces`)
 *
 * Older files load unchanged. A version 1/2 project is a single-piece project:
 * its top-level `layers` become piece 0, which is also why `layers`,
 * `textureSize` and `activeLayerId` are still written at the top level —
 * an older build opening a version 3 file still finds the first piece there.
 */
export const PROJECT_VERSION = 3

export interface SerializedPiece {
  /** Mesh name, used to match saved layers back onto the reloaded model. */
  name: string
  textureSize: number
  activeLayerId: number
  layers: SerializedLayer[]
}

export interface MeshCoatProject {
  version: number
  name: string
  modelPath: string | null
  modelName: string
  /** First piece's size; per-piece sizes live in `pieces`. */
  textureSize: number
  activeLayerId: number
  layers: SerializedLayer[]
  /** Present from version 3. Absent in older files, which have exactly one piece. */
  pieces?: SerializedPiece[]
  activePieceIndex?: number
  savedAt: number
}

/**
 * Encodes a CPU pixel snapshot into a standard PNG data URL.
 */
export function cpuSnapshotToDataUrl(snapshot: CpuPixelSnapshot): string {
  const { size, data } = snapshot
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return ''
  }

  const imgData = ctx.createImageData(size, size)
  imgData.data.set(data)
  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Decodes a PNG data URL back into a CPU pixel snapshot.
 */
export function dataUrlToCpuSnapshot(dataUrl: string, size: number): Promise<CpuPixelSnapshot> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to obtain 2d canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0, size, size)
      const imgData = ctx.getImageData(0, 0, size, size)
      resolve({
        size,
        data: new Uint8Array(imgData.data.buffer)
      })
    }
    img.onerror = () => reject(new Error('Failed to load layer image data URL'))
    img.src = dataUrl
  })
}

/** PNG-encodes whichever PBR channels a layer snapshot carries; undefined if none. */
function serializeChannels(
  snapshot: CpuPixelSnapshot
): Partial<Record<PbrChannel, string>> | undefined {
  if (!snapshot.channels) {
    return undefined
  }
  let out: Partial<Record<PbrChannel, string>> | undefined
  for (const channel of PBR_CHANNELS) {
    const data = snapshot.channels[channel]
    if (!data) {
      continue
    }
    out ??= {}
    out[channel] = cpuSnapshotToDataUrl({ size: snapshot.size, data })
  }
  return out
}

/**
 * Serializes the current project state (model metadata, layer stack, and compressed layer pixels)
 * into a JSON string.
 */
export function serializeProject(options: {
  modelPath: string | null
  modelName: string
  /** Every paintable piece, in model order. */
  pieces: { name: string; layerStack: LayerStack }[]
  activePieceIndex?: number
}): string {
  const { modelPath, modelName, pieces, activePieceIndex = 0 } = options

  const serializedPieces: SerializedPiece[] = pieces.map(({ name, layerStack }) => {
    const state = layerStack.captureState()
    return {
      name,
      textureSize: layerStack.textureSize,
      activeLayerId: state.activeId,
      layers: state.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        isMask: l.isMask,
        clippedToMaskId: l.clippedToMaskId,
        blendMode: l.blendMode,
        dataUrl: cpuSnapshotToDataUrl(l.pixels),
        channelDataUrls: serializeChannels(l.pixels)
      }))
    }
  })

  const first = serializedPieces[0]
  const project: MeshCoatProject = {
    version: PROJECT_VERSION,
    name: modelName,
    modelPath,
    modelName,
    textureSize: first?.textureSize ?? 2048,
    activeLayerId: first?.activeLayerId ?? 0,
    layers: first?.layers ?? [],
    pieces: serializedPieces,
    activePieceIndex,
    savedAt: Date.now()
  }

  return JSON.stringify(project)
}

/**
 * Deserializes a project JSON string and prepares a StackSnapshot ready to be restored
 * onto a LayerStack.
 */
export async function deserializeProject(
  jsonString: string
): Promise<{ project: MeshCoatProject; stackSnapshots: StackSnapshot[] }> {
  const project = JSON.parse(jsonString) as MeshCoatProject

  // A pre-version-3 file is a one-piece project stored at the top level.
  const pieces: SerializedPiece[] =
    project.pieces && project.pieces.length > 0
      ? project.pieces
      : [
          {
            name: project.modelName || project.name || 'Piece 1',
            textureSize: project.textureSize || 2048,
            activeLayerId: project.activeLayerId,
            layers: project.layers
          }
        ]

  for (const piece of pieces) {
    if (!piece.layers || !Array.isArray(piece.layers)) {
      throw new Error('Invalid project file: missing layer data')
    }
  }

  const stackSnapshots = await Promise.all(
    pieces.map(async (piece) => {
      const textureSize = piece.textureSize || project.textureSize || 2048
      const restoredLayers = await Promise.all(
        piece.layers.map(async (l) => {
          const pixels = await dataUrlToCpuSnapshot(l.dataUrl, textureSize)
          for (const channel of PBR_CHANNELS) {
            const url = l.channelDataUrls?.[channel]
            if (!url) {
              continue
            }
            const channelPixels = await dataUrlToCpuSnapshot(url, textureSize)
            pixels.channels ??= {}
            pixels.channels[channel] = channelPixels.data
          }
          return {
            id: l.id,
            name: l.name,
            visible: l.visible,
            opacity: l.opacity,
            isMask: l.isMask,
            clippedToMaskId: l.clippedToMaskId,
            blendMode: l.blendMode,
            pixels
          }
        })
      )
      const snapshot: StackSnapshot = {
        activeId: piece.activeLayerId,
        layers: restoredLayers
      }
      return snapshot
    })
  )

  project.pieces = pieces
  return { project, stackSnapshots }
}
