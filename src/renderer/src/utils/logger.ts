/**
 * Renderer-side logging. Every line still goes to the devtools console, and is
 * also sent to the main process, which appends it to the log file in the
 * userData/logs folder (Settings → Open Logs Folder).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Matches main/logger.ts — a stamp-footprint data URL is megabytes long. */
const MAX_ARG_CHARS = 4000

const rawConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
}

function truncate(text: string): string {
  return text.length > MAX_ARG_CHARS
    ? `${text.slice(0, MAX_ARG_CHARS)}… [${text.length - MAX_ARG_CHARS} more chars]`
    : text
}

/** IPC structured-clones its arguments, which fails on DOM nodes, functions and GPU objects — so everything crosses as text. */
function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return truncate(arg)
  }
  if (arg instanceof Error) {
    return truncate(arg.stack ?? `${arg.name}: ${arg.message}`)
  }
  if (arg === undefined || typeof arg === 'function' || typeof arg === 'symbol') {
    return String(arg)
  }
  try {
    return truncate(JSON.stringify(arg) ?? String(arg))
  } catch {
    return truncate(String(arg))
  }
}

/**
 * A warning raised every frame (a bad uniform, a missing texture) would write
 * thousands of lines a minute, so each window gets a budget; the overflow is
 * counted and reported once the next window opens.
 */
const BUDGET_WINDOW_MS = 10_000
const BUDGET_LINES = 200
let windowStart = 0
let windowLines = 0
let droppedLines = 0

function sendToFile(level: LogLevel, scope: string, args: unknown[]): void {
  const now = Date.now()
  if (now - windowStart > BUDGET_WINDOW_MS) {
    windowStart = now
    windowLines = 0
    if (droppedLines > 0) {
      const dropped = droppedLines
      droppedLines = 0
      sendToFile('warn', 'logger', [`${dropped} log lines dropped (rate limit)`])
    }
  }
  if (++windowLines > BUDGET_LINES) {
    droppedLines++
    return
  }
  try {
    window.api?.writeLog(level, scope, args.map(serializeArg))
  } catch {
    // No preload (tests, popups) or IPC gone — the console copy is all there is.
  }
}

export interface ScopedLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(scope: string): ScopedLogger {
  const emit =
    (level: LogLevel) =>
    (...args: unknown[]): void => {
      rawConsole[level](`[${scope}]`, ...args)
      sendToFile(level, scope, args)
    }
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error')
  }
}

let installed = false

/**
 * Routes stray console.warn/error calls (ours and third-party, e.g. three.js
 * shader compile errors) and uncaught errors into the log file. console.log
 * stays console-only: it's where the viewport's per-stroke debug output goes.
 */
export function installConsoleCapture(): void {
  if (installed) {
    return
  }
  installed = true

  console.warn = (...args: unknown[]): void => {
    rawConsole.warn(...args)
    sendToFile('warn', 'console', args)
  }
  console.error = (...args: unknown[]): void => {
    rawConsole.error(...args)
    sendToFile('error', 'console', args)
  }

  window.addEventListener('error', (event) => {
    sendToFile('error', 'uncaught', [
      event.error ?? event.message,
      `at ${event.filename}:${event.lineno}:${event.colno}`
    ])
  })
  window.addEventListener('unhandledrejection', (event) => {
    sendToFile('error', 'unhandled-rejection', [event.reason])
  })
}
