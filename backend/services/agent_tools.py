"""LangChain tool wrappers for all QuasarBroker OSINT capabilities.

Each tool is a @tool-decorated function that the deepagents OSINT agent can invoke.
Tools are organized by domain: person intel, live data, web, and analysis.
"""
import json
import logging
from typing import Optional
from langchain_core.tools import tool

logger = logging.getLogger(__name__)


# ===========================================================================
# Person Intelligence Tools
# ===========================================================================

@tool
def person_lookup(
    name: str = "",
    email: str = "",
    username: str = "",
    phone: str = "",
    domain: str = "",
) -> str:
    """Full OSINT investigation on a person. Runs Sherlock username scan across 150+
    sites, email enumeration, GitHub deep profile, HIBP breach check, WHOIS/RDAP,
    DNS recon, Wayback Machine, and paste exposure search.

    Provide at least one of: name, email, username, or domain.
    Returns a comprehensive JSON report with all findings."""
    from services.person_lookup import lookup_person
    result = lookup_person(name=name, email=email, username=username, phone=phone, domain=domain)
    return json.dumps(result, default=str, indent=2)


@tool
def sherlock_scan(username: str) -> str:
    """Scan 150+ websites for a specific username (Sherlock-style enumeration).
    Returns list of sites where the username was found, organized by category
    (dev, social, media, gaming, security, forums, finance, crypto)."""
    from services.person_lookup import _sherlock_scan
    results = _sherlock_scan(username)
    return json.dumps(results, default=str, indent=2)


@tool
def email_enumerate(email: str) -> str:
    """Check if an email address is registered on various services (Holehe-style).
    Checks: Gravatar, GitHub, Spotify, Duolingo, OpenPGP Keys, Ubuntu Keyserver."""
    from services.person_lookup import _email_enumerate
    results = _email_enumerate(email)
    return json.dumps(results, default=str, indent=2)


@tool
def whois_lookup(domain: str) -> str:
    """Look up domain registration data via RDAP/WHOIS.
    Returns: registrant, registrar, creation/expiry dates, nameservers, status."""
    from services.person_lookup import _lookup_whois
    result = _lookup_whois(domain)
    return json.dumps(result, default=str, indent=2)


@tool
def dns_recon(domain: str) -> str:
    """DNS reconnaissance for a domain. Enumerates subdomains via Certificate
    Transparency (crt.sh), MX records, and TXT records via Google DNS."""
    from services.person_lookup import _dns_recon
    result = _dns_recon(domain)
    return json.dumps(result, default=str, indent=2)


@tool
def hibp_check(email: str) -> str:
    """Check HaveIBeenPwned for data breach exposure of an email address.
    Requires HIBP_API_KEY in backend .env. Returns breach names, dates, and data classes."""
    from services.person_lookup import _lookup_hibp
    result = _lookup_hibp(email)
    return json.dumps(result, default=str, indent=2)


@tool
def github_lookup(username: str = "", name: str = "") -> str:
    """Deep GitHub profile lookup. Provide username for direct lookup or name for search.
    Returns: bio, location, company, repos, followers, creation date, avatar."""
    from services.person_lookup import _lookup_github
    result = _lookup_github(username, name)
    return json.dumps(result, default=str, indent=2)


@tool
def wayback_lookup(url: str) -> str:
    """Check the Wayback Machine (Internet Archive) for archived snapshots of a URL.
    Provide a full URL or domain name."""
    from services.person_lookup import _lookup_wayback
    result = _lookup_wayback(url)
    return json.dumps(result, default=str, indent=2)


# ===========================================================================
# Live Data Tools (from QuasarBroker real-time feeds)
# ===========================================================================

def _get_data(key: str, limit: int = 50) -> str:
    """Helper to get live data from the QuasarBroker data store."""
    from services.data_fetcher import get_latest_data
    data = get_latest_data()
    items = data.get(key, [])
    if isinstance(items, list) and len(items) > limit:
        items = items[:limit]
    return json.dumps(items, default=str, indent=2)


@tool
def get_live_flights(limit: int = 30) -> str:
    """Get current tracked flights from the QuasarBroker real-time feed.
    Includes commercial, military, and private flights with positions and callsigns.
    Use limit parameter to control output size (default 30)."""
    from services.data_fetcher import get_latest_data
    data = get_latest_data()
    flights = []
    for key in ["military_flights", "tracked_flights", "private_jets"]:
        items = data.get(key, [])
        if isinstance(items, list):
            flights.extend(items)
    if len(flights) > limit:
        flights = flights[:limit]
    return json.dumps(flights, default=str, indent=2)


