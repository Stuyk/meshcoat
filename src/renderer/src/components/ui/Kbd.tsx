import { type JSX } from 'solid-js'

export interface KbdProps {
  children: JSX.Element
  size?: 'xs' | 'sm'
  class?: string
}

export default function Kbd(props: KbdProps) {
  const sizeClass = () =>
    props.size === 'xs' ? 'text-[9px] px-1 py-0' : 'text-[10px] px-1.5 py-0.5'

  return (
    <kbd
      class={`inline-flex items-center justify-center font-mono font-medium rounded bg-zinc-900 border border-zinc-800 text-zinc-400 select-none shadow-xs uppercase tracking-tight ${sizeClass()} ${
        props.class ?? ''
      }`}
    >
      {props.children}
    </kbd>
  )
}
