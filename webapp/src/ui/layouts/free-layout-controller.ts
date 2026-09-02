/// <reference lib="dom" />
/**
 * Free Layout controller — browser-side vanilla JS.
 *
 • Drag/Resize per chart pane ir widget elementus.
 • Drag veikia TIK per aiškų handle (.pane-handle), ne per chart canvas — kad
   nekirstų su chart interactions (zoom/pan/crosshair/drawings).
 • Snap-to-grid (12×8) įjungiamas per workspace.snapToGrid.
 • Minimalūs dydžiai: chart 20% × 20%, widget 15% × 12%, max 100% × 100%.
 • Persistencija: po kiekvieno drag/resize → window.__hgfxSaveLayout?.()
 • Aktyvaus pane focus: paspaudus ant pane viduje (bet ne ant handle) → focus.
 *
 * Sąsaja su terminal.js: tas failas inicializuoja šį modulį per
 * `window.HgfxLayouts.mount({ host, state, save, presets, ... })`.
 */

import { snapPosition, updateItem } from './workspace'
import type { LayoutItem, LayoutItemType, WorkspaceLayout } from './types'

const HANDLE_CLASS = 'pane-handle'
const DRAG_THRESHOLD = 3
const MIN_W_CHART = 0.2
const MIN_H_CHART = 0.2
const MIN_W_WIDGET = 0.15
const MIN_H_WIDGET = 0.12

interface MountOptions {
  host: HTMLElement
  getState: () => WorkspaceLayout
  setState: (w: WorkspaceLayout) => void
  save: () => void
  setActivePane: (id: string | null) => void
  onAfterApply?: () => void
  presets?: PresetPreview[]
  /**
   * Sukuria chart'ą Free Layout pane (kai state === 'normal'/'minimized'/'maximized' && type === 'chart').
   * Grąžina dispose funkciją (uždaryti WebSocket'us, valyti state).
   * Jei nepateikta — sukuriamas tuščias <canvas> (placeholder).
   */
  createChart?: (host: HTMLElement, item: LayoutItem) => () => void
  /**
   * Užpildo widget pane turiniu (footprint, orderbook, notes, …).
   * Grąžina dispose funkciją.
   */
  createWidget?: (host: HTMLElement, item: LayoutItem) => () => void
}

export interface PresetPreview {
  id: string
  name: string
  description: string
  icon: 'single' | 'rows' | 'grid' | 'orderflow' | 'trading' | 'scanner' | 'planner' | 'free'
}

interface DragState {
  itemId: string
  mode: 'move' | 'resize'
  resizeDir?: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  startX: number
  startY: number
  startPos: { x: number; y: number; w: number; h: number }
  rect: DOMRect
  moved: boolean
}

const elementsByItem = new Map<string, HTMLElement>()
const disposeByItem = new Map<string, () => void>()
let currentMount: MountOptions | null = null
let dragState: DragState | null = null

function el(id: string): HTMLElement | null { return document.getElementById(id) }

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function isChartItem(item: LayoutItem): boolean {
  return item.type === 'chart'
}

function minFor(item: LayoutItem): { w: number; h: number } {
  if (isChartItem(item)) return { w: MIN_W_CHART, h: MIN_H_CHART }
  return { w: MIN_W_WIDGET, h: MIN_H_WIDGET }
}

function ensureHandle(paneEl: HTMLElement, item: LayoutItem): void {
  if (paneEl.querySelector('.' + HANDLE_CLASS)) return
  const handle = document.createElement('div')
  handle.className = HANDLE_CLASS
  handle.setAttribute('data-pane-handle', item.id)
  handle.setAttribute('aria-label', `Drag ${item.title ?? item.type}`)
  // Spacer / drag region
  const title = document.createElement('span')
  title.className = 'pane-handle__title'
  title.textContent = item.title ?? item.type
  handle.appendChild(title)

  // Resize handles
  ;(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).forEach((dir) => {
    const r = document.createElement('div')
    r.className = `pane-resize pane-resize--${dir}`
    r.setAttribute('data-resize', dir)
    handle.appendChild(r)
  })

  // Close / minimize / maximize (tik widget)
  if (!isChartItem(item)) {
    const ctrls = document.createElement('div')
    ctrls.className = 'pane-ctrls'
    const min = document.createElement('button')
    min.type = 'button'
    min.className = 'pane-ctrl'
    min.setAttribute('data-ctrl', 'min')
    min.title = 'Minimize'
    min.textContent = '–'
    const max = document.createElement('button')
    max.type = 'button'
    max.className = 'pane-ctrl'
    max.setAttribute('data-ctrl', 'max')
    max.title = 'Maximize'
    max.textContent = '◻'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'pane-ctrl pane-ctrl--close'
    close.setAttribute('data-ctrl', 'close')
    close.title = 'Close'
    close.textContent = '✕'
    // Tiesioginis click handler'is – kad testuose būtų lengviau triger'inti
    // (jsdom click() nedispatch'ina pointerdown).
    const fire = (ctrl: 'min' | 'max' | 'close') => (ev: Event) => {
      ev.stopPropagation()
      handleCtrl(item, ctrl)
    }
    min.addEventListener('click', fire('min'))
    max.addEventListener('click', fire('max'))
    close.addEventListener('click', fire('close'))
    ctrls.appendChild(min)
    ctrls.appendChild(max)
    ctrls.appendChild(close)
    handle.appendChild(ctrls)
  }

  paneEl.appendChild(handle)
}

