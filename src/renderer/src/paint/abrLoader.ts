import { readAbr, type SampleInfo } from 'ag-psd'

export interface AbrBrushPreset {
  id: string
  name: string
  width: number
  height: number
  spacing: number // fraction [0.02 .. 2.0]
  diameter: number // pixel size
  angle?: number
  dataUrl: string
  packName: string
  sampleId?: string
}

export interface AbrFileResult {
  fileName: string
  packName: string
  brushes: AbrBrushPreset[]
}

/** Converts an 8-bit alpha array into a PNG data URL (white RGB + alpha channel). */
export function sampleAlphaToDataUrl(w: number, h: number, alpha: Uint8Array): string {
  if (w <= 0 || h <= 0) return ''
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const imgData = ctx.createImageData(w, h)
  const data = imgData.data
  const total = w * h
  for (let i = 0; i < total; i++) {
    const a = alpha[i] ?? 0
    const idx = i * 4
    data[idx] = 255
    data[idx + 1] = 255
    data[idx + 2] = 255
    data[idx + 3] = a
  }
  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Procedurally generates a standard canvas brush tip texture. */
function generateProceduralTip(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void
): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  draw(ctx, size)
  return canvas.toDataURL('image/png')
}

/** Generates built-in standard brush presets available out of the box. */
export function getStandardBrushPresets(): AbrBrushPreset[] {
  const presets: AbrBrushPreset[] = [
    {
      id: 'std-soft-round',
      name: 'Soft Round',
      width: 128,
      height: 128,
      spacing: 0.15,
      diameter: 128,
      packName: 'Standard Tips',
      dataUrl: generateProceduralTip(128, (ctx, s) => {
        const rad = s / 2
        const grad = ctx.createRadialGradient(rad, rad, 0, rad, rad, rad)
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)')
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, s, s)
      })
    },
    {
      id: 'std-hard-round',
      name: 'Hard Round',
      width: 128,
      height: 128,
      spacing: 0.2,
      diameter: 128,
      packName: 'Standard Tips',
      dataUrl: generateProceduralTip(128, (ctx, s) => {
        const rad = s / 2
        ctx.beginPath()
        ctx.arc(rad, rad, rad - 2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 1)'
        ctx.fill()
      })
    },
    {
      id: 'std-chisel',
      name: 'Flat Chisel',
      width: 128,
      height: 128,
      spacing: 0.1,
      diameter: 128,
      packName: 'Standard Tips',
      dataUrl: generateProceduralTip(128, (ctx, s) => {
        ctx.translate(s / 2, s / 2)
        ctx.rotate((30 * Math.PI) / 180)
        ctx.fillStyle = 'rgba(255, 255, 255, 1)'
        ctx.beginPath()
        ctx.ellipse(0, 0, s * 0.42, s * 0.14, 0, 0, Math.PI * 2)
        ctx.fill()
      })
    },
    {
      id: 'std-spatter',
      name: 'Spatter & Spray',
      width: 128,
      height: 128,
      spacing: 0.35,
      diameter: 128,
      packName: 'Standard Tips',
      dataUrl: generateProceduralTip(128, (ctx, s) => {
        const rad = s / 2
        let seed = 42
        const rnd = () => {
          seed = (seed * 9301 + 49297) % 233280
          return seed / 233280
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        for (let i = 0; i < 90; i++) {
          const angle = rnd() * Math.PI * 2
          const r = Math.pow(rnd(), 1.5) * (rad * 0.88)
          const px = rad + Math.cos(angle) * r
          const py = rad + Math.sin(angle) * r
          const dotRadius = 1 + rnd() * 3.5
          ctx.beginPath()
          ctx.arc(px, py, dotRadius, 0, Math.PI * 2)
          ctx.fill()
        }
      })
    },
    {
      id: 'std-charcoal',
      name: 'Rough Chalk / Charcoal',
      width: 128,
      height: 128,
      spacing: 0.18,
      diameter: 128,
      packName: 'Standard Tips',
      dataUrl: generateProceduralTip(128, (ctx, s) => {
        const rad = s / 2
        let seed = 1337
        const rnd = () => {
          seed = (seed * 16807) % 2147483647
          return (seed - 1) / 2147483646
        }
        for (let y = 0; y < s; y += 2) {
          for (let x = 0; x < s; x += 2) {
            const dx = x - rad
            const dy = y - rad
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < rad * 0.9) {
              const falloff = 1 - dist / (rad * 0.9)
              const noise = rnd()
              if (noise > 0.35) {
                const alpha = Math.min(1, falloff * noise * 1.4)
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
                ctx.fillRect(x, y, 2, 2)
              }
            }
          }
        }
      })
    },
    {
      id: 'std-square',
      name: 'Square Block',
      width: 128,
      height: 128,
      spacing: 0.22,
      diameter: 128,
      packName: 'Standard Tips',
      dataUrl: generateProceduralTip(128, (ctx, s) => {
        const pad = s * 0.12
        ctx.fillStyle = 'rgba(255, 255, 255, 1)'
        ctx.fillRect(pad, pad, s - pad * 2, s - pad * 2)
      })
    }
  ]
  return presets
}

