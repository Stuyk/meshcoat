import type { LayerStack, StackSnapshot } from '../paint/layers'
import type { CpuPixelSnapshot } from '../paint/paintEngine'
import type { BlendMode } from '../paint/blendShader'

export interface SerializedLayer {
  id: number
  name: string
  visible: boolean
  opacity: number
  isMask?: boolean
  clippedToMaskId?: number
  blendMode?: BlendMode
  dataUrl: string
}

export interface MeshCoatProject {
  version: 1
  name: string
  modelPath: string | null
  modelName: string
  textureSize: number
  activeLayerId: number
  layers: SerializedLayer[]
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
  if (!ctx) return ''

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

/**
 * Serializes the current project state (model metadata, layer stack, and compressed layer pixels)
 * into a JSON string.
 */
export function serializeProject(options: {
  modelPath: string | null
  modelName: string
  layerStack: LayerStack
}): string {
  const { modelPath, modelName, layerStack } = options
  const state = layerStack.captureState()

  const serializedLayers: SerializedLayer[] = state.layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    isMask: l.isMask,
    clippedToMaskId: l.clippedToMaskId,
    blendMode: l.blendMode,
    dataUrl: cpuSnapshotToDataUrl(l.pixels)
  }))

  const project: MeshCoatProject = {
    version: 1,
    name: modelName,
    modelPath,
    modelName,
    textureSize: layerStack.textureSize,
    activeLayerId: state.activeId,
    layers: serializedLayers,
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
): Promise<{ project: MeshCoatProject; stackSnapshot: StackSnapshot }> {
  const project = JSON.parse(jsonString) as MeshCoatProject
  if (!project.layers || !Array.isArray(project.layers)) {
    throw new Error('Invalid project file: missing layer data')
  }

  const textureSize = project.textureSize || 2048

  const restoredLayers = await Promise.all(
    project.layers.map(async (l) => {
      const pixels = await dataUrlToCpuSnapshot(l.dataUrl, textureSize)
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

  const stackSnapshot: StackSnapshot = {
    activeId: project.activeLayerId,
    layers: restoredLayers
  }

  return { project, stackSnapshot }
}
