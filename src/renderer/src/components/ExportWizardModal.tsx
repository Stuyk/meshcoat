import { createSignal, createEffect, For, Show } from 'solid-js'
import { Modal, Button, SegmentedControl, Checkbox, TextInput, Label } from './ui'
import {
  DownloadIcon,
  HelpCircleIcon,
  LayersIcon,
  ImagesIcon,
  CubeIcon,
  FileTextIcon
} from './icons'
import type { ViewportHandle, PieceInfo } from '../viewport/Viewport'
import { combineDataUrls, combineMaskedDataUrls, packOrmFromDataUrls } from '../paint/exportTexture'

export interface ExportWizardModalProps {
  isOpen: boolean
  onClose: () => void
  modelName: string
  pieces?: PieceInfo[]
  getViewportHandle?: () => ViewportHandle | undefined
  viewportHandle?: ViewportHandle
  onToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
}

type ExportMode = 'individual' | 'combined'
type ResolutionOption = 'native' | '1024' | '2048' | '4096'

/** File-name stem for one piece: the shared base stem when there's only one piece, otherwise the base stem plus a sanitized piece name. */
function pieceStem(baseStem: string, pieceName: string, count: number): string {
  if (count < 2) {
    return baseStem
  }
  const safe = pieceName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${baseStem}_${safe || 'Piece'}`
}

/** Writes `url` to `path` if present. Returns whether anything was written, for the running export count. */
async function writeIfPresent(path: string, url: string | undefined | null): Promise<boolean> {
  if (!url) {
    return false
  }
  await window.api.savePng(path, url)
  return true
}

/**
 * A combined-mode data channel (roughness/metalness/normal): the single
 * piece's own map when exporting one piece at native resolution, otherwise
 * every piece's map merged onto one sheet — skipped (null) when no piece
 * actually painted that channel, rather than merging an all-neutral sheet.
 */
async function resolveCombinedDataChannel(
  isSingleNative: boolean,
  directUrl: () => string | undefined,
  urls: () => (string | undefined)[],
  merge: (urls: (string | undefined)[], background?: string) => Promise<string>,
  background: string
): Promise<string | null> {
  if (isSingleNative) {
    return directUrl() ?? null
  }
  const resolved = urls()
  return resolved.some(Boolean) ? await merge(resolved, background) : null
}

/** One piece's one channel in individual-piece export mode: resizes to `size` unless already native, then writes it. Returns whether anything was written. */
async function exportPieceChannel(
  dir: string,
  pieceStem: string,
  suffix: string,
  size: number,
  isNative: boolean,
  url: string | undefined
): Promise<boolean> {
  if (!url) {
    return false
  }
  const finalUrl = isNative ? url : await combineDataUrls([url], size, size)
  await window.api.savePng(`${dir}${pieceStem}_${suffix}.png`, finalUrl)
  return true
}

interface ExportChannelFlags {
  baseColor: boolean
  roughness: boolean
  metalness: boolean
  normal: boolean
  orm: boolean
}

/**
 * Merges every piece's maps onto one sheet (or, for a single piece at native
 * resolution, exports it directly with no resize/merge pass). Each piece's
 * maps are opaque across the whole square, so merging clips each piece to
 * its own UV coverage first — otherwise the last piece drawn wipes out every
 * piece before it.
 */
async function exportCombinedMode(
  handle: ViewportHandle,
  pieceList: PieceInfo[],
  isSingleNative: boolean,
  targetSize: number,
  dir: string,
  chosenStem: string,
  flags: ExportChannelFlags
): Promise<number> {
  let writtenCount = 0
  const primaryPieceIdx = pieceList[0]?.index ?? 0
  const masks = pieceList.map((p) => handle.exportCoverageMaskPng(p.index))
  const merge = (urls: (string | undefined)[], background?: string): Promise<string> =>
    combineMaskedDataUrls(
      urls.map((url, i) => ({ url, maskUrl: masks[i] })),
      targetSize,
      background
    )

  // BaseColor — every piece always has one, so this always merges (no skip-if-empty check).
  if (flags.baseColor) {
    const finalUrl = isSingleNative
      ? handle.exportBaseColorPng(primaryPieceIdx)
      : await merge(pieceList.map((p) => handle.exportBaseColorPng(p.index)))
    if (await writeIfPresent(`${dir}${chosenStem}_BaseColor.png`, finalUrl)) {
      writtenCount++
    }
  }

  // Roughness — neutral for the untouched sheet is fully rough (white).
  const combinedRoughUrl =
    flags.roughness || flags.orm
      ? await resolveCombinedDataChannel(
          isSingleNative,
          () => handle.exportChannelPng('roughness', primaryPieceIdx),
          () => pieceList.map((p) => handle.exportChannelPng('roughness', p.index)),
          merge,
          '#ffffff'
        )
      : null
  if (
    flags.roughness &&
    (await writeIfPresent(`${dir}${chosenStem}_Roughness.png`, combinedRoughUrl))
  ) {
    writtenCount++
  }

  // Metalness — neutral is fully dielectric (black).
  const combinedMetalUrl =
    flags.metalness || flags.orm
      ? await resolveCombinedDataChannel(
          isSingleNative,
          () => handle.exportChannelPng('metalness', primaryPieceIdx),
          () => pieceList.map((p) => handle.exportChannelPng('metalness', p.index)),
          merge,
          '#000000'
        )
      : null
  if (
    flags.metalness &&
    (await writeIfPresent(`${dir}${chosenStem}_Metalness.png`, combinedMetalUrl))
  ) {
    writtenCount++
  }

  // Normal — neutral is flat tangent-space (128, 128, 255).
  if (flags.normal) {
    const finalUrl = await resolveCombinedDataChannel(
      isSingleNative,
      () => handle.exportChannelPng('normal', primaryPieceIdx),
      () => pieceList.map((p) => handle.exportChannelPng('normal', p.index)),
      merge,
      '#8080ff'
    )
    if (await writeIfPresent(`${dir}${chosenStem}_Normal.png`, finalUrl)) {
      writtenCount++
    }
  }

  // ORM Map
  if (flags.orm) {
    const orm = isSingleNative
      ? handle.exportOrmPng(primaryPieceIdx)
      : await packOrmFromDataUrls(combinedRoughUrl, combinedMetalUrl, null, targetSize)
    if (await writeIfPresent(`${dir}${chosenStem}_ORM.png`, orm)) {
      writtenCount++
    }
  }

  return writtenCount
}

/** Every enabled channel for one piece, individual-export mode. Returns how many files were written. */
async function exportPieceAllChannels(
  handle: ViewportHandle,
  piece: PieceInfo,
  pStem: string,
  size: number,
  isNative: boolean,
  flags: ExportChannelFlags,
  dir: string
): Promise<number> {
  const channels: [boolean, string, string | undefined][] = [
    [flags.baseColor, 'BaseColor', handle.exportBaseColorPng(piece.index)],
    [flags.roughness, 'Roughness', handle.exportChannelPng('roughness', piece.index)],
    [flags.metalness, 'Metalness', handle.exportChannelPng('metalness', piece.index)],
    [flags.normal, 'Normal', handle.exportChannelPng('normal', piece.index)],
    [flags.orm, 'ORM', handle.exportOrmPng(piece.index)]
  ]
  let written = 0
  for (const [enabled, suffix, url] of channels) {
    if (!enabled) {
      continue
    }
    if (await exportPieceChannel(dir, pStem, suffix, size, isNative, url)) {
      written++
    }
  }
  return written
}

/** Exports every piece to its own set of files (one PNG per enabled channel per piece). */
async function exportIndividualMode(
  handle: ViewportHandle,
  pieceList: PieceInfo[],
  isNative: boolean,
  targetSize: number,
  dir: string,
  chosenStem: string,
  flags: ExportChannelFlags
): Promise<number> {
  let writtenCount = 0
  for (const piece of pieceList) {
    const pStem = pieceStem(chosenStem, piece.name, pieceList.length)
    const size = isNative ? piece.textureSize || 2048 : targetSize
    writtenCount += await exportPieceAllChannels(handle, piece, pStem, size, isNative, flags, dir)
  }
  return writtenCount
}

export default function ExportWizardModal(props: ExportWizardModalProps) {
  const getHandle = (): ViewportHandle | undefined => {
    return props.getViewportHandle ? props.getViewportHandle() : props.viewportHandle
  }

  const getPieces = (): PieceInfo[] => {
    if (props.pieces && props.pieces.length > 0) {
      return props.pieces
    }
    const h = getHandle()
    return h?.pieces() ?? []
  }

  const initialStem = () => props.modelName.replace(/\.[^/.]+$/, '') || 'Model'
  const [stem, setStem] = createSignal(initialStem())

  const isMultiPiece = () => getPieces().length > 1
  const [mode, setMode] = createSignal<ExportMode>(
    getPieces().length > 1 ? 'individual' : 'combined'
  )

  // Keep mode in sync if piece count changes
  createEffect(() => {
    if (getPieces().length <= 1) {
      setMode('combined')
    }
  })

  // Reset default stem when modelName changes
  createEffect(() => {
    setStem(initialStem())
  })

  const [exportBaseColor, setExportBaseColor] = createSignal(true)
  const [exportOrm, setExportOrm] = createSignal(true)
  const [exportRoughness, setExportRoughness] = createSignal(false)
  const [exportMetalness, setExportMetalness] = createSignal(false)
  const [exportNormal, setExportNormal] = createSignal(false)

  const [resolution, setResolution] = createSignal<ResolutionOption>('native')
  const [isExporting, setIsExporting] = createSignal(false)

  function applyPreset(preset: 'pbr' | 'colorOnly' | 'allUnpacked') {
    if (preset === 'pbr') {
      setExportBaseColor(true)
      setExportOrm(true)
      setExportRoughness(false)
      setExportMetalness(false)
      setExportNormal(true)
    } else if (preset === 'colorOnly') {
      setExportBaseColor(true)
      setExportOrm(false)
      setExportRoughness(false)
      setExportMetalness(false)
      setExportNormal(false)
    } else if (preset === 'allUnpacked') {
      setExportBaseColor(true)
      setExportOrm(false)
      setExportRoughness(true)
      setExportMetalness(true)
      setExportNormal(true)
    }
  }

  const previewFiles = (): string[] => {
    const currentStem = stem().trim() || 'Model'
    const files: string[] = []
    const pieceList = getPieces()

    if (mode() === 'combined' || pieceList.length <= 1) {
      if (exportBaseColor()) {
        files.push(`${currentStem}_BaseColor.png`)
      }
      if (exportOrm()) {
        files.push(`${currentStem}_ORM.png`)
      }
      if (exportRoughness()) {
        files.push(`${currentStem}_Roughness.png`)
      }
      if (exportMetalness()) {
        files.push(`${currentStem}_Metalness.png`)
      }
      if (exportNormal()) {
        files.push(`${currentStem}_Normal.png`)
      }
    } else {
      for (const piece of pieceList) {
        const pStem = pieceStem(currentStem, piece.name, pieceList.length)
        if (exportBaseColor()) {
          files.push(`${pStem}_BaseColor.png`)
        }
        if (exportOrm()) {
          files.push(`${pStem}_ORM.png`)
        }
        if (exportRoughness()) {
          files.push(`${pStem}_Roughness.png`)
        }
        if (exportMetalness()) {
          files.push(`${pStem}_Metalness.png`)
        }
        if (exportNormal()) {
          files.push(`${pStem}_Normal.png`)
        }
      }
    }
    return files
  }

  async function handleExport(): Promise<void> {
    const handle = getHandle()
    if (!handle) {
      props.onToast?.('3D Viewport is not ready yet. Please wait for model to load.', 'error')
      return
    }
    const pieceList = getPieces()
    if (pieceList.length === 0) {
      props.onToast?.('No 3D model is currently loaded to export textures from.', 'warning')
      return
    }
    const currentStem = stem().trim() || 'Model'

    const filesToGenerate = previewFiles()
    if (filesToGenerate.length === 0) {
      props.onToast?.('Select at least one channel to export', 'warning')
      return
    }

    const defaultFileName = filesToGenerate[0]
    const filePath = await window.api.saveFileDialog({
      defaultPath: defaultFileName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (!filePath) {
      return
    }

    setIsExporting(true)
    try {
      const separator = filePath.includes('\\') ? '\\' : '/'
      const dir = filePath.slice(0, filePath.lastIndexOf(separator) + 1)
      const chosenStem =
        filePath
          .slice(dir.length)
          .replace(/\.png$/i, '')
          .replace(/_BaseColor$/i, '')
          .replace(/_ORM$/i, '')
          .replace(/_Roughness$/i, '')
          .replace(/_Metalness$/i, '')
          .replace(/_Normal$/i, '') || currentStem

      const maxNativeSize = Math.max(...pieceList.map((p) => p.textureSize || 2048), 2048)
      const targetSize = resolution() === 'native' ? maxNativeSize : parseInt(resolution(), 10)

      const flags: ExportChannelFlags = {
        baseColor: exportBaseColor(),
        roughness: exportRoughness(),
        metalness: exportMetalness(),
        normal: exportNormal(),
        orm: exportOrm()
      }
      const writtenCount =
        mode() === 'combined' || pieceList.length <= 1
          ? await exportCombinedMode(
              handle,
              pieceList,
              pieceList.length <= 1 && resolution() === 'native',
              targetSize,
              dir,
              chosenStem,
              flags
            )
          : await exportIndividualMode(
              handle,
              pieceList,
              resolution() === 'native',
              targetSize,
              dir,
              chosenStem,
              flags
            )

      props.onToast?.(
        writtenCount === 1
          ? `Exported 1 texture map to ${dir}`
          : `Successfully exported ${writtenCount} texture maps to ${dir}`,
        'success'
      )
      props.onClose()
    } catch (err: any) {
      console.error('Export wizard error:', err)
      props.onToast?.(`Export failed: ${err?.message || err}`, 'error')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Export Textures"
      icon={(p) => <DownloadIcon size={p.size} class="text-blue-400" />}
      size="lg"
      footer={
        <div class="flex items-center justify-between w-full">
          <Button variant="ghost" onClick={props.onClose} disabled={isExporting()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={isExporting() || previewFiles().length === 0}
          >
            <DownloadIcon size={15} />
            <span>
              {isExporting()
                ? 'Exporting...'
                : `Export ${previewFiles().length} File${previewFiles().length === 1 ? '' : 's'}`}
            </span>
          </Button>
        </div>
      }
    >
      <div class="flex flex-col gap-4 text-xs text-zinc-300">
        {/* Mode Selector for Multi-Piece Models */}
        <Show
          when={isMultiPiece()}
          fallback={
            <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-950/40 border border-zinc-800/80 text-zinc-400">
              <CubeIcon size={15} class="text-blue-400 shrink-0" />
              <span>Single model piece: exporting unified texture maps.</span>
            </div>
          }
        >
          <div class="flex flex-col gap-2">
            <Label>Piece Export Mode</Label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  mode() === 'individual'
                    ? 'bg-blue-600/15 border-blue-500/50 shadow-xs'
                    : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                }`}
                onClick={() => setMode('individual')}
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 font-semibold text-zinc-100">
                    <LayersIcon
                      size={15}
                      class={mode() === 'individual' ? 'text-blue-400' : 'text-zinc-400'}
                    />
                    <span>Individual Pieces</span>
                  </div>
                  <Show when={mode() === 'individual'}>
                    <span class="w-2 h-2 rounded-full bg-blue-500" />
                  </Show>
                </div>
                <p class="text-[11px] text-zinc-400 leading-snug">
                  Each piece gets its own set of textures (e.g.{' '}
                  <code class="text-zinc-300">Head_BaseColor</code>,{' '}
                  <code class="text-zinc-300">Body_BaseColor</code>).
                </p>
              </button>

              <button
                type="button"
                class={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  mode() === 'combined'
                    ? 'bg-blue-600/15 border-blue-500/50 shadow-xs'
                    : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                }`}
                onClick={() => setMode('combined')}
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 font-semibold text-zinc-100">
                    <ImagesIcon
                      size={15}
                      class={mode() === 'combined' ? 'text-blue-400' : 'text-zinc-400'}
                    />
                    <span>Single Image (Shared UV)</span>
                  </div>
                  <Show when={mode() === 'combined'}>
                    <span class="w-2 h-2 rounded-full bg-blue-500" />
                  </Show>
                </div>
                <p class="text-[11px] text-zinc-400 leading-snug">
                  All pieces are merged into one texture atlas sheet (e.g.{' '}
                  <code class="text-zinc-300">Model_BaseColor</code>).
                </p>
              </button>
            </div>
          </div>
        </Show>

        {/* Channels to Export */}
        <div class="flex flex-col gap-2">
          <Label
            actions={
              <div class="flex items-center gap-1.5 text-[11px]">
                <span class="text-zinc-500">Presets:</span>
                <button
                  type="button"
                  class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
                  onClick={() => applyPreset('pbr')}
                >
                  PBR + ORM
                </button>
                <button
                  type="button"
                  class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
                  onClick={() => applyPreset('colorOnly')}
                >
                  Color Only
                </button>
                <button
                  type="button"
                  class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
                  onClick={() => applyPreset('allUnpacked')}
                >
                  All Unpacked
                </button>
              </div>
            }
          >
            Channels to Export
          </Label>

          <div class="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
            {/* Base Color */}
            <Checkbox
              checked={exportBaseColor()}
              onChange={setExportBaseColor}
              label="Base Color"
              subtext="_BaseColor"
            />

            {/* Packed ORM */}
            <Checkbox
              checked={exportOrm()}
              onChange={setExportOrm}
              label="Packed ORM"
              subtext="_ORM"
            />

            {/* Normal */}
            <Checkbox
              checked={exportNormal()}
              onChange={setExportNormal}
              label="Normal Map"
              subtext="_Normal"
            />

            {/* Roughness */}
            <Checkbox
              checked={exportRoughness()}
              onChange={setExportRoughness}
              label="Roughness"
              subtext="_Roughness"
            />

            {/* Metalness */}
            <Checkbox
              checked={exportMetalness()}
              onChange={setExportMetalness}
              label="Metalness"
              subtext="_Metalness"
            />
          </div>
        </div>

        {/* Settings Row: Filename Stem & Resolution */}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Filename Stem */}
          <div class="flex flex-col gap-1.5">
            <Label>Filename Prefix</Label>
            <TextInput value={stem()} onInput={setStem} placeholder="e.g. MyModel" mono size="sm" />
          </div>

          {/* Resolution Override */}
          <div class="flex flex-col gap-1.5">
            <Label>Resolution</Label>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'native', label: 'Native' },
                { value: '1024', label: '1024px' },
                { value: '2048', label: '2048px' },
                { value: '4096', label: '4096px' }
              ]}
              value={resolution()}
              onChange={(v) => setResolution(v as ResolutionOption)}
            />
          </div>
        </div>

        {/* Files Preview Box */}
        <div class="flex flex-col gap-1.5">
          <Label badge={`${previewFiles().length} file(s)`}>Files to be Exported</Label>
          <div class="max-h-28 overflow-y-auto p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80 font-mono text-[11px] text-zinc-400 space-y-1 select-none">
            <Show
              when={previewFiles().length > 0}
              fallback={
                <span class="text-zinc-600 italic">
                  No channels selected. Select at least one channel above.
                </span>
              }
            >
              <For each={previewFiles()}>
                {(file) => (
                  <div class="flex items-center gap-2 text-zinc-300">
                    <FileTextIcon size={12} class="text-blue-400/80 shrink-0" />
                    <span class="truncate">{file}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* User Requested Disclaimer Tooltip Banner */}
        <div class="flex items-start gap-2.5 p-3 rounded-lg bg-zinc-950/80 border border-amber-500/30 text-xs text-zinc-400 leading-relaxed shadow-xs">
          <HelpCircleIcon size={16} class="text-amber-400 shrink-0 mt-0.5" />
          <p>
            <span class="font-semibold text-zinc-200">Note:</span> You are only exporting texture
            images here and not assigning materials to the model. You will need to use your 3D
            program of choice (such as Blender, Maya, Unreal Engine, Unity, Godot, etc.) to hook up
            the textures as the final step.
          </p>
        </div>
      </div>
    </Modal>
  )
}