function applyItemPosition(paneEl: HTMLElement, item: LayoutItem): void {
  const { position } = item
  if (item.state === 'maximized') {
    paneEl.style.left = '0%'
    paneEl.style.top = '0%'
    paneEl.style.width = '100%'
    paneEl.style.height = '100%'
    paneEl.dataset.maximized = '1'
    return
  }
  if (item.state === 'minimized') {
    paneEl.style.left = (position.x * 100).toFixed(3) + '%'
    paneEl.style.top = (position.y * 100).toFixed(3) + '%'
    paneEl.style.width = '36px'
    paneEl.style.height = '24px'
    paneEl.dataset.minimized = '1'
    return
  }
  paneEl.style.left = (position.x * 100).toFixed(3) + '%'
  paneEl.style.top = (position.y * 100).toFixed(3) + '%'
  paneEl.style.width = (position.w * 100).toFixed(3) + '%'
  paneEl.style.height = (position.h * 100).toFixed(3) + '%'
  delete paneEl.dataset.maximized
  delete paneEl.dataset.minimized
}

export function renderLayout(host: HTMLElement, w: WorkspaceLayout): void {
  if (!host) return
  // Surenkam naujus items – senus paliekam, bet perskaičiuojam positions
  const seen = new Set<string>()
  for (const item of w.items) {
    seen.add(item.id)
    let paneEl = elementsByItem.get(item.id)
    if (!paneEl) {
      paneEl = document.createElement('div')
      paneEl.className = 'pane ' + (isChartItem(item) ? 'pane--chart' : 'pane--widget')
      paneEl.dataset.itemId = item.id
      paneEl.dataset.itemType = item.type
      // Content slot – čia dedame canvas (chart) arba widget body
      const content = document.createElement('div')
      content.className = 'pane__content'
      content.dataset.paneContent = item.id
      paneEl.appendChild(content)
      host.appendChild(paneEl)
      elementsByItem.set(item.id, paneEl)
      // Pirmą kartą – kviesk createChart/createWidget
      if (isChartItem(item) && currentMount?.createChart) {
        const dispose = currentMount.createChart(content, item)
        if (typeof dispose === 'function') disposeByItem.set(item.id, dispose)
      } else if (!isChartItem(item) && currentMount?.createWidget) {
        const dispose = currentMount.createWidget(content, item)
        if (typeof dispose === 'function') disposeByItem.set(item.id, dispose)
      }
    }
    ensureHandle(paneEl, item)
    applyItemPosition(paneEl, item)
    if (w.activePaneId === item.id) {
      paneEl.classList.add('pane--active')
    } else {
      paneEl.classList.remove('pane--active')
    }
  }
  // Pašalinam nebenaudojamus
  for (const [id, paneEl] of elementsByItem) {
    if (!seen.has(id)) {
      const dispose = disposeByItem.get(id)
      if (dispose) {
        try { dispose() } catch { /* ignore */ }
        disposeByItem.delete(id)
      }
      paneEl.remove()
      elementsByItem.delete(id)
    }
  }
}

function getItemFromEl(e: EventTarget | null): LayoutItem | null {
  if (!currentMount) return null
  const el = (e as HTMLElement | null)?.closest('[data-item-id]') as HTMLElement | null
  if (!el) return null
  const id = el.dataset.itemId
  if (!id) return null
  return currentMount.getState().items.find((i) => i.id === id) ?? null
}

function onPointerDown(e: PointerEvent): void {
  if (!currentMount) return
  const target = e.target as HTMLElement
  if (target.closest('[data-resize]')) {
    const dir = target.getAttribute('data-resize') as DragState['resizeDir']
    beginDrag(e, 'resize', dir)
    return
  }
  if (target.closest('[data-ctrl]')) {
    const ctrl = target.getAttribute('data-ctrl')
    const item = getItemFromEl(target)
    if (item && ctrl) handleCtrl(item, ctrl as 'min' | 'max' | 'close')
    return
  }
  if (target.closest('.' + HANDLE_CLASS)) {
    beginDrag(e, 'move')
  }
}

