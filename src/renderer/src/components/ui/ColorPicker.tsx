import { createSignal, createEffect, createMemo } from 'solid-js'
import {
  hexToHsv,
  hsvToHex,
  hexToRgb,
  rgbToHex,
  normalizeHex,
  parseCssColor,
  type HSV
} from '../../utils/colorUtils'
import { EyedropperIcon, CopyIcon, CheckIcon } from '../icons'

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

    const s = Math.min(1, Math.max(0, x / rect.width))
    const v = Math.min(1, Math.max(0, 1 - y / rect.height))

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
    const ratio = Math.min(1, Math.max(0, x / rect.width))
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
  const handleHexChange = (val: string) => {
    setHexInput(val)
    const parsed = parseCssColor(val)
    if (parsed) {
      setHsv(hexToHsv(parsed))
      props.onChange(parsed)
    }
  }

  // Leaving the field snaps whatever was typed back to the canonical hex
  const commitHexInput = () => {
    setEditingText(false)
    setHexInput(normalizeHex(props.color).toUpperCase())
  }

  // Handle RGB channel edits
  const handleRgbChange = (channel: 'r' | 'g' | 'b', val: number) => {
    const current = rgb()
    const updated = {
      ...current,
      [channel]: Math.min(255, Math.max(0, isNaN(val) ? 0 : val))
    }
    const newHex = rgbToHex(updated.r, updated.g, updated.b)
    setHsv(hexToHsv(newHex))
    setHexInput(newHex.toUpperCase())
    props.onChange(newHex)
  }

  // Copy hex to clipboard
  const copyHex = () => {
    void navigator.clipboard.writeText(props.color.toUpperCase())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Eyedropper API support
  const handleScreenEyedropper = async () => {
    if ('EyeDropper' in window) {
      try {
        // @ts-expect-error EyeDropper is a modern Web API
        const eyeDropper = new window.EyeDropper()
        const result = await eyeDropper.open()
        if (result?.sRGBHex) {
          const hex = normalizeHex(result.sRGBHex)
          setHsv(hexToHsv(hex))
          setHexInput(hex.toUpperCase())
          props.onChange(hex)
        }
      } catch {}
    } else if (props.onEyeDropperClick) {
      props.onEyeDropperClick()
    } else {
      nativeInputRef?.click()
    }
  }

  return (
    <div
      class={`flex flex-col gap-2.5 p-2.5 bg-zinc-950/80 border border-zinc-800/90 rounded-lg select-none ${props.class ?? ''}`}
    >
      {/* 1. 2D Saturation / Value Gradient Box */}
      <div
        ref={svAreaRef}
        class="relative w-full h-24 rounded-md cursor-crosshair touch-none overflow-hidden border border-zinc-700/60 shadow-inner"
        style={{ 'background-color': `hsl(${hsv().h}, 100%, 50%)` }}
        onPointerDown={handleSvPointerDown}
        onPointerMove={handleSvPointerMove}
        onPointerUp={handleSvPointerUp}
      >
        {/* White to transparent horizontal gradient */}
        <div class="absolute inset-0 bg-gradient-to-r from-white to-transparent pointer-events-none" />
        {/* Transparent to black vertical gradient */}
        <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent pointer-events-none" />

        {/* Reticle / Position Handle */}
        <div
          class="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow-[0_0_2px_rgba(0,0,0,0.8)] pointer-events-none transition-transform duration-75"
          style={{
            left: `${hsv().s * 100}%`,
            top: `${(1 - hsv().v) * 100}%`,
            'background-color': props.color
          }}
        />
      </div>

      {/* 2. 1D Hue Rainbow Slider */}
      <div class="flex items-center gap-2">
        <div
          ref={hueBarRef}
          class="relative flex-1 h-3.5 rounded-full cursor-pointer touch-none border border-zinc-700/60 shadow-inner overflow-visible"
          style={{
            background:
              'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
          }}
          onPointerDown={handleHuePointerDown}
          onPointerMove={handleHuePointerMove}
          onPointerUp={handleHuePointerUp}
        >
          {/* Thumb Handle */}
          <div
            class="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 rounded-full bg-white border-2 border-zinc-900 shadow-md pointer-events-none transition-transform duration-75"
            style={{
              left: `${(hsv().h / 360) * 100}%`,
              'background-color': `hsl(${hsv().h}, 100%, 50%)`
            }}
          />
        </div>

        {/* Quick Eyedropper Button */}
        <button
          type="button"
          onClick={handleScreenEyedropper}
          title="Sample color from screen"
          class="p-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white transition-colors cursor-pointer shrink-0"
        >
          <EyedropperIcon size={14} />
        </button>

        {/* Native OS Picker Fallback */}
        <button
          type="button"
          onClick={() => nativeInputRef?.click()}
          title="Open OS system color dialog"
          class="w-6 h-6 rounded-md border border-zinc-700/60 shadow-xs cursor-pointer shrink-0 overflow-hidden relative group"
          style={{ 'background-color': props.color }}
        >
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-[10px] text-white">
            OS
          </div>
          <input
            ref={nativeInputRef}
            type="color"
            class="sr-only"
            value={props.color}
            onInput={(e) => {
              const hex = normalizeHex(e.currentTarget.value)
              setHsv(hexToHsv(hex))
              setHexInput(hex.toUpperCase())
              props.onChange(hex)
            }}
          />
        </button>
      </div>

      {/* 3. Color Readout & Direct Value Inputs */}
      <div class="flex items-center gap-2 pt-0.5">
        {/* Color Swatch Comparison (Previous vs New) */}
        <div class="flex items-center h-7 rounded-md border border-zinc-700/80 overflow-hidden shadow-xs shrink-0">
          <div
            class="w-4 h-full"
            style={{ 'background-color': initialColor() }}
            title={`Initial: ${initialColor().toUpperCase()}`}
          />
          <div
            class="w-6 h-full"
            style={{ 'background-color': props.color }}
            title={`Current: ${props.color.toUpperCase()}`}
          />
        </div>

        {/* Hex Input */}
        <div class="flex-1 flex items-center bg-zinc-900 border border-zinc-700/60 rounded-md px-2 py-1 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
          <span class="text-[11px] font-mono font-medium text-zinc-500 select-none mr-1">#</span>
          <input
            type="text"
            spellcheck={false}
            value={hexInput().replace(/^#/, '')}
            onFocus={() => setEditingText(true)}
            onInput={(e) => handleHexChange(e.currentTarget.value)}
            onBlur={commitHexInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            placeholder="hex, rgb(), hsl(), name"
            class="w-full bg-transparent font-mono text-xs font-semibold text-zinc-200 outline-hidden"
          />
          <button
            type="button"
            onClick={copyHex}
            title="Copy HEX to clipboard"
            class="text-zinc-500 hover:text-zinc-200 cursor-pointer ml-1"
          >
            {copied() ? <CheckIcon size={12} class="text-emerald-400" /> : <CopyIcon size={12} />}
          </button>
        </div>

        {/* RGB Channels */}
        <div class="flex items-center gap-1 shrink-0 font-mono text-[10px]">
          <div class="flex flex-col items-center">
            <span class="text-[9px] text-zinc-500">R</span>
            <input
              type="number"
              min="0"
              max="255"
              value={rgb().r}
              onInput={(e) => handleRgbChange('r', parseInt(e.currentTarget.value, 10))}
              class="w-9 text-center bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-200 outline-hidden focus:border-blue-500"
            />
          </div>
          <div class="flex flex-col items-center">
            <span class="text-[9px] text-zinc-500">G</span>
            <input
              type="number"
              min="0"
              max="255"
              value={rgb().g}
              onInput={(e) => handleRgbChange('g', parseInt(e.currentTarget.value, 10))}
              class="w-9 text-center bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-200 outline-hidden focus:border-blue-500"
            />
          </div>
          <div class="flex flex-col items-center">
            <span class="text-[9px] text-zinc-500">B</span>
            <input
              type="number"
              min="0"
              max="255"
              value={rgb().b}
              onInput={(e) => handleRgbChange('b', parseInt(e.currentTarget.value, 10))}
              class="w-9 text-center bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-200 outline-hidden focus:border-blue-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
