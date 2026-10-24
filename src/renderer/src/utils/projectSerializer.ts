import type { LayerFolder, LayerStack, StackSnapshot } from '../paint/layers'
import type { CpuPixelSnapshot } from '../paint/paintEngine'
import type { BlendMode } from '../paint/blendShader'
import { PBR_CHANNELS, type PbrChannel } from '../paint/channels'
import { groupsForPiece } from '../paint/selectionGroups'

/** A PNG's place in a version 5 file's blob section (see `encodeProject`). */
export interface BlobRef {
  offset: number
  length: number
}

export interface SerializedLayer {
  id: number
  name: string
  visible: boolean
  opacity: number
  isMask?: boolean
  clippedToMaskId?: number
  blendMode?: BlendMode
  /** Layer folder id within the piece. Optional — absent in older files. */
  folderId?: number
  /** Base color as a PNG data URL — versions 1–4. Named `dataUrl` since version 1. */
  dataUrl?: string
  /**
   * PBR channels as PNG data URLs (versions 2–4), present only for layers
   * that carry them.
   */
  channelDataUrls?: Partial<Record<PbrChannel, string>>
  /** Base color PNG — version 5. */
  image?: BlobRef
  /** PBR channel PNGs — version 5, present only for layers that carry them. */
  channelImages?: Partial<Record<PbrChannel, BlobRef>>
}

/**
 * Project file format.
 *
 *   1 — base color only
 *   2 — adds per-layer PBR channels (roughness / metalness / normal)
 *   3 — one texture set per model piece (`pieces`)
 *   4 — UVs normalized to a bottom-left origin at import for every format
 *   5 — binary container: a JSON header plus raw PNG bytes (see `encodeProject`)
 *
 * Older files load unchanged. A version 1/2 project is a single-piece project:
 * its top-level `layers` become piece 0, which is also why `layers`,
 * `textureSize` and `activeLayerId` are still written at the top level —
 * an older build opening a version 3 file still finds the first piece there.
 *
 * Version 4 is the one break in that: a glTF-derived model (.glb/.gltf, and
 * .blend via the Blender bridge) used to keep glTF's top-down UVs, so anything
 * painted against it was stored vertically mirrored relative to the space this
 * build paints in. Those pieces are flipped back on load — see
 * `deserializeProject`. An .obj project was always bottom-up and is untouched.
 *
 * Version 5 changes the file itself rather than the model. Versions 1–4 were
 * one JSON document with every layer as a base64 PNG data URL, and piece 0's
 * layers written twice (top-level `layers` too, for older builds). That made
 * files a third larger than their pixels for the base64 alone and close to
 * double for single-piece projects, and a big project could pass V8's string
 * length limit and become unsaveable. Version 5 stores each PNG once, as raw
 * bytes, and leaves top-level `layers` empty — builds older than this one
 * can't open it, which is why the version changed.
 */
export const PROJECT_VERSION = 5

const MAGIC = 'MESHCOAT'
/** Layout version of the binary container, independent of PROJECT_VERSION. */
const CONTAINER_VERSION = 1
/** Magic + container version (u32) + header length (u32). */
const PREAMBLE_BYTES = MAGIC.length + 8

export interface SerializedPiece {
  /** Mesh name, used to match saved layers back onto the reloaded model. */
  name: string
  /** User display name for the piece. Optional — absent in older files. */
  alias?: string
  textureSize: number
  activeLayerId: number
  layers: SerializedLayer[]
  /** Named face selections on this piece. Optional — absent in older files. */
  selectionGroups?: { name: string; faces: number[] }[]
  /**
   * Layer folders on this piece. Optional — absent in older files, and ignored
   * by builds before folders, which open the same layers ungrouped.
   */
  folders?: LayerFolder[]
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
  /**
   * Other places the model has been found (#52): a project shared between
   * machines keeps every location it was relinked to, so it opens on each
   * without asking again. `modelPath` is always the one last used.
   */
  modelPathAlternates?: string[]
  savedAt: number
}

/** PNG-encodes a CPU pixel snapshot. Chromium encodes off the main thread, so a big save doesn't freeze input. */
async function encodePng(snapshot: CpuPixelSnapshot): Promise<Uint8Array> {
  const { size, data } = snapshot
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to obtain 2d canvas context')
  }
  const imgData = ctx.createImageData(size, size)
  imgData.data.set(data)
  ctx.putImageData(imgData, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Draws a decoded image into a `size`² pixel snapshot — resampling if the
 * image differs, and undoing the pre-version-4 UV flip when asked.
 */
function imageToCpuSnapshot(
  img: CanvasImageSource,
  size: number,
  /** Version 3 and older stored glTF-derived pieces in the old top-down UV space — see `deserializeProject`. */
  flipV: boolean,
  /** A tangent-space normal map's G channel encodes the V slope, so a vertical flip has to invert it too. */
  invertGreen: boolean
): CpuPixelSnapshot {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to obtain 2d canvas context')
  }
  if (flipV) {
    ctx.translate(0, size)
    ctx.scale(1, -1)
  }
  ctx.drawImage(img, 0, 0, size, size)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const imgData = ctx.getImageData(0, 0, size, size)
  if (flipV && invertGreen) {
    const px = imgData.data
    for (let i = 1; i < px.length; i += 4) {
      px[i] = 255 - px[i]
    }
  }
  return { size, data: new Uint8Array(imgData.data.buffer) }
}

