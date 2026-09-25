// ─── World-system model + static OSINT layers ──────────────────────────────
// Client, types and color scales for the /api/worldsystem endpoints (backend/services/worldsystem.py).
// The model is a hybrid agent-based model (world-systems, structural-demographic theory,
// metaethnic frontier) calibrated on 1950-2019 and projected to 2030.
import { API_BASE } from "@/lib/api";

export type Matrix = (number | null)[][];

export interface WorldSystemMeta {
  years: number[];
  iso3: string[];
  names: string[];
  isonum: number[];
  channels: string[];
  channel_names: Record<string, string>;
  last_data_year: number;
  scenarios: Record<string, string[]>;
  recommendation_modes: string[];
}

export interface CountryRecommendation {
  cambio_pp: Record<string, number>;
  regla_pct: Record<string, number>;
  presupuesto_pp: number;
  d_consumo_medio: number;
  d_consumo_10a: number;
  d_pib_10a: number;
  d_deuda_10a: number;
  d_conflicto: number;
  prob_mejora: number;
  acuerdo_signo: Record<string, number>;
}

export interface WorldSystemState {
  model: boolean;
  scenario: string;
  variable: string;
  year: number;
  recMode: string;
  osint: Record<StaticLayerId, boolean>;
  selected: string | null; // ISO3
}

export type StaticLayerId = "conflictos" | "maritimo" | "comercio" | "vuelos" | "ductos" | "energia" | "cables" | "puertos";

export const CHANNEL_LABELS: Record<string, string> = {
  k: "Capital doméstico", r: "Tecnología propia", m: "Importar del centro",
  x: "Extracción propia", f: "Recursos fuera", w: "Redistribuir",
};

export const SCENARIOS: { id: string; name: string }[] = [
  { id: "datos", name: "Datos observados" },
  { id: "modelo_hist", name: "Modelo · políticas históricas" },
  { id: "pronostico", name: "Pronóstico desde 1990" },
  { id: "proyeccion", name: "Proyección 2020–2030" },
  { id: "rl_bienestar", name: "RL · Bienestar" },
  { id: "rl_poder", name: "RL · Poder" },
  { id: "rl_elite", name: "RL · Élite" },
  { id: "rl_irl", name: "RL · Recompensa revelada" },
];

type Ramp = [string, string, string, string];
const RAMPS: Record<string, Ramp> = {
  blue: ["#10243a", "#1f5c99", "#4f9be8", "#cfe5fb"],
  orange: ["#2a1a12", "#8a3a18", "#e8662f", "#fcd0b8"],
  aqua: ["#0f2621", "#146b4c", "#22b884", "#bff0dc"],
  violet: ["#1d1a33", "#4b3f9c", "#9486ee", "#e0dcfc"],
  amber: ["#2a2213", "#7a5400", "#d99400", "#f9da92"],
  green: ["#122312", "#1d5e1d", "#35a835", "#c4ebc4"],
};

export interface IndicatorDef {
  id: string;
  name: string;
  desc: string;
  domain: [number, number];
  ramp?: keyof typeof RAMPS;
  diverging?: boolean;
  log?: boolean;
  fmt: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export const INDICATORS: IndicatorDef[] = [
  { id: "ly", name: "PIB per cápita", desc: "Dólares PPA de 2017 por persona (escala log).", domain: [Math.log(500), Math.log(80000)], ramp: "blue", fmt: (v) => usd(Math.exp(v)) },
  { id: "core", name: "Posición en el sistema-mundo", desc: "Centralidad: 0 periferia, 1 centro (productividad relativa).", domain: [0, 1], ramp: "violet", fmt: (v) => v.toFixed(2) },
  { id: "psi", name: "Estrés político (PSI)", desc: "Goldstone/Turchin: movilización de masas × competencia de élites × debilidad fiscal.", domain: [Math.log(0.2), Math.log(20)], ramp: "orange", log: true, fmt: (v) => v.toFixed(2) },
  { id: "conflict", name: "Conflicto interno", desc: "Probabilidad anual de conflicto armado (datos: UCDP activo).", domain: [0, 0.6], ramp: "orange", fmt: pct },
  { id: "asab", name: "Asabiya", desc: "Cohesión colectiva: crece en la frontera metaétnica, decae en centros ricos.", domain: [0.05, 0.95], ramp: "aqua", fmt: (v) => v.toFixed(2) },
  { id: "E", name: "Captura de élites", desc: "Parte del excedente apropiada por la élite (datos: top 10 % WID).", domain: [0.2, 0.8], ramp: "violet", fmt: pct },
  { id: "rent_in", name: "Renta neta del sistema-mundo", desc: "Rentas netas recibidas (+) o drenadas (−), % del PIB.", domain: [-0.12, 0.12], diverging: true, fmt: (v) => (v > 0 ? "+" : "") + pct1(v) },
  { id: "res_share", name: "Rentas de recursos", desc: "Rentas de recursos naturales, % del PIB.", domain: [0, 0.3], ramp: "amber", fmt: pct1 },
  { id: "reserves", name: "Reservas restantes", desc: "Fracción de los recursos recuperables aún sin extraer (curva de Hubbert).", domain: [0, 1], ramp: "green", fmt: pct },
  { id: "debt", name: "Deuda pública", desc: "Deuda / PIB.", domain: [0, 1.5], ramp: "violet", fmt: pct },
  { id: "demo", name: "Democracia", desc: "Democracia (datos) o probabilidad de serlo (modelo).", domain: [0, 1], ramp: "blue", fmt: pct },
  { id: "temp", name: "Temperatura", desc: "Temperatura media anual del país (°C).", domain: [0, 30], ramp: "orange", fmt: (v) => `${v.toFixed(1)} °C` },
  { id: "dclim", name: "Daño climático", desc: "Efecto acumulado del clima sobre la productividad (Burke-Hsiang-Miguel).", domain: [-0.15, 0.15], diverging: true, fmt: (v) => (v > 0 ? "+" : "") + pct1(v) },
  { id: "co2", name: "Emisiones de CO₂", desc: "Mt de CO₂ fósil por año (escala log).", domain: [0, Math.log(10000)], ramp: "amber", log: true, fmt: (v) => `${Math.round(v).toLocaleString("en-US")} Mt` },
];

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Color for a raw indicator value (log-transformed first for log indicators). */
export function colorFor(ind: IndicatorDef, raw: number | null | undefined): string | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const v = ind.log ? Math.log(Math.max(raw, 1e-6)) : raw;
  const [lo, hi] = ind.domain;
  if (ind.diverging) {
    const t = Math.max(-1, Math.min(1, v / Math.max(Math.abs(lo), Math.abs(hi))));
    return t < 0 ? mix("#2b2f36", "#e8662f", -t) : mix("#2b2f36", "#4f9be8", t);
  }
  const r = RAMPS[ind.ramp ?? "blue"];
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 3;
  const k = Math.min(2, Math.floor(t));
  return mix(r[k], r[k + 1], t - k);
}