/** Fallback parser for legacy Photoshop v1/v2 ABR files. */
function parseLegacyAbr(buffer: Uint8Array, packName: string): AbrBrushPreset[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let offset = 0
  const version = view.getInt16(offset)
  offset += 2
  if (version !== 1 && version !== 2) return []

  const count = view.getInt16(offset)
  offset += 2
  const brushes: AbrBrushPreset[] = []

  for (let i = 0; i < count && offset < buffer.byteLength; i++) {
    const type = view.getInt16(offset)
    offset += 2
    const size = view.getUint32(offset)
    offset += 4
    const brushEnd = offset + size

    if (type === 2 && brushEnd <= buffer.byteLength) {
      offset += 4 // skip misc int32
      const spacingRaw = view.getInt16(offset)
      offset += 2
      offset += 2 // skip antialiasing
      const top = view.getInt16(offset)
      offset += 2
      const left = view.getInt16(offset)
      offset += 2
      const bottom = view.getInt16(offset)
      offset += 2
      const right = view.getInt16(offset)
      offset += 2
      const h = bottom - top
      const w = right - left

      if (w > 0 && h > 0) {
        offset += 4 // depth
        const compression = view.getUint8(offset)
        offset += 1

        const alpha = new Uint8Array(w * h)
        if (compression === 0) {
          const copyLen = Math.min(alpha.byteLength, buffer.byteLength - offset)
          alpha.set(buffer.subarray(offset, offset + copyLen))
        } else if (compression === 1) {
          offset += h * 2
          let outIdx = 0
          while (outIdx < alpha.length && offset < brushEnd) {
            const n = view.getInt8(offset++)
            if (n >= 0) {
              const countBytes = n + 1
              for (let k = 0; k < countBytes && outIdx < alpha.length; k++) {
                alpha[outIdx++] = view.getUint8(offset++)
              }
            } else if (n !== -128) {
              const countBytes = 1 - n
              const val = view.getUint8(offset++)
              for (let k = 0; k < countBytes && outIdx < alpha.length; k++) {
                alpha[outIdx++] = val
              }
            }
          }
        }

        const dataUrl = sampleAlphaToDataUrl(w, h, alpha)
        if (dataUrl) {
          brushes.push({
            id: `legacy-${i}-${w}x${h}`,
            name: `${packName} Brush ${i + 1}`,
            width: w,
            height: h,
            spacing: Math.max(0.02, Math.min(1.5, spacingRaw / 1000 || 0.25)),
            diameter: Math.max(w, h),
            dataUrl,
            packName
          })
        }
      }
    }
    offset = brushEnd
  }
  return brushes
}

/**
 * Parses an Adobe Photoshop .abr file buffer into structured brush presets.
 * Supports modern CS2-CC (v6-v10) and legacy Photoshop 7 (v1-v2) formats.
 */
