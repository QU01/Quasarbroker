"""OSINT Person Lookup — aggregates public data from multiple sources.

Integrates:
- Sherlock-style username enumeration (150+ sites)
- Email enumeration (Gravatar, HIBP, PGP keys)
- GitHub deep profile
- Wikipedia summary
- WHOIS / RDAP for domains
- Wayback Machine history
- Pastebin/paste search
"""
import json
import logging
import hashlib
import time
import os
import concurrent.futures
from pathlib import Path
from urllib.parse import quote
from cachetools import TTLCache
from services.network_utils import fetch_with_curl

logger = logging.getLogger(__name__)

# Cache results for 1 hour
person_cache = TTLCache(maxsize=200, ttl=3600)

# Load Sherlock sites database
_SHERLOCK_DB_PATH = Path(__file__).parent.parent / "data" / "sherlock_sites.json"
_SHERLOCK_SITES = []
try:
    with open(_SHERLOCK_DB_PATH) as f:
        _db = json.load(f)
        _SHERLOCK_SITES = _db.get("sites", [])
    logger.info(f"Loaded {len(_SHERLOCK_SITES)} Sherlock sites")
except Exception as e:
    logger.warning(f"Could not load Sherlock sites DB: {e}")


def _cache_key(name: str, email: str, username: str, phone: str, domain: str) -> str:
    raw = f"{name}|{email}|{username}|{phone}|{domain}".lower().strip()
    return hashlib.md5(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Sherlock-style username enumeration
# ---------------------------------------------------------------------------
def _check_single_site(site: dict, username: str) -> dict | None:
    """Check if username exists on a single site. Returns result or None."""
    url = site["url"].replace("{}", quote(username))
    try:
        res = fetch_with_curl(url, timeout=8, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })
        found = False
        if site.get("method", "status") == "status":
            found = res.status_code == 200
        elif site["method"] == "body_contains":
            found = res.status_code == 200 and site.get("match", "") in res.text
        elif site["method"] == "body_missing":
            found = res.status_code == 200 and site.get("match", "") not in res.text

        if found:
            return {
                "name": site["name"],
                "url": url,
                "cat": site.get("cat", "other"),
            }
    except Exception:
        pass
    return None


def _sherlock_scan(username: str) -> list:
    """Scan 150+ sites for username existence using concurrent requests."""
    if not username or not _SHERLOCK_SITES:
        return []

    results = []
    # Use 30 workers for parallel HTTP checks — fast like Sherlock
    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as pool:
        futures = {
            pool.submit(_check_single_site, site, username): site
            for site in _SHERLOCK_SITES
        }
        for future in concurrent.futures.as_completed(futures, timeout=25):
            try:
                result = future.result(timeout=10)
                if result:
                    results.append(result)
            except Exception:
                pass

    # Sort by category then name
    results.sort(key=lambda r: (r.get("cat", "z"), r["name"]))
    return results


