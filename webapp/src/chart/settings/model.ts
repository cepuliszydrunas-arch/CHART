/**
 * Chart Settings — griežtai tipizuotas modelis ir default'ai.
 *
 * Šis failas yra grynas (be DOM), kad būtų lengvai testuojamas per vitest.
 * Nustatymų hierarchija / prioritetas apibrėžti `store.ts`:
 *   pane override → workspace setting → application default.
 *
 * Kiekvienas laukas, kurio engine dar NEPALAIKO, žymimas `available:false`
 * su `whyUnavailable` paaiškinimu — UI juos rodo disabled su tooltip.
 * Jokių "demo/mock" settings: viskas arba veikia, arba aiškiai pasakyta, kodėl ne.
 */

// ---------------------------------------------------------------------------
// Tipai
// ---------------------------------------------------------------------------

export type CandleStyle = 'candle' | 'bar' | 'hollow' | 'heikin' | 'line' | 'area'
export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4'
export type PriceScalePos = 'right' | 'left' | 'both' | 'hidden'
export type TimeScalePos = 'bottom' | 'hidden' | 'top'
export type WheelMode = 'zoom' | 'scroll' | 'disabled'
export type ZoomMode = 'xy' | 'h' | 'v'
export type DoubleClickAction = 'fit' | 'reset' | 'disabled'
export type DragAction = 'pan' | 'disabled'
export type Timezone = 'local' | 'utc' | 'exchange'
export type LineStyle = 'solid' | 'dashed' | 'dotted'
export type GridOption = 'both' | 'horizontal' | 'vertical' | 'none'
export type CrosshairMode = 'off' | 'normal' | 'magnet'
export type VolumePosition = 'bottom' | 'hidden'
export type WatermarkPosition = 'tl' | 'tr' | 'bl' | 'br' | 'center'
export type FontSize = 'small' | 'medium' | 'large'
export type CursorStyle = 'crosshair' | 'default' | 'hidden'

/** Vieta, kurioje nustatymas saugomas (persistencijos strategija). */
export type PersistScope = 'app' | 'workspace' | 'pane'

export type SettingCategory =
  | 'general'
  | 'appearance'
  | 'candles'
  | 'axes'
  | 'interaction'
  | 'indicators'
  | 'drawings'
  | 'orderflow'
  | 'layout'

// ---------------------------------------------------------------------------
// ChartSettings modelis
// ---------------------------------------------------------------------------

export interface ChartSettings {
  // ---- General ----
  showTitle: boolean
  showSymbolHeader: boolean
  timezone: Timezone
  pricePrecision: number | 'auto'
  thousandsSeparator: boolean
  crosshairMode: CrosshairMode
  showLastPriceLine: boolean
  lastPriceLineColor: string
  lastPriceLineStyle: LineStyle
  showLastPriceLabel: boolean
  syncSymbolAcrossPanes: boolean
  syncTimeframeAcrossPanes: boolean
  syncSettingsAcrossPanes: boolean

  // ---- Appearance ----
  chartBackground: string
  plotBackground: string
  grid: GridOption
  gridColor: string
  gridOpacity: number
  gridWidth: number
  gridLineStyle: LineStyle
  showBorder: boolean
  borderColor: string
  borderWidth: number
  showWatermark: boolean
  watermarkText: string
  watermarkOpacity: number
  watermarkPosition: WatermarkPosition
  watermarkFontSize: number
  labelFontSize: FontSize
  cursorStyle: CursorStyle

  // ---- Candles / Bars ----
  chartStyle: CandleStyle
  bullColor: string
  bearColor: string
  wickColor: string
  bullBorderColor: string
  bearBorderColor: string
  showWicks: boolean
  showCandleBorders: boolean
  candleWidth: number
  hollowStyle: boolean
  priceSource: PriceSource
  showVolume: boolean
  volumePosition: VolumePosition
  bullVolumeColor: string
  bearVolumeColor: string
  volumeOpacity: number

  // ---- Scales & Axes ----
  priceScalePos: PriceScalePos
  timeScalePos: TimeScalePos
  autoScale: boolean
  logScale: boolean
  invertPriceScale: boolean
  showPriceLabels: boolean
  showTimeLabels: boolean
  axisColor: string
  axisLabelColor: string
  decimalPrecision: number | 'auto'
  showOHLC: boolean

  // ---- Interaction ----
  wheelMode: WheelMode
  zoomMode: ZoomMode
  zoomToCursor: boolean
  doubleClickAction: DoubleClickAction
  dragAction: DragAction
  spaceDragPan: boolean
  keyboardShortcuts: boolean
  arrowPanStep: number
  zoomSensitivity: number
  panSensitivity: number
  pinchZoom: boolean
  twoFingerPan: boolean
  doubleTapReset: boolean

