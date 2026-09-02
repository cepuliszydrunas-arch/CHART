/**
 * Workspace persistencija per localStorage.
 *
 * • `saveDebounced` – saugus 250 ms debounce, kad greiti drag/resize eventai
 *   nespam'intų localStorage.
 * • `load` – skaito + validuoja (jei sugadinta → fallback į 'single' preset).
 * • `exportJson` / `importJson` – vartotojo import/export.
 *
 * Validacija: kiekvienas item privalo turėti `id`, `type`, `position` su
 * baigtiniais skaičiais [0..1]. Neprievalomi laukai praleidžiami (nėra throw).
 *
 * Testuojama per `presets.test.ts` (round-trip + corruption).
 */

import type { LayoutItem, LayoutMode, WorkspaceLayout } from './types';
import { buildPresetItems, isPresetId, type PresetId } from './presets';

const STORAGE_KEY = 'hgfx.layouts.v1';
const DEBOUNCE_MS = 250;
const FREE_GRID_COLS = 12;
const FREE_GRID_ROWS = 8;

export interface StoredState {
  /** Visų vartotojo workspace'ų sąrašas (preset'ai NIEKADA nesaugomi – jie read-only). */
  workspaces: WorkspaceLayout[];
  /** ID aktyvaus workspace'o. */
  activeWorkspaceId: string;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function isLayoutItem(value: unknown): value is LayoutItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.type !== 'string') return false;
  const p = v.position as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return false;
  const x = p.x, y = p.y, w = p.w, h = p.h;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) return false;
  if (w <= 0 || h <= 0) return false;
  if (x < 0 || y < 0 || x > 1 || y > 1) return false;
  return true;
}

function sanitizeItem(value: unknown): LayoutItem | null {
  if (!isLayoutItem(value)) return null;
  const v = value as unknown as Record<string, unknown>;
  const p = v.position as Record<string, unknown>;
  const item: LayoutItem = {
    id: v.id as string,
    type: v.type as LayoutItem['type'],
    position: {
      x: clamp(Number(p.x), 0, 1),
      y: clamp(Number(p.y), 0, 1),
      w: clamp(Number(p.w), 0.05, 1),
      h: clamp(Number(p.h), 0.05, 1),
      minW: isFiniteNumber(p.minW) ? Number(p.minW) : undefined,
      minH: isFiniteNumber(p.minH) ? Number(p.minH) : undefined,
      maxW: isFiniteNumber(p.maxW) ? Number(p.maxW) : undefined,
      maxH: isFiniteNumber(p.maxH) ? Number(p.maxH) : undefined
    }
  };
  if (typeof v.title === 'string') item.title = v.title;
  if (typeof v.chartPaneId === 'string') item.chartPaneId = v.chartPaneId;
  if (v.state === 'minimized' || v.state === 'maximized' || v.state === 'normal') item.state = v.state;
  if (v.config && typeof v.config === 'object') item.config = v.config as Record<string, unknown>;
  return item;
}

function isWorkspace(value: unknown): value is WorkspaceLayout {
  if (!value || typeof value !== 'object') return false;
  const v = value as unknown as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  if (typeof v.name !== 'string') return false;
  if (v.mode !== 'preset' && v.mode !== 'free') return false;
  if (!Array.isArray(v.items)) return false;
  if (typeof v.snapToGrid !== 'boolean') return false;
  if (typeof v.createdAt !== 'number' || typeof v.updatedAt !== 'number') return false;
  // Bent vienas chart item privalo egzistuoti
  return v.items.some((i) => isLayoutItem(i) && (i as LayoutItem).type === 'chart');
}

function sanitizeWorkspace(value: unknown): WorkspaceLayout | null {
  if (!isWorkspace(value)) return null;
  const v = value as unknown as Record<string, unknown>;
  const items = (v.items as unknown[]).map(sanitizeItem).filter((x): x is LayoutItem => x !== null);
  if (!items.some((i) => i.type === 'chart')) return null;
  return {
    id: v.id as string,
    name: v.name as string,
    mode: v.mode as LayoutMode,
    presetId: typeof v.presetId === 'string' ? v.presetId : undefined,
    items,
    activePaneId: typeof v.activePaneId === 'string' || v.activePaneId === null ? (v.activePaneId as string | null) : undefined,
    snapToGrid: Boolean(v.snapToGrid),
    createdAt: Number(v.createdAt),
    updatedAt: Number(v.updatedAt)
  };
}