# ---------------------------------------------------------------------------
# Email enumeration — check if email is registered on services
# ---------------------------------------------------------------------------
def _email_enumerate(email: str) -> list:
    """Check if an email is registered on various services (Holehe-style)."""
    if not email:
        return []

    results = []

    # 1. Gravatar — check via hash
    email_hash = hashlib.md5(email.lower().strip().encode()).hexdigest()
    try:
        res = fetch_with_curl(f"https://en.gravatar.com/{email_hash}.json", timeout=8)
        if res.status_code == 200:
            results.append({"service": "Gravatar", "registered": True, "url": f"https://gravatar.com/{email_hash}"})
        else:
            results.append({"service": "Gravatar", "registered": False})
    except Exception:
        results.append({"service": "Gravatar", "registered": None})

    # 2. GitHub — search by email
    try:
        res = fetch_with_curl(
            f"https://api.github.com/search/users?q={quote(email)}+in:email&per_page=1",
            timeout=8,
            headers={"Accept": "application/vnd.github.v3+json"},
        )
        if res.status_code == 200:
            data = res.json()
            found = data.get("total_count", 0) > 0
            results.append({
                "service": "GitHub",
                "registered": found,
                "url": data["items"][0]["html_url"] if found and data.get("items") else None,
            })
    except Exception:
        pass

    # 3. Spotify — check password reset endpoint hints
    try:
        res = fetch_with_curl(
            f"https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email={quote(email)}",
            timeout=8,
        )
        if res.status_code == 200:
            data = res.json()
            # Spotify returns status 20 if email exists
            registered = data.get("status") == 20
            results.append({"service": "Spotify", "registered": registered})
    except Exception:
        pass

    # 4. Duolingo — check via API
    try:
        res = fetch_with_curl(
            f"https://www.duolingo.com/2017-06-30/users?email={quote(email)}&fields=username",
            timeout=8,
        )
        if res.status_code == 200:
            data = res.json()
            users = data.get("users", [])
            found = len(users) > 0
            results.append({
                "service": "Duolingo",
                "registered": found,
                "username": users[0].get("username") if found else None,
            })
    except Exception:
        pass

    # 5. PGP Key Servers — check for published public keys
    try:
        res = fetch_with_curl(
            f"https://keys.openpgp.org/vks/v1/by-email/{quote(email)}",
            timeout=8,
        )
        if res.status_code == 200 and "BEGIN PGP" in res.text:
            results.append({"service": "OpenPGP Keys", "registered": True, "url": f"https://keys.openpgp.org/search?q={quote(email)}"})
        else:
            results.append({"service": "OpenPGP Keys", "registered": False})
    except Exception:
        pass

    # 6. Ubuntu Keyserver
    try:
        res = fetch_with_curl(
            f"https://keyserver.ubuntu.com/pks/lookup?op=index&search={quote(email)}",
            timeout=8,
        )
        if res.status_code == 200 and "pub" in res.text.lower() and email.lower() in res.text.lower():
            results.append({"service": "Ubuntu Keyserver", "registered": True})
        else:
            results.append({"service": "Ubuntu Keyserver", "registered": False})
    except Exception:
        pass

    return results


# ---------------------------------------------------------------------------
# GitHub deep profile
# ---------------------------------------------------------------------------
def _lookup_github(username: str, name: str) -> dict:
    """Search GitHub for user profile by username or name."""
    if not username and not name:
        return {}

    if username:
        try:
            res = fetch_with_curl(f"https://api.github.com/users/{quote(username)}", timeout=10,
                                  headers={"Accept": "application/vnd.github.v3+json"})
            if res.status_code == 200:
                data = res.json()
                return {
                    "username": data.get("login", ""),
                    "avatar_url": data.get("avatar_url", ""),
                    "bio": data.get("bio", ""),
                    "location": data.get("location", ""),
                    "company": data.get("company", ""),
                    "blog": data.get("blog", ""),
                    "public_repos": data.get("public_repos", 0),
                    "followers": data.get("followers", 0),
                    "following": data.get("following", 0),
                    "created_at": data.get("created_at", ""),
                    "url": data.get("html_url", ""),
                }
        except Exception as e:
            logger.warning(f"GitHub user lookup failed for {username}: {e}")

    if name:
        try:
            res = fetch_with_curl(
                f"https://api.github.com/search/users?q={quote(name)}&per_page=3",
                timeout=10,
                headers={"Accept": "application/vnd.github.v3+json"},
            )
            if res.status_code == 200:
                items = res.json().get("items", [])
                if items:
                    top = items[0]
                    detail_res = fetch_with_curl(top["url"], timeout=10,
                                                 headers={"Accept": "application/vnd.github.v3+json"})
                    if detail_res.status_code == 200:
                        data = detail_res.json()
                        return {
                            "username": data.get("login", ""),
                            "avatar_url": data.get("avatar_url", ""),
                            "bio": data.get("bio", ""),
                            "location": data.get("location", ""),
                            "company": data.get("company", ""),
                            "blog": data.get("blog", ""),
                            "public_repos": data.get("public_repos", 0),
                            "followers": data.get("followers", 0),
                            "following": data.get("following", 0),
                            "created_at": data.get("created_at", ""),
                            "url": data.get("html_url", ""),
                            "match_type": "name_search",
                        }
        except Exception as e:
            logger.warning(f"GitHub search failed for {name}: {e}")

    return {}