  // ---- Indicators (enable/flags) ----
  indEMA20: boolean
  indEMA50: boolean
  indSMA200: boolean
  indVWAP: boolean
  indBB: boolean
  indVolume: boolean
  indCVD: boolean

  // ---- Drawings ----
  showDrawings: boolean
  lockDrawings: boolean
  drawingLineColor: string
  drawingLineWidth: number
  drawingLineStyle: LineStyle
  drawingOpacity: number
  magnetMode: boolean

  // ---- Order Flow / Footprint ----
  footprintEnabled: boolean
  obEnabled: boolean
  tapeEnabled: boolean

  // ---- Layout ----
  snapToGrid: boolean
}


// ---------------------------------------------------------------------------
// Defaults — atitinka realų chart pradinį look (Nordic-Atelier dark)
// ---------------------------------------------------------------------------

export const defaultSettings: ChartSettings = {
  // General
  showTitle: true,
  showSymbolHeader: true,
  timezone: 'local',
  pricePrecision: 'auto',
  thousandsSeparator: true,
  crosshairMode: 'normal',
  showLastPriceLine: true,
  lastPriceLineColor: '#e8e9ea',
  lastPriceLineStyle: 'solid',
  showLastPriceLabel: true,
  syncSymbolAcrossPanes: false,
  syncTimeframeAcrossPanes: false,
  syncSettingsAcrossPanes: false,

  // Appearance
  chartBackground: '#0b0d0e',
  plotBackground: '#0b0d0e',
  grid: 'both',
  gridColor: '#1c2024',
  gridOpacity: 1,
  gridWidth: 1,
  gridLineStyle: 'solid',
  showBorder: true,
  borderColor: '#1c2024',
  borderWidth: 1,
  showWatermark: false,
  watermarkText: 'HUGOFXLAB',
  watermarkOpacity: 0.6,
  watermarkPosition: 'center',
  watermarkFontSize: 48,
  labelFontSize: 'medium',
  cursorStyle: 'crosshair',

  // Candles / Bars
  chartStyle: 'candle',
  bullColor: '#2ebd85',
  bearColor: '#e0483e',
  wickColor: '#2ebd85',
  bullBorderColor: '#2ebd85',
  bearBorderColor: '#e0483e',
  showWicks: true,
  showCandleBorders: true,
  candleWidth: 62,
  hollowStyle: true,
  priceSource: 'close',
  showVolume: true,
  volumePosition: 'bottom',
  bullVolumeColor: '#2ebd85',
  bearVolumeColor: '#e0483e',
  volumeOpacity: 0.3,

  // Scales & Axes
  priceScalePos: 'right',
  timeScalePos: 'bottom',
  autoScale: true,
  logScale: false,
  invertPriceScale: false,
  showPriceLabels: true,
  showTimeLabels: true,
  axisColor: '#1c2024',
  axisLabelColor: '#8b909a',
  decimalPrecision: 'auto',
  showOHLC: true,

  // Interaction
  wheelMode: 'zoom',
  zoomMode: 'xy',
  zoomToCursor: true,
  doubleClickAction: 'fit',
  dragAction: 'pan',
  spaceDragPan: true,
  keyboardShortcuts: true,
  arrowPanStep: 15,
  zoomSensitivity: 1,
  panSensitivity: 1,
  pinchZoom: true,
  twoFingerPan: true,
  doubleTapReset: true,

  // Indicators
  indVolume: true,
  indEMA20: false,
  indEMA50: false,
  indSMA200: false,
  indVWAP: false,
  indBB: false,
  indCVD: false,

  // Drawings
  showDrawings: true,
  lockDrawings: false,
  drawingLineColor: '#e0c46c',
  drawingLineWidth: 1.4,
  drawingLineStyle: 'solid',
  drawingOpacity: 1,
  magnetMode: false,

  // Order Flow / Footprint
  footprintEnabled: false,
  obEnabled: false,
  tapeEnabled: false,

  // Layout
  snapToGrid: true
}

/** Visų category pavadinimai (UI navigacijai, tvarka). */
export const CATEGORIES: { id: SettingCategory; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: '⚙' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'candles', label: 'Candles / Bars', icon: '🕯' },
  { id: 'axes', label: 'Scales & Axes', icon: '📐' },
  { id: 'interaction', label: 'Interaction', icon: '🖱' },
  { id: 'indicators', label: 'Indicators', icon: '📈' },
  { id: 'drawings', label: 'Drawings', icon: '✏' },
  { id: 'orderflow', label: 'Order Flow', icon: '🧱' },
  { id: 'layout', label: 'Layout', icon: '🔲' }
]

/** Panele atitinkantis key (overrides). */
export type PaneOverrides = Partial<ChartSettings>

export function isChartSettingsKey(key: string): key is keyof ChartSettings {
  return key in defaultSettings
}
