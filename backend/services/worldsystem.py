"""World-system model and static OSINT layers (from the Reproducible-Research-Project-2 model).

Serves the outputs of the hybrid agent-based model (world-systems + structural-demographic +
metaethnic frontier, calibrated on 1950-2019 and projected to 2030): per-country indicators by
scenario and year, the out-of-sample validation, the reward revealed by the inverse problem and
the incremental policy recommendations, plus open OSINT snapshots that the live feeds do not
cover (UCDP GED conflict events, shipping lanes, bilateral trade, air-route network, pipelines,
LNG terminals and oil/gas fields, new reactors, submarine cables, world ports).

Data files live in backend/data/worldsystem/ (gzip JSON), refreshed with
scripts/sync_worldsystem.py from a checkout of the research repository.
"""
from __future__ import annotations

import gzip
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "worldsystem"
OSINT_LAYERS = ("conflictos_ged", "maritimo", "vuelos", "ductos", "energia", "cables", "puertos", "modelo")

router = APIRouter(prefix="/api/worldsystem", tags=["worldsystem"])


def _load(name: str) -> Any:
    path = DATA_DIR / f"{name}.json.gz"
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"World-system data not installed ({path.name}); run scripts/sync_worldsystem.py")
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def model_data() -> dict:
    return _load("dashboard_data")


@lru_cache(maxsize=16)
def osint_layer(name: str) -> dict:
    return _load(f"osint/{name}")


def _scenario(name: str) -> dict:
    sc = model_data()["scenarios"].get(name)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario '{name}'")
    return sc


@router.get("/meta")
def meta() -> dict:
    """Countries, years, scenarios with their variables, calibration summary and headline results."""
    d = model_data()
    m = d["meta"]
    return {
        "years": m["years"], "iso3": m["iso3"], "names": m["names"], "isonum": m["isonum"],
        "channels": m["channels"], "channel_names": m["channel_names"], "last_data_year": m.get("last_data_year", 2019),
        "scenarios": {k: sorted(v.keys()) for k, v in d["scenarios"].items()},
        "fit": d.get("calibration", {}).get("fit"),
        "resumen": {k: v for k, v in d.get("resumen", {}).items() if k != "rl"},
        "recommendation_modes": [k for k in ("bienestar", "revelada") if k in d.get("recomendaciones", {})],
    }


@router.get("/layer")
def layer(scenario: str = Query("modelo_hist"), var: str = Query("ly"), year: int | None = Query(None)) -> dict:
    """Indicator values for all countries: the full (N, T) matrix, or one year when `year` is given."""
    sc = _scenario(scenario)
    if var not in sc:
        raise HTTPException(status_code=404, detail=f"Variable '{var}' not in scenario '{scenario}'")
    vals = sc[var]
    if year is None:
        return {"scenario": scenario, "var": var, "values": vals}
    years = model_data()["meta"]["years"]
    if year not in years:
        raise HTTPException(status_code=404, detail=f"Year {year} outside {years[0]}-{years[-1]}")
    t = years.index(year)
    return {"scenario": scenario, "var": var, "year": year, "values": [row[t] for row in vals]}


@router.get("/country/{iso3}")
def country(iso3: str) -> dict:
    """Time series of the main indicators in every scenario and the recommendations for one country."""
    d = model_data()
    iso = iso3.upper()
    if iso not in d["meta"]["iso3"]:
        raise HTTPException(status_code=404, detail=f"Unknown country '{iso3}'")
    i = d["meta"]["iso3"].index(iso)
    keep = ("ly", "ly_p10", "ly_p90", "conflict", "psi", "debt", "demo", "E", "reserves", "temp")
    series = {s: {k: v[i] for k, v in sc.items() if k in keep} for s, sc in d["scenarios"].items()}
    recs = {m: r["paises"].get(iso) for m, r in d.get("recomendaciones", {}).items() if isinstance(r, dict) and "paises" in r}
    return {"iso3": iso, "name": d["meta"]["names"][i], "years": d["meta"]["years"], "series": series, "recomendaciones": recs}


@router.get("/recommendations")
def recommendations(mode: str = Query("bienestar")) -> dict:
    rec = model_data().get("recomendaciones", {})
    if mode not in rec:
        raise HTTPException(status_code=404, detail=f"No recommendations for objective '{mode}'")
    r = rec[mode]
    return {"mode": mode, "meta": rec.get("meta"), "global": r.get("global_"), "largo_plazo": r.get("largo_plazo"), "paises": r["paises"]}


@router.get("/insights")
def insights() -> dict:
    """Revealed reward (inverse RL), decision rules and validation summaries."""
    d = model_data()
    irl = d.get("irl", {})
    val = d.get("validacion", {})
    return {
        "irl": {k: irl.get(k) for k in ("theta_std", "racionalidad", "racionalidad_alternativas", "por_zona", "por_regimen", "parsimonioso")},
        "conducta": d.get("conducta"),
        "validacion": {k: val.get(k) for k in ("gdp", "conf", "debt", "temp") if k in val},
    }


@router.get("/countries")
def countries() -> dict:
    """Natural Earth 1:110m country polygons; feature id = ISO 3166 numeric (matches meta.isonum)."""
    return _load("countries")


@router.get("/osint/{name}")
def osint(name: str, year: int | None = Query(None)) -> dict:
    """Static open-source layers. For conflictos_ged and modelo, `year` returns only that year."""
    if name not in OSINT_LAYERS:
        raise HTTPException(status_code=404, detail=f"Unknown layer '{name}'. Available: {', '.join(OSINT_LAYERS)}")
    d = osint_layer(name)
    if year is None:
        return d
    if name == "conflictos_ged":
        return {"fuente": d["fuente"], "campos": d["campos"], "year": year,
                "muertes": d["muertes_por_anio"].get(str(year)), "filas": d["por_anio"].get(str(year), [])}
    if name == "modelo":
        trade_years = sorted(int(y) for y in d["comercio_por_anio"])
        ty = max([y for y in trade_years if y <= year] or trade_years[:1])
        return {"posiciones": d["posiciones"], "year": year,
                "conflictos": d["conflictos_por_anio"].get(str(year), []),
                "comercio_anio": ty, "comercio": d["comercio_por_anio"].get(str(ty), []),
                "fuente_conflictos": d["fuente_conflictos"], "fuente_comercio": d["fuente_comercio"]}
    return d
