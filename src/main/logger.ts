import { app } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { inspect } from 'util'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Daily files older than this are pruned on startup. */
const KEEP_DAYS = 14
/** One argument can be a whole data URL or project JSON; nobody reads past this. */
const MAX_ARG_CHARS = 4000

let logsDir: string | null = null
let currentFile: string | null = null
let currentDay = ''
/** Console as it was before init — writing through the patched one would loop. */
const rawConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
}

export function getLogsDir(): string {
  return logsDir ?? join(app.getPath('userData'), 'logs')
}

function dayStamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fileFor(d: Date): string {
  const day = dayStamp(d)
  if (day !== currentDay || !currentFile) {
    currentDay = day
    currentFile = join(getLogsDir(), `meshcoat-${day}.log`)
  }
  return currentFile
}

function formatArg(arg: unknown): string {
  let text: string
  if (typeof arg === 'string') {
    text = arg
  } else if (arg instanceof Error) {
    text = arg.stack ?? `${arg.name}: ${arg.message}`
  } else {
    text = inspect(arg, { depth: 4, breakLength: Infinity })
  }
  return text.length > MAX_ARG_CHARS
    ? `${text.slice(0, MAX_ARG_CHARS)}… [${text.length - MAX_ARG_CHARS} more chars]`
    : text
}

/**
 * Appends one line to today's log file. Synchronous on purpose: the lines that
 * matter most are the ones written just before a crash or a forced quit, and a
 * buffered async write would lose exactly those.
 */
function writeLine(level: LogLevel, scope: string, args: unknown[]): void {
  if (!logsDir) {
    return
  }
  const now = new Date()
  const line = `${now.toISOString()} [${level.toUpperCase().padEnd(5)}] [${scope}] ${args
    .map(formatArg)
    .join(' ')}\n`
  try {
    appendFileSync(fileFor(now), line, 'utf-8')
  } catch {
    // Disk full or folder gone — logging must never take the app down with it.
  }
}

/** Writes to the log file and to the terminal. Renderer lines arrive here too, scoped by origin. */
export function log(level: LogLevel, scope: string, ...args: unknown[]): void {
  writeLine(level, scope, args)
  const out = level === 'debug' ? rawConsole.debug : rawConsole[level]
  out(`[${scope}]`, ...args)
}

export interface ScopedLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(scope: string): ScopedLogger {
  return {
    debug: (...args) => log('debug', scope, ...args),
    info: (...args) => log('info', scope, ...args),
    warn: (...args) => log('warn', scope, ...args),
    error: (...args) => log('error', scope, ...args)
  }
}

function pruneOldLogs(dir: string): void {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const name of readdirSync(dir)) {
    const match = /^meshcoat-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name)
    if (!match) {
      continue
    }
    const fileDay = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
    if (fileDay < cutoff) {
      try {
        unlinkSync(join(dir, name))
      } catch {
        // Harmless: it just lingers until the next startup.
      }
    }
  }
}

/**
 * Opens the log folder, prunes old files, routes the main process's console
 * through the file, and records crashes nothing else would catch. Call once,
 * as early as possible — anything logged before this only reaches the terminal.
 */
export function initLogger(): void {
  const dir = join(app.getPath('userData'), 'logs')
  try {
    mkdirSync(dir, { recursive: true })
    pruneOldLogs(dir)
    logsDir = dir
  } catch (err) {
    rawConsole.error('Logging to file disabled — could not prepare', dir, err)
    return
  }

  // Third-party and stray console calls in main still end up in the file.
  console.debug = (...args: unknown[]) => log('debug', 'main', ...args)
  console.log = (...args: unknown[]) => log('info', 'main', ...args)
  console.info = (...args: unknown[]) => log('info', 'main', ...args)
  console.warn = (...args: unknown[]) => log('warn', 'main', ...args)
  console.error = (...args: unknown[]) => log('error', 'main', ...args)

  // The monitor variant observes without replacing Electron's own handling
  // (its error dialog), which a plain 'uncaughtException' listener would.
  process.on('uncaughtExceptionMonitor', (err) => {
    log('error', 'main', 'Uncaught exception:', err)
  })
  process.on('unhandledRejection', (reason) => {
    log('error', 'main', 'Unhandled promise rejection:', reason)
  })

  log(
    'info',
    'app',
    `MeshCoat ${app.getVersion()} starting — ${process.platform} ${process.arch}, Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`
  )
  log('info', 'app', 'userData:', app.getPath('userData'))
}