/** Decodes a version 1–4 PNG data URL. */
function dataUrlToCpuSnapshot(
  dataUrl: string,
  size: number,
  flipV = false,
  invertGreen = false
): Promise<CpuPixelSnapshot> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        resolve(imageToCpuSnapshot(img, size, flipV, invertGreen))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('Failed to load layer image data URL'))
    img.src = dataUrl
  })
}

/** Decodes a version 5 PNG from the file's blob section. */
async function blobToCpuSnapshot(
  blobs: Uint8Array<ArrayBuffer>,
  ref: BlobRef,
  size: number
): Promise<CpuPixelSnapshot> {
  const bytes = blobs.subarray(ref.offset, ref.offset + ref.length)
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  try {
    return imageToCpuSnapshot(bitmap, size, false, false)
  } finally {
    bitmap.close()
  }
}

/** A project's metadata plus the pixels to go with it, before (or instead of) encoding. */
export interface CapturedProject {
  project: MeshCoatProject
  stackSnapshots: StackSnapshot[]
}

/**
 * Snapshots every piece's layers and metadata, synchronously — so the result
 * is one consistent moment even though encoding it happens later, while the
 * artist keeps painting. Snapshot buffers are never mutated after capture.
 *
 * Throws GpuContextLostError once the layers can no longer be read back.
 */
export function captureProject(options: {
  modelPath: string | null
  modelName: string
  /** Every paintable piece, in model order. */
  pieces: { name: string; alias?: string; layerStack: LayerStack }[]
  activePieceIndex?: number
  modelPathAlternates?: string[]
}): CapturedProject {
  const { modelPath, modelName, pieces, activePieceIndex = 0, modelPathAlternates } = options
  const stackSnapshots: StackSnapshot[] = []
  const serializedPieces: SerializedPiece[] = pieces.map(({ name, alias, layerStack }) => {
    const state = layerStack.captureState()
    stackSnapshots.push(state)
    return {
      name,
      alias,
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
        folderId: l.folderId
      })),
      folders: state.folders?.length ? state.folders : undefined,
      selectionGroups: groupsForPiece(name).map(({ name: groupName, faces }) => ({
        name: groupName,
        faces
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
    // Pieces carry the layers; see PROJECT_VERSION for why this stays empty.
    layers: [],
    pieces: serializedPieces,
    activePieceIndex,
    modelPathAlternates: modelPathAlternates?.length ? modelPathAlternates : undefined,
    savedAt: Date.now()
  }
  return { project, stackSnapshots }
}

/**
 * Encodes a captured project as a version 5 file, returned as the parts to
 * write in order (so it's never copied into one buffer):
 *
 *   "MESHCOAT" | u32 container version | u32 header length | header JSON | PNG blobs
 *
 * The header is the MeshCoatProject with each layer's PNGs referenced by
 * offset into the blob section. PNGs are encoded one at a time to keep peak
 * memory near one layer's worth.
 */
export async function encodeProject(captured: CapturedProject): Promise<Uint8Array[]> {
  const { project, stackSnapshots } = captured
  const blobs: Uint8Array[] = []
  let offset = 0
  const add = (png: Uint8Array): BlobRef => {
    blobs.push(png)
    const ref = { offset, length: png.byteLength }
    offset += png.byteLength
    return ref
  }

  const pieces: SerializedPiece[] = []
  for (let i = 0; i < (project.pieces ?? []).length; i++) {
    const piece = project.pieces![i]
    const snapshot = stackSnapshots[i]
    const layers: SerializedLayer[] = []
    for (let j = 0; j < piece.layers.length; j++) {
      layers.push(await encodeLayer(piece.layers[j], snapshot.layers[j].pixels, add))
    }
    pieces.push({ ...piece, layers })
  }

  const header = new TextEncoder().encode(JSON.stringify({ ...project, pieces }))
  const preamble = new Uint8Array(PREAMBLE_BYTES)
  preamble.set(new TextEncoder().encode(MAGIC), 0)
  const view = new DataView(preamble.buffer)
  view.setUint32(MAGIC.length, CONTAINER_VERSION, true)
  view.setUint32(MAGIC.length + 4, header.byteLength, true)
  return [preamble, header, ...blobs]
}

/** One layer's metadata plus refs to its freshly encoded PNGs. */
async function encodeLayer(
  meta: SerializedLayer,
  pixels: CpuPixelSnapshot,
  add: (png: Uint8Array) => BlobRef
): Promise<SerializedLayer> {
  const layer: SerializedLayer = { ...meta, image: add(await encodePng(pixels)) }
  for (const channel of PBR_CHANNELS) {
    const data = pixels.channels?.[channel]
    if (data) {
      layer.channelImages ??= {}
      layer.channelImages[channel] = add(await encodePng({ size: pixels.size, data }))
    }
  }
  return layer
}

/** Captures and encodes in one go — the capture still happens synchronously, on call. */
export function serializeProject(
  options: Parameters<typeof captureProject>[0]
): Promise<Uint8Array[]> {
  return encodeProject(captureProject(options))
}

function isBinaryProject(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PREAMBLE_BYTES) {
    return false
  }
  return new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) === MAGIC
}