# ---------------------------------------------------------------------------
# Gravatar profile
# ---------------------------------------------------------------------------
def _lookup_gravatar(email: str) -> dict:
    """Look up Gravatar profile by email hash."""
    if not email:
        return {}
    email_hash = hashlib.md5(email.lower().strip().encode()).hexdigest()
    try:
        res = fetch_with_curl(f"https://en.gravatar.com/{email_hash}.json", timeout=8)
        if res.status_code == 200:
            data = res.json()
            entry = data.get("entry", [{}])[0] if data.get("entry") else {}
            return {
                "avatar_url": entry.get("thumbnailUrl", ""),
                "display_name": entry.get("displayName", ""),
                "profile_url": entry.get("profileUrl", ""),
                "about_me": entry.get("aboutMe", ""),
                "current_location": entry.get("currentLocation", ""),
                "accounts": [
                    {"platform": a.get("shortname", ""), "url": a.get("url", ""), "username": a.get("display", "")}
                    for a in entry.get("accounts", [])
                ],
            }
    except Exception as e:
        logger.warning(f"Gravatar lookup failed: {e}")
    return {}


# ---------------------------------------------------------------------------
# HIBP breach check
# ---------------------------------------------------------------------------
def _lookup_hibp(email: str) -> dict:
    """Check HaveIBeenPwned for email breach exposure."""
    if not email:
        return {"available": False, "reason": "no_email"}

    api_key = os.environ.get("HIBP_API_KEY", "")
    if not api_key:
        return {"available": False, "reason": "no_api_key"}

    try:
        res = fetch_with_curl(
            f"https://haveibeenpwned.com/api/v3/breachedaccount/{quote(email)}?truncateResponse=false",
            timeout=10,
            headers={"hibp-api-key": api_key, "Accept": "application/json"},
        )
        if res.status_code == 200:
            breaches = res.json()
            return {
                "available": True,
                "count": len(breaches),
                "items": [
                    {
                        "name": b.get("Name", ""),
                        "domain": b.get("Domain", ""),
                        "date": b.get("BreachDate", ""),
                        "data_classes": b.get("DataClasses", []),
                    }
                    for b in breaches[:20]
                ],
            }
        elif res.status_code == 404:
            return {"available": True, "count": 0, "items": []}
        else:
            return {"available": False, "reason": f"http_{res.status_code}"}
    except Exception as e:
        logger.warning(f"HIBP lookup failed: {e}")
        return {"available": False, "reason": "error"}


# ---------------------------------------------------------------------------
# WHOIS / RDAP
# ---------------------------------------------------------------------------
def _lookup_whois(domain: str) -> dict:
    """Look up domain registration data via RDAP."""
    if not domain:
        return {}

    domain = domain.lower().strip()
    if domain.startswith("http"):
        from urllib.parse import urlparse
        domain = urlparse(domain).netloc or domain
    domain = domain.split("/")[0]

    try:
        res = fetch_with_curl(f"https://rdap.org/domain/{quote(domain)}", timeout=10)
        if res.status_code == 200:
            data = res.json()
            registrant = ""
            registrar = ""
            for entity in data.get("entities", []):
                roles = entity.get("roles", [])
                handle = entity.get("handle", "")
                vcard = entity.get("vcardArray", [None, []])[1] if entity.get("vcardArray") else []
                name_parts = [v[3] for v in vcard if isinstance(v, list) and len(v) > 3 and v[0] == "fn"]
                entity_name = name_parts[0] if name_parts else handle

                if "registrant" in roles:
                    registrant = entity_name
                if "registrar" in roles:
                    registrar = entity_name

            events = data.get("events", [])
            created = next((e["eventDate"] for e in events if e.get("eventAction") == "registration"), "")
            expires = next((e["eventDate"] for e in events if e.get("eventAction") == "expiration"), "")
            updated = next((e["eventDate"] for e in events if e.get("eventAction") == "last changed"), "")

            return {
                "domain": domain,
                "registrant": registrant,
                "registrar": registrar,
                "created": created,
                "expires": expires,
                "updated": updated,
                "status": data.get("status", []),
                "nameservers": [ns.get("ldhName", "") for ns in data.get("nameservers", [])],
            }
    except Exception as e:
        logger.warning(f"RDAP lookup failed for {domain}: {e}")
    return {}


