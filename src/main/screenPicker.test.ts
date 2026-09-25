import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, desktopCapturer: {}, screen: {} }))

const { sampleAround } = await import('./screenPicker')
type Capture = import('./screenPicker').Capture

/** A solid-color capture of one display, BGRA, optionally at a different pixel density. */
function solid(
  bounds: { x: number; y: number; width: number; height: number },
  rgb: [number, number, number],
  scale = 1
): Capture {
  const width = bounds.width * scale
  const height = bounds.height * scale
  const bitmap = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    bitmap[i * 4] = rgb[2]
    bitmap[i * 4 + 1] = rgb[1]
    bitmap[i * 4 + 2] = rgb[0]
    bitmap[i * 4 + 3] = 255
  }
  return { display: { bounds } as never, bitmap, width, height }
}

const center = (hex: string): string => hex.substr(Math.floor((15 * 15) / 2) * 6, 6)

describe('sampleAround', () => {
  const left = solid({ x: 0, y: 0, width: 2560, height: 1440 }, [255, 136, 0])
  const right = solid({ x: 2560, y: 0, width: 2560, height: 1440 }, [0, 136, 255])

  it('reads the monitor the cursor is on, for side-by-side displays', () => {
    expect(center(sampleAround([left, right], 100, 100)!)).toBe('ff8800')
    expect(center(sampleAround([left, right], 2600, 100)!)).toBe('0088ff')
    expect(center(sampleAround([left, right], 5119, 1439)!)).toBe('0088ff')
  })

  it('ignores capture order', () => {
    expect(center(sampleAround([right, left], 100, 100)!)).toBe('ff8800')
  })

  it('maps DIP to pixels on a scaled display', () => {
    const hidpi = solid({ x: -1280, y: 0, width: 1280, height: 720 }, [1, 2, 3], 2)
    // Paint one physical pixel and aim at it in DIP coordinates.
    const px = 400 * 2
    const py = 300 * 2
    const o = (py * hidpi.width + px) * 4
    hidpi.bitmap[o] = 0x33
    hidpi.bitmap[o + 1] = 0x22
    hidpi.bitmap[o + 2] = 0x11
    expect(center(sampleAround([hidpi, left], -1280 + 400, 300)!)).toBe('112233')
  })

  it('returns null off every display', () => {
    expect(sampleAround([left, right], 6000, 100)).toBeNull()
  })
})
