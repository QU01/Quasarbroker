"""Mexico-specific fetchers — CONAGUA weather alerts, CENAPRED volcanic alerts."""
import logging
import re
import xml.etree.ElementTree as ET
from services.network_utils import fetch_with_curl
from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.fetchers.retry import with_retry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State centroids for geocoding CONAGUA alerts (major cities / state capitals)
# ---------------------------------------------------------------------------
_STATE_COORDS = {
    "aguascalientes": (21.88, -102.29), "baja california": (30.84, -115.28),
    "baja california sur": (24.14, -110.31), "campeche": (19.84, -90.53),
    "chiapas": (16.75, -93.12), "chihuahua": (28.63, -106.09),
    "ciudad de mexico": (19.43, -99.13), "coahuila": (25.42, -100.99),
    "colima": (19.24, -103.72), "durango": (24.02, -104.67),
    "guanajuato": (21.02, -101.26), "guerrero": (17.55, -99.51),
    "hidalgo": (20.09, -98.76), "jalisco": (20.66, -103.35),
    "mexico": (19.29, -99.65), "michoacan": (19.70, -101.19),
    "morelos": (18.92, -99.23), "nayarit": (21.50, -104.89),
    "nuevo leon": (25.67, -100.31), "oaxaca": (17.07, -96.72),
    "puebla": (19.04, -98.20), "queretaro": (20.59, -100.39),
    "quintana roo": (21.16, -86.85), "san luis potosi": (22.15, -100.98),
    "sinaloa": (24.81, -107.39), "sonora": (29.07, -110.96),
    "tabasco": (17.99, -92.93), "tamaulipas": (23.74, -99.15),
    "tlaxcala": (19.32, -98.24), "veracruz": (19.53, -96.92),
    "yucatan": (20.97, -89.62), "zacatecas": (22.77, -102.58),
}


# ---------------------------------------------------------------------------
# CONAGUA SMN — Weather Alerts (CAP/RSS feed)
# ---------------------------------------------------------------------------
@with_retry(max_retries=1, base_delay=2)
def fetch_conagua_alerts():
    """Fetch severe weather alerts from CONAGUA SMN (Servicio Meteorológico Nacional).

    Primary: CAP alerts RSS from SMN.
    Fallback: SMN web service for general conditions.
    """
    alerts = []
    try:
        # SMN publishes Common Alerting Protocol (CAP) alerts via RSS
        rss_url = "https://smn.conagua.gob.mx/tools/DATA/Alertas/Aviso_CAP/Cap_Alertas.xml"
        response = fetch_with_curl(rss_url, timeout=15, headers={"User-Agent": "QuasarBroker-OSINT/1.0"})
        if response.status_code == 200 and response.text.strip():
            root = ET.fromstring(response.text)
            # CAP XML may use namespaces
            ns = {"cap": "urn:oasis:names:tc:emergency:cap:1.2"}

            # Try parsing as CAP alert feed
            for alert_elem in root.iter("{urn:oasis:names:tc:emergency:cap:1.2}alert"):
                try:
                    info = alert_elem.find("cap:info", ns)
                    if info is None:
                        continue
                    event = info.findtext("cap:event", "", ns)
                    severity = info.findtext("cap:severity", "Unknown", ns)
                    urgency = info.findtext("cap:urgency", "", ns)
                    headline = info.findtext("cap:headline", "", ns)
                    description = info.findtext("cap:description", "", ns)
                    area_elem = info.find("cap:area", ns)
                    area_desc = area_elem.findtext("cap:areaDesc", "", ns) if area_elem else ""

                    # Try to get coordinates from circle or polygon
                    lat, lng = None, None
                    if area_elem is not None:
                        circle = area_elem.findtext("cap:circle", "", ns)
                        if circle:
                            # Format: "lat,lng radius"
                            coords_part = circle.split()[0] if circle else ""
                            if "," in coords_part:
                                lat, lng = float(coords_part.split(",")[0]), float(coords_part.split(",")[1])

                    # Fallback: geocode from area description
                    if lat is None and area_desc:
                        area_lower = area_desc.lower()
                        for state, (slat, slng) in _STATE_COORDS.items():
                            if state in area_lower:
                                lat, lng = slat, slng
                                break

                    if lat is not None and lng is not None:
                        alerts.append({
                            "event": event,
                            "severity": severity,
                            "urgency": urgency,
                            "headline": headline or event,
                            "description": description[:300] if description else "",
                            "area": area_desc,
                            "lat": lat,
                            "lng": lng,
                            "source": "CONAGUA-SMN",
                        })
                except Exception:
                    continue

            # If CAP parsing yielded nothing, try RSS item parsing (alternate format)
            if not alerts:
                for item in root.iter("item"):
                    try:
                        title = item.findtext("title", "")
                        desc = item.findtext("description", "")
                        link = item.findtext("link", "")

                        # Try to extract state/location from title
                        lat, lng = None, None
                        title_lower = title.lower()
                        for state, (slat, slng) in _STATE_COORDS.items():
                            if state in title_lower:
                                lat, lng = slat, slng
                                break

                        if lat is None:
                            # Try description
                            desc_lower = desc.lower()
                            for state, (slat, slng) in _STATE_COORDS.items():
                                if state in desc_lower:
                                    lat, lng = slat, slng
                                    break

                        if lat is not None and lng is not None:
                            severity = "Severe" if any(w in title_lower for w in ["huracan", "tornado", "tormenta tropical", "alerta roja"]) else \
                                       "Moderate" if any(w in title_lower for w in ["tormenta", "lluvia intensa", "alerta naranja", "granizo"]) else "Minor"
                            alerts.append({
                                "event": title,
                                "severity": severity,
                                "urgency": "",
                                "headline": title,
                                "description": desc[:300] if desc else "",
                                "area": "",
                                "lat": lat,
                                "lng": lng,
                                "source": "CONAGUA-SMN",
                            })
                    except Exception:
                        continue

        logger.info(f"CONAGUA alerts: {len(alerts)} alerts fetched")
    except Exception as e:
        logger.error(f"Error fetching CONAGUA alerts: {e}")

    with _data_lock:
        latest_data["mexico_weather_alerts"] = alerts
    if alerts:
        _mark_fresh("mexico_weather_alerts")