/** Fallback workspace – visada validus, pagamintas iš 'single' preset. */
export function makeFallbackWorkspace(): WorkspaceLayout {
  const now = Date.now();
  const items = buildPresetItems('single');
  return {
    id: 'fallback-single',
    name: 'Single Chart',
    mode: 'preset',
    presetId: 'single',
    items,
    activePaneId: 'p1',
    snapToGrid: false,
    createdAt: now,
    updatedAt: now
  };
}

/** Pirmas chart item ID – naudojamas kaip activePaneId fallback. */
export function firstChartId(items: LayoutItem[]): string | undefined {
  return items.find((i) => i.type === 'chart')?.id;
}

/**
 * Skaitymas iš localStorage. Visada grąžina validžią struktūrą
 * (net jei localStorage tuščias, sugadintas, arba JSON blogas).
 */
export function load(stateLike: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null): StoredState {
  if (!stateLike) return defaultState();
  const raw = stateLike.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return defaultState(); }
  if (!parsed || typeof parsed !== 'object') return defaultState();
  const v = parsed as Record<string, unknown>;
  const ws = Array.isArray(v.workspaces)
    ? (v.workspaces as unknown[]).map(sanitizeWorkspace).filter((x): x is WorkspaceLayout => x !== null)
    : [];
  if (ws.length === 0) return defaultState();
  const active = typeof v.activeWorkspaceId === 'string' && ws.some((w) => w.id === v.activeWorkspaceId)
    ? (v.activeWorkspaceId as string)
    : ws[0]!.id;
  return { workspaces: ws, activeWorkspaceId: active };
}

function defaultState(): StoredState {
  const fallback = makeFallbackWorkspace();
  return { workspaces: [fallback], activeWorkspaceId: fallback.id };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized: string | null = null;

/** Debounced įrašymas – drag/resize eventų metu spam'inama ta pati būsena, todėl
 *  paskutinis call'as visada laimi ir tampa vienu storage write'u. */
export function saveDebounced(state: StoredState, store: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null): void {
  if (!store) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const serialized = JSON.stringify(state);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      store.setItem(STORAGE_KEY, serialized);
    } catch {
      // localStorage quota – ignoruojam, bet nebemėtom klaidos
    }
  }, DEBOUNCE_MS);
}

/** Sinchroninis (testams / kritiniams atvejams) – praleidžia debounce. */
export function saveNow(state: StoredState, store: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!store) return;
  try {
    const serialized = JSON.stringify(state);
    lastSerialized = serialized;
    store.setItem(STORAGE_KEY, serialized);
  } catch { /* quota */ }
}

/** Aiškiai išvalo debounce timer'į (naudoti shutdown metu). */
export function cancelPendingSave(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

/** Eksportuoja VISĄ būseną (workspace'ai) į JSON string'ą. */
export function exportJson(state: StoredState): string {
  return JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    state
  }, null, 2);
}

/** Importuoja JSON string'ą. Jei sugadintas ar ne validus – meta Error. */
export function importJson(raw: string): StoredState {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error('Import failed: invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Import failed: expected object');
  const v = parsed as Record<string, unknown>;
  const state = v.state as Record<string, unknown> | undefined;
  if (!state || typeof state !== 'object') throw new Error('Import failed: missing state');
  const ws = Array.isArray(state.workspaces)
    ? (state.workspaces as unknown[]).map(sanitizeWorkspace).filter((x): x is WorkspaceLayout => x !== null)
    : [];
  if (ws.length === 0) throw new Error('Import failed: no valid workspaces');
  const active = typeof state.activeWorkspaceId === 'string' && ws.some((w) => w.id === state.activeWorkspaceId)
    ? (state.activeWorkspaceId as string)
    : ws[0]!.id;
  return { workspaces: ws, activeWorkspaceId: active };
}

