import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildUvLocator } from './uvLocator'

function quad(indexed: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]
  const uv = [0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5]
  if (indexed) {
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex([0, 1, 2, 0, 2, 3])
    return g
  }
  const order = [0, 1, 2, 0, 2, 3]
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      order.flatMap((i) => pos.slice(i * 3, i * 3 + 3)),
      3
    )
  )
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      order.flatMap((i) => uv.slice(i * 2, i * 2 + 2)),
      2
    )
  )
  return g
}

describe('buildUvLocator', () => {
  it.each([true, false])('finds the covering triangle (indexed=%s)', (indexed) => {
    const loc = buildUvLocator(quad(indexed))!
    const lower = loc.locate(0.4, 0.1)!
    expect(lower.face).toBe(0)
    const upper = loc.locate(0.1, 0.4)!
    expect(upper.face).toBe(1)
    const sum = upper.bary.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1)
  })

  it('returns null outside every island', () => {
    const loc = buildUvLocator(quad(true))!
    expect(loc.locate(0.9, 0.9)).toBeNull()
    expect(loc.locate(-0.1, 0.2)).toBeNull()
  })

  it('reconstructs position from barycentrics', () => {
    const g = quad(true)
    const loc = buildUvLocator(g)!
    const hit = loc.locate(0.25, 0.1)!
    const pos = g.getAttribute('position')
    const x = hit.vertices.reduce((acc, v, i) => acc + pos.getX(v) * hit.bary[i], 0)
    expect(x).toBeCloseTo(0.5)
  })
})
