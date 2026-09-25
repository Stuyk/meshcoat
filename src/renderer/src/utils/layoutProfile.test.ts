import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadLayoutProfile,
  saveLayoutProfile,
  flushLayoutProfile,
  DEFAULT_PROFILE,
  PROFILE_STORAGE_KEY,
  LEGACY_SIDEBAR_KEY
} from './layoutProfile'

// Mock localStorage in Node/Bun environment
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, val: string) => {
    store.set(key, String(val))
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  }
}
;(globalThis as any).localStorage = mockLocalStorage

describe('layoutProfile', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
    saveLayoutProfile(DEFAULT_PROFILE)
    flushLayoutProfile()
  })

  it('loads defaults when storage is empty', () => {
    mockLocalStorage.clear()
    const profile = loadLayoutProfile()
    expect(profile.sidebarWidth).toBe(DEFAULT_PROFILE.sidebarWidth)
    expect(profile.textureDrawerHeight).toBe(DEFAULT_PROFILE.textureDrawerHeight)
    expect(profile.lightingMode).toBe('neutral')
  })

  it('migrates from legacy sidebar key if profile key is not set', () => {
    mockLocalStorage.clear()
    mockLocalStorage.setItem(LEGACY_SIDEBAR_KEY, JSON.stringify({ width: 380, layers: 260 }))
    saveLayoutProfile({ sidebarWidth: 380, layersHeight: 260 })
    flushLayoutProfile()
    const profile = loadLayoutProfile()
    expect(profile.sidebarWidth).toBe(380)
    expect(profile.layersHeight).toBe(260)
  })

  it('clamps and validates out-of-bound values safely', () => {
    saveLayoutProfile({
      sidebarWidth: 5000,
      textureDrawerHeight: 10,
      toolPanelWidth: 50,
      lightingMode: 'outdoor',
      toolPanelCollapsed: true
    })
    flushLayoutProfile()

    const profile = loadLayoutProfile()
    expect(profile.sidebarWidth).toBeLessThan(5000)
    expect(profile.textureDrawerHeight).toBeGreaterThanOrEqual(140)
    expect(profile.toolPanelWidth).toBeGreaterThanOrEqual(240)
    expect(profile.lightingMode).toBe('outdoor')
    expect(profile.toolPanelCollapsed).toBe(true)
  })

  it('saves and remembers panel state between sessions', () => {
    saveLayoutProfile({
      textureDrawerCollapsed: true,
      textureDrawerHeight: 280,
      sidebarCollapsed: true,
      showUvPanel: true,
      uvPanelWidth: 600,
      uvPanelHeight: 700,
      uvPanelX: 150,
      uvPanelY: 200,
      paletteMode: 'presets',
      activePresetId: 'skin'
    })
    flushLayoutProfile()

    const raw = JSON.parse(mockLocalStorage.getItem(PROFILE_STORAGE_KEY)!)
    expect(raw.textureDrawerCollapsed).toBe(true)
    expect(raw.textureDrawerHeight).toBe(280)
    expect(raw.sidebarCollapsed).toBe(true)
    expect(raw.showUvPanel).toBe(true)
    expect(raw.uvPanelWidth).toBe(600)
    expect(raw.paletteMode).toBe('presets')
    expect(raw.activePresetId).toBe('skin')
  })
})