@tool
def get_live_ships(limit: int = 30) -> str:
    """Get current vessel positions from the QuasarBroker AIS stream.
    Includes ship name, MMSI, type, position, speed, destination."""
    return _get_data("ships", limit)


@tool
def get_live_earthquakes(limit: int = 30) -> str:
    """Get recent earthquakes from USGS and SSN (Mexico seismological service).
    Includes magnitude, location, depth, and time."""
    from services.data_fetcher import get_latest_data
    data = get_latest_data()
    quakes = data.get("earthquakes", [])
    mx_quakes = data.get("mexico_earthquakes", [])
    combined = (quakes if isinstance(quakes, list) else []) + (mx_quakes if isinstance(mx_quakes, list) else [])
    if len(combined) > limit:
        combined = combined[:limit]
    return json.dumps(combined, default=str, indent=2)


@tool
def get_live_news(limit: int = 20) -> str:
    """Get current OSINT news feed with geolocated risk-scored articles.
    Sources include Reuters, AP, BBC, Al Jazeera, and Mexican outlets."""
    return _get_data("news", limit)


@tool
def get_live_conflicts(limit: int = 30) -> str:
    """Get current conflict and incident data from GDELT and LiveUAMap.
    Includes geopolitical events, protests, military actions worldwide."""
    from services.data_fetcher import get_latest_data
    data = get_latest_data()
    incidents = []
    for key in ["gdelt", "liveuamap"]:
        items = data.get(key, [])
        if isinstance(items, list):
            incidents.extend(items[:limit])
    return json.dumps(incidents[:limit], default=str, indent=2)


@tool
def get_mexico_data() -> str:
    """Get all Mexico-specific OSINT data: military bases (SEDENA/SEMAR), PEMEX
    infrastructure, volcanoes (CENAPRED alerts), weather alerts (CONAGUA),
    airports, border crossings, ports, prisons, and dams."""
    from services.data_fetcher import get_latest_data
    data = get_latest_data()
    mexico = {}
    for key in [
        "military_bases", "pemex_infrastructure", "mexico_volcanoes",
        "mexico_weather_alerts", "mexico_earthquakes", "mexico_airports",
        "mexico_border_crossings", "mexico_ports", "mexico_prisons", "mexico_dams",
    ]:
        items = data.get(key, [])
        if isinstance(items, list):
            # Filter military bases to Mexico only
            if key == "military_bases":
                items = [b for b in items if b.get("country") == "Mexico"
                         or "SEDENA" in str(b.get("branch", ""))
                         or "SEMAR" in str(b.get("branch", ""))
                         or "Mexican" in str(b.get("branch", ""))]
            mexico[key] = items[:50]
    return json.dumps(mexico, default=str, indent=2)


@tool
def get_mexico_state_news(state: str = "", limit: int = 10) -> str:
    """Get current news articles for a specific Mexican state or all states.

    Args:
        state: State name (e.g. "Sinaloa", "CDMX", "Jalisco", "Guerrero") or
               state code (e.g. "SIN", "CMX", "JAL", "GRO"). Leave empty for
               a summary of ALL states with their top headlines and risk scores.
        limit: Maximum articles to return per state (default 10).

    Returns JSON with news articles including title, source, risk_score, published date.
    Useful for situational awareness, security analysis, and tracking events in Mexico."""
    from services.data_fetcher import get_latest_data
    from services.fetchers.mexico_news import MEXICO_STATES

    data = get_latest_data()
    mexico_news = data.get("mexico_news", [])

    if not mexico_news:
        return json.dumps({"error": "No Mexico news data available. The fetcher may not have run yet."})

    state = state.strip()

    if not state:
        # Return summary of all states
        summary = []
        for s in mexico_news:
            if s.get("articles"):
                summary.append({
                    "state": s["state_name"],
                    "code": s["state_code"],
                    "article_count": s["article_count"],
                    "max_risk": s["max_risk"],
                    "top_headline": s["articles"][0]["title"] if s["articles"] else "",
                    "top_source": s["articles"][0]["source"] if s["articles"] else "",
                })
        return json.dumps({"states_with_news": len(summary), "states": summary}, default=str, indent=2)

    # Match by state name or code (case-insensitive)
    state_lower = state.lower()
    matched = None
    for s in mexico_news:
        if (s["state_code"].lower() == state_lower or
            s["state_name"].lower() == state_lower or
            state_lower in s["state_name"].lower()):
            matched = s
            break

    # Also try matching against MEXICO_STATES keys/names
    if not matched:
        for code, info in MEXICO_STATES.items():
            if state_lower == code.lower() or state_lower in info["name"].lower():
                # Found the code, look in news data
                for s in mexico_news:
                    if s["state_code"] == code:
                        matched = s
                        break
                break

    if not matched:
        return json.dumps({"error": f"State '{state}' not found. Valid states: " +
                          ", ".join(f"{v['name']} ({k})" for k, v in sorted(MEXICO_STATES.items()))})

    return json.dumps({
        "state": matched["state_name"],
        "code": matched["state_code"],
        "total_articles": matched["article_count"],
        "max_risk_score": matched["max_risk"],
        "articles": matched["articles"][:limit],
    }, default=str, indent=2)


