import { describe, it, expect } from 'vitest'
import { LayerStack, type Layer } from './layers'

interface Spec {
  name: string
  mask?: boolean
  clip?: string
  /** Folder name; folders are created in the order first seen. */
  folder?: string
}

// Specs are listed top → bottom, matching the layers panel.
function makeStack(specs: Spec[]): LayerStack {
  const stack = Object.create(LayerStack.prototype) as LayerStack
  const bottomUp = [...specs].reverse()
  const ids = new Map(bottomUp.map((s, i) => [s.name, i + 1]))
  const folderIds = new Map<string, number>()
  for (const s of specs) {
    if (s.folder && !folderIds.has(s.folder)) {
      folderIds.set(s.folder, folderIds.size + 1)
    }
  }
  stack.layers = bottomUp.map(
    (s) =>
      ({
        id: ids.get(s.name)!,
        name: s.name,
        visible: true,
        opacity: 1,
        isMask: s.mask,
        clippedToMaskId: s.clip ? ids.get(s.clip) : undefined,
        folderId: s.folder ? folderIds.get(s.folder) : undefined,
        engine: { dispose: () => {} }
      }) as unknown as Layer
  )
  stack.folders = [...folderIds].map(([name, id]) => ({ id, name, visible: true, opacity: 1 }))
  stack.activeId = stack.layers[0].id
  ;(stack as unknown as { recomposite: () => void }).recomposite = () => {}
  return stack
}