# ---------------------------------------------------------------------------
# Wikipedia
# ---------------------------------------------------------------------------
def _search_wikipedia(name: str) -> dict:
    """Search Wikipedia for a person's summary."""
    if not name:
        return {}

    slug = quote(name.replace(" ", "_"))
    try:
        res = fetch_with_curl(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}", timeout=10)
        if res.status_code == 200:
            data = res.json()
            if data.get("type") != "disambiguation":
                return {
                    "title": data.get("title", ""),
                    "description": data.get("description", ""),
                    "summary": data.get("extract", ""),
                    "thumbnail": data.get("thumbnail", {}).get("source", ""),
                    "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
                }
    except Exception as e:
        logger.warning(f"Wikipedia lookup failed for {name}: {e}")
    return {}


# ---------------------------------------------------------------------------
# Wayback Machine — check if domain/username has been archived
# ---------------------------------------------------------------------------
def _lookup_wayback(target: str) -> dict:
    """Check Wayback Machine for archived snapshots."""
    if not target:
        return {}

    # Build the URL to check: could be a domain or a social profile
    check_url = target
    if not target.startswith("http"):
        check_url = f"https://{target}"

    try:
        res = fetch_with_curl(
            f"https://archive.org/wayback/available?url={quote(check_url)}",
            timeout=10,
        )
        if res.status_code == 200:
            data = res.json()
            snapshot = data.get("archived_snapshots", {}).get("closest", {})
            if snapshot:
                return {
                    "available": True,
                    "url": snapshot.get("url", ""),
                    "timestamp": snapshot.get("timestamp", ""),
                    "status": snapshot.get("status", ""),
                }
    except Exception as e:
        logger.warning(f"Wayback Machine lookup failed: {e}")
    return {}


# ---------------------------------------------------------------------------
# Paste search — check for leaked data in public pastes
# ---------------------------------------------------------------------------
def _search_pastes(query: str) -> list:
    """Search for mentions in public paste aggregators."""
    if not query:
        return []

    results = []

    # IntelX (free tier — limited results)
    try:
        res = fetch_with_curl(
            f"https://2.intelx.io/phonebook/search?term={quote(query)}&buckets[]=pastes&limit=5&media=0",
            timeout=10,
            headers={"x-key": "9df61df0-84f7-4dc7-b34c-8ccfb8646571"},  # Public free key
        )
        if res.status_code == 200:
            data = res.json()
            for item in data.get("selectors", [])[:5]:
                results.append({
                    "source": "IntelX",
                    "value": item.get("selectorvalue", ""),
                    "type": item.get("selectortypeh", ""),
                })
    except Exception:
        pass

    return results


# ---------------------------------------------------------------------------
# DNS reconnaissance — check for related subdomains and DNS records
# ---------------------------------------------------------------------------
def _dns_recon(domain: str) -> dict:
    """Basic DNS reconnaissance for a domain using public APIs."""
    if not domain:
        return {}

    domain = domain.lower().strip()
    if domain.startswith("http"):
        from urllib.parse import urlparse
        domain = urlparse(domain).netloc or domain
    domain = domain.split("/")[0]

    result = {"domain": domain, "subdomains": [], "dns_records": {}}

    # crt.sh — Certificate Transparency logs for subdomain enumeration
    try:
        res = fetch_with_curl(
            f"https://crt.sh/?q=%.{quote(domain)}&output=json",
            timeout=12,
        )
        if res.status_code == 200:
            certs = res.json()
            subdomains = set()
            for cert in certs[:200]:  # Limit processing
                name = cert.get("name_value", "")
                for line in name.split("\n"):
                    line = line.strip().lower()
                    if line.endswith(domain) and line != domain:
                        subdomains.add(line)
            result["subdomains"] = sorted(subdomains)[:50]  # Cap at 50
    except Exception as e:
        logger.debug(f"crt.sh lookup failed for {domain}: {e}")

    # SecurityTrails-style DNS via public resolvers
    try:
        res = fetch_with_curl(
            f"https://dns.google/resolve?name={quote(domain)}&type=MX",
            timeout=8,
        )
        if res.status_code == 200:
            data = res.json()
            mx_records = [a.get("data", "") for a in data.get("Answer", [])]
            result["dns_records"]["mx"] = mx_records
    except Exception:
        pass

    try:
        res = fetch_with_curl(
            f"https://dns.google/resolve?name={quote(domain)}&type=TXT",
            timeout=8,
        )
        if res.status_code == 200:
            data = res.json()
            txt_records = [a.get("data", "") for a in data.get("Answer", [])]
            result["dns_records"]["txt"] = txt_records[:10]
    except Exception:
        pass

    return result


