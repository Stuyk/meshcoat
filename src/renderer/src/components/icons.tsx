export {
  Clipboard as ClipboardIcon,
  Crop as CropIcon,
  Maximize2 as PopoutIcon,
  PanelRightOpen as PanelRightIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  RefreshCw as RefreshCwIcon,
  Search as SearchIcon,
  X as XIcon,
  Play as PlayIcon,
  Pause as PauseIcon,
  Layers as LayersIcon,
  Download as DownloadIcon,
  Trash2 as Trash2Icon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  ChevronRight as ChevronRightIcon,
  ChevronLeft as ChevronLeftIcon,
  Sliders as SlidersIcon,
  Keyboard as KeyboardIcon,
  HelpCircle as HelpCircleIcon,
  Settings as SettingsIcon,
  Copy as CopyIcon,
  Eye as EyeIcon,
  EyeOff as EyeOffIcon,
  Plus as PlusIcon,
  Paintbrush as BrushIcon,
  Stamp as StampIcon,
  Eraser as EraserIcon,
  PaintBucket as FillIcon,
  Pipette as EyedropperIcon,
  MousePointer as MousePointerIcon,
  Sun as StudioLightIcon,
  SunDim as FlatLightIcon,
  CloudSun as OutdoorLightIcon,
  Gem as ShowcaseLightIcon,
  Grid3x3 as WireframeIcon,
  Check as CheckIcon,
  Focus as FocusIcon,
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
  Palette as PaletteIcon,
  Pencil as Edit2Icon,
  Box as CubeIcon,
  Images as ImagesIcon,
  Sparkles as SparklesIcon,
  Drama as DramaIcon,
  Contrast as ContrastIcon,
  Droplets as DropletsIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  Unlink as UnlinkIcon,
  Link as LinkIcon,
  CornerDownRight as CornerDownRightIcon,
  LayersPlus as LayersPlusIcon,
  Upload as UploadIcon,
  Trash2 as TrashIcon,
  CircleDot as CircleDotIcon,
  SlidersHorizontal as SlidersHorizontalIcon,
  MoveHorizontal as SpacingIcon,
  Feather as FeatherIcon,
  RotateCw as RotateIcon,
  SquareSplitHorizontal as SymmetryIcon,
  Clock as ClockIcon,
  BookOpen as BookOpenIcon,
  Compass as CompassIcon,
  FileText as FileTextIcon,
  Hammer as EdgeWearIcon,
  SwatchBook as MaterialChannelsIcon,
  Library as LibraryIcon,
  Bookmark as BookmarkIcon,
  Type as TextIcon,
  Scan as UvPanelIcon,
  Expand as FitIcon
} from 'lucide-solid'

export function AppIcon(props: { size?: number; class?: string }) {
  const s = () => props.size || 24
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={s()}
      height={s()}
      class={props.class}
      style={{ 'flex-shrink': '0' }}
    >
      {/* Squircle background */}
      <rect width="128" height="128" rx="28" fill="#1e2430" />

      {/* Centered 3D isometric box */}
      <g transform="translate(18, 18) scale(1.64)">
        <path
          fill="#3b82f6"
          d="m28 26.64l22.078-12.538c-.352-.352-.774-.633-1.289-.915l-16.523-9.42C30.813 2.946 29.406 2.5 28 2.5s-2.812.445-4.266 1.266L7.211 13.188c-.516.28-.937.562-1.29.914ZM26.406 53.5V29.453L4.4 16.891a7.8 7.8 0 0 0-.188 1.78V36.93c0 3.398 1.195 4.664 3.375 5.906l18.352 10.453c.164.094.304.164.468.211m3.188 0c.164-.047.304-.117.469-.21l18.351-10.454c2.18-1.242 3.375-2.508 3.375-5.906V18.672c0-.703-.07-1.266-.187-1.781L29.594 29.453Z"
        />
      </g>

      {/* Scaled-down paint brush in bottom-right corner with background outline */}
      <g transform="translate(68, 68) scale(4.4)">
        <path
          fill="none"
          stroke="#161a24"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2 7a1 1 0 0 0 1 1h1v1.5c0 .827.673 1.5 1.5 1.5S7 10.327 7 9.5V8h1a1 1 0 0 0 1-1V6H2zm6.5-6H8v2a.5.5 0 0 1-1 0V1H6v1.5a.5.5 0 0 1-1 0V1H2.5a.5.5 0 0 0-.5.5V5h7V1.5a.5.5 0 0 0-.5-.5"
        />
        <path
          fill="#f57c00"
          d="M2 7a1 1 0 0 0 1 1h1v1.5c0 .827.673 1.5 1.5 1.5S7 10.327 7 9.5V8h1a1 1 0 0 0 1-1V6H2zm6.5-6H8v2a.5.5 0 0 1-1 0V1H6v1.5a.5.5 0 0 1-1 0V1H2.5a.5.5 0 0 0-.5.5V5h7V1.5a.5.5 0 0 0-.5-.5"
        />
      </g>
    </svg>
  )
}

export function LineIcon(props: { size?: number | string; class?: string; [key: string]: any }) {
  const s = () => props.size || 18
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={s()}
      height={s()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
    >
      <line x1="4" y1="20" x2="20" y2="4" />
      <circle cx="4" cy="20" r="1.5" fill="currentColor" />
      <circle cx="20" cy="4" r="1.5" fill="currentColor" />
    </svg>
  )
}
