/**
 * Chart Settings — viešas API.
 * `window.HgfxSettings` (per settings-entry.ts) naudojasi terminal.js.
 */
export { defaultSettings, CATEGORIES, isChartSettingsKey } from './model'
export type {
  ChartSettings,
  PaneOverrides,
  SettingCategory,
  CandleStyle,
  PriceScalePos,
  WheelMode,
  ZoomMode,
  DoubleClickAction,
  DragAction,
  Timezone,
  LineStyle,
  GridOption,
  CrosshairMode,
  VolumePosition,
  PriceSource
} from './model'
export { sanitizeSettings, sanitizePaneOverrides, sanitizePrecision, isHexColor } from './validate'
export {
  emptyStore,
  hydrate,
  serialize,
  setValue,
  resetPane,
  resetAll,
  mergeSettings,
  storeHasChanges,
  STORAGE_KEY,
  SCHEMA_VERSION
} from './store'
export type { PersistedShape } from './store'