export function legendStops(ind: IndicatorDef, n = 8): string[] {
  const [lo, hi] = ind.domain;
  return Array.from({ length: n }, (_, k) => {
    const v = lo + ((hi - lo) * k) / (n - 1);
    return colorFor({ ...ind, log: false }, v) ?? "#333";
  });
}

export interface StaticLayerDef {
  id: StaticLayerId;
  name: string;
  color: string;
  source: string;
  api: string; // osint layer name
  byYear?: boolean;
}

export const STATIC_LAYERS: StaticLayerDef[] = [
  { id: "conflictos", name: "Conflictos UCDP GED", color: "#ff5a47", api: "conflictos_ged", byYear: true,
    source: "UCDP GED v24.1 (1989–2023), eventos en celdas de 0,5°; antes de 1989 y después de 2023, conflictos por país (UCDP/PRIO) o riesgo del modelo" },
  { id: "maritimo", name: "Rutas marítimas", color: "#3fe0c5", api: "maritimo", source: "Shipping Lanes v1 (Benden 2021), derivadas de densidad AIS" },
  { id: "comercio", name: "Comercio bilateral", color: "#f2c14e", api: "modelo", byYear: true, source: "Correlates of War, comercio diádico 1950–2014: 300 mayores flujos del quinquenio" },
  { id: "vuelos", name: "Red de rutas aéreas", color: "#7cc6ff", api: "vuelos", source: "OpenFlights (2014): 2 500 pares de aeropuertos con más aerolíneas" },
  { id: "ductos", name: "Oleoductos y gasoductos", color: "#e76f51", api: "ductos", source: "Global Energy Monitor (GOIT/GGIT), en operación, CC BY 4.0" },
  { id: "energia", name: "GNL, yacimientos, reactores", color: "#ff7ab8", api: "energia", source: "GEM: terminales de GNL y yacimientos ≥ 20 mil bep/d; GeoNuclearData: reactores en construcción o planeados" },
  { id: "cables", name: "Cables submarinos", color: "#b8a1ff", api: "cables", source: "TeleGeography Submarine Cable Map (copia en GitHub), CC BY-NC-SA 3.0" },
  { id: "puertos", name: "Puertos del mundo", color: "#e9edf1", api: "puertos", source: "NGA World Port Index: puertos grandes y medianos" },
];

export const DEFAULT_WS: WorldSystemState = {
  model: false,
  scenario: "datos",
  variable: "ly",
  year: 2019,
  recMode: "bienestar",
  osint: { conflictos: false, maritimo: false, comercio: false, vuelos: false, ductos: false, energia: false, cables: false, puertos: false },
  selected: null,
};

const cache = new Map<string, Promise<unknown>>();
export function wsFetch<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(`${API_BASE}/api/worldsystem${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path) as Promise<T>;
}

/** Scenario to read a variable from: forecast/projection scenarios only cover later years. */
export function valueAt(values: Matrix | undefined, i: number, t: number): number | null {
  if (!values || !values[i]) return null;
  const v = values[i][t];
  return v == null ? null : v;
}
