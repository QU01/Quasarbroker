"""World-system module: endpoints serve the model outputs and static OSINT layers."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.worldsystem import OSINT_LAYERS, router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_meta_lists_countries_scenarios_and_years():
    r = client.get("/api/worldsystem/meta")
    assert r.status_code == 200
    m = r.json()
    assert len(m["iso3"]) == len(m["names"]) == len(m["isonum"]) > 150
    assert m["years"][0] == 1950 and m["years"][-1] >= 2030
    assert "ly" in m["scenarios"]["modelo_hist"]


def test_layer_year_slice_matches_full_matrix():
    full = client.get("/api/worldsystem/layer", params={"scenario": "datos", "var": "ly"}).json()["values"]
    one = client.get("/api/worldsystem/layer", params={"scenario": "datos", "var": "ly", "year": 2000}).json()["values"]
    assert len(one) == len(full)
    assert one == [row[50] for row in full]


def test_unknown_inputs_return_404():
    assert client.get("/api/worldsystem/layer", params={"scenario": "nope"}).status_code == 404
    assert client.get("/api/worldsystem/layer", params={"var": "nope"}).status_code == 404
    assert client.get("/api/worldsystem/country/XXX").status_code == 404
    assert client.get("/api/worldsystem/osint/nope").status_code == 404


def test_country_has_series_and_recommendations():
    c = client.get("/api/worldsystem/country/mex").json()
    assert c["iso3"] == "MEX"
    assert len(c["series"]["datos"]["ly"]) == len(c["years"])
    assert isinstance(c["recomendaciones"], dict)


def test_every_osint_layer_loads():
    for name in OSINT_LAYERS:
        assert client.get(f"/api/worldsystem/osint/{name}").status_code == 200, name


def test_conflict_events_by_year():
    d = client.get("/api/worldsystem/osint/conflictos_ged", params={"year": 2015}).json()
    assert d["year"] == 2015 and len(d["filas"]) > 100
    lon, lat, events, deaths, kind = d["filas"][0]
    assert -180 <= lon <= 180 and -90 <= lat <= 90 and events >= 1 and kind in (1, 2, 3)


def test_trade_flows_fall_back_to_last_available_year():
    d = client.get("/api/worldsystem/osint/modelo", params={"year": 2019}).json()
    assert d["comercio_anio"] <= 2019 and len(d["comercio"]) > 0
