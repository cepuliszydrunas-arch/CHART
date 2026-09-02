import { describe, it, expect } from 'vitest'
import {
  defaultSettings,
  emptyStore,
  hydrate,
  serialize,
  setValue,
  resetPane,
  resetAll,
  mergeSettings,
  storeHasChanges,
  sanitizePaneOverrides,
  sanitizePrecision,
  isHexColor
} from './index'

describe('settings defaults', () => {
  it('has sane default for every field, typed', () => {
    expect(defaultSettings.chartStyle).toBe('candle')
    expect(defaultSettings.bullColor).toBe('#2ebd85')
    expect(defaultSettings.grid).toBe('both')
    expect(defaultSettings.wheelMode).toBe('zoom')
    expect(defaultSettings.syncSettingsAcrossPanes).toBe(false)
    // no demo placeholders
    expect(Object.keys(defaultSettings).length).toBeGreaterThan(60)
  })
})

describe('validation', () => {
  it('fixes invalid color to default', () => {
    const s = sanitizePaneOverrides({ bullColor: 'red', gridColor: '#1234' })
    expect(s.bullColor).toBe(defaultSettings.bullColor)
    expect(s.gridColor).toBe(defaultSettings.gridColor)
  })
  it('accepts valid hex color', () => {
    expect(isHexColor('#1a2b3c')).toBe(true)
    expect(isHexColor('red')).toBe(false)
    expect(sanitizePaneOverrides({ bullColor: '#ff0000' }).bullColor).toBe('#ff0000')
  })
  it('clamps numeric ranges', () => {
    expect(sanitizePaneOverrides({ candleWidth: 999, gridOpacity: 2, zoomSensitivity: 0 }).candleWidth).toBe(100)
    expect(sanitizePaneOverrides({ gridOpacity: 2 }).gridOpacity).toBe(1)
    expect(sanitizePaneOverrides({ zoomSensitivity: 0 }).zoomSensitivity).toBe(0.1)
  })
  it('sanitizes precision auto-or-fixed', () => {
    expect(sanitizePrecision('auto')).toBe('auto')
    expect(sanitizePrecision(2)).toBe(2)
    expect(sanitizePrecision(20)).toBe('auto')
    expect(sanitizePrecision(-1)).toBe('auto')
  })
})

describe('migration + hydration', () => {
  it('empty → fresh store', () => {
    const s = hydrate(null)
    expect(s.version).toBe(1)
    expect(storeHasChanges(s)).toBe(false)
  })
  it('migrates legacy v0 bulk settings into workspace', () => {
    const legacy = { chartStyle: 'heikin', bullColor: '#123456' }
    const s = hydrate(legacy)
    expect(s.workspace.chartStyle).toBe('heikin')
    expect(s.workspace.bullColor).toBe('#123456')
    expect(s.panes).toEqual({})
  })
  it('corrupt data falls back to defaults safely', () => {
    const s = hydrate({ version: 1, app: [{ nope: 1 }], panes: 'junk' })
    expect(storeHasChanges(s)).toBe(false)
  })
  it('round-trips through serialize/hydrate', () => {
    let s = emptyStore()
    s = setValue(s, 'p1', 'bullColor', '#abcdef', false)
    const text = serialize(s)
    const back = hydrate(JSON.parse(text))
    expect(sanitizePaneOverrides(back.panes['p1']).bullColor).toBe('#abcdef')
  })
})

describe('merge priority & per-pane', () => {
  it('pane override wins over workspace and default', () => {
    let s = emptyStore()
    s = setValue(s, 'p1', 'chartStyle', 'heikin', false)
    // workspace sets bearColor
    s = setValue(s, 'p2', 'bearColor', '#111111', false)
    const p1 = mergeSettings(s, 'p1')
    const p2 = mergeSettings(s, 'p2')
    expect(p1.chartStyle).toBe('heikin')
    expect(p1.bearColor).toBe(defaultSettings.bearColor)
    expect(p2.bearColor).toBe('#111111')
  })
  it('sync=true pushes to workspace and clears pane overrides', () => {
    let s = emptyStore()
    s = setValue(s, 'p1', 'grid', 'none', true)
    expect(s.workspace.grid).toBe('none')
    expect(s.panes['p1']?.grid).toBeUndefined()
    expect(mergeSettings(s, 'p1').grid).toBe('none')
  })
  it('one pane change does not leak to another pane (sync off)', () => {
    let s = emptyStore()
    s = setValue(s, 'p1', 'logScale', true, false)
    expect(mergeSettings(s, 'p2').logScale).toBe(false)
  })
})

describe('reset', () => {
  it('resetPane clears only that pane', () => {
    let s = emptyStore()
    s = setValue(s, 'p1', 'logScale', true, false)
    s = setValue(s, 'p2', 'logScale', true, false)
    s = resetPane(s, 'p1')
    expect(storeHasChanges(s)).toBe(true)
    expect(mergeSettings(s, 'p1').logScale).toBe(false)
    expect(mergeSettings(s, 'p2').logScale).toBe(true)
  })
  it('resetAll returns clean store', () => {
    let s = emptyStore()
    s = setValue(s, 'p1', 'logScale', true, false)
    s = resetAll(s)
    expect(storeHasChanges(s)).toBe(false)
    expect(mergeSettings(s, 'p1').logScale).toBe(false)
  })
})