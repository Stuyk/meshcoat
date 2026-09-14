import type { PaintChannel } from './channels'

/**
 * PBR texture sets ship as loose files — `rock_BaseColor.png`,
 * `rock_Roughness.png`, `rock_Normal.png` — with no manifest tying them
 * together. The convention every exporter follows is the filename: one shared
 * stem plus a channel suffix. This groups a folder of images back into the
 * materials they came from, so the shelf can offer "Rock" as one thing to paint
 * with rather than four unrelated stamps.
 */

/**
 * Suffix spellings seen in the wild, longest-first within each channel so
 * `_BaseColor` is matched before `_Base` would be. Deliberately generous:
 * Substance, Quixel, Poliigon, ambientCG and Blender exports all disagree.
 */
const CHANNEL_SUFFIXES: { channel: PaintChannel | 'ao' | 'height' | 'orm'; patterns: string[] }[] =
  [
    {
      channel: 'baseColor',
      patterns: ['basecolor', 'base_color', 'albedo', 'diffuse', 'color', 'col', 'diff', 'bc']
    },
    { channel: 'roughness', patterns: ['roughness', 'rough', 'rgh'] },
    { channel: 'metalness', patterns: ['metallic', 'metalness', 'metal', 'mtl'] },
    {
      channel: 'normal',
      patterns: ['normalgl', 'normal_gl', 'normaldx', 'normal_dx', 'normal', 'nrm', 'nor']
    },
    { channel: 'ao', patterns: ['ambientocclusion', 'ambient_occlusion', 'occlusion', 'ao'] },
    { channel: 'height', patterns: ['displacement', 'height', 'disp', 'bump'] },
    { channel: 'orm', patterns: ['orm', 'arm', 'occlusionroughnessmetallic', 'mro'] }
  ]

/** A map slot a set can carry. AO, height, and ORM are recognised. */
export type MaterialMapSlot = PaintChannel | 'ao' | 'height' | 'orm'

export interface MaterialSet {
  /** Display name — the shared filename stem, tidied up. */
  name: string
  /** Stable identity for selection, derived from the folder + stem. */
  id: string
  maps: Partial<Record<MaterialMapSlot, string>>
}

function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash >= 0 ? path.slice(slash + 1) : path
}

function directory(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash >= 0 ? path.slice(0, slash) : ''
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * Splits a filename into (stem, channel). Returns null when no channel suffix
 * is recognised — that file is a plain stamp image, not part of a set.
 *
 * Matching is on the *trailing* token only. A file called `metal_plate.png`
 * with no suffix is a texture named "metal plate", not a metalness map, and
 * matching anywhere in the name would get that wrong constantly.
 */
export function parseChannelSuffix(
  path: string
): { stem: string; channel: MaterialMapSlot } | null {
  const base = stripExtension(fileName(path))
  // Separator before the suffix: _ - . or a space, or camelCase (RockBaseColor).
  const match = /^(.*?)[\s._-]*([A-Za-z]+)$/.exec(base)
  if (!match) {
    return null
  }

  const [, head, tail] = match
  const tailKey = tail.toLowerCase()
  for (const entry of CHANNEL_SUFFIXES) {
    for (const pattern of entry.patterns) {
      if (tailKey !== pattern.replace(/[_\s-]/g, '')) {
        continue
      }
      const stem = head.replace(/[\s._-]+$/, '')
      // A suffix with nothing in front of it ("normal.png") names no material.
      if (!stem) {
        return null
      }
      return { stem, channel: entry.channel }
    }
  }
  return null
}

function tidyName(stem: string): string {
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Groups a flat list of image paths into material sets plus the leftovers.
 *
 * A single file whose name happens to carry a suffix is not a material — a lone
 * `rock_Normal.png` with no siblings is just an image, and presenting it as a
 * one-map material would be a worse stamp than treating it as one. Sets
 * therefore need at least two recognised maps.
 */
export function groupMaterialSets(paths: string[]): { sets: MaterialSet[]; loose: string[] } {
  const grouped = new Map<
    string,
    { stem: string; maps: Partial<Record<MaterialMapSlot, string>>; paths: string[] }
  >()
  const loose: string[] = []

  for (const path of paths) {
    const parsed = parseChannelSuffix(path)
    if (!parsed) {
      loose.push(path)
      continue
    }
    // Same stem in two folders is two different materials.
    const key = `${directory(path)}::${parsed.stem.toLowerCase()}`
    let entry = grouped.get(key)
    if (!entry) {
      entry = { stem: parsed.stem, maps: {}, paths: [] }
      grouped.set(key, entry)
    }
    // First file wins a slot; a set with two roughness spellings keeps one.
    entry.maps[parsed.channel] ??= path
    entry.paths.push(path)
  }

  const sets: MaterialSet[] = []
  for (const [key, entry] of grouped) {
    if (Object.keys(entry.maps).length < 2) {
      loose.push(...entry.paths)
      continue
    }
    sets.push({ id: key, name: tidyName(entry.stem), maps: entry.maps })
  }

  sets.sort((a, b) => a.name.localeCompare(b.name))
  loose.sort()
  return { sets, loose }
}

/** Channels this set can actually paint (AO and height are not paint channels). */
export function paintableChannels(set: MaterialSet): PaintChannel[] {
  return (['baseColor', 'roughness', 'metalness', 'normal'] as PaintChannel[]).filter(
    (c) => !!set.maps[c]
  )
}
