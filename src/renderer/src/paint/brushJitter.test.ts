import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { brush } from './brush'

const hue = (c: THREE.Color): number => {
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return hsl.h * 360
}

describe('brush color jitter', () => {
  beforeEach(() => {
    brush.setColor('#cc4422')
    brush.setChaos(false)
    brush.setJitterScope('dab')
  })

  it('returns the plain color with no jitter', () => {
    expect(brush.jitteredColor().getHexString()).toBe(new THREE.Color('#cc4422').getHexString())
  })

  it('keeps one variation for the whole stroke in stroke scope', () => {
    brush.setHueJitter(1)
    brush.setJitterScope('stroke')
    brush.beginStrokeJitter()
    const a = brush.jitteredColor().getHexString()
    const b = brush.jitteredColor().getHexString()
    expect(a).toBe(b)
  })

  it('stays within ±60° of hue', () => {
    brush.setHueJitter(1)
    const base = hue(new THREE.Color('#cc4422'))
    for (let i = 0; i < 200; i++) {
      const d = Math.abs(((hue(brush.jitteredColor()) - base + 540) % 360) - 180)
      expect(d).toBeLessThanOrEqual(60.5)
    }
  })

  it('chaos turns jitters on and off', () => {
    brush.setChaos(true)
    expect(brush.chaosActive()).toBe(true)
    expect(brush.jitterScope()).toBe('stroke')
    brush.setChaos(false)
    expect(brush.chaosActive()).toBe(false)
  })
})
