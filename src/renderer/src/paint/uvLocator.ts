import * as THREE from 'three'

/**
 * Inverse of the UV unwrap: which triangle covers a given UV, and where on it.
 *
 * The 2D paint panel works in texture space, but every paint path in the app
 * is driven by a SurfaceHit (a world position + normal on the model, plus the
 * UV and face under it) — that's what the brush projector, the fill, the
 * eyedropper and face selection all consume. Mapping a UV back onto the
 * surface lets the 2D panel reuse all of them unchanged instead of growing a
 * second, texture-space copy of each tool.
 *
 * Overlapping UVs (mirrored halves sharing one island) are genuinely
 * ambiguous; the lowest-numbered triangle wins, which is also the one a paint
 * pass writes last, so what gets painted matches what the panel shows.
 */
export interface UvLocation {
  /** Triangle index, same numbering as SurfaceHit.faceIndex. */
  face: number
  /** Barycentric weights for the triangle's three corners. */
  bary: [number, number, number]
  /** Vertex indices of the three corners (after resolving the index buffer). */
  vertices: [number, number, number]
}

export interface UvLocator {
  locate(u: number, v: number): UvLocation | null
  faceCount: number
}

const GRID = 128
const cache = new WeakMap<THREE.BufferGeometry, UvLocator>()

export function getUvLocator(geometry: THREE.BufferGeometry): UvLocator | null {
  const cached = cache.get(geometry)
  if (cached) {
    return cached
  }
  const built = buildUvLocator(geometry)
  if (built) {
    cache.set(geometry, built)
  }
  return built
}

export function buildUvLocator(geometry: THREE.BufferGeometry): UvLocator | null {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) {
    return null
  }
  const index = geometry.index
  const faceCount = Math.floor((index ? index.count : uv.count) / 3)
  const vertexOf = (corner: number): number => (index ? index.getX(corner) : corner)

  // Buckets of triangles over the 0-1 square; UVs outside it (UDIM-style
  // offsets, tiling) are wrapped into it, the way the texture samples them.
  const buckets: number[][] = Array.from({ length: GRID * GRID }, () => [])
  const us = new Float32Array(faceCount * 3)
  const vs = new Float32Array(faceCount * 3)
  for (let f = 0; f < faceCount; f++) {
    let minU = Infinity
    let minV = Infinity
    let maxU = -Infinity
    let maxV = -Infinity
    for (let k = 0; k < 3; k++) {
      const vert = vertexOf(f * 3 + k)
      const u = uv.getX(vert)
      const v = uv.getY(vert)
      us[f * 3 + k] = u
      vs[f * 3 + k] = v
      minU = Math.min(minU, u)
      minV = Math.min(minV, v)
      maxU = Math.max(maxU, u)
      maxV = Math.max(maxV, v)
    }
    const x0 = Math.max(0, Math.floor(minU * GRID))
    const y0 = Math.max(0, Math.floor(minV * GRID))
    const x1 = Math.min(GRID - 1, Math.floor(maxU * GRID))
    const y1 = Math.min(GRID - 1, Math.floor(maxV * GRID))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        buckets[y * GRID + x].push(f)
      }
    }
  }

  return {
    faceCount,
    locate(u: number, v: number): UvLocation | null {
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) {
        return null
      }
      const bx = Math.min(GRID - 1, Math.floor(u * GRID))
      const by = Math.min(GRID - 1, Math.floor(v * GRID))
      // Small tolerance so a click exactly on a shared edge still lands.
      const eps = -1e-6
      for (const f of buckets[by * GRID + bx]) {
        const ax = us[f * 3]
        const ay = vs[f * 3]
        const v0x = us[f * 3 + 1] - ax
        const v0y = vs[f * 3 + 1] - ay
        const v1x = us[f * 3 + 2] - ax
        const v1y = vs[f * 3 + 2] - ay
        const v2x = u - ax
        const v2y = v - ay
        const den = v0x * v1y - v1x * v0y
        if (Math.abs(den) < 1e-14) {
          continue
        }
        const b1 = (v2x * v1y - v1x * v2y) / den
        const b2 = (v0x * v2y - v2x * v0y) / den
        const b0 = 1 - b1 - b2
        if (b0 >= eps && b1 >= eps && b2 >= eps) {
          return {
            face: f,
            bary: [b0, b1, b2],
            vertices: [vertexOf(f * 3), vertexOf(f * 3 + 1), vertexOf(f * 3 + 2)]
          }
        }
      }
      return null
    }
  }
}