function beginDrag(e: PointerEvent, mode: 'move' | 'resize', dir?: DragState['resizeDir']): void {
  if (!currentMount) return
  const item = getItemFromEl(e.target)
  if (!item) return
  const paneEl = elementsByItem.get(item.id)
  if (!paneEl) return
  const w = currentMount.getState()
  if (item.state === 'maximized' && mode === 'move') return
  if (item.state === 'minimized' && mode === 'move') {
    // Atstatom normal dydį prieš drag
    const restored = updateItem(w, item.id, (i) => ({ ...i, state: 'normal' as const }))
    currentMount.setState(restored)
    renderLayout(currentMount.host, restored)
    currentMount.onAfterApply?.()
    return
  }
  dragState = {
    itemId: item.id,
    mode,
    resizeDir: dir,
    startX: e.clientX,
    startY: e.clientY,
    startPos: { x: item.position.x, y: item.position.y, w: item.position.w, h: item.position.h },
    rect: currentMount.host.getBoundingClientRect(),
    moved: false
  }
  try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
  e.preventDefault()
  e.stopPropagation()
  paneEl.classList.add('pane--dragging')
}

function onPointerMove(e: PointerEvent): void {
  if (!dragState || !currentMount) return
  const ds = dragState
  const hostRect = ds.rect
  const dx = (e.clientX - ds.startX) / hostRect.width
  const dy = (e.clientY - ds.startY) / hostRect.height
  if (!ds.moved) {
    if (Math.abs(e.clientX - ds.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - ds.startY) < DRAG_THRESHOLD) return
    ds.moved = true
  }
  const w = currentMount.getState()
  const item = w.items.find((i) => i.id === ds.itemId)
  if (!item) return
  const min = minFor(item)
  let next = { x: ds.startPos.x, y: ds.startPos.y, w: ds.startPos.w, h: ds.startPos.h }
  if (ds.mode === 'move') {
    next = {
      x: clamp(ds.startPos.x + dx, 0, 1 - ds.startPos.w),
      y: clamp(ds.startPos.y + dy, 0, 1 - ds.startPos.h),
      w: ds.startPos.w,
      h: ds.startPos.h
    }
  } else {
    const dir = ds.resizeDir ?? 'se'
    if (dir.includes('e')) next.w = clamp(ds.startPos.w + dx, min.w, 1 - ds.startPos.x)
    if (dir.includes('s')) next.h = clamp(ds.startPos.h + dy, min.h, 1 - ds.startPos.y)
    if (dir.includes('w')) {
      const newX = clamp(ds.startPos.x + dx, 0, ds.startPos.x + ds.startPos.w - min.w)
      next.w = ds.startPos.w + (ds.startPos.x - newX)
      next.x = newX
    }
    if (dir.includes('n')) {
      const newY = clamp(ds.startPos.y + dy, 0, ds.startPos.y + ds.startPos.h - min.h)
      next.h = ds.startPos.h + (ds.startPos.y - newY)
      next.y = newY
    }
  }
  // Snap-to-grid
  if (w.snapToGrid) {
    next = snapPosition(next, 12, 8, true)
  }
  const updated = updateItem(w, item.id, (i) => ({ ...i, position: { ...i.position, ...next } }))
  currentMount.setState(updated)
  const paneEl = elementsByItem.get(item.id)
  if (paneEl) applyItemPosition(paneEl, { ...item, position: { ...item.position, ...next } })
}

