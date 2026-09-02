/**
 * Layout / Workspace tipai — Chart Layouts sistemai.
 *
 * `LayoutItem` apibūdina vieną elementą darbo erdvėje: chart pane, order book,
 * footprint, order ticket, notes ir t.t. Koordinatės — normalizuotos [0..1],
 * kad viewport dydžio pokyčiai automatiškai persistuotų (chart canvas realiu
 * laiku perskaičiuoja dydžius pagal `position`).
 *
 * Preset'ai turi fiksuotą `presetId`; vartotojo workspace'ai — ne.
 */

export type LayoutMode = 'preset' | 'free';

export type LayoutItemType =
  | 'chart'
  | 'footprint'
  | 'orderbook'
  | 'time_sales'
  | 'order_ticket'
  | 'positions'
  | 'alerts'
  | 'cvd'
  | 'volume_profile'
  | 'notes'
  | 'sessions';

export interface LayoutGridPosition {
  /** Normalizuota [0..1] – x koordinatė kairysis kraštas */
  x: number;
  /** Normalizuota [0..1] – y koordinatė viršutinis kraštas */
  y: number;
  /** Normalizuotas [0..1] plotis */
  w: number;
  /** Normalizuotas [0..1] aukštis */
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface ChartPaneConfig {
  symbol?: string;
  exchange?: string;
  interval?: string;
  /** Ar šis pane laikomas „aktyviu" (focus + indikatoriai taikomi jam) */
  active?: boolean;
}

export interface LayoutItem {
  id: string;
  type: LayoutItemType;
  title?: string;
  position: LayoutGridPosition;
  config?: Record<string, unknown>;
  chartPaneId?: string;
  /** Minimizuota/maximizuota būsena (Free Layout) */
  state?: 'normal' | 'minimized' | 'maximized';
}

export interface WorkspaceLayout {
  id: string;
  name: string;
  mode: LayoutMode;
  /** Jei sukurta iš preset'o – originalaus preset'o ID (kad žinoti, kad neperrašyti) */
  presetId?: string;
  items: LayoutItem[];
  activePaneId?: string | null;
  snapToGrid: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LayoutPresetMeta {
  id: string;
  name: string;
  description: string;
  icon: 'single' | 'rows' | 'grid' | 'orderflow' | 'trading' | 'scanner' | 'planner' | 'free';
}

/** 6×4 grid (Free Layout) */
export const FREE_GRID = { cols: 12, rows: 8 } as const;