@tool
def get_region_intelligence(lat: float, lng: float) -> str:
    """Generate an intelligence dossier for a geographic region/country at the
    given coordinates. Includes political context, military presence, risk assessment,
    economic data, and nearby infrastructure."""
    try:
        from services.region_dossier import get_region_dossier
        result = get_region_dossier(lat, lng)
        return json.dumps(result, default=str, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def search_flights_by_callsign(callsign: str) -> str:
    """Search for a specific flight by callsign or registration number.
    Searches across all flight categories (military, tracked, commercial, private)."""
    from services.data_fetcher import get_latest_data
    data = get_latest_data()
    callsign_upper = callsign.upper()
    results = []
    for key in ["military_flights", "tracked_flights", "commercial_flights", "private_jets", "private_flights"]:
        items = data.get(key, [])
        if not isinstance(items, list):
            continue
        for flight in items:
            cs = str(flight.get("callsign", "") or flight.get("flight", "")).upper()
            reg = str(flight.get("registration", "")).upper()
            if callsign_upper in cs or callsign_upper in reg:
                results.append(flight)
    return json.dumps(results[:20], default=str, indent=2)


@tool
def search_ships_by_name(name: str) -> str:
    """Search for a specific vessel by name or MMSI in the AIS data stream."""
    from services.data_fetcher import get_latest_data
    data = get_latest_data()
    ships = data.get("ships", [])
    if not isinstance(ships, list):
        return "[]"
    name_upper = name.upper()
    results = [s for s in ships if name_upper in str(s.get("name", "")).upper()
               or name_upper in str(s.get("mmsi", ""))]
    return json.dumps(results[:20], default=str, indent=2)


# ===========================================================================
# Web Research Tools
# ===========================================================================

@tool
def web_search(query: str, max_results: int = 8) -> str:
    """Search the web using DuckDuckGo. Returns titles, URLs, and snippets.
    Great for researching people, organizations, events, or any OSINT topic.
    Use specific queries with names, usernames, or domains for best results."""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        return json.dumps(results, default=str, indent=2)
    except Exception as e:
        logger.warning(f"Web search failed: {e}")
        return json.dumps({"error": str(e)})


@tool
def web_search_news(query: str, max_results: int = 8) -> str:
    """Search recent news articles using DuckDuckGo News.
    Great for finding recent mentions of people, organizations, or events."""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.news(query, max_results=max_results))
        return json.dumps(results, default=str, indent=2)
    except Exception as e:
        logger.warning(f"News search failed: {e}")
        return json.dumps({"error": str(e)})


@tool
def web_scrape(url: str) -> str:
    """Scrape a webpage and extract its readable text content.
    Useful for reading articles, profiles, or any web page.
    Returns the first 5000 characters of extracted text."""
    try:
        from services.network_utils import fetch_with_curl
        from bs4 import BeautifulSoup
        res = fetch_with_curl(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        if res.status_code != 200:
            return json.dumps({"error": f"HTTP {res.status_code}"})
        soup = BeautifulSoup(res.text, "html.parser")
        # Remove script/style elements
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        # Truncate to 5000 chars
        if len(text) > 5000:
            text = text[:5000] + "\n... [truncated]"
        return text
    except Exception as e:
        logger.warning(f"Web scrape failed for {url}: {e}")
        return json.dumps({"error": str(e)})


# ===========================================================================
# All tools registry
# ===========================================================================

ALL_TOOLS = [
    # Person intelligence
    person_lookup,
    sherlock_scan,
    email_enumerate,
    whois_lookup,
    dns_recon,
    hibp_check,
    github_lookup,
    wayback_lookup,
    # Live data
    get_live_flights,
    get_live_ships,
    get_live_earthquakes,
    get_live_news,
    get_live_conflicts,
    get_mexico_data,
    get_mexico_state_news,
    get_region_intelligence,
    search_flights_by_callsign,
    search_ships_by_name,
    # Web research
    web_search,
    web_search_news,
    web_scrape,
]
