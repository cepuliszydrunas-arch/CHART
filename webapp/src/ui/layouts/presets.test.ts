/**
 * Layout presets + workspace persistencija – unit testai.
 *
 * Tikslas: kiekvienas preset'as validus, round-trip per localStorage +
 * corruption fallback + import/export + delete/duplicate/reset.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  addItem,
  cancelPendingSave,
  duplicateWorkspace,
  exportJson,
  importJson,
  load,
  makeEmptyFreeWorkspace,
  makeFallbackWorkspace,
  makeWorkspaceFromPreset,
  newWorkspaceId,
  removeWorkspace,
  renameWorkspace,
  resetAll,
  saveDebounced,
  saveNow,
  setActivePane,
  snapPosition,
  updateItem,
  updateActive
} from './workspace'
import { PRESET_IDS, isPresetId } from './presets'
import type { LayoutItem, WorkspaceLayout } from './types'

class MemStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private data = new Map<string, string>()
  getItem(k: string): string | null { return this.data.has(k) ? this.data.get(k)! : null }
  setItem(k: string, v: string): void { this.data.set(k, v) }
  removeItem(k: string): void { this.data.delete(k) }
  raw(): Record<string, string> { return Object.fromEntries(this.data) }
}

describe('presets', () => {
  it('has 8 presets', () => {
    expect(PRESET_IDS.length).toBe(8)
  })

  it('every preset is a valid id and produces a valid items list', () => {
    for (const id of PRESET_IDS) {
      const ws = makeWorkspaceFromPreset(id)
      expect(ws.presetId).toBe(id)
      expect(ws.items.length).toBeGreaterThan(0)
      expect(ws.items.some((i) => i.type === 'chart')).toBe(true)
      for (const item of ws.items) {
        expect(item.id).toBeTruthy()
        expect(item.position.w).toBeGreaterThan(0)
        expect(item.position.h).toBeGreaterThan(0)
        expect(item.position.x).toBeGreaterThanOrEqual(0)
        expect(item.position.y).toBeGreaterThanOrEqual(0)
        expect(item.position.x + item.position.w).toBeLessThanOrEqual(1.0001)
        expect(item.position.y + item.position.h).toBeLessThanOrEqual(1.0001)
      }
    }
  })

  it('topdown has 3 charts with different intervals', () => {
    const ws = makeWorkspaceFromPreset('topdown')
    const charts = ws.items.filter((i) => i.type === 'chart')
    expect(charts.length).toBe(3)
    const ivals = charts.map((c) => (c.config as { interval?: string } | undefined)?.interval)
    expect(ivals).toEqual(['1h', '15m', '5m'])
  })

  it('grid4 has 4 charts (2x2)', () => {
    const ws = makeWorkspaceFromPreset('grid4')
    const charts = ws.items.filter((i) => i.type === 'chart')
    expect(charts.length).toBe(4)
  })

  it('orderflow has chart + footprint + orderbook + time_sales', () => {
    const ws = makeWorkspaceFromPreset('orderflow')
    const types = ws.items.map((i) => i.type)
    expect(types).toContain('chart')
    expect(types).toContain('footprint')
    expect(types).toContain('orderbook')
    expect(types).toContain('time_sales')
  })

  it('trading is PAPER-only (no real trading widgets)', () => {
    const ws = makeWorkspaceFromPreset('trading')
    const titles = ws.items.map((i) => i.title ?? '')
    expect(titles.some((t) => t.toLowerCase().includes('paper'))).toBe(true)
  })

  it('planner has notes widget (always present)', () => {
    const ws = makeWorkspaceFromPreset('planner')
    expect(ws.items.some((i) => i.type === 'notes')).toBe(true)
  })

  it('scanner allows independent symbols per pane', () => {
    const ws = makeWorkspaceFromPreset('scanner')
    const charts = ws.items.filter((i) => i.type === 'chart')
    const syms = charts.map((c) => (c.config as { symbol?: string } | undefined)?.symbol)
    const uniq = new Set(syms)
    expect(uniq.size).toBeGreaterThan(1)
  })

  it('isPresetId is safe', () => {
    expect(isPresetId('single')).toBe(true)
    expect(isPresetId('not-a-preset')).toBe(false)
    expect(isPresetId(123)).toBe(false)
    expect(isPresetId(null)).toBe(false)
  })

  it('fallback workspace is always valid', () => {
    const fb = makeFallbackWorkspace()
    expect(fb.items.some((i) => i.type === 'chart')).toBe(true)
    expect(fb.presetId).toBe('single')
  })

  it('first chart item id is exposed via activePaneId', () => {
    const ws = makeWorkspaceFromPreset('grid4')
    const id = ws.activePaneId
    expect(id).toBeTruthy()
    expect(ws.items.find((i) => i.id === id)?.type).toBe('chart')
  })
})

describe('workspace persistence', () => {
  let store: MemStorage
  beforeEach(() => { store = new MemStorage(); cancelPendingSave() })

  it('returns fallback when storage is empty', () => {
    const state = load(store)
    expect(state.workspaces.length).toBe(1)
    expect(state.workspaces[0]!.presetId).toBe('single')
  })

  it('round-trips a workspace', () => {
    const ws = makeWorkspaceFromPreset('grid4')
    const state = { workspaces: [ws], activeWorkspaceId: ws.id }
    saveNow(state, store)
    const loaded = load(store)
    expect(loaded.workspaces.length).toBe(1)
    expect(loaded.workspaces[0]!.items.length).toBe(ws.items.length)
    expect(loaded.activeWorkspaceId).toBe(ws.id)
  })

  it('debounced save does not write synchronously', () => {
    const ws = makeWorkspaceFromPreset('single')
    saveDebounced({ workspaces: [ws], activeWorkspaceId: ws.id }, store)
    expect(store.raw()).toEqual({})
  })

  it('falls back gracefully on corruption', () => {
    store.setItem('hgfx.layouts.v1', '{not valid json')
    const state = load(store)
    expect(state.workspaces[0]!.presetId).toBe('single')
  })

  it('drops invalid items and accepts valid ones', () => {
    const ws = makeWorkspaceFromPreset('single')
    const corrupted = {
      workspaces: [{
        ...ws,
        items: [
          ...ws.items,
          { id: 'broken', type: 'chart' /* missing position */ },
          { id: '', type: 'chart', position: { x: 0, y: 0, w: 1, h: 1 } },
          { id: 'neg', type: 'chart', position: { x: -1, y: 0, w: 1, h: 1 } }
        ]
      }],
      activeWorkspaceId: ws.id
    }
    store.setItem('hgfx.layouts.v1', JSON.stringify(corrupted))
    const loaded = load(store)
    expect(loaded.workspaces[0]!.items.length).toBe(ws.items.length)
  })

  it('falls back if no chart items remain after sanitization', () => {
    const bad = { workspaces: [{ id: 'a', name: 'x', mode: 'free', snapToGrid: true, createdAt: 0, updatedAt: 0, items: [] }], activeWorkspaceId: 'a' }
    store.setItem('hgfx.layouts.v1', JSON.stringify(bad))
    const loaded = load(store)
    expect(loaded.workspaces[0]!.presetId).toBe('single')
  })

  it('clamps out-of-range positions', () => {
    const ws = makeWorkspaceFromPreset('single')
    const raw = {
      workspaces: [{
        ...ws,
        items: [{ id: 'p1', type: 'chart', position: { x: -5, y: 2, w: 50, h: 50 } }]
      }],
      activeWorkspaceId: ws.id
    }
    store.setItem('hgfx.layouts.v1', JSON.stringify(raw))
    const loaded = load(store)
    const p = loaded.workspaces[0]!.items[0]!.position
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeGreaterThanOrEqual(0)
    expect(p.w).toBeLessThanOrEqual(1)
    expect(p.h).toBeLessThanOrEqual(1)
  })
})