function onPointerUp(e: PointerEvent): void {
  if (!dragState || !currentMount) return
  const ds = dragState
  dragState = null
  const paneEl = elementsByItem.get(ds.itemId)
  if (paneEl) paneEl.classList.remove('pane--dragging')
  try { (e.target as Element).releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  if (ds.moved) {
    currentMount.save()
  }
}

function onClick(e: MouseEvent): void {
  if (!currentMount) return
  const target = e.target as HTMLElement
  if (target.closest('.' + HANDLE_CLASS) || target.closest('[data-resize]') || target.closest('[data-ctrl]')) return
  const item = getItemFromEl(target)
  if (!item) return
  // focus = aktyvus pane
  currentMount.setActivePane(item.id)
  // Pažymim vizualiai
  for (const [, el] of elementsByItem) el.classList.remove('pane--active')
  elementsByItem.get(item.id)?.classList.add('pane--active')
}

function handleCtrl(item: LayoutItem, ctrl: 'min' | 'max' | 'close'): void {
  if (!currentMount) return
  const w = currentMount.getState()
  if (ctrl === 'close') {
    // Pašalinti
    if (item.type === 'chart' && w.items.filter((i) => i.type === 'chart').length <= 1) {
      // Negalima pašalinti paskutinio chart – paliekam kaip yra
      return
    }
    const updated = updateItem(w, item.id, () => null)
    if (updated.items.length === 0) {
      const fallback: LayoutItem = {
        id: 'p1', type: 'chart', chartPaneId: 'p1',
        position: { x: 0, y: 0, w: 1, h: 1 },
        config: { symbol: 'BTCUSDT', interval: '1h', active: true }
      }
      const next: WorkspaceLayout = { ...updated, items: [fallback], activePaneId: 'p1' }
      currentMount.setState(next)
      renderLayout(currentMount.host, next)
      currentMount.save()
      return
    }
    const next: WorkspaceLayout = { ...updated, activePaneId: updated.items.find((i) => i.type === 'chart')?.id ?? null }
    currentMount.setState(next)
    renderLayout(currentMount.host, next)
    currentMount.save()
    return
  }
  if (ctrl === 'min') {
    const updated = updateItem(w, item.id, (i) => ({ ...i, state: 'minimized' as const }))
    currentMount.setState(updated)
    renderLayout(currentMount.host, updated)
    currentMount.save()
    return
  }
  if (ctrl === 'max') {
    const nextState = item.state === 'maximized' ? 'normal' as const : 'maximized' as const
    const updated = updateItem(w, item.id, (i) => ({ ...i, state: nextState }))
    currentMount.setState(updated)
    renderLayout(currentMount.host, updated)
    currentMount.save()
  }
}

function onDoubleClick(e: MouseEvent): void {
  if (!currentMount) return
  const target = e.target as HTMLElement
  if (target.closest('.' + HANDLE_CLASS)) return
  const item = getItemFromEl(target)
  if (!item) return
  // Toggle maximize
  handleCtrl(item, 'max')
}

export function mount(opts: MountOptions): void {
  if (currentMount) unmount()
  currentMount = opts
  opts.host.addEventListener('pointerdown', onPointerDown)
  opts.host.addEventListener('pointermove', onPointerMove)
  opts.host.addEventListener('pointerup', onPointerUp)
  opts.host.addEventListener('pointercancel', onPointerUp)
  opts.host.addEventListener('click', onClick)
  opts.host.addEventListener('dblclick', onDoubleClick)
  renderLayout(opts.host, opts.getState())
}

/** Pašalina dispose konkretų item (pvz. kai chart'as atjungiamas). */
export function disposeItem(itemId: string): void {
  const dispose = disposeByItem.get(itemId)
  if (dispose) {
    try { dispose() } catch { /* ignore */ }
    disposeByItem.delete(itemId)
  }
  const paneEl = elementsByItem.get(itemId)
  if (paneEl) {
    paneEl.remove()
    elementsByItem.delete(itemId)
  }
}

export function unmount(): void {
  if (!currentMount) return
  currentMount.host.removeEventListener('pointerdown', onPointerDown)
  currentMount.host.removeEventListener('pointermove', onPointerMove)
  currentMount.host.removeEventListener('pointerup', onPointerUp)
  currentMount.host.removeEventListener('pointercancel', onPointerUp)
  currentMount.host.removeEventListener('click', onClick)
  currentMount.host.removeEventListener('dblclick', onDoubleClick)
  // Dispose visus chart/widget resursus
  for (const [, dispose] of disposeByItem) {
    try { dispose() } catch { /* ignore */ }
  }
  disposeByItem.clear()
  for (const [, el] of elementsByItem) el.remove()
  elementsByItem.clear()
  currentMount = null
  dragState = null
}

export function refresh(): void {
  if (!currentMount) return
  renderLayout(currentMount.host, currentMount.getState())
}

export function getItemTypeLabel(type: LayoutItemType): string {
  switch (type) {
    case 'chart': return 'Chart'
    case 'footprint': return 'Footprint'
    case 'orderbook': return 'Order Book'
    case 'time_sales': return 'Time & Sales'
    case 'order_ticket': return 'Order Ticket'
    case 'positions': return 'Positions'
    case 'alerts': return 'Alerts'
    case 'cvd': return 'CVD'
    case 'volume_profile': return 'Volume Profile'
    case 'notes': return 'Notes'
    case 'sessions': return 'Session Levels'
  }
}
