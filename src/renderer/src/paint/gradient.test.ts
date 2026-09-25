import { describe, it, expect, beforeEach } from 'vitest'
import { gradient, normalizeStops } from './gradient'

describe('gradient stops', () => {
  beforeEach(() => {
    gradient.setStops([
      { color: '#ffffff', opacity: 1, position: 0 },
      { color: '#000000', opacity: 1, position: 1 }
    ])
  })

  it('normalizes and orders stops', () => {
    const out = normalizeStops([
      { color: 'F00', opacity: 2, position: 0.8 },
      { color: 'nope', opacity: 1, position: 0.1 },
      { color: '#00ff00', opacity: -1, position: -0.5 }
    ])
    expect(out).toEqual([
      { color: '#00ff00', opacity: 0, position: 0 },
      { color: '#ff0000', opacity: 1, position: 0.8 }
    ])
  })

  it('adds a stop in the widest gap', () => {
    gradient.addStop('#ff0000')
    const added = gradient.stops().find((s) => s.color === '#ff0000')
    expect(added?.position).toBeCloseTo(0.5)
  })

  it('keeps at least one stop', () => {
    gradient.removeStop(0)
    gradient.removeStop(0)
    expect(gradient.stops().length).toBe(1)
  })

  it('reverses positions', () => {
    gradient.reverseStops()
    const white = gradient.stops().find((s) => s.color === '#ffffff')
    expect(white?.position).toBe(1)
  })

  it('builds a css preview', () => {
    expect(gradient.cssGradient()).toBe(
      'linear-gradient(to right, rgba(255, 255, 255, 1) 0%, rgba(0, 0, 0, 1) 100%)'
    )
  })
})
