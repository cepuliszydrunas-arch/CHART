/**
 * 8 paruošti layout šablonai.
 *
 * Visos koordinatės normalizuotos [0..1]. Chart panes pagal presetą gauna
 * atskirus `chartPaneId` ir skirtingus `config.interval` pagal paskirtį
 * (top-down: 1H/15M/5M; 4-grid: 4H/1H/15M/5M). Simbolis visada prasideda
 * nuo BTCUSDT, bet vartotojas vėliau gali pakeisti per chart type / symbol
 * meniu – tas pakeitimas išsaugomas atskirame workspace'e, o ne perrašo
 * preset'ą.
 */

import type { ChartPaneConfig, LayoutItem, LayoutPresetMeta, LayoutItemType } from './types';

export const PRESET_IDS = [
  'single',
  'topdown',
  'grid4',
  'orderflow',
  'trading',
  'scanner',
  'planner',
  'free'
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_META: Record<PresetId, LayoutPresetMeta> = {
  single: {
    id: 'single',
    name: 'Single Chart',
    description: 'One full-size chart for focus on a single instrument or timeframe.',
    icon: 'single'
  },
  topdown: {
    id: 'topdown',
    name: 'Top-Down',
    description: 'Three charts for top-down analysis (1H / 15M / 5M).',
    icon: 'rows'
  },
  grid4: {
    id: 'grid4',
    name: '4 Chart Grid',
    description: '2×2 grid of charts across multiple timeframes (4H / 1H / 15M / 5M).',
    icon: 'grid'
  },
  orderflow: {
    id: 'orderflow',
    name: 'Order Flow',
    description: 'Main chart + Footprint, Order Book and Time & Sales widgets.',
    icon: 'orderflow'
  },
  trading: {
    id: 'trading',
    name: 'Trading Desk',
    description: 'Chart + Order Ticket, Positions, Risk panel and Alerts (PAPER only).',
    icon: 'trading'
  },
  scanner: {
    id: 'scanner',
    name: 'Market Scanner',
    description: 'Multi-symbol watch with one main chart and several scanner panes.',
    icon: 'scanner'
  },
  planner: {
    id: 'planner',
    name: 'Session Planner',
    description: 'Chart with London/NY session levels, Volume Profile, CVD and Notes.',
    icon: 'planner'
  },
  free: {
    id: 'free',
    name: 'Free Layout',
    description: 'Custom workspace — add, move, resize and remove any chart or widget.',
    icon: 'free'
  }
};

function chart(id: string, pos: { x: number; y: number; w: number; h: number }, cfg: ChartPaneConfig): LayoutItem {
  return {
    id,
    type: 'chart',
    chartPaneId: id,
    position: { x: pos.x, y: pos.y, w: pos.w, h: pos.h, minW: 0.2, minH: 0.2, maxW: 1, maxH: 1 },
    config: { ...cfg }
  };
}

function widget(
  id: string,
  type: Exclude<LayoutItemType, 'chart'>,
  pos: { x: number; y: number; w: number; h: number },
  title?: string
): LayoutItem {
  return {
    id,
    type,
    title,
    position: { x: pos.x, y: pos.y, w: pos.w, h: pos.h, minW: 0.15, minH: 0.12, maxW: 1, maxH: 1 }
  };
}

function preset(id: PresetId, items: LayoutItem[], activePaneId?: string): LayoutItem[] {
  void id;
  void activePaneId;
  return items;
}

/** Grąžina items sąrašą pagal preset ID. */
export function buildPresetItems(presetId: PresetId): LayoutItem[] {
  switch (presetId) {
    case 'single':
      return preset('single', [
        chart('p1', { x: 0, y: 0, w: 1, h: 1 }, { symbol: 'BTCUSDT', interval: '1h', active: true })
      ], 'p1');

    case 'topdown':
      return preset('topdown', [
        chart('p1', { x: 0, y: 0, w: 1, h: 0.34 }, { symbol: 'BTCUSDT', interval: '1h', active: true }),
        chart('p2', { x: 0, y: 0.34, w: 1, h: 0.33 }, { symbol: 'BTCUSDT', interval: '15m' }),
        chart('p3', { x: 0, y: 0.67, w: 1, h: 0.33 }, { symbol: 'BTCUSDT', interval: '5m' })
      ], 'p1');

    case 'grid4':
      return preset('grid4', [
        chart('p1', { x: 0, y: 0, w: 0.5, h: 0.5 }, { symbol: 'BTCUSDT', interval: '4h', active: true }),
        chart('p2', { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { symbol: 'BTCUSDT', interval: '1h' }),
        chart('p3', { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { symbol: 'ETHUSDT', interval: '15m' }),
        chart('p4', { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, { symbol: 'SOLUSDT', interval: '5m' })
      ], 'p1');

    case 'orderflow':
      return preset('orderflow', [
        chart('p1', { x: 0, y: 0, w: 0.7, h: 1 }, { symbol: 'BTCUSDT', interval: '5m', active: true }),
        widget('w-fp', 'footprint', { x: 0.7, y: 0, w: 0.3, h: 0.4 }, 'Footprint'),
        widget('w-ob', 'orderbook', { x: 0.7, y: 0.4, w: 0.3, h: 0.3 }, 'Order Book'),
        widget('w-ts', 'time_sales', { x: 0.7, y: 0.7, w: 0.3, h: 0.3 }, 'Time & Sales')
      ], 'p1');

    case 'trading':
      return preset('trading', [
        chart('p1', { x: 0, y: 0, w: 0.65, h: 1 }, { symbol: 'BTCUSDT', interval: '15m', active: true }),
        widget('w-ticket', 'order_ticket', { x: 0.65, y: 0, w: 0.35, h: 0.4 }, 'Order Ticket · PAPER'),
        widget('w-pos', 'positions', { x: 0.65, y: 0.4, w: 0.35, h: 0.35 }, 'Positions / Orders'),
        widget('w-alerts', 'alerts', { x: 0.65, y: 0.75, w: 0.35, h: 0.25 }, 'Alerts')
      ], 'p1');

    case 'scanner':
      return preset('scanner', [
        chart('p1', { x: 0, y: 0, w: 0.6, h: 0.65 }, { symbol: 'BTCUSDT', interval: '15m', active: true }),
        chart('p2', { x: 0.6, y: 0, w: 0.4, h: 0.325 }, { symbol: 'ETHUSDT', interval: '15m' }),
        chart('p3', { x: 0.6, y: 0.325, w: 0.4, h: 0.325 }, { symbol: 'SOLUSDT', interval: '15m' }),
        widget('w-watch', 'notes', { x: 0, y: 0.65, w: 0.6, h: 0.35 }, 'Watchlist'),
        chart('p4', { x: 0.6, y: 0.65, w: 0.4, h: 0.35 }, { symbol: 'BNBUSDT', interval: '1h' })
      ], 'p1');

    case 'planner':
      return preset('planner', [
        chart('p1', { x: 0, y: 0, w: 0.65, h: 0.7 }, { symbol: 'BTCUSDT', interval: '15m', active: true }),
        widget('w-sessions', 'sessions', { x: 0.65, y: 0, w: 0.35, h: 0.25 }, 'London / NY sessions'),
        widget('w-vp', 'volume_profile', { x: 0.65, y: 0.25, w: 0.35, h: 0.25 }, 'Volume Profile'),
        widget('w-cvd', 'cvd', { x: 0.65, y: 0.5, w: 0.35, h: 0.2 }, 'CVD'),
        widget('w-alerts', 'alerts', { x: 0.65, y: 0.7, w: 0.35, h: 0.15 }, 'Alerts'),
        widget('w-notes', 'notes', { x: 0, y: 0.7, w: 0.65, h: 0.3 }, 'Session Notes')
      ], 'p1');

    case 'free':
      return preset('free', [
        chart('p1', { x: 0, y: 0, w: 0.6, h: 0.7 }, { symbol: 'BTCUSDT', interval: '1h', active: true }),
        widget('w-ob', 'orderbook', { x: 0.6, y: 0, w: 0.4, h: 0.5 }, 'Order Book'),
        widget('w-notes', 'notes', { x: 0.6, y: 0.5, w: 0.4, h: 0.5 }, 'Notes')
      ], 'p1');
  }
}

/** Ar PresetID yra žinomas. */
export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value);
}