/** Splits a version 5 file into its header and blob section. */
function parseBinary(bytes: Uint8Array<ArrayBuffer>): {
  project: MeshCoatProject
  blobs: Uint8Array<ArrayBuffer>
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const container = view.getUint32(MAGIC.length, true)
  if (container > CONTAINER_VERSION) {
    throw new Error('This project was saved by a newer version of MeshCoat.')
  }
  const headerLength = view.getUint32(MAGIC.length + 4, true)
  const headerEnd = PREAMBLE_BYTES + headerLength
  const project = JSON.parse(
    new TextDecoder().decode(bytes.subarray(PREAMBLE_BYTES, headerEnd))
  ) as MeshCoatProject
  return { project, blobs: bytes.subarray(headerEnd) }
}

/**
 * Just the project metadata (name, pieces, layer list) — cheap for a version
 * 5 file, which only parses its header. Older JSON files parse whole.
 */
export function readProjectHeader(input: ArrayBuffer): MeshCoatProject {
  const bytes = new Uint8Array(input)
  return isBinaryProject(bytes)
    ? parseBinary(bytes).project
    : (JSON.parse(new TextDecoder().decode(bytes)) as MeshCoatProject)
}

/**
 * Reads a project file — version 5 binary or an older JSON one — into
 * metadata plus StackSnapshots ready to restore onto LayerStacks.
 */
export async function deserializeProject(input: ArrayBuffer): Promise<CapturedProject> {
  const bytes = new Uint8Array(input)
  let project: MeshCoatProject
  let blobs: Uint8Array<ArrayBuffer> | null = null
  if (isBinaryProject(bytes)) {
    ;({ project, blobs } = parseBinary(bytes))
  } else {
    project = JSON.parse(new TextDecoder().decode(bytes)) as MeshCoatProject
  }

  // Pre-version-4 glTF-derived pieces were painted in glTF's top-down UV
  // space; this build normalizes every model to bottom-up at import, so their
  // stored pixels have to be flipped to match.
  const modelPath = (project.modelPath ?? '').toLowerCase()
  const flipV = (project.version ?? 1) < 4 && /\.(glb|gltf|blend)$/.test(modelPath)

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

  const decode = (
    layer: SerializedLayer,
    channel: PbrChannel | null,
    size: number
  ): Promise<CpuPixelSnapshot> | null => {
    const ref = channel ? layer.channelImages?.[channel] : layer.image
    if (ref && blobs) {
      return blobToCpuSnapshot(blobs, ref, size)
    }
    const url = channel ? layer.channelDataUrls?.[channel] : layer.dataUrl
    if (url) {
      return dataUrlToCpuSnapshot(url, size, flipV, channel === 'normal')
    }
    return null
  }

  const stackSnapshots = await Promise.all(
    pieces.map(async (piece) => {
      const textureSize = piece.textureSize || project.textureSize || 2048
      const restoredLayers = await Promise.all(
        piece.layers.map(async (l) => {
          const base = decode(l, null, textureSize)
          if (!base) {
            throw new Error(`Invalid project file: layer "${l.name}" has no pixels`)
          }
          const pixels = await base
          for (const channel of PBR_CHANNELS) {
            const channelPixels = decode(l, channel, textureSize)
            if (!channelPixels) {
              continue
            }
            pixels.channels ??= {}
            pixels.channels[channel] = (await channelPixels).data
          }
          return {
            id: l.id,
            name: l.name,
            visible: l.visible,
            opacity: l.opacity,
            isMask: l.isMask,
            clippedToMaskId: l.clippedToMaskId,
            blendMode: l.blendMode,
            folderId: l.folderId,
            pixels
          }
        })
      )
      const snapshot: StackSnapshot = {
        activeId: piece.activeLayerId,
        layers: restoredLayers,
        folders: piece.folders
      }
      return snapshot
    })
  )

  project.pieces = pieces
  return { project, stackSnapshots }
}
