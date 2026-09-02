/**
 * Free Layout controller – UI testai (jsdom).
 *
 * Testuojama: pane sukūrimas, drag/resize state, snap-to-grid,
 * close/min/max, dispose tracking, createChart/createWidget hooks.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount, unmount, renderLayout, refresh, disposeItem } from './free-layout-controller'
import { snapPosition } from './workspace'
import type { LayoutItem, WorkspaceLayout } from './types'

function makeWorkspace(items: LayoutItem[]): WorkspaceLayout {
  return {
    id: 'ws1', name: 'Test', mode: 'free',
    items, activePaneId: items[0]?.id ?? null,
    snapToGrid: false, createdAt: 0, updatedAt: 0
  }
}

function chartItem(id: string, x = 0, y = 0, w = 0.5, h = 0.5): LayoutItem {
  return {
    id, type: 'chart', chartPaneId: id,
    position: { x, y, w, h, minW: 0.2, minH: 0.2 },
    config: { symbol: 'BTCUSDT', interval: '1h' }
  }
}
function widgetItem(id: string, type: LayoutItem['type'], x = 0.5, y = 0): LayoutItem {
  return {
    id, type, title: type,
    position: { x, y, w: 0.4, h: 0.4, minW: 0.15, minH: 0.12 }
  }
}

describe('free-layout-controller', () => {
  let host: HTMLElement
  let mounted = false

  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    host.id = 'host'
    host.style.position = 'absolute'
    host.style.left = '0'
    host.style.top = '0'
    host.style.width = '1000px'
    host.style.height = '600px'
    document.body.appendChild(host)
  })

  afterEach(() => {
    if (mounted) { unmount(); mounted = false }
  })

  it('mount creates a pane element for each item', () => {
    const w = makeWorkspace([chartItem('p1'), widgetItem('w1', 'notes', 0.6, 0)])
    mount({
      host,
      getState: () => w,
      setState: () => {},
      save: () => {},
      setActivePane: () => {}
    })
    mounted = true
    expect(host.querySelectorAll('[data-item-id]').length).toBe(2)
    const p1 = host.querySelector('[data-item-id="p1"]') as HTMLElement
    expect(p1).toBeTruthy()
    expect(p1.classList.contains('pane--chart')).toBe(true)
    expect(p1.style.left).toBe('0%')
    expect(p1.style.top).toBe('0%')
    expect(p1.style.width).toBe('50%')
    expect(p1.style.height).toBe('50%')
    const w1 = host.querySelector('[data-item-id="w1"]') as HTMLElement
    expect(w1.classList.contains('pane--widget')).toBe(true)
    expect(w1.style.left).toBe('60%')
  })

  it('mount calls createChart with a content element and stores dispose', () => {
    let capturedContent: HTMLElement | undefined
    let capturedItem: LayoutItem | undefined
    const createChart = (content: HTMLElement, item: LayoutItem) => {
      capturedContent = content
      capturedItem = item
      const cv = document.createElement('canvas')
      content.appendChild(cv)
      return () => { cv.remove() }
    }
    const w = makeWorkspace([chartItem('p1')])
    mount({
      host, getState: () => w, setState: () => {}, save: () => {}, setActivePane: () => {},
      createChart
    })
    mounted = true
    expect(capturedContent).toBeDefined()
    expect(capturedItem).toBeDefined()
    if (capturedContent === undefined || capturedItem === undefined) return
    expect(capturedContent.classList.contains('pane__content')).toBe(true)
    expect(capturedContent.querySelector('canvas')).toBeTruthy()
    expect(capturedItem.id).toBe('p1')
  })

  it('mount calls createWidget for non-chart items', () => {
    let capturedItem: LayoutItem | undefined
    const createWidget = (_content: HTMLElement, item: LayoutItem) => {
      capturedItem = item
      return () => {}
    }
    const w = makeWorkspace([widgetItem('w1', 'notes')])
    mount({
      host, getState: () => w, setState: () => {}, save: () => {}, setActivePane: () => {},
      createWidget
    })
    mounted = true
    expect(capturedItem).toBeDefined()
    if (capturedItem === undefined) return
    expect(capturedItem.type).toBe('notes')
  })

  it('disposeItem removes pane and calls dispose', () => {
    const dispose = vi.fn()
    let captured: { content: HTMLElement; item: LayoutItem } | null = null
    const w = makeWorkspace([chartItem('p1')])
    mount({
      host, getState: () => w, setState: () => {}, save: () => {}, setActivePane: () => {},
      createChart: (content, item) => {
        captured = { content, item }
        return dispose
      }
    })
    mounted = true
    expect(captured).toBeTruthy()
    disposeItem('p1')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-item-id="p1"]')).toBeFalsy()
  })

  it('refresh re-renders after state change', () => {
    let state = makeWorkspace([chartItem('p1', 0, 0, 0.5, 0.5)])
    mount({
      host, getState: () => state, setState: () => {}, save: () => {}, setActivePane: () => {}
    })
    mounted = true
    state = makeWorkspace([chartItem('p1', 0, 0, 0.8, 0.8), chartItem('p2', 0.8, 0, 0.2, 1)])
    refresh()
    expect(host.querySelectorAll('[data-item-id]').length).toBe(2)
    const p1 = host.querySelector('[data-item-id="p1"]') as HTMLElement
    expect(p1.style.width).toBe('80%')
  })

  it('applies activePaneId class', () => {
    const w = makeWorkspace([chartItem('p1'), chartItem('p2', 0.5, 0, 0.5, 1)])
    w.activePaneId = 'p2'
    mount({
      host, getState: () => w, setState: () => {}, save: () => {}, setActivePane: () => {}
    })
    mounted = true
    const p2 = host.querySelector('[data-item-id="p2"]') as HTMLElement
    expect(p2.classList.contains('pane--active')).toBe(true)
    const p1 = host.querySelector('[data-item-id="p1"]') as HTMLElement
    expect(p1.classList.contains('pane--active')).toBe(false)
  })

  it('handle close button removes widget item', () => {
    const w = makeWorkspace([chartItem('p1'), widgetItem('w1', 'notes', 0.5, 0)])
    let updated: WorkspaceLayout = w
    mount({
      host, getState: () => w, setState: (next) => { updated = next }, save: () => {}, setActivePane: () => {}
    })
    mounted = true
    const w1 = host.querySelector('[data-item-id="w1"]') as HTMLElement
    const closeBtn = w1.querySelector('[data-ctrl="close"]') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    closeBtn.click()
    expect(updated.items.length).toBe(1)
    expect(updated.items[0]!.id).toBe('p1')
  })

  it('chart items do not have close/min/max buttons', () => {
    const w = makeWorkspace([chartItem('p1')])
    mount({
      host, getState: () => w, setState: () => {}, save: () => {}, setActivePane: () => {}
    })
    mounted = true
    const p1 = host.querySelector('[data-item-id="p1"]') as HTMLElement
    expect(p1.querySelector('[data-ctrl="close"]')).toBeFalsy()
    expect(p1.querySelector('[data-ctrl="min"]')).toBeFalsy()
    expect(p1.querySelector('[data-ctrl="max"]')).toBeFalsy()
  })

  it('handle minimize/maximize toggles state', () => {
    const w = makeWorkspace([widgetItem('w1', 'notes')])
    let updated: WorkspaceLayout = w
    mount({
      host, getState: () => w, setState: (next) => { updated = next }, save: () => {}, setActivePane: () => {}
    })
    mounted = true
    const min = host.querySelector('[data-ctrl="min"]') as HTMLButtonElement
    min.click()
    expect(updated.items[0]!.state).toBe('minimized')
    const max = host.querySelector('[data-ctrl="max"]') as HTMLButtonElement
    max.click()
    expect(updated.items[0]!.state).toBe('maximized')
  })

  it('handle sets activePane on click', () => {
    const w = makeWorkspace([chartItem('p1'), chartItem('p2', 0.5, 0, 0.5, 1)])
    let active = ''
    mount({
      host, getState: () => w, setState: () => {}, save: () => {}, setActivePane: (id) => { active = id || '' }
    })
    mounted = true
    const p2 = host.querySelector('[data-item-id="p2"]') as HTMLElement
    // Click ant pane (ne ant handle)
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true })
    p2.querySelector('.pane__content')!.dispatchEvent(evt)
    expect(active).toBe('p2')
  })

  it('snapPosition rounds positions to the grid', () => {
    const pos = { x: 0.07, y: 0.13, w: 0.31, h: 0.24 }
    const snapped = snapPosition(pos, 12, 8, true)
    expect(snapped.x).toBeCloseTo(1 / 12, 5)
    expect(snapped.y).toBeCloseTo(1 / 8, 5)
    expect(snapped.w).toBeCloseTo(4 / 12, 5)
    expect(snapped.h).toBeCloseTo(2 / 8, 5)
  })

  it('getItemTypeLabel returns human label for every type', async () => {
    const { getItemTypeLabel } = await import('./free-layout-controller')
    expect(getItemTypeLabel('chart')).toBe('Chart')
    expect(getItemTypeLabel('footprint')).toBe('Footprint')
    expect(getItemTypeLabel('orderbook')).toBe('Order Book')
    expect(getItemTypeLabel('time_sales')).toBe('Time & Sales')
    expect(getItemTypeLabel('order_ticket')).toBe('Order Ticket')
    expect(getItemTypeLabel('notes')).toBe('Notes')
    expect(getItemTypeLabel('sessions')).toBe('Session Levels')
  })

  it('unmount removes all panes and disposes resources', () => {
    const dispose = vi.fn()
    const w = makeWorkspace([chartItem('p1'), chartItem('p2', 0.5, 0, 0.5, 1)])
    mount({
      host, getState: () => w, setState: () => {}, save: () => {}, setActivePane: () => {},
      createChart: () => dispose
    })
    mounted = true
    expect(host.querySelectorAll('[data-item-id]').length).toBe(2)
    unmount()
    mounted = false
    expect(host.querySelectorAll('[data-item-id]').length).toBe(0)
    expect(dispose).toHaveBeenCalled()
  })
})
