import { For, Show, createSignal, createEffect, on, type JSX } from 'solid-js'
import { listAvailableFonts } from '../paint/fonts'
import { TextIcon, SearchIcon } from './icons'
import { Modal, TextInput } from './ui'

export interface FontPickerModalProps {
  isOpen: boolean
  onClose: () => void
  /** Currently selected family, highlighted in the list. */
  value: string
  onSelect: (family: string) => void
  /** Sample drawn in each row, so the choice is made on the actual text. */
  sample?: string
}

/**
 * Picks a font from the ones the system actually has, each row previewed in
 * the face it names.
 *
 * The list is fetched when the modal opens rather than at boot: the Local Font
 * Access API only resolves off a user gesture, and opening this counts as one.
 */
export default function FontPickerModal(props: FontPickerModalProps): JSX.Element {
  const [fonts, setFonts] = createSignal<string[]>([])
  const [enumerated, setEnumerated] = createSignal(true)
  const [loading, setLoading] = createSignal(false)
  const [query, setQuery] = createSignal('')

  createEffect(
    on(
      () => props.isOpen,
      (open) => {
        if (!open) {
          return
        }
        setQuery('')
        setLoading(true)
        void listAvailableFonts()
          .then((result) => {
            setFonts(result.fonts)
            setEnumerated(result.enumerated)
          })
          .finally(() => setLoading(false))
      }
    )
  )

  const filtered = (): string[] => {
    const q = query().trim().toLowerCase()
    return q ? fonts().filter((f) => f.toLowerCase().includes(q)) : fonts()
  }

  /** Falls back to the family name when there's no text to preview yet. */
  const sample = (): string => {
    const text = (props.sample ?? '').split('\n')[0].trim()
    return text.length > 0 ? text.slice(0, 28) : 'Abc 123'
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Choose a Font"
      icon={(p) => <TextIcon size={p.size} class="text-[var(--accent-color)]" />}
      size="md"
    >
      <div class="flex flex-col gap-2 text-xs">
        <TextInput
          value={query()}
          onInput={setQuery}
          autofocus
          placeholder="Search fonts..."
          icon={(p) => <SearchIcon {...p} />}
          onKeyDown={(e) => e.stopPropagation()}
        />

        <Show when={!enumerated() && !loading()}>
          <p class="text-[10px] text-amber-400/90 leading-snug">
            Couldn&apos;t read the system font list, so this is the subset of common families found
            on this machine.
          </p>
        </Show>

        <div class="h-[22rem] overflow-y-auto flex flex-col gap-0.5 pr-0.5">
          <Show
            when={!loading()}
            fallback={<div class="p-3 text-[var(--text-muted)]">Loading fonts...</div>}
          >
            <Show
              when={filtered().length > 0}
              fallback={<div class="p-3 text-[var(--text-muted)] italic">No matching fonts.</div>}
            >
              <For each={filtered()}>
                {(family) => (
                  <button
                    type="button"
                    onClick={() => {
                      props.onSelect(family)
                      props.onClose()
                    }}
                    class={`flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-[var(--ui-radius)] border text-left cursor-pointer transition-colors ${
                      family === props.value
                        ? 'bg-[var(--accent-color)]/15 border-[var(--accent-color)]/60'
                        : 'bg-[var(--bg-input)] border-transparent hover:border-[var(--border-color)]'
                    }`}
                  >
                    <span class="text-[10px] text-[var(--text-muted)] truncate max-w-full">
                      {family}
                    </span>
                    <span
                      class="text-base text-[var(--text-main)] truncate max-w-full"
                      style={{ 'font-family': `"${family}"` }}
                    >
                      {sample()}
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </Modal>
  )
}
