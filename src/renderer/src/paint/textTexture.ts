/**
 * Renders a line (or several) of text into a transparent canvas and hands back
 * a data URL.
 *
 * Text on a model is just a decal, and the paint shader already treats a
 * texture's alpha as the decal's shape (see texSample.a in paintShader.ts).
 * So text needs no new paint path: draw the glyphs on a transparent canvas,
 * feed the result in as the brush texture, and the Face UV Projector places it
 * on the selected faces like any other image.
 */

export interface TextTextureOptions {
  text: string
  fontFamily: string
  /** Glyph height in canvas pixels — the texture is sized from it, not the other way round. */
  fontSize: number
  bold: boolean
  italic: boolean
  color: string
  /** Outline width in pixels; 0 draws no outline. */
  outlineWidth: number
  outlineColor: string
  /** Extra space between glyphs, in pixels. */
  letterSpacing: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
}

export interface TextTexture {
  dataUrl: string
  width: number
  height: number
}

export const DEFAULT_TEXT_OPTIONS: TextTextureOptions = {
  text: 'TEXT',
  fontFamily: 'Arial',
  fontSize: 128,
  bold: true,
  italic: false,
  color: '#ffffff',
  outlineWidth: 0,
  outlineColor: '#000000',
  letterSpacing: 0,
  lineHeight: 1.15,
  align: 'center'
}

/** Canvas-sized limit: a huge font on a long line would otherwise blow past GPU texture limits. */
const MAX_DIMENSION = 2048
/** Breathing room so an outline or a glyph's overhang isn't clipped at the edge. */
const PADDING = 0.25

function cssFont(options: TextTextureOptions): string {
  const style = options.italic ? 'italic ' : ''
  const weight = options.bold ? '700 ' : '400 '
  return `${style}${weight}${options.fontSize}px ${options.fontFamily}`
}

/**
 * Draws one line, glyph by glyph when letter spacing is in play. Canvas has a
 * `letterSpacing` property, but it is not universally supported and does not
 * feed back into measureText, so laying the glyphs out here keeps the measured
 * width and the drawn width the same number.
 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  spacing: number,
  stroke: boolean
): void {
  if (spacing === 0) {
    if (stroke) {
      ctx.strokeText(line, x, y)
    } else {
      ctx.fillText(line, x, y)
    }
    return
  }
  let cursor = x
  for (const char of line) {
    if (stroke) {
      ctx.strokeText(char, cursor, y)
    } else {
      ctx.fillText(char, cursor, y)
    }
    cursor += ctx.measureText(char).width + spacing
  }
}

function lineWidth(ctx: CanvasRenderingContext2D, line: string, spacing: number): number {
  if (spacing === 0) {
    return ctx.measureText(line).width
  }
  let width = 0
  for (const char of line) {
    width += ctx.measureText(char).width + spacing
  }
  return Math.max(0, width - spacing)
}

/**
 * Rasterizes `options.text`. Returns null for empty text — there is nothing to
 * paint with, and a zero-sized canvas is not a valid texture.
 */
export function renderTextTexture(options: TextTextureOptions): TextTexture | null {
  const lines = options.text.split('\n')
  if (options.text.trim().length === 0) {
    return null
  }

  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) {
    return null
  }
  measure.font = cssFont(options)
  const spacing = options.letterSpacing
  const widest = Math.max(...lines.map((line) => lineWidth(measure, line, spacing)))
  const lineStep = options.fontSize * options.lineHeight
  const pad = options.fontSize * PADDING + options.outlineWidth

  const width = Math.min(MAX_DIMENSION, Math.ceil(widest + pad * 2))
  const height = Math.min(MAX_DIMENSION, Math.ceil(lineStep * lines.length + pad * 2))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, width)
  canvas.height = Math.max(2, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  ctx.font = cssFont(options)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = options.color
  ctx.strokeStyle = options.outlineColor
  ctx.lineWidth = options.outlineWidth * 2
  ctx.lineJoin = 'round'

  lines.forEach((line, i) => {
    const w = lineWidth(ctx, line, spacing)
    const x =
      options.align === 'left'
        ? pad
        : options.align === 'right'
          ? canvas.width - pad - w
          : (canvas.width - w) / 2
    const y = pad + lineStep * (i + 0.5)
    if (options.outlineWidth > 0) {
      // Stroke first so the outline sits behind the fill rather than eating
      // half the glyph's weight.
      drawLine(ctx, line, x, y, spacing, true)
    }
    drawLine(ctx, line, x, y, spacing, false)
  })

  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}