export function parseAbr(
  buffer: ArrayBuffer | Uint8Array,
  fileName = 'Imported Brushes.abr'
): AbrFileResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const cleanPackName = fileName.replace(/\.abr$/i, '').trim() || 'Imported Brushes'
  const brushes: AbrBrushPreset[] = []

  try {
    const abr = readAbr(bytes)
    const sampleMap = new Map<string, { sample: SampleInfo; dataUrl: string }>()

    for (const sample of abr.samples) {
      const w = sample.bounds.w
      const h = sample.bounds.h
      if (w > 0 && h > 0) {
        const dataUrl = sampleAlphaToDataUrl(w, h, sample.alpha)
        if (dataUrl) {
          sampleMap.set(sample.id, { sample, dataUrl })
        }
      }
    }

    const matchedSampleIds = new Set<string>()

    // 1. Match with descriptor brushes when available
    if (abr.brushes && abr.brushes.length > 0) {
      for (let i = 0; i < abr.brushes.length; i++) {
        const b = abr.brushes[i]
        const shape = b.shape

        if (shape && shape.type === 'sampled') {
          const sampleDataId = shape.sampledData
          const matched = sampleMap.get(sampleDataId)

          if (matched) {
            matchedSampleIds.add(sampleDataId)
            const w = matched.sample.bounds.w
            const h = matched.sample.bounds.h
            const spacingVal =
              typeof b.spacing === 'number'
                ? b.spacing
                : typeof shape.spacing === 'number'
                  ? shape.spacing
                  : 0.25

            brushes.push({
              id: `abr-${i}-${sampleDataId}`,
              name: b.name || shape.name || `${cleanPackName} ${i + 1}`,
              width: w,
              height: h,
              spacing: Math.max(0.02, Math.min(1.5, spacingVal)),
              diameter: shape.size || Math.max(w, h),
              angle: shape.angle || 0,
              dataUrl: matched.dataUrl,
              packName: cleanPackName,
              sampleId: sampleDataId
            })
            continue
          }
        }

        // Computed brush shape in descriptor
        if (shape && shape.type === 'computed') {
          const size = shape.size || 64
          const hardness = shape.hardness ?? 0.8
          const spacingVal = typeof shape.spacing === 'number' ? shape.spacing : 0.25
          const dataUrl = generateProceduralTip(128, (ctx, s) => {
            const rad = s / 2
            const grad = ctx.createRadialGradient(rad, rad, 0, rad, rad, rad)
            grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
            grad.addColorStop(Math.min(0.95, hardness), 'rgba(255, 255, 255, 1)')
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
            ctx.fillStyle = grad
            ctx.fillRect(0, 0, s, s)
          })

          brushes.push({
            id: `abr-comp-${i}`,
            name: b.name || `Round ${Math.round(size)}px`,
            width: 128,
            height: 128,
            spacing: Math.max(0.02, Math.min(1.5, spacingVal)),
            diameter: size,
            angle: shape.angle || 0,
            dataUrl,
            packName: cleanPackName
          })
        }
      }
    }

    // 2. Add any unmatched samples (or all samples if brushes list was empty)
    let sampleIdx = 1
    for (const [id, { sample, dataUrl }] of sampleMap) {
      if (!matchedSampleIds.has(id)) {
        brushes.push({
          id: `sample-${id}`,
          name: `${cleanPackName} Tip ${sampleIdx++}`,
          width: sample.bounds.w,
          height: sample.bounds.h,
          spacing: 0.25,
          diameter: Math.max(sample.bounds.w, sample.bounds.h),
          dataUrl,
          packName: cleanPackName,
          sampleId: id
        })
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`ag-psd readAbr failed for ${fileName} (${msg}), trying legacy v1/v2 parser...`)
    const legacyBrushes = parseLegacyAbr(bytes, cleanPackName)
    if (legacyBrushes.length > 0) {
      brushes.push(...legacyBrushes)
    } else {
      console.error(`Failed to parse ABR file: ${fileName}`, err)
      throw new Error(`Unable to parse .abr file: ${msg}`)
    }
  }

  return {
    fileName,
    packName: cleanPackName,
    brushes
  }
}
