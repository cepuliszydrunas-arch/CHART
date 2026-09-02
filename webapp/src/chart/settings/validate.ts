/**
 * Settings validacija / sanitizacija.
 *
 * Naudojama tiek persistinant (kad localStorage būtų tik validus, serializuojamas
 * state), tiek užkraunant vartotojo įvestį iš UI. Kiekviena reikšmė, neatitinkanti
 * tipo diapazono, grąžinama į saugų default. Jokio `throw` — invalid reikšmės
 * taisomos, kad sugadintas localStorage nesulaužytų charto.
 */
import { defaultSettings, isChartSettingsKey, type ChartSettings, type PaneOverrides } from './model'

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && COLOR_RE.test(v)
}

function sanitizeUnion<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function sanitizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function sanitizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Paverčia Partial<ChartSettings> į pilną ChartSettings su default'ais ir
 * sanitizacija. Negaliojančios reikšmės → saugus default.
 */
export function sanitizeSettings(input: PaneOverrides): ChartSettings {
  const out: ChartSettings = { ...defaultSettings }
  const rec = out as unknown as Record<string, unknown>
  for (const key of Object.keys(defaultSettings) as (keyof ChartSettings)[]) {
    const v = input[key]
    if (v === undefined || v === null) continue
    const def = defaultSettings[key]
    switch (typeof def) {
      case 'boolean':
        rec[key as string] = sanitizeBool(v, def as boolean)
        break
      case 'number':
        rec[key as string] = sanitizeNumber(v, numberMin(key), numberMax(key), def as number)
        break
      case 'string':
        rec[key as string] = sanitizeString(key, v, def as string)
        break
    }
  }
  return out
}

function numberMin(key: keyof ChartSettings): number {
  switch (key) {
    case 'gridOpacity': case 'volumeOpacity': case 'drawingOpacity': case 'watermarkOpacity': return 0.05
    case 'candleWidth': return 1
    case 'arrowPanStep': return 1
    case 'zoomSensitivity': case 'panSensitivity': return 0.1
    case 'watermarkFontSize': return 10
    case 'drawingLineWidth': return 0.5
    case 'gridWidth': return 0.5
    case 'borderWidth': return 0
    default: return -Infinity
  }
}

function numberMax(key: keyof ChartSettings): number {
  switch (key) {
    case 'gridOpacity': case 'volumeOpacity': case 'drawingOpacity':
    case 'watermarkOpacity': return 1
    case 'candleWidth': return 100
    case 'arrowPanStep': return 100
    case 'zoomSensitivity': case 'panSensitivity': return 10
    case 'watermarkFontSize': return 160
    case 'drawingLineWidth': return 10
    case 'gridWidth': case 'borderWidth': return 8
    default: return Infinity
  }
}

function sanitizeString(key: keyof ChartSettings, value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  switch (key) {
    case 'timezone': return sanitizeUnion(value, ['local', 'utc', 'exchange'], 'local')
    case 'crosshairMode': return sanitizeUnion(value, ['off', 'normal', 'magnet'], 'normal')
    case 'lastPriceLineStyle': return sanitizeUnion(value, ['solid', 'dashed', 'dotted'], 'solid')
    case 'grid': return sanitizeUnion(value, ['both', 'horizontal', 'vertical', 'none'], 'both')
    case 'gridLineStyle': return sanitizeUnion(value, ['solid', 'dashed', 'dotted'], 'solid')
    case 'watermarkPosition': return sanitizeUnion(value, ['tl', 'tr', 'bl', 'br', 'center'], 'center')
    case 'labelFontSize': return sanitizeUnion(value, ['small', 'medium', 'large'], 'medium')
    case 'cursorStyle': return sanitizeUnion(value, ['crosshair', 'default', 'hidden'], 'crosshair')
    case 'chartStyle': return sanitizeUnion(value, ['candle', 'bar', 'hollow', 'heikin', 'line', 'area'], 'candle')
    case 'priceSource': return sanitizeUnion(value, ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'], 'close')
    case 'volumePosition': return sanitizeUnion(value, ['bottom', 'hidden'], 'bottom')
    case 'priceScalePos': return sanitizeUnion(value, ['right', 'left', 'both', 'hidden'], 'right')
    case 'timeScalePos': return sanitizeUnion(value, ['bottom', 'hidden', 'top'], 'bottom')
    case 'wheelMode': return sanitizeUnion(value, ['zoom', 'scroll', 'disabled'], 'zoom')
    case 'zoomMode': return sanitizeUnion(value, ['xy', 'h', 'v'], 'xy')
    case 'doubleClickAction': return sanitizeUnion(value, ['fit', 'reset', 'disabled'], 'fit')
    case 'dragAction': return sanitizeUnion(value, ['pan', 'disabled'], 'pan')
    case 'drawingLineStyle': return sanitizeUnion(value, ['solid', 'dashed', 'dotted'], 'solid')
    case 'bullColor': case 'bearColor': case 'wickColor': case 'bullBorderColor':
    case 'bearBorderColor': case 'bullVolumeColor': case 'bearVolumeColor':
    case 'chartBackground': case 'plotBackground': case 'gridColor': case 'borderColor':
    case 'axisColor': case 'axisLabelColor': case 'lastPriceLineColor': case 'drawingLineColor':
      return isHexColor(value) ? value : fallback
    case 'watermarkText':
      return value.slice(0, 64)
    default:
      return value
  }
}

/** Ar reikšmė 'auto' arba validus non-negatyvus int (precision). */
export function sanitizePrecision(value: unknown): number | 'auto' {
  if (value === 'auto') return 'auto'
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8) {
    return Math.floor(value)
  }
  return 'auto'
}

/** Persistencijai: reguliuoja vieną partial (pane override / workspace). */
export function sanitizePaneOverrides(input: unknown): PaneOverrides {
  if (!input || typeof input !== 'object') return {}
  const out: PaneOverrides = {}
  for (const [k, v] of Object.entries(input)) {
    if (isChartSettingsKey(k) && v !== undefined) {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return sanitizeSettings(out)
}