function view(stack: LayerStack): string[] {
  const byId = new Map(stack.layers.map((l) => [l.id, l.name]))
  const folderName = new Map((stack.folders ?? []).map((f) => [f.id, f.name]))
  return [...stack.layers].reverse().map((l) => {
    const name = l.clippedToMaskId ? `${l.name}>${byId.get(l.clippedToMaskId)}` : l.name
    return l.folderId !== undefined ? `${folderName.get(l.folderId)}/${name}` : name
  })
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

const foldered: Spec[] = [
  { name: 'Top' },
  { name: 'F1', folder: 'Dirt' },
  { name: 'Mask', mask: true, folder: 'Dirt' },
  { name: 'A', clip: 'Mask', folder: 'Dirt' },
  { name: 'Base' }
]

function id(stack: LayerStack, name: string): number {
  return stack.layers.find((l) => l.name === name)!.id
}

describe('LayerStack folders', () => {
  it('a layer at the folder edge steps out before it moves', () => {
    const s = makeStack(foldered)
    move(s, 'F1', 'up')
    expect(view(s)).toEqual(['Top', 'F1', 'Dirt/Mask', 'Dirt/A>Mask', 'Base'])
  })

  it('a mask group at the folder edge steps out as a whole', () => {
    const s = makeStack(foldered)
    move(s, 'Mask', 'down')
    expect(view(s)).toEqual(['Top', 'Dirt/F1', 'Mask', 'A>Mask', 'Base'])
  })

  it('a layer beside a folder steps into it', () => {
    const s = makeStack(foldered)
    move(s, 'Top', 'down')
    expect(view(s)).toEqual(['Dirt/Top', 'Dirt/F1', 'Dirt/Mask', 'Dirt/A>Mask', 'Base'])
    move(s, 'Base', 'up')
    expect(view(s)).toEqual(['Dirt/Top', 'Dirt/F1', 'Dirt/Mask', 'Dirt/A>Mask', 'Dirt/Base'])
  })

  it('moves a folder past its neighbors as one block', () => {
    const s = makeStack(foldered)
    s.moveFolder(s.folders[0].id, 'up')
    expect(view(s)).toEqual(['Dirt/F1', 'Dirt/Mask', 'Dirt/A>Mask', 'Top', 'Base'])
    s.moveFolder(s.folders[0].id, 'down')
    s.moveFolder(s.folders[0].id, 'down')
    expect(view(s)).toEqual(['Top', 'Base', 'Dirt/F1', 'Dirt/Mask', 'Dirt/A>Mask'])
  })

  it('swaps two adjacent folders whole', () => {
    const s = makeStack([
      { name: 'A', folder: 'One' },
      { name: 'B', folder: 'Two' },
      { name: 'C', folder: 'Two' }
    ])
    s.moveFolder(s.folders[1].id, 'up')
    expect(view(s)).toEqual(['Two/B', 'Two/C', 'One/A'])
  })

  it('groups a clipped layer together with its whole mask group', () => {
    const s = makeStack(group)
    s.groupIntoFolder(id(s, 'A'), 'G')
    expect(view(s)).toEqual(['Top', 'G/Mask', 'G/A>Mask', 'G/B>Mask', 'Base'])
  })

  it('does not nest folders', () => {
    const s = makeStack(foldered)
    const before = s.folders.length
    s.groupIntoFolder(id(s, 'F1'))
    expect(s.folders.length).toBe(before)
  })

  it('ungroup keeps the layers in place', () => {
    const s = makeStack(foldered)
    s.ungroupFolder(s.folders[0].id)
    expect(view(s)).toEqual(['Top', 'F1', 'Mask', 'A>Mask', 'Base'])
    expect(s.folders).toEqual([])
  })

  it('removing a folder deletes its layers', () => {
    const s = makeStack(foldered)
    s.removeFolder(s.folders[0].id)
    expect(view(s)).toEqual(['Top', 'Base'])
    expect(s.folders).toEqual([])
  })

  it('drops a folder once its last member leaves', () => {
    const s = makeStack([{ name: 'Top' }, { name: 'Only', folder: 'Solo' }, { name: 'Base' }])
    move(s, 'Only', 'up')
    expect(view(s)).toEqual(['Top', 'Only', 'Base'])
    expect(s.folders).toEqual([])
  })
})

describe('LayerStack merge down', () => {
  type MergeArgs = Parameters<Layer['engine']['mergeOnto']>
  function withMergeSpy(s: LayerStack): Array<{ target: string; args: MergeArgs[1] }> {
    const calls: Array<{ target: string; args: MergeArgs[1] }> = []
    for (const l of s.layers) {
      ;(l.engine as unknown as { texture: string }).texture = `${l.name}-tex`
      ;(l.engine as unknown as { mergeOnto: (...a: MergeArgs) => void }).mergeOnto = (
        other,
        args
      ) => {
        const target = s.layers.find((x) => x.engine === other)!.name
        calls.push({ target, args })
      }
    }
    return calls
  }

  it('bakes blend mode and both opacities', () => {
    const s = makeStack([{ name: 'Top' }, { name: 'Base' }])
    const calls = withMergeSpy(s)
    const top = s.layers.find((l) => l.name === 'Top')!
    const base = s.layers.find((l) => l.name === 'Base')!
    top.blendMode = 'luminosity'
    top.opacity = 0.6
    base.opacity = 0.5
    s.mergeDown(top.id)
    expect(calls).toEqual([
      {
        target: 'Base',
        args: { opacity: 0.6, blendMode: 'luminosity', mask: undefined, backdropOpacity: 0.5 }
      }
    ])
    expect(base.opacity).toBe(1)
    expect(view(s)).toEqual(['Base'])
  })

  it('leaves a shared mask applied rather than baking it', () => {
    const s = makeStack(group)
    const calls = withMergeSpy(s)
    s.mergeDown(id(s, 'A'))
    expect(calls[0].args.mask).toBeUndefined()
    expect(view(s)).toEqual(['Top', 'Mask', 'B>Mask', 'Base'])
  })

  it('bakes in a mask only the top layer is clipped to', () => {
    const s = makeStack(group)
    const calls = withMergeSpy(s)
    s.mergeDown(id(s, 'B'))
    expect(calls[0].target).toBe('Base')
    expect(calls[0].args.mask).toEqual({ texture: 'Mask-tex', opacity: 1 })
  })

  it('refuses hidden layers, masks and folder boundaries', () => {
    const s = makeStack([
      { name: 'Top' },
      { name: 'Mask', mask: true },
      { name: 'A', clip: 'Mask' },
      { name: 'F', folder: 'Folder' },
      { name: 'Hidden' },
      { name: 'Base' }
    ])
    s.layers.find((l) => l.name === 'Hidden')!.visible = false
    expect(s.canMergeDown(id(s, 'Top'))).toBe(false)
    expect(s.canMergeDown(id(s, 'Mask'))).toBe(false)
    expect(s.canMergeDown(id(s, 'A'))).toBe(false)
    expect(s.canMergeDown(id(s, 'F'))).toBe(false)
    expect(s.canMergeDown(id(s, 'Hidden'))).toBe(false)
    expect(s.canMergeDown(id(s, 'Base'))).toBe(false)
  })
})
