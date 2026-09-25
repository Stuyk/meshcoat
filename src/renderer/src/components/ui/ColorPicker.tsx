import { createSignal, createEffect, createMemo, For, Show } from 'solid-js'
import {
  hexToHsv,
  hsvToHex,
  hexToRgb,
  rgbToHex,
  normalizeHex,
  parseCssColor,
  type HSV
} from '../../utils/colorUtils'
import { EyedropperIcon, CopyIcon, CheckIcon, MonitorIcon, AppWindowIcon } from '../icons'

export interface ColorPickerProps {
  color: string
  onChange: (hex: string) => void
  onSaveColor?: (hex: string) => void
  onEyeDropperClick?: () => void
  class?: string
}

export default function ColorPicker(props: ColorPickerProps) {
  let svAreaRef: HTMLDivElement | undefined
  let hueBarRef: HTMLDivElement | undefined
  let nativeInputRef: HTMLInputElement | undefined

  // Internal HSV representation
  const [hsv, setHsv] = createSignal<HSV>(hexToHsv(props.color))
  const [hexInput, setHexInput] = createSignal(props.color.toUpperCase())
  const [isDraggingSV, setIsDraggingSV] = createSignal(false)
  const [isDraggingHue, setIsDraggingHue] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  // While the text field has focus its draft is the user's, not ours — a
  // round-trip through HSV must not rewrite "rgb(10, 20, 30)" mid-typing.
  const [editingText, setEditingText] = createSignal(false)
  const [channelMode, setChannelMode] = createSignal<'rgb' | 'hsv'>('rgb')
  const [picking, setPicking] = createSignal(false)

  // Track initial color for comparison
  const [initialColor] = createSignal(props.color)

  // Synchronize when external props.color updates, but ONLY when not actively dragging
  createEffect(() => {
    const ext = props.color
    if (!isDraggingSV() && !isDraggingHue()) {
      const currentHex = hsvToHex(hsv().h, hsv().s, hsv().v)
      if (normalizeHex(ext) !== normalizeHex(currentHex)) {
        setHsv(hexToHsv(ext))
        if (!editingText()) {
          setHexInput(ext.toUpperCase())
        }
      }
    }
  })

  // Compute RGB channels for display
  const rgb = createMemo(() => hexToRgb(props.color))

  // Update SV from pointer coordinates
  const updateSVFromPointer = (clientX: number, clientY: number) => {
    if (!svAreaRef) {
      return
    }
    const rect = svAreaRef.getBoundingClientRect()
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width)
    const y = Math.min(Math.max(0, clientY - rect.top), rect.height)

    // Handles are inset by their own radius (see the markup), so map the same way.
    const s = Math.min(1, Math.max(0, (x - 8) / Math.max(1, rect.width - 16)))
    const v = Math.min(1, Math.max(0, 1 - (y - 8) / Math.max(1, rect.height - 16)))

    const newHsv: HSV = { h: hsv().h, s, v }
    setHsv(newHsv)
    const newHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v)
    setHexInput(newHex.toUpperCase())
    props.onChange(newHex)
  }

  // Update Hue from pointer coordinates
  const updateHueFromPointer = (clientX: number) => {
    if (!hueBarRef) {
      return
    }
    const rect = hueBarRef.getBoundingClientRect()
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width)
    const ratio = Math.min(1, Math.max(0, (x - 8) / Math.max(1, rect.width - 16)))
    const h = Math.round(ratio * 360) % 360

    const newHsv: HSV = { h, s: hsv().s, v: hsv().v }
    setHsv(newHsv)
    const newHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v)
    setHexInput(newHex.toUpperCase())
    props.onChange(newHex)
  }

  const handleSvPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    setIsDraggingSV(true)
    svAreaRef?.setPointerCapture(e.pointerId)
    updateSVFromPointer(e.clientX, e.clientY)
  }

  const handleSvPointerMove = (e: PointerEvent) => {
    if (!isDraggingSV()) {
      return
    }
    updateSVFromPointer(e.clientX, e.clientY)
  }

  const handleSvPointerUp = (e: PointerEvent) => {
    if (isDraggingSV()) {
      try {
        svAreaRef?.releasePointerCapture(e.pointerId)
      } catch {}
      setIsDraggingSV(false)
    }
  }

  const handleHuePointerDown = (e: PointerEvent) => {
    e.preventDefault()
    setIsDraggingHue(true)
    hueBarRef?.setPointerCapture(e.pointerId)
    updateHueFromPointer(e.clientX)
  }

  const handleHuePointerMove = (e: PointerEvent) => {
    if (!isDraggingHue()) {
      return
    }
    updateHueFromPointer(e.clientX)
  }

  const handleHuePointerUp = (e: PointerEvent) => {
    if (isDraggingHue()) {
      try {
        hueBarRef?.releasePointerCapture(e.pointerId)
      } catch {}
      setIsDraggingHue(false)
    }
  }

  // Handle text edit: accepts hex (with or without '#'), rgb(), hsl() and named colors
  const handleHexChange = (val: string): void => {
    setHexInput(val)
    const parsed = parseCssColor(val)
    if (parsed) {
      setHsv(hexToHsv(parsed))
      props.onChange(parsed)
    }
  }

  // Leaving the field snaps whatever was typed back to the canonical hex
  const commitHexInput = (): void => {
    setEditingText(false)
    setHexInput(normalizeHex(props.color).toUpperCase())
  }

  // Numeric channel edits, in whichever model the channel row is showing
  const handleRgbChange = (channel: 'r' | 'g' | 'b', val: number): void => {
    const updated = {
      ...rgb(),
      [channel]: Math.min(255, Math.max(0, isNaN(val) ? 0 : val))
    }
    applyHex(rgbToHex(updated.r, updated.g, updated.b))
  }

  const handleHsvChange = (channel: 'h' | 's' | 'v', val: number): void => {
    const n = isNaN(val) ? 0 : val
    const next: HSV = { ...hsv() }
    if (channel === 'h') {
      next.h = ((Math.round(n) % 360) + 360) % 360
    } else {
      next[channel] = Math.min(100, Math.max(0, n)) / 100
    }
    setHsv(next)
    const hex = hsvToHex(next.h, next.s, next.v)
    setHexInput(hex.toUpperCase())
    props.onChange(hex)
  }

  const applyHex = (hex: string): void => {
    const normalized = normalizeHex(hex)
    setHsv(hexToHsv(normalized))
    setHexInput(normalized.toUpperCase())
    props.onChange(normalized)
  }

  const copyHex = (): void => {
    void navigator.clipboard.writeText(props.color.toUpperCase())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  /**
   * Samples any pixel on screen, other applications included. The main
   * process does the capture (see main/screenPicker.ts) because Electron
   * doesn't implement the web EyeDropper; that API is only a fallback for
   * running outside Electron.
   */
  const pickFromScreen = async (): Promise<void> => {
    if (picking()) {
      return
    }
    setPicking(true)
    try {
      if (window.api?.pickScreenColor) {
        const hex = await window.api.pickScreenColor()
        if (hex) {
          applyHex(hex)
        }
        return
      }
      if ('EyeDropper' in window) {
        // @ts-expect-error EyeDropper is a modern Web API
        const result = await new window.EyeDropper().open()
        if (result?.sRGBHex) {
          applyHex(result.sRGBHex)
        }
        return
      }
      nativeInputRef?.click()
    } catch {
      // Cancelled or capture refused (e.g. denied screen-share portal): no change.
    } finally {
      setPicking(false)
    }
  }

  const channelFields = (): {
    key: string
    label: string
    value: number
    max: number
    suffix?: string
    set: (n: number) => void
  }[] => {
    if (channelMode() === 'rgb') {
      const c = rgb()
      return [
        { key: 'r', label: 'R', value: c.r, max: 255, set: (n) => handleRgbChange('r', n) },
        { key: 'g', label: 'G', value: c.g, max: 255, set: (n) => handleRgbChange('g', n) },
        { key: 'b', label: 'B', value: c.b, max: 255, set: (n) => handleRgbChange('b', n) }
      ]
    }
    const c = hsv()
    return [
      {
        key: 'h',
        label: 'H',
        value: Math.round(c.h),
        max: 359,
        suffix: '°',
        set: (n) => handleHsvChange('h', n)
      },
      {
        key: 's',
        label: 'S',
        value: Math.round(c.s * 100),
        max: 100,
        suffix: '%',
        set: (n) => handleHsvChange('s', n)
      },
      {
        key: 'v',
        label: 'V',
        value: Math.round(c.v * 100),
        max: 100,
        suffix: '%',
        set: (n) => handleHsvChange('v', n)
      }
    ]
  }

  const toolButton =
    'flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-md border border-zinc-700/60 bg-zinc-900 text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait'

  return (
    <div
      class={`flex flex-col gap-3 p-3 w-full min-w-0 max-w-full box-border overflow-hidden bg-zinc-950/80 border border-zinc-800/90 rounded-lg select-none ${props.class ?? ''}`}
    >
      {/* Saturation / value field */}
      <div
        ref={svAreaRef}
        class="relative w-full h-40 rounded-md cursor-crosshair touch-none overflow-hidden border border-zinc-700/60 shadow-inner"
        style={{ 'background-color': `hsl(${hsv().h}, 100%, 50%)` }}
        onPointerDown={handleSvPointerDown}
        onPointerMove={handleSvPointerMove}
        onPointerUp={handleSvPointerUp}
      >
        <div class="absolute inset-0 bg-gradient-to-r from-white to-transparent pointer-events-none" />
        <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent pointer-events-none" />
        <div
          class="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white shadow-[0_0_3px_rgba(0,0,0,0.9)] pointer-events-none"
          style={{
            left: `calc(8px + (100% - 16px) * ${hsv().s})`,
            top: `calc(8px + (100% - 16px) * ${1 - hsv().v})`,
            'background-color': props.color
          }}
        />
      </div>

      {/* Hue */}
      <div
        ref={hueBarRef}
        class="relative w-full h-3.5 rounded-full cursor-pointer touch-none border border-zinc-700/60 shadow-inner"
        style={{
          background:
            'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
        }}
        onPointerDown={handleHuePointerDown}
        onPointerMove={handleHuePointerMove}
        onPointerUp={handleHuePointerUp}
      >
        <div
          class="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 rounded-full border-2 border-white shadow-[0_0_3px_rgba(0,0,0,0.9)] pointer-events-none"
          style={{
            left: `calc(8px + (100% - 16px) * ${hsv().h / 360})`,
            'background-color': `hsl(${hsv().h}, 100%, 50%)`
          }}
        />
      </div>

      {/* Before / after, and the pickers — an even grid, so nothing can push past the card */}
      <div class={`grid gap-2 ${props.onEyeDropperClick ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div class="flex h-8 min-w-0 rounded-md border border-zinc-700/80 overflow-hidden">
          <button
            type="button"
            class="flex-1 cursor-pointer"
            style={{ 'background-color': initialColor() }}
            title={`Revert to ${initialColor().toUpperCase()}`}
            onClick={() => applyHex(initialColor())}
          />
          <div
            class="flex-1"
            style={{ 'background-color': props.color }}
            title={`Current: ${props.color.toUpperCase()}`}
          />
        </div>
        <button
          type="button"
          class={`${toolButton} min-w-0`}
          onClick={() => void pickFromScreen()}
          disabled={picking()}
          title="Pick a color from anywhere on screen, including other apps (Esc cancels)"
        >
          <MonitorIcon size={13} class="shrink-0" />
          <span class="truncate">{picking() ? 'Picking…' : 'Screen'}</span>
        </button>
        <Show when={props.onEyeDropperClick}>
          <button
            type="button"
            class={`${toolButton} min-w-0`}
            onClick={() => props.onEyeDropperClick?.()}
            title="Sample a color from the model (I)"
          >
            <EyedropperIcon size={13} class="shrink-0" />
            <span class="truncate">Model</span>
          </button>
        </Show>
      </div>

      {/* Hex / any CSS color */}
      <div class="flex items-center h-8 bg-zinc-900 border border-zinc-700/60 rounded-md px-2.5 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mr-2">
          Hex
        </span>
        <input
          type="text"
          spellcheck={false}
          value={hexInput()}
          onFocus={() => setEditingText(true)}
          onInput={(e) => handleHexChange(e.currentTarget.value)}
          onBlur={commitHexInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          placeholder="#RRGGBB, rgb(), hsl(), name"
          class="flex-1 min-w-0 bg-transparent font-mono text-xs font-semibold text-zinc-100 outline-hidden"
        />
        <button
          type="button"
          onClick={() => nativeInputRef?.click()}
          title="Open the system color dialog"
          class="relative text-zinc-500 hover:text-zinc-200 cursor-pointer ml-2"
        >
          <AppWindowIcon size={13} />
          <input
            ref={nativeInputRef}
            type="color"
            tabIndex={-1}
            class="absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
            value={props.color}
            onInput={(e) => applyHex(e.currentTarget.value)}
          />
        </button>
        <button
          type="button"
          onClick={copyHex}
          title="Copy hex to clipboard"
          class="text-zinc-500 hover:text-zinc-200 cursor-pointer ml-2"
        >
          {copied() ? <CheckIcon size={13} class="text-emerald-400" /> : <CopyIcon size={13} />}
        </button>
      </div>

      {/* Channel values */}
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1 self-start rounded-md bg-zinc-900 border border-zinc-800 p-0.5">
          <For each={['rgb', 'hsv'] as const}>
            {(mode) => (
              <button
                type="button"
                onClick={() => setChannelMode(mode)}
                class={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase cursor-pointer transition-colors ${
                  channelMode() === mode
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {mode}
              </button>
            )}
          </For>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <For each={channelFields()}>
            {(field) => (
              <label class="flex items-center h-8 bg-zinc-900 border border-zinc-800 rounded-md px-2 gap-1.5 focus-within:border-blue-500">
                <span class="text-[10px] font-semibold text-zinc-500">{field.label}</span>
                <input
                  type="number"
                  min="0"
                  max={field.max}
                  value={field.value}
                  onChange={(e) => field.set(parseFloat(e.currentTarget.value))}
                  class="flex-1 min-w-0 bg-transparent text-right font-mono text-xs text-zinc-100 outline-hidden [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <Show when={field.suffix}>
                  <span class="text-[10px] text-zinc-500">{field.suffix}</span>
                </Show>
              </label>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