# ---------------------------------------------------------------------------
# CENAPRED Volcanic Alerts — scrape semáforo volcánico
# ---------------------------------------------------------------------------

# Alert level mapping from CENAPRED semáforo
_ALERT_MAP = {
    "verde": "green", "green": "green",
    "amarillo": "yellow", "yellow": "yellow",
    "naranja": "orange", "orange": "orange",
    "rojo": "red", "red": "red",
}

@with_retry(max_retries=1, base_delay=2)
def fetch_cenapred_alerts():
    """Scrape CENAPRED for volcanic alert levels and update the volcano dataset.

    Checks the CENAPRED Popocatépetl page and general volcanic reports
    for current semáforo (traffic light) status.
    """
    updated_levels = {}
    try:
        # Primary: Popocatépetl monitoring page (most frequently updated)
        popo_url = "https://www.cenapred.unam.mx/monitoreoPopworking/popo.html"
        resp = fetch_with_curl(popo_url, timeout=15, headers={"User-Agent": "QuasarBroker-OSINT/1.0"})
        if resp.status_code == 200:
            text = resp.text.lower()
            # Look for semáforo pattern: "semáforo ... amarillo fase 2" etc.
            sem_match = re.search(r"sem[aá]foro[^<]*?(verde|amarillo|naranja|rojo)", text)
            if sem_match:
                level = _ALERT_MAP.get(sem_match.group(1), "yellow")
                updated_levels["Popocatépetl"] = level
                # Extract phase if present
                phase_match = re.search(r"fase\s*(\d)", text)
                if phase_match:
                    updated_levels["Popocatépetl_phase"] = int(phase_match.group(1))

        # Secondary: general volcanic reports page
        reports_url = "https://www.cenapred.unam.mx/reportesVolcanesMX/"
        resp2 = fetch_with_curl(reports_url, timeout=15, headers={"User-Agent": "QuasarBroker-OSINT/1.0"})
        if resp2.status_code == 200:
            text2 = resp2.text.lower()
            # Colima
            colima_match = re.search(r"colima[^<]*?sem[aá]foro[^<]*?(verde|amarillo|naranja|rojo)", text2)
            if colima_match:
                updated_levels["Volcán de Colima"] = _ALERT_MAP.get(colima_match.group(1), "green")

    except Exception as e:
        logger.warning(f"CENAPRED scrape failed (non-fatal): {e}")

    # Update the volcano dataset with scraped alert levels
    if updated_levels:
        try:
            with _data_lock:
                volcanoes = latest_data.get("mexico_volcanoes", [])
                for v in volcanoes:
                    name = v.get("name", "")
                    if name in updated_levels:
                        v["alert_level"] = updated_levels[name]
                    # Add phase info for Popocatépetl
                    if name == "Popocatépetl" and "Popocatépetl_phase" in updated_levels:
                        v["alert_phase"] = updated_levels["Popocatépetl_phase"]
            _mark_fresh("cenapred_alerts")
            logger.info(f"CENAPRED alerts: updated {len(updated_levels)} volcano levels")
        except Exception as e:
            logger.error(f"Error updating volcano levels: {e}")
    else:
        logger.info("CENAPRED alerts: no updates found (pages may be unavailable)")
