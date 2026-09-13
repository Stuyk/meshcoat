import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readdirSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getBlenderPath, setBlenderPath } from './prefs'

const execFileAsync = promisify(execFile)

/**
 * Tests if a given path is an executable Blender binary by running `blender -v`.
 */
export async function testBlenderExecutable(
  executablePath: string
): Promise<{ valid: boolean; version?: string; error?: string }> {
  if (!executablePath || !existsSync(executablePath)) {
    return { valid: false, error: 'File does not exist' }
  }

  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ['-v'], {
      timeout: 10000
    })
    const output = (stdout || stderr || '').trim()
    const match = output.match(/Blender\s+([0-9.]+[\w\s-]*)/i)
    if (match) {
      return { valid: true, version: match[0].split('\n')[0].trim() }
    }
    return { valid: true, version: 'Blender (unknown version)' }
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Scans standard OS and user directories for Blender installations.
 */
export async function findSystemBlender(): Promise<string | null> {
  const candidates: string[] = []
  const home = homedir()

  // 1. Check user programs directory (e.g. ~/programs/blender-5.2.0-linux-x64/blender)
  const userProgramsDir = join(home, 'programs')
  if (existsSync(userProgramsDir)) {
    try {
      const entries = readdirSync(userProgramsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase().includes('blender')) {
          const directBin = join(userProgramsDir, entry.name, 'blender')
          const winBin = join(userProgramsDir, entry.name, 'blender.exe')
          if (existsSync(directBin)) candidates.push(directBin)
          if (existsSync(winBin)) candidates.push(winBin)
        }
      }
    } catch {}
  }

  // 2. Common user directories
  candidates.push(
    join(home, 'bin', 'blender'),
    join(home, '.local', 'bin', 'blender'),
    join(home, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender')
  )

  // 3. Linux system paths
  if (process.platform === 'linux') {
    candidates.push(
      '/usr/bin/blender',
      '/usr/local/bin/blender',
      '/snap/bin/blender',
      '/var/lib/flatpak/exports/bin/org.blender.Blender'
    )
  }

  // 4. Windows system paths
  if (process.platform === 'win32') {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const progFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const blenderFoundDir = join(progFiles, 'Blender Foundation')

    if (existsSync(blenderFoundDir)) {
      try {
        const entries = readdirSync(blenderFoundDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            candidates.push(join(blenderFoundDir, entry.name, 'blender.exe'))
          }
        }
      } catch {}
    }

    candidates.push(
      join(progFiles, 'Blender Foundation', 'Blender', 'blender.exe'),
      join(progFiles86, 'Blender Foundation', 'Blender', 'blender.exe'),
      join(progFiles, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe')
    )
  }

  // 5. macOS system paths
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Blender.app/Contents/MacOS/Blender',
      join(home, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender')
    )
  }

  // 6. Test candidates in order
  for (const path of candidates) {
    if (existsSync(path)) {
      const test = await testBlenderExecutable(path)
      if (test.valid) {
        return path
      }
    }
  }

  // 7. PATH lookup via `which` or `where`
  try {
    const lookupCmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(lookupCmd, ['blender'], { timeout: 5000 })
    const path = stdout.trim().split(/\r?\n/)[0]
    if (path && existsSync(path)) {
      const test = await testBlenderExecutable(path)
      if (test.valid) return path
    }
  } catch {}

  return null
}

/**
 * Returns the effective Blender path, checking saved preference first, then system.
 */
export async function getEffectiveBlender(): Promise<{
  path: string | null
  version?: string
}> {
  const saved = getBlenderPath()
  if (saved && existsSync(saved)) {
    const test = await testBlenderExecutable(saved)
    if (test.valid) {
      return { path: saved, version: test.version }
    }
  }

  const found = await findSystemBlender()
  if (found) {
    const test = await testBlenderExecutable(found)
    if (test.valid) {
      setBlenderPath(found)
      return { path: found, version: test.version }
    }
  }

  return { path: null }
}

/**
 * Converts a .blend file to a temporary .glb file using headless Blender.
 */
export async function convertBlendToGlb(
  blendPath: string
): Promise<{ glbPath: string; durationMs: number; version?: string }> {
  if (!existsSync(blendPath)) {
    throw new Error(`Blend file not found: ${blendPath}`)
  }

  const { path: blenderPath, version } = await getEffectiveBlender()
  if (!blenderPath) {
    throw new Error(
      'Blender executable not found. Please configure your Blender path in MeshCoat Settings.'
    )
  }

  const startTime = Date.now()
  const cacheDir = join(app.getPath('temp'), 'meshcoat-blend-cache')
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }

  const fileStem = blendPath.split(/[/\\]/).pop()?.replace(/\.blend$/i, '') || 'model'
  const outFileName = `${fileStem}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.glb`
  const glbPath = join(cacheDir, outFileName)
  const normalizedGlbPath = glbPath.replace(/\\/g, '/')

  // Export scene with evaluated modifiers (export_apply=True), tangents, and normals
  const pythonScript = `import bpy; bpy.ops.export_scene.gltf(filepath=r"${normalizedGlbPath}", export_format="GLB", export_apply=True, export_tangents=True)`

  try {
    await execFileAsync(
      blenderPath,
      ['-b', blendPath, '--python-expr', pythonScript],
      {
        timeout: 120000, // 2 minutes max
        maxBuffer: 20 * 1024 * 1024
      }
    )
  } catch (err) {
    throw new Error(
      `Blender conversion failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!existsSync(glbPath)) {
    throw new Error('Blender finished but no output .glb file was produced.')
  }

  const durationMs = Date.now() - startTime
  return { glbPath, durationMs, version }
}
