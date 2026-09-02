/// <reference lib="dom" />
/**
 * Client entry — Chart Settings engine browser bundle.
 * `vite build --config vite.settings.config.ts` → public/static/settings.js
 * Eksponuoja `window.HgfxSettings` API, kuriuo naudojasi terminal.js (vanilla UI).
 */
import {
  defaultSettings,
  CATEGORIES,
  emptyStore,
  hydrate,
  serialize,
  setValue,
  resetPane,
  resetAll,
  mergeSettings,
  storeHasChanges,
  sanitizePaneOverrides
} from '../chart/settings'
import type { ChartSettings, PaneOverrides } from '../chart/settings'

export interface HgfxSettingsApi {
  defaults: ChartSettings
  categories: typeof CATEGORIES
  hydrate: typeof hydrate
  serialize: typeof serialize
  setValue: typeof setValue
  resetPane: typeof resetPane
  resetAll: typeof resetAll
  mergeSettings: typeof mergeSettings
  storeHasChanges: typeof storeHasChanges
  sanitizePaneOverrides: typeof sanitizePaneOverrides
  load: () => ReturnType<typeof hydrate>
  persist: (state: Parameters<typeof serialize>[0]) => void
}

declare global {
  interface Window {
    HgfxSettings?: HgfxSettingsApi
  }
}

if (typeof window !== 'undefined') {
  const STORAGE_KEY = 'hgfx.settings.v1'
  function load(): ReturnType<typeof hydrate> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return hydrate(raw ? JSON.parse(raw) : null)
    } catch {
      return emptyStore()
    }
  }
  function persist(state: Parameters<typeof serialize>[0]): void {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(state))
    } catch {
      /* quota / private mode — tyliai ignoruojame */
    }
  }
  const api: HgfxSettingsApi = {
    defaults: defaultSettings,
    categories: CATEGORIES,
    hydrate,
    serialize,
    setValue,
    resetPane,
    resetAll,
    mergeSettings,
    storeHasChanges,
    sanitizePaneOverrides,
    load,
    persist
  }
  window.HgfxSettings = api
}
export default {}