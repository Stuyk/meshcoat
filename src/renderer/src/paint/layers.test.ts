import { describe, it, expect } from 'vitest'
import { LayerStack, type Layer } from './layers'

interface Spec {
  name: string
  mask?: boolean
  clip?: string
}

// Specs are listed top → bottom, matching the layers panel.
function makeStack(specs: Spec[]): LayerStack {
  const stack = Object.create(LayerStack.prototype) as LayerStack
  const bottomUp = [...specs].reverse()
  const ids = new Map(bottomUp.map((s, i) => [s.name, i + 1]))
  stack.layers = bottomUp.map(
    (s) =>
      ({
        id: ids.get(s.name)!,
        name: s.name,
        visible: true,
        opacity: 1,
        isMask: s.mask,
        clippedToMaskId: s.clip ? ids.get(s.clip) : undefined
      }) as unknown as Layer
  )
  ;(stack as unknown as { recomposite: () => void }).recomposite = () => {}
  return stack
}

function view(stack: LayerStack): string[] {
  const byId = new Map(stack.layers.map((l) => [l.id, l.name]))
  return [...stack.layers]
    .reverse()
    .map((l) => (l.clippedToMaskId ? `${l.name}>${byId.get(l.clippedToMaskId)}` : l.name))
}

function move(stack: LayerStack, name: string, dir: 'up' | 'down'): void {
  stack.moveLayer(stack.layers.find((l) => l.name === name)!.id, dir)
}

const group: Spec[] = [
  { name: 'Top' },
  { name: 'Mask', mask: true },
  { name: 'A', clip: 'Mask' },
  { name: 'B', clip: 'Mask' },
  { name: 'Base' }
]

describe('LayerStack.moveLayer', () => {
  it('moves a mask down together with its clipped layers', () => {
    const s = makeStack(group)
    move(s, 'Mask', 'down')
    expect(view(s)).toEqual(['Top', 'Base', 'Mask', 'A>Mask', 'B>Mask'])
  })

  it('moves a mask up together with its clipped layers', () => {
    const s = makeStack(group)
    move(s, 'Mask', 'up')
    expect(view(s)).toEqual(['Mask', 'A>Mask', 'B>Mask', 'Top', 'Base'])
  })

  it('moves a mask past a whole neighboring group', () => {
    const s = makeStack([
      { name: 'M1', mask: true },
      { name: 'A', clip: 'M1' },
      { name: 'M2', mask: true },
      { name: 'B', clip: 'M2' }
    ])
    move(s, 'M2', 'up')
    expect(view(s)).toEqual(['M2', 'B>M2', 'M1', 'A>M1'])
  })

  it('reorders clipped layers within their group', () => {
    const s = makeStack(group)
    move(s, 'A', 'down')
    expect(view(s)).toEqual(['Top', 'Mask', 'B>Mask', 'A>Mask', 'Base'])
  })

  it('leaves the group past its top and bottom edges', () => {
    const s = makeStack(group)
    move(s, 'A', 'up')
    expect(view(s)).toEqual(['Top', 'A', 'Mask', 'B>Mask', 'Base'])
    move(s, 'B', 'down')
    expect(view(s)).toEqual(['Top', 'A', 'Mask', 'B', 'Base'])
  })

  it('joins a group when a standalone layer moves into it', () => {
    const s = makeStack(group)
    move(s, 'Top', 'down')
    expect(view(s)).toEqual(['Mask', 'Top>Mask', 'A>Mask', 'B>Mask', 'Base'])
    move(s, 'Base', 'up')
    expect(view(s)).toEqual(['Mask', 'Top>Mask', 'A>Mask', 'B>Mask', 'Base>Mask'])
  })

  it('swaps standalone layers', () => {
    const s = makeStack([{ name: 'X' }, { name: 'Y' }])
    move(s, 'Y', 'up')
    expect(view(s)).toEqual(['Y', 'X'])
  })

  it('unclipping pulls the layer below the rest of its group', () => {
    const s = makeStack(group)
    s.setClipToMask(s.layers.find((l) => l.name === 'A')!.id, 0)
    expect(view(s)).toEqual(['Top', 'Mask', 'B>Mask', 'A', 'Base'])
  })
})