/** Unikalus naujo workspace ID (nenaudojamas kaip presetId). */
export function newWorkspaceId(): string {
  return 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** Sukuria naują tuščią workspace, kopijuojant tik struktūrą (be items). */
export function makeEmptyFreeWorkspace(name = 'Free Layout'): WorkspaceLayout {
  const now = Date.now();
  return {
    id: newWorkspaceId(),
    name,
    mode: 'free',
    items: [],
    snapToGrid: true,
    createdAt: now,
    updatedAt: now
  };
}

/** Sukuria workspace pagal preset'ą (visada naujas ID). */
export function makeWorkspaceFromPreset(presetId: PresetId, name?: string): WorkspaceLayout {
  const now = Date.now();
  const items = buildPresetItems(presetId);
  return {
    id: newWorkspaceId(),
    name: name ?? capitalize(presetId),
    mode: 'preset',
    presetId,
    items,
    activePaneId: firstChartId(items) ?? null,
    snapToGrid: false,
    createdAt: now,
    updatedAt: now
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Dubliuoja workspace (naujas ID, gilus items kopija). */
export function duplicateWorkspace(w: WorkspaceLayout, newName?: string): WorkspaceLayout {
  const now = Date.now();
  return {
    ...w,
    id: newWorkspaceId(),
    name: newName ?? `${w.name} (copy)`,
    presetId: undefined,
    items: w.items.map((i) => ({ ...i, position: { ...i.position }, config: i.config ? { ...i.config } : undefined })),
    createdAt: now,
    updatedAt: now
  };
}

/** Pervadina workspace. Originalaus preset'o pervadinti NELEIDŽIAMA (mutate'as preset). */
export function renameWorkspace(w: WorkspaceLayout, newName: string): WorkspaceLayout {
  if (isPresetId(w.presetId)) {
    // Vartotojas negali pervardinti preset'o originalo – sukuriamas vartotojo variantas.
    return { ...w, id: newWorkspaceId(), presetId: undefined, name: newName, updatedAt: Date.now() };
  }
  return { ...w, name: newName, updatedAt: Date.now() };
}

/** Reset – išvalo visus vartotojo workspace'us, palieka tik fallback preset. */
export function resetAll(): StoredState {
  return defaultState();
}

/** Pašalina vieną workspace. Jei trinamas aktyvus – perjungia į pirmą likusį. */
export function removeWorkspace(state: StoredState, id: string): StoredState {
  const remaining = state.workspaces.filter((w) => w.id !== id);
  if (remaining.length === 0) {
    const fallback = makeFallbackWorkspace();
    return { workspaces: [fallback], activeWorkspaceId: fallback.id };
  }
  const active = state.activeWorkspaceId === id ? remaining[0]!.id : state.activeWorkspaceId;
  return { workspaces: remaining, activeWorkspaceId: active };
}

/** Atlieka pakeitimus atomic – pakeičia aktyvų workspace. */
export function updateActive(state: StoredState, mutate: (w: WorkspaceLayout) => WorkspaceLayout): StoredState {
  return {
    ...state,
    workspaces: state.workspaces.map((w) => (w.id === state.activeWorkspaceId ? mutate(w) : w)),
    activeWorkspaceId: state.activeWorkspaceId
  };
}

/** Atnaujina konkretų item (arba pašalina, jei `item == null`). */
export function updateItem(
  w: WorkspaceLayout,
  itemId: string,
  updater: (item: LayoutItem) => LayoutItem | null
): WorkspaceLayout {
  let changed = false;
  const next: LayoutItem[] = [];
  for (const it of w.items) {
    if (it.id === itemId) {
      const u = updater(it);
      changed = true;
      if (u) next.push(u);
    } else {
      next.push(it);
    }
  }
  if (!changed) return w;
  return { ...w, items: next, updatedAt: Date.now() };
}

/** Prideda naują item. Jei nepavyksta (clash) – grąžina originalą. */
export function addItem(w: WorkspaceLayout, item: LayoutItem): WorkspaceLayout {
  if (w.items.some((i) => i.id === item.id)) return w;
  return { ...w, items: [...w.items, item], updatedAt: Date.now() };
}

/** Aktyvaus pane ID setter. */
export function setActivePane(w: WorkspaceLayout, id: string | null): WorkspaceLayout {
  return { ...w, activePaneId: id, updatedAt: Date.now() };
}

/** Sumažina drag delta iki grid (snap). */
export function snap(value: number, grid: number): number {
  if (!Number.isFinite(value) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Free Layout: pozicija normalizuota iki grid (col/row). */
export function snapPosition(
  pos: { x: number; y: number; w: number; h: number },
  cols: number = FREE_GRID_COLS,
  rows: number = FREE_GRID_ROWS,
  enabled: boolean = true
): { x: number; y: number; w: number; h: number } {
  if (!enabled) return pos;
  const sx = 1 / cols;
  const sy = 1 / rows;
  return {
    x: clamp(snap(pos.x, sx), 0, 1),
    y: clamp(snap(pos.y, sy), 0, 1),
    w: clamp(snap(pos.w, sx), 0.05, 1),
    h: clamp(snap(pos.h, sy), 0.05, 1)
  };
}

export { isPresetId };
