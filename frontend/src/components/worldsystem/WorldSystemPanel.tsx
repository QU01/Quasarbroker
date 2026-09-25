"use client";
// Control panel for the world-system module: model layer (scenario, indicator, year), static OSINT
// layers and the selected country's incremental recommendation.
import { useEffect, useState } from "react";
import { Play, Pause, X, Globe2 } from "lucide-react";
import {
  CHANNEL_LABELS, INDICATORS, SCENARIOS, STATIC_LAYERS, legendStops,
  type Matrix, type WorldSystemMeta, type WorldSystemState,
} from "@/lib/worldsystem";
import type { Recommendations } from "@/hooks/useWorldSystem";

interface Props {
  ws: WorldSystemState;
  setWs: React.Dispatch<React.SetStateAction<WorldSystemState>>;
  meta: WorldSystemMeta | null;
  values: Matrix | undefined;
  recs: Recommendations | null;
  error: string | null;
  onClose: () => void;
}

const label = "text-[8px] font-mono tracking-[0.2em] text-[var(--text-muted)] uppercase";
const sel = "w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)]";
const sgn = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

export default function WorldSystemPanel({ ws, setWs, meta, values, recs, error, onClose }: Props) {
  const [playing, setPlaying] = useState(false);
  const ind = INDICATORS.find((i) => i.id === ws.variable) ?? INDICATORS[0];
  const y0 = meta?.years[0] ?? 1950, y1 = meta?.years[meta.years.length - 1] ?? 2030;
  const avail = meta?.scenarios[ws.scenario] ?? [];

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setWs((s) => ({ ...s, year: s.year >= y1 ? y0 : s.year + 1 })), 450);
    return () => clearInterval(id);
  }, [playing, setWs, y0, y1]);

  const i = meta && ws.selected ? meta.iso3.indexOf(ws.selected) : -1;
  const t = meta ? meta.years.indexOf(ws.year) : -1;
  const v = i >= 0 && t >= 0 ? values?.[i]?.[t] : null;
  const rec = ws.selected && recs ? recs.paises[ws.selected] : undefined;

  return (
    <div className="pointer-events-auto w-[380px] max-h-[calc(100vh-8rem)] overflow-y-auto styled-scrollbar bg-[var(--bg-primary)]/85 backdrop-blur-md border border-[var(--border-primary)] rounded-lg shadow-[0_0_24px_rgba(0,255,255,0.08)] p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-cyan-400"><Globe2 size={13} /><span className="text-[10px] font-mono tracking-[0.3em]">SISTEMA-MUNDO</span></div>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Cerrar panel"><X size={13} /></button>
      </div>
      <p className="text-[9px] leading-relaxed text-[var(--text-secondary)]">
        Modelo agéntico de 180 países (sistema-mundo, demografía estructural, frontera metaétnica) calibrado con datos 1950–2019, validado fuera de muestra y proyectado a 2030.
      </p>
      {error && <p className="text-[9px] font-mono text-red-400">{error}</p>}

      <label className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-primary)]">
        <input type="checkbox" checked={ws.model} onChange={(e) => setWs((s) => ({ ...s, model: e.target.checked }))} className="accent-cyan-500" />
        Capa del modelo en el mapa
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div><div className={label}>Escenario</div>
          <select className={sel} value={ws.scenario} onChange={(e) => setWs((s) => ({ ...s, scenario: e.target.value, model: true }))}>
            {SCENARIOS.filter((s) => !meta || meta.scenarios[s.id]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><div className={label}>Indicador</div>
          <select className={sel} value={ws.variable} onChange={(e) => setWs((s) => ({ ...s, variable: e.target.value, model: true }))}>
            {INDICATORS.map((d) => <option key={d.id} value={d.id} disabled={meta != null && !avail.includes(d.id)}>{d.name}</option>)}
          </select></div>
      </div>
      <div className="text-[9px] text-[var(--text-muted)]">{ind.desc}</div>
      <div>
        <div className="h-2 rounded" style={{ background: `linear-gradient(90deg, ${legendStops(ind).join(",")})` }} />
        <div className="flex justify-between text-[8px] font-mono text-[var(--text-muted)] mt-0.5">
          <span>{ind.fmt(ind.log ? Math.exp(ind.domain[0]) : ind.domain[0])}</span><span>{ind.fmt(ind.log ? Math.exp(ind.domain[1]) : ind.domain[1])}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setPlaying((p) => !p)} className="w-7 h-7 rounded-full border border-cyan-800/60 grid place-items-center text-cyan-300" aria-label={playing ? "Pausar" : "Reproducir"}>
          {playing ? <Pause size={11} /> : <Play size={11} />}
        </button>
        <input type="range" min={y0} max={y1} value={ws.year} onChange={(e) => setWs((s) => ({ ...s, year: +e.target.value }))} className="flex-1 accent-cyan-500" aria-label="Año" />
        <span className="text-[13px] font-mono text-[var(--text-primary)] w-12 text-right">{ws.year}{meta && ws.year > meta.last_data_year ? "*" : ""}</span>
      </div>

      <div>
        <div className={label}>Capas OSINT abiertas</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {STATIC_LAYERS.map((l) => (
            <button key={l.id} title={l.source} aria-pressed={ws.osint[l.id]}
              onClick={() => setWs((s) => ({ ...s, osint: { ...s.osint, [l.id]: !s.osint[l.id] } }))}
              className={`flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-mono ${ws.osint[l.id] ? "border-cyan-500/70 text-[var(--text-primary)]" : "border-[var(--border-primary)] text-[var(--text-muted)]"}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: l.color, opacity: ws.osint[l.id] ? 1 : 0.35 }} />{l.name}
            </button>
          ))}
        </div>
        <p className="text-[8px] text-[var(--text-muted)] mt-1">Instantáneas públicas; los conflictos y el comercio siguen al año elegido.</p>
      </div>

      <div className="border-t border-[var(--border-primary)] pt-2">
        <div className="flex items-center justify-between">
          <div className={label}>País</div>
          <select className="bg-transparent text-[9px] font-mono text-cyan-300" value={ws.recMode} onChange={(e) => setWs((s) => ({ ...s, recMode: e.target.value }))} aria-label="Objetivo de la recomendación">
            {(meta?.recommendation_modes ?? ["bienestar"]).map((m) => <option key={m} value={m}>{m === "bienestar" ? "Objetivo: bienestar" : "Objetivo: recompensa revelada"}</option>)}
          </select>
        </div>
        {!ws.selected || i < 0 ? (
          <p className="text-[9px] text-[var(--text-muted)] mt-1">Pulsa un país en el mapa con la capa del modelo activa para ver su recomendación.</p>
        ) : (
          <div className="mt-1 flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-bold text-[var(--text-primary)]">{meta!.names[i]}</span>
              <span className="text-[10px] font-mono text-cyan-300">{ind.name}: {v == null ? "—" : ind.fmt(v)}</span>
            </div>
            {rec ? (
              <>
                <div className="text-[8px] text-[var(--text-muted)]">Cambio recomendado 2020–2024 frente a su regla de decisión estimada (puntos del PIB)</div>
                {Object.entries(rec.cambio_pp).map(([c, d]) => (
                  <div key={c} className="grid grid-cols-[110px_1fr_40px] items-center gap-2">
                    <span className="text-[9px] text-[var(--text-secondary)]">{CHANNEL_LABELS[c] ?? c}</span>
                    <div className="relative h-1.5 bg-[var(--bg-secondary)] rounded">
                      <span className="absolute top-0 bottom-0 w-px left-1/2 bg-[var(--border-primary)]" />
                      <span className={`absolute top-0 bottom-0 rounded ${d >= 0 ? "bg-emerald-400" : "bg-rose-400"}`}
                        style={d >= 0 ? { left: "50%", width: `${Math.min(50, Math.abs(d) * 5)}%` } : { right: "50%", width: `${Math.min(50, Math.abs(d) * 5)}%` }} />
                    </div>
                    <span className="text-[9px] font-mono text-right text-[var(--text-primary)]">{sgn(d)}</span>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px] font-mono mt-1">
                  <span className="text-[var(--text-muted)]">Gasto total</span><span className="text-right">{sgn(rec.presupuesto_pp)} pp</span>
                  <span className="text-[var(--text-muted)]">Consumo medio</span><span className="text-right">{sgn(100 * rec.d_consumo_medio)} %</span>
                  <span className="text-[var(--text-muted)]">PIB en 10 años</span><span className="text-right">{sgn(100 * rec.d_pib_10a)} %</span>
                  <span className="text-[var(--text-muted)]">Deuda en 10 años</span><span className="text-right">{sgn(100 * rec.d_deuda_10a)} pp</span>
                  <span className="text-[var(--text-muted)]">Prob. de mejora</span><span className="text-right">{Math.round(100 * rec.prob_mejora)} %</span>
                  <span className="text-[var(--text-muted)]">Robustez del signo</span><span className="text-right">{Math.round(100 * (rec.acuerdo_signo.presupuesto ?? 0))} %</span>
                </div>
                <p className="text-[8px] text-[var(--text-muted)]">Salida del modelo con una región de confianza alrededor de la conducta observada; no es consejo de política.</p>
              </>
            ) : <p className="text-[9px] text-[var(--text-muted)]">Sin recomendación para este país.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