# ===========================================================================
# Main lookup orchestrator
# ===========================================================================
def lookup_person(
    name: str = "",
    email: str = "",
    username: str = "",
    phone: str = "",
    domain: str = "",
) -> dict:
    """Aggregate OSINT data about a person from multiple public sources."""
    name = (name or "").strip()
    email = (email or "").strip()
    username = (username or "").strip()
    phone = (phone or "").strip()
    domain = (domain or "").strip()

    # Check cache
    key = _cache_key(name, email, username, phone, domain)
    if key in person_cache:
        cached = person_cache[key]
        cached["meta"]["cached"] = True
        return cached

    sources_checked = 0
    sources_found = 0

    # Run all lookups in parallel — 8 workers for independent sources
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        github_fut = pool.submit(_lookup_github, username, name)
        gravatar_fut = pool.submit(_lookup_gravatar, email)
        sherlock_fut = pool.submit(_sherlock_scan, username)
        email_enum_fut = pool.submit(_email_enumerate, email)
        hibp_fut = pool.submit(_lookup_hibp, email)
        whois_fut = pool.submit(_lookup_whois, domain)
        wiki_fut = pool.submit(_search_wikipedia, name)
        wayback_fut = pool.submit(_lookup_wayback, domain or (f"https://github.com/{username}" if username else ""))
        paste_fut = pool.submit(_search_pastes, email or username)
        dns_fut = pool.submit(_dns_recon, domain)

    def _get(fut, label, default=None):
        nonlocal sources_checked, sources_found
        sources_checked += 1
        try:
            result = fut.result(timeout=30)
            if result:
                sources_found += 1
            return result
        except Exception as e:
            logger.warning(f"{label} lookup timed out or failed: {e}")
            return default if default is not None else {}

    github = _get(github_fut, "GitHub")
    gravatar = _get(gravatar_fut, "Gravatar")
    sherlock = _get(sherlock_fut, "Sherlock", default=[])
    email_enum = _get(email_enum_fut, "EmailEnum", default=[])
    breaches = _get(hibp_fut, "HIBP")
    whois = _get(whois_fut, "WHOIS")
    wikipedia = _get(wiki_fut, "Wikipedia")
    wayback = _get(wayback_fut, "Wayback")
    pastes = _get(paste_fut, "Pastes", default=[])
    dns = _get(dns_fut, "DNS")

    # Build social_profiles from Sherlock results for backward compat
    social_profiles = []
    for s in (sherlock or []):
        social_profiles.append({
            "platform": s["name"],
            "url": s["url"],
            "status": "found",
            "cat": s.get("cat", "other"),
            "details": {},
        })

    # Organize Sherlock results by category
    sherlock_by_cat = {}
    for s in (sherlock or []):
        cat = s.get("cat", "other")
        if cat not in sherlock_by_cat:
            sherlock_by_cat[cat] = []
        sherlock_by_cat[cat].append({"name": s["name"], "url": s["url"]})

    result = {
        "query": {
            "name": name,
            "email": email,
            "username": username,
            "phone": phone,
            "domain": domain,
        },
        "github": github,
        "gravatar": gravatar,
        "social_profiles": social_profiles,
        "sherlock": {
            "total_sites_checked": len(_SHERLOCK_SITES),
            "total_found": len(sherlock or []),
            "by_category": sherlock_by_cat,
        },
        "email_enum": email_enum if isinstance(email_enum, list) else [],
        "breaches": breaches if isinstance(breaches, dict) else {"available": False},
        "whois": whois,
        "dns": dns,
        "wikipedia": wikipedia,
        "wayback": wayback,
        "pastes": pastes if isinstance(pastes, list) else [],
        "meta": {
            "sources_checked": sources_checked,
            "sources_found": sources_found,
            "sherlock_sites": len(_SHERLOCK_SITES),
            "cached": False,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    }

    person_cache[key] = result
    return result