describe('workspace CRUD', () => {
  it('newWorkspaceId is unique', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) ids.add(newWorkspaceId())
    expect(ids.size).toBe(50)
  })

  it('duplicate creates independent copy', () => {
    const ws = makeWorkspaceFromPreset('grid4')
    const dup = duplicateWorkspace(ws, 'My Grid Copy')
    expect(dup.id).not.toBe(ws.id)
    expect(dup.presetId).toBeUndefined()
    expect(dup.name).toBe('My Grid Copy')
    expect(dup.items.length).toBe(ws.items.length)
    // deep copy of items
    dup.items[0]!.position.x = 0.99
    expect(ws.items[0]!.position.x).not.toBe(0.99)
  })

  it('rename on preset creates a user variant (does not mutate preset)', () => {
    const ws = makeWorkspaceFromPreset('single')
    const renamed = renameWorkspace(ws, 'My focus')
    expect(renamed.presetId).toBeUndefined()
    expect(renamed.name).toBe('My focus')
    expect(renamed.id).not.toBe(ws.id)
  })

  it('rename on user workspace keeps id and updates name', () => {
    const ws = makeEmptyFreeWorkspace('A')
    const renamed = renameWorkspace(ws, 'B')
    expect(renamed.id).toBe(ws.id)
    expect(renamed.name).toBe('B')
  })

  it('removeWorkspace switches active when removing the active one', () => {
    const a = makeWorkspaceFromPreset('single')
    const b = makeWorkspaceFromPreset('topdown')
    const state = { workspaces: [a, b], activeWorkspaceId: a.id }
    const next = removeWorkspace(state, a.id)
    expect(next.activeWorkspaceId).toBe(b.id)
    expect(next.workspaces.length).toBe(1)
  })

  it('removeWorkspace never leaves empty list', () => {
    const a = makeWorkspaceFromPreset('single')
    const state = { workspaces: [a], activeWorkspaceId: a.id }
    const next = removeWorkspace(state, a.id)
    expect(next.workspaces.length).toBe(1)
    expect(next.workspaces[0]!.presetId).toBe('single')
  })

  it('resetAll returns default state', () => {
    const a = makeWorkspaceFromPreset('grid4')
    const state = resetAll()
    expect(state.workspaces.length).toBe(1)
    expect(state.workspaces[0]!.presetId).toBe('single')
  })

  it('updateActive mutates only active workspace', () => {
    const a = makeWorkspaceFromPreset('single')
    const b = makeWorkspaceFromPreset('topdown')
    const state = { workspaces: [a, b], activeWorkspaceId: a.id }
    const next = updateActive(state, (w) => ({ ...w, name: 'renamed' }))
    expect(next.workspaces[0]!.name).toBe('renamed')
    expect(next.workspaces[1]!.name).toBe(b.name)
  })

  it('addItem and updateItem work', () => {
    const ws = makeEmptyFreeWorkspace()
    const item: LayoutItem = {
      id: 'w-foo', type: 'notes',
      position: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }
    }
    const added = addItem(ws, item)
    expect(added.items.length).toBe(1)
    const moved = updateItem(added, 'w-foo', (i) => ({ ...i, position: { ...i.position, x: 0.5 } }))
    expect(moved.items[0]!.position.x).toBe(0.5)
    const removed = updateItem(moved, 'w-foo', () => null)
    expect(removed.items.length).toBe(0)
  })

  it('setActivePane updates field', () => {
    const ws = makeWorkspaceFromPreset('grid4')
    const updated = setActivePane(ws, 'p3')
    expect(updated.activePaneId).toBe('p3')
  })
})

