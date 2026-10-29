#!/usr/bin/env python3
"""ROAD MINERS — serveur local + proxy des cours.

Sert l'application statique ET expose /api/spot.json :
  - prix d'achat max par gramme (Kitco refining, CAD) par matériau
  - cours au comptant or/argent/platine/palladium (USD + CAD)

Cache de 5 minutes pour éviter de solliciter les sources.
Usage : python3 server.py [port]   (défaut 8734)
"""
import json
import re
import time
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

CACHE_TTL = 300  # secondes
_cache = {"ts": 0, "data": None}

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")

KITCO_URL = "https://online.kitco.com/refining/gold-silver-CAD.html"
GOLDAPI_URL = "https://api.gold-api.com/price/{sym}"
FX_URL = "https://open.er-api.com/v6/latest/USD"

# tier de poids applicable par section (borne basse en grammes)
def tier_bounds(name):
    if any(k in name for k in ("Silver", "Sterling", "Ag ")) and "Gold" not in name:
        return [0, 30000, 150000]
    return [0, 500, 3000]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def scrape_kitco():
    """Retourne la liste des matériaux avec prix/gramme (individuel & max)."""
    html = fetch(KITCO_URL).decode("utf-8", "replace")
    row_re = re.compile(
        r"<td>([^<]+?)</td>\s*"
        r"((?:<td>\s*<div>\s*\$<span class=\"individual_price\">[\d.]+</span>"
        r"<span class=\"wholesale_price\">[\d.]+</span>\s*</div>\s*</td>\s*){1,3})",
        re.S)
    price_re = re.compile(
        r"\$<span class=\"individual_price\">([\d.]+)</span>"
        r"<span class=\"wholesale_price\">([\d.]+)</span>")
    materials = []
    for name, block in row_re.findall(html):
        name = " ".join(name.split())
        prices = price_re.findall(block)
        if not prices:
            continue
        bounds = tier_bounds(name)
        tiers = []
        for i, (ind, whole) in enumerate(prices):
            tiers.append({
                "min_g": bounds[i] if i < len(bounds) else bounds[-1],
                "individual": float(ind),
                "wholesale": float(whole),
            })
        materials.append({"name": name, "tiers": tiers})
    return materials


def scrape_spot():
    """Cours au comptant (USD/oz) via api.gold-api.com + taux USD/CAD."""
    usd = {}
    for metal in ("XAU", "XAG", "XPT", "XPD"):
        try:
            d = json.loads(fetch(GOLDAPI_URL.format(sym=metal)))
            usd[metal] = d.get("price")
        except Exception:
            usd[metal] = None
    rate = None
    try:
        d = json.loads(fetch(FX_URL))
        rate = d["rates"].get("CAD")
    except Exception:
        pass
    rate = rate or 1.40
    spot = {}
    for metal, price in usd.items():
        spot[metal] = {
            "usd_oz": price,
            "cad_oz": round(price * rate, 2) if price else None,
            "usd_g": round(price / 31.1034768, 4) if price else None,
            "cad_g": round(price * rate / 31.1034768, 4) if price else None,
        }
    return spot, rate


YF_HIST = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=5d&interval=1h"
YF_SYMS = {"XAU": "GC=F", "XAG": "SI=F", "XPT": "PL=F", "XPD": "PA=F"}


def scrape_history():
    """Historique 5 jours / 1 h pour le graphique d'évolution."""
    out = {}
    for metal, sym in YF_SYMS.items():
        try:
            d = json.loads(fetch(YF_HIST.format(sym=sym)))
            res = d["chart"]["result"][0]
            ts = res.get("timestamp") or []
            closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
            pts = [[t * 1000, round(c, 2)] for t, c in zip(ts, closes) if c is not None]
            out[metal] = pts[-80:]
        except Exception:
            out[metal] = []
    return out


def get_spot_data():
    now = time.time()
    if _cache["data"] and now - _cache["ts"] < CACHE_TTL:
        return _cache["data"]
    data = {"updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "materials": [], "spot": {}, "usdcad": None, "errors": []}
    try:
        data["materials"] = scrape_kitco()
    except Exception as e:
        data["errors"].append(f"kitco: {e}")
    try:
        data["spot"], data["usdcad"] = scrape_spot()
    except Exception as e:
        data["errors"].append(f"spot: {e}")
    try:
        data["history"] = scrape_history()
    except Exception as e:
        data["errors"].append(f"history: {e}")
    _cache.update(ts=now, data=data)
    return data


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/spot.json"):
            body = json.dumps(get_spot_data()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8734
    print(f"ROAD MINERS → http://localhost:{port}")
    ThreadingHTTPServer(("", port), Handler).serve_forever()
