import { createSignal, createEffect, Show } from 'solid-js'
import { Modal, Button, Badge, Label, TextInput } from './ui'
import { SettingsIcon, FolderOpenIcon, CheckIcon, XIcon, RefreshCwIcon } from './icons'

export interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
}

export default function SettingsModal(props: SettingsModalProps) {
  const [blenderPath, setBlenderPath] = createSignal<string>('')
  const [blenderVersion, setBlenderVersion] = createSignal<string | null>(null)
  const [isDetected, setIsDetected] = createSignal<boolean>(false)
  const [isChecking, setIsChecking] = createSignal<boolean>(false)
  const [statusMessage, setStatusMessage] = createSignal<string | null>(null)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)

  createEffect(() => {
    if (props.isOpen) {
      void checkBlenderStatus()
    }
  })

  async function checkBlenderStatus(): Promise<void> {
    setIsChecking(true)
    setErrorMessage(null)
    try {
      const res = await window.api.detectBlender()
      if (res.path) {
        setBlenderPath(res.path)
        setBlenderVersion(res.version || 'Detected')
        setIsDetected(true)
      } else {
        setIsDetected(false)
        setBlenderVersion(null)
      }
    } catch (err) {
      setIsDetected(false)
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setIsChecking(false)
    }
  }

  async function handleBrowseBlender(): Promise<void> {
    setIsChecking(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const res = await window.api.browseBlenderExecutable()
      if (res && res.success && res.path) {
        setBlenderPath(res.path)
        setBlenderVersion(res.version || 'Configured')
        setIsDetected(true)
        setStatusMessage('Blender path successfully configured!')
        props.onToast?.('Blender executable configured', 'success')
      } else if (res && !res.success) {
        setErrorMessage(res.error || 'Selected file is not a valid Blender executable')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setIsChecking(false)
    }
  }

  async function handleAutoDetect(): Promise<void> {
    setIsChecking(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const res = await window.api.detectBlender()
      if (res.path) {
        setBlenderPath(res.path)
        setBlenderVersion(res.version || 'Detected')
        setIsDetected(true)
        setStatusMessage(`Found ${res.version || 'Blender'} at ${res.path}`)
        props.onToast?.(`Detected ${res.version || 'Blender'}`, 'success')
      } else {
        setIsDetected(false)
        setErrorMessage(
          'Blender could not be found automatically. Please browse and select your Blender binary.'
        )
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setIsChecking(false)
    }
  }

  async function handleSaveCustomPath(): Promise<void> {
    const p = blenderPath().trim()
    setIsChecking(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const res = await window.api.setBlenderPath(p || null)
      if (res.success) {
        if (p) {
          setIsDetected(true)
          setBlenderVersion(res.version || 'Configured')
          setStatusMessage('Blender executable verified and saved.')
          props.onToast?.('Blender path saved', 'success')
        } else {
          setIsDetected(false)
          setBlenderVersion(null)
          setStatusMessage('Blender path cleared.')
        }
      } else {
        setErrorMessage(res.error || 'Failed to verify Blender executable at given path.')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setIsChecking(false)
    }
  }

  async function handleClearPath(): Promise<void> {
    setBlenderPath('')
    await handleSaveCustomPath()
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Settings & Preferences"
      icon={(p) => <SettingsIcon size={p.size} class="text-blue-400" />}
      size="lg"
      footer={
        <div class="flex items-center justify-end gap-2 w-full">
          <Button variant="primary" onClick={props.onClose} class="text-xs">
            Done
          </Button>
        </div>
      }
    >
      <div class="flex flex-col gap-5 py-1">
        {/* Status Alerts */}
        <Show when={statusMessage()}>
          <div class="p-3 bg-emerald-950/40 border border-emerald-800 rounded-lg text-xs text-emerald-300 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <CheckIcon size={14} class="text-emerald-400" />
              <span>{statusMessage()}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              class="text-emerald-400 hover:text-emerald-200 cursor-pointer"
            >
              <XIcon size={12} />
            </button>
          </div>
        </Show>

        <Show when={errorMessage()}>
          <div class="p-3 bg-red-950/50 border border-red-800 rounded-lg text-xs text-red-300 flex items-center justify-between">
            <span>{errorMessage()}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              class="text-red-400 hover:text-red-200 cursor-pointer"
            >
              <XIcon size={12} />
            </button>
          </div>
        </Show>

        {/* 1. Blender Integration Section */}
        <div class="flex flex-col gap-3 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-orange-600/20 text-orange-400">
                <SettingsIcon size={16} />
              </div>
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-zinc-200">Blender 3D Bridge</span>
                <span class="text-[10px] text-zinc-500">
                  Directly import native .blend files into MeshCoat
                </span>
              </div>
            </div>
            <Badge variant={isDetected() ? 'success' : 'amber'} size="xs">
              {isDetected() ? blenderVersion() || 'Ready' : 'Not Configured'}
            </Badge>
          </div>

          <p class="text-[11px] text-zinc-400 leading-relaxed">
            MeshCoat converts native <strong>.blend</strong> files in the background using headless
            Blender. This accurately evaluates all modifiers (Subdivision, Mirror, Bevel, Geometry
            Nodes) and UV coordinates into seamless paintable meshes.
          </p>

          {/* Current Path & Config Input */}
          <div class="flex flex-col gap-1.5 pt-1">
            <Label>Blender Executable Location</Label>
            <div class="flex items-center gap-2">
              <TextInput
                value={blenderPath()}
                onInput={setBlenderPath}
                placeholder="/usr/bin/blender or C:\Program Files\Blender Foundation\Blender\blender.exe"
                mono
                size="sm"
                class="flex-1"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBrowseBlender}
                disabled={isChecking()}
                class="shrink-0 text-xs"
              >
                <FolderOpenIcon size={13} />
                <span>Browse...</span>
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div class="flex items-center justify-between pt-1">
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={handleAutoDetect}
                disabled={isChecking()}
                class="text-zinc-400 hover:text-zinc-200"
              >
                <RefreshCwIcon size={12} class={isChecking() ? 'animate-spin' : ''} />
                <span>Auto-Detect</span>
              </Button>
              <Show when={blenderPath()}>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleClearPath}
                  disabled={isChecking()}
                  class="text-zinc-500 hover:text-zinc-300"
                >
                  Clear Path
                </Button>
              </Show>
            </div>

            <Button
              variant="primary"
              size="xs"
              onClick={handleSaveCustomPath}
              disabled={isChecking()}
            >
              {isChecking() ? 'Verifying...' : 'Save & Verify'}
            </Button>
          </div>
        </div>

        {/* 2. Format Capabilities Summary */}
        <div class="flex flex-col gap-2.5 p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
          <Label uppercase>Supported 3D Model Formats</Label>
          <div class="grid grid-cols-2 gap-2 text-xs text-zinc-300">
            <div class="flex items-center gap-2 p-2 rounded-lg bg-zinc-900/40 border border-zinc-850">
              <span class="font-mono text-blue-400 font-semibold">.glb / .gltf</span>
              <span class="text-[10px] text-zinc-500">Native glTF 2.0 (Fastest)</span>
            </div>
            <div class="flex items-center gap-2 p-2 rounded-lg bg-zinc-900/40 border border-zinc-850">
              <span class="font-mono text-purple-400 font-semibold">.obj</span>
              <span class="text-[10px] text-zinc-500">Wavefront OBJ with UVs</span>
            </div>
            <div class="flex items-center gap-2 p-2 rounded-lg bg-zinc-900/40 border border-zinc-850">
              <span class="font-mono text-orange-400 font-semibold">.blend</span>
              <span class="text-[10px] text-zinc-500">Blender Native (Headless bridge)</span>
            </div>
            <div class="flex items-center gap-2 p-2 rounded-lg bg-zinc-900/40 border border-zinc-850">
              <span class="font-mono text-emerald-400 font-semibold">.meshcoat</span>
              <span class="text-[10px] text-zinc-500">Full layer projects with undo</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