describe('import / export', () => {
  it('exports and re-imports', () => {
    const ws = makeWorkspaceFromPreset('orderflow')
    const state = { workspaces: [ws], activeWorkspaceId: ws.id }
    const json = exportJson(state)
    const restored = importJson(json)
    expect(restored.workspaces[0]!.items.length).toBe(ws.items.length)
  })

  it('import rejects bad json', () => {
    expect(() => importJson('not json')).toThrow(/invalid JSON/i)
  })

  it('import rejects missing state', () => {
    expect(() => importJson('{}')).toThrow(/missing state/i)
  })

  it('import rejects empty workspaces', () => {
    expect(() => importJson(JSON.stringify({ state: { workspaces: [], activeWorkspaceId: 'x' } }))).toThrow(/no valid/i)
  })
})

describe('snap to grid', () => {
  it('snaps positions to grid', () => {
    const pos = { x: 0.07, y: 0.13, w: 0.31, h: 0.24 }
    const snapped = snapPosition(pos, 12, 8, true)
    expect(snapped.x).toBeCloseTo(1 / 12, 5)
    expect(snapped.y).toBeCloseTo(1 / 8, 5)
    expect(snapped.w).toBeCloseTo(4 / 12, 5)
    expect(snapped.h).toBeCloseTo(2 / 8, 5)
  })

  it('disabled snap returns same', () => {
    const pos = { x: 0.07, y: 0.13, w: 0.31, h: 0.24 }
    const out = snapPosition(pos, 12, 8, false)
    expect(out).toEqual(pos)
  })

  it('respects min size during snap', () => {
    const pos = { x: 0, y: 0, w: 0, h: 0 }
    const snapped = snapPosition(pos, 12, 8, true)
    expect(snapped.w).toBeGreaterThanOrEqual(0.05)
    expect(snapped.h).toBeGreaterThanOrEqual(0.05)
  })
})
