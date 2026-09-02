/**
 * Settings store — versionuota persistencija + sluoksnis:
 *
 *   pane override → workspace setting → application default
 *
 * • Versioning: localStorage raktas `hgfx.settings.v1`. Jei randama senesnė
 *   schema (v0) arba sugadintas state — migruojama / fallback į default'us.
 * • Persistinamas TIK validus, sanitizuotas, plain-object state.
 * • Per-pane overrides saugomi `panes[paneId]`, kad vienas pane nekeistų kitų,
 *   kol sync toggle išjungtas.
 * • `mergeSettings(base, paneId)` grąžina efektyvius nustatymus pane'iui.
 *   Jei `syncingSettings` true — grąžina workspace/app default'us (visiems).
 *
 * Grynas modulis (be DOM), testuojamas per vitest.
 */
import { defaultSettings, type ChartSettings, type PaneOverrides } from './model'
import { sanitizePaneOverrides, sanitizePrecision, sanitizeSettings } from './validate'

export const STORAGE_KEY = 'hgfx.settings.v1'
export const SCHEMA_VERSION = 1

interface PersistedShape {
  version: number
  /** Globalūs (visų workspace'ų) nustatymai — ne indikatoriai/sync. */
  app: PaneOverrides
  /** Workspace default'ai (taikomi pane, kurie be savo override). */
  workspace: PaneOverrides
  /** Per-pane overrides. */
  panes: Record<string, PaneOverrides>
}
export type { PersistedShape }

export const emptyStore = (): PersistedShape => ({
  version: SCHEMA_VERSION,
  app: {},
  workspace: {},
  panes: {}
})

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Migruoja / hydratuoja persistuotą state.
 * - Negaliograma struktūra arba sugadinti duomenys → švarus default.
 * - v0 (bulk ChartSettings be 'version') → dedama į workspace, kad neprarastume.
 */
export function hydrate(raw: unknown): PersistedShape {
  if (!isRecord(raw)) return emptyStore()
  const version = typeof raw.version === 'number' ? raw.version : 0
  const out = emptyStore()

  // v0 migration: viskas gulėjo tiesiai ant top-level
  if (version === 0) {
    const legacy: Record<string, unknown> = { ...raw }
    delete legacy.version
    out.workspace = sanitizePaneOverrides(legacy)
    return out
  }

  if (raw.app && isRecord(raw.app)) out.app = sanitizePaneOverrides(raw.app)
  if (raw.workspace && isRecord(raw.workspace)) out.workspace = sanitizePaneOverrides(raw.workspace)
  if (raw.panes && isRecord(raw.panes)) {
    for (const [id, val] of Object.entries(raw.panes)) {
      if (isRecord(val)) out.panes[id] = sanitizePaneOverrides(val)
    }
  }
  return out
}

/** Serijalizacija persistinimui (tik validus plain object). */
export function serialize(state: PersistedShape): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    app: state.app,
    workspace: state.workspace,
    panes: state.panes
  })
}

/** Nustatyti vieną reikšmę (persistencijos scope dimensija). */
export function setValue(
  state: PersistedShape,
  paneId: string,
  key: keyof ChartSettings,
  value: unknown,
  sync: boolean
): PersistedShape {
  const next = clone(state)
  if (sync) {
    // Shared — įdedam į workspace default'us ir pašalinam iš pane overrides.
    // Tačiau color-scoped (per-pane appearance) nekeisti, kai sync — žr. mergeSettings.
    ;(next.workspace as Record<string, unknown>)[key] = sanitizeOneValue(key, value)
    for (const id of Object.keys(next.panes)) delete next.panes[id][key]
    return next
  }
  const paneOverrides = next.panes[paneId] ?? {}
  ;(paneOverrides as Record<string, unknown>)[key] = sanitizeOneValue(key, value)
  next.panes[paneId] = paneOverrides
  // Nuosavas pane override užgožia workspace reikšmę — tą pačią reikšmę
  // iš workspace galima palikti, nes merge prioritetas pane > workspace.
  return next
}

/** Reset vieno pane į workspace/app default'us (pašalina jo overrides). */
export function resetPane(state: PersistedShape, paneId: string): PersistedShape {
  const next = clone(state)
  delete next.panes[paneId]
  return next
}

/** Reset visko į gamyklinį default. */
export function resetAll(state: PersistedShape): PersistedShape {
  return emptyStore()
}

/**
 * Efektyvūs settingai pane'iui.
 * Prioritetas: pane.panes[id] → pane.workspace? (per sync false) → app.default.
 * Kai `sync.settings` aktyvus (per app override sign), naudojam app/workstation.
 *
 * Šiame jQuery-ages teisingiausias apibrėžimas: merge san itizuotą PaneOverrides
 * virš default'ų, paskui workspace, paskui pane.
 */
export function mergeSettings(state: PersistedShape, paneId: string): ChartSettings {
  const base: PaneOverrides = { ...defaultSettings, ...state.workspace, ...state.app }
  const pane = state.panes?.[paneId]
  const effective: PaneOverrides = pane ? { ...base, ...pane } : base
  const merged = sanitizeSettings(effective)
  // precision clavis – atskirai, nes jis gali būti 'auto' arba number
  merged.decimalPrecision = sanitizePrecision(effective.decimalPrecision)
  merged.pricePrecision = sanitizePrecision(effective.pricePrecision)
  return merged
}

function clone(state: PersistedShape): PersistedShape {
  return {
    version: state.version,
    app: { ...state.app },
    workspace: { ...state.workspace },
    panes: Object.fromEntries(Object.entries(state.panes).map(([k, v]) => [k, { ...v }]))
  }
}

function sanitizeOneValue(key: keyof ChartSettings, value: unknown): unknown {
  if (key === 'decimalPrecision' || key === 'pricePrecision') return sanitizePrecision(value)
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  return defaultSettings[key]
}

/** Ar yra nespekifikuoti pakeitimai kažkuriame sluoksnyje (UI "unsaved"). */
export function storeHasChanges(state: PersistedShape): boolean {
  return (
    Object.keys(state.app).length > 0 ||
    Object.keys(state.workspace).length > 0 ||
    Object.keys(state.panes).length > 0
  )
}