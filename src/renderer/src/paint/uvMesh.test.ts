import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { findUvIslandFaces } from './uvMesh'

/** Builds geometry from per-vertex position/uv lists, optionally indexed. */
function geo(positions: number[][], uvs: number[][], index?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2))
  if (index) {
    g.setIndex(index)
  }
  return g
}

describe('findUvIslandFaces', () => {
  it('follows the index buffer on indexed geometry', () => {
    // Two quads (4 triangles). Quad A at x 0-1, quad B at x 5-6, both mapped
    // to the same UV square — mirrored halves sharing one island layout.
    const positions = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [5, 0, 0],
      [6, 0, 0],
      [6, 1, 0],
      [5, 1, 0]
    ]
    const uvs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ]
    const g = geo(positions, uvs, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    expect(findUvIslandFaces(g, 0).sort()).toEqual([0, 1])
    expect(findUvIslandFaces(g, 3).sort()).toEqual([2, 3])
  })

  it('splits at a UV seam even where positions are shared', () => {
    // A strip of two quads sharing the x=1 edge in 3D, but the second quad's
    // UVs are elsewhere on the sheet.
    const positions = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [1, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
      [1, 1, 0]
    ]
    const uvs = [
      [0, 0],
      [0.4, 0],
      [0.4, 0.4],
      [0, 0.4],
      [0.6, 0.6],
      [1, 0.6],
      [1, 1],
      [0.6, 1]
    ]
    const g = geo(positions, uvs, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    expect(findUvIslandFaces(g, 1).sort()).toEqual([0, 1])
  })

  it('joins across an unwelded (non-indexed) shared edge', () => {
    const tri = (a: number[], b: number[], c: number[]): number[][] => [a, b, c]
    const p = tri([0, 0, 0], [1, 0, 0], [1, 1, 0]).concat(tri([0, 0, 0], [1, 1, 0], [0, 1, 0]))
    const u = tri([0, 0], [1, 0], [1, 1]).concat(tri([0, 0], [1, 1], [0, 1]))
    const g = geo(p, u)
    expect(findUvIslandFaces(g, 0).sort()).toEqual([0, 1])
  })
})
