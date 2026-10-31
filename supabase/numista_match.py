#!/usr/bin/env python3
"""Associe chaque entrée de data/coins.json à une pièce Numista (images pile/face).

- Recherche par émetteur + année + dénomination, choix du meilleur candidat.
- Dédoublonnage : une même requête n'est faite qu'une fois (cache), et chaque
  entrée est liée à un identifiant Numista unique et stable.
- Reprise sur interruption : data/numista_map.json est sauvegardé en continu.

Usage : NUMISTA_API_KEY=... python3 supabase/numista_match.py [max_requetes]
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

KEY = os.environ["NUMISTA_API_KEY"]
BASE = "https://api.numista.com/v3"
PAUSE = 0.35  # secondes entre requêtes (politesse + limites)
OUT = "data/numista_map.json"
PROGRESS = "data/numista_progress.json"

ISSUERS = {
    "UNITED STATES": "united-states",
    "WORLD GOLD COINS": None,  # détecté par mots-clés pays
}
WORLD = [
    ("austria", "austria"), ("bahamas", "bahamas"), ("belgium", "belgium"),
    ("bermuda", "bermuda"), ("cayman", "cayman-islands"), ("chile", "chile"),
    ("colombia", "colombia"), ("germany", "germany"), ("britain", "united-kingdom"),
    ("france", "france"), ("iran", "iran"), ("italy", "italy"),
    ("jamaica", "jamaica"), ("mexico", "mexico"), ("netherlands", "netherlands"),
    ("panama", "panama"), ("russia", "russia"),
]
DENOMS = [
    ("TWENTY-FIVE CENTS", "25 cents"), ("FIFTY CENTS", "50 cents"),
    ("TWENTY CENTS", "20 cents"), ("TEN CENTS", "10 cents"),
    ("FIVE CENTS SILVER", "5 cents"), ("FIVE CENTS NICKEL", "5 cents"),
    ("FIVE CENTS", "5 cents"), ("LARGE CENTS", "1 cent"), ("SMALL CENTS", "1 cent"),
    ("HALF CENTS", "1/2 cent"), ("TWO DOLLARS GOLD", "2 dollars"),
    ("TWO DOLLARS", "2 dollars"), ("NICKEL DOLLARS", "1 dollar"),
    ("SILVER DOLLARS", "1 dollar"), ("DOLLARS", "1 dollar"),
    ("QUARTER DOLLAR", "25 cents"), ("HALF DOLLAR", "50 cents"),
    ("DIMES", "10 cents"), ("TRADE DOLLARS", "trade dollar"),
    ("GOLD 2 1/2 DOLLARS", "2.5 dollars"), ("GOLD 3 DOLLARS", "3 dollars"),
    ("GOLD 4 DOLLARS", "4 dollars"), ("GOLD 5 DOLLARS", "5 dollars"),
    ("GOLD 10 DOLLARS", "10 dollars"), ("GOLD 20 DOLLARS", "20 dollars"),
    ("GOLD DOLLARS", "1 dollar"),
]
SKIP_SECTIONS = {"PAPER MONEY OF CANADA", "CANADIAN MEDALS", "BULLION VALUES"}


def entry_key(e):
    raw = "|".join(str(e.get(k, "")) for k in
                   ("source", "page", "section", "category", "series", "date", "description", "price"))
    return raw


def get_issuer(e):
    sec = (e.get("section") or "").upper()
    if sec in ISSUERS:
        iss = ISSUERS[sec]
        if iss:
            return iss
        text = (e.get("series", "") + " " + e.get("description", "")).lower()
        for kw, code in WORLD:
            if kw in text:
                return code
        return None
    return "canada"


def get_denom(e):
    cat = (e.get("category") or "").upper()
    for pat, d in DENOMS:
        if pat in cat:
            return d
    m = re.match(r"(\d+) DOLLARS", cat)
    if m:
        return f"{m.group(1)} dollars"
    m = re.search(r"(\d+)\s*\$", e.get("description", "")[:20])
    if m:
        return f"{m.group(1)} dollars"
    return ""


def get_year(e):
    m = re.search(r"(1[5-9]\d{2}|20[0-2]\d)", e.get("date") or "")
    return int(m.group(1)) if m else None


def api(path, params):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Numista-API-Key": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


BAD_WORDS = ("pattern", "specimen", "token", "jeton", "medal", "medaille",
             "fantasy", "souvenir", "essai", "trial")


def phrase_in(phrase, title):
    return re.search(r"\b" + re.escape(phrase) + r"s?\b", title) is not None


def search_numista(issuer, denom, year, desc_words):
    params = {"category": "coin"}
    if issuer:
        params["issuer"] = issuer
    q = " ".join(x for x in [str(year) if year else "", denom] if x)
    if q.strip():
        params["q"] = q
    data = api("/types", params)
    best, best_score = None, -1
    for t in data.get("types", []):
        score = 0
        if year:
            if t.get("min_year") and t["min_year"] <= year <= (t.get("max_year") or 9999):
                score += 5
            else:
                continue
        title = (t.get("title") or "").lower()
        if denom and phrase_in(denom.lower(), title):
            score += 6
        for w in desc_words:
            if re.search(r"\b" + re.escape(w) + r"\b", title):
                score += 3
        for bw in BAD_WORDS:
            if bw in title and not any(bw in dw for dw in desc_words):
                score -= 10
        if score > best_score:
            best, best_score = t, score
    # exiger une correspondance minimale crédible
    threshold = 8 if year else 6
    if best and best_score >= threshold:
        return {
            "id": best["id"],
            "title": best.get("title"),
            "obv": best.get("obverse_thumbnail"),
            "rev": best.get("reverse_thumbnail"),
        }
    return None


def search_with_retry(issuer, denom, year, desc_words):
    """Réessaie sur 429 (quota) et erreurs réseau ; lève QuotaExceeded si quota persistant."""
    for attempt in range(4):
        try:
            return search_numista(issuer, denom, year, desc_words)
        except urllib.error.HTTPError as ex:
            if ex.code == 429:
                print(f"429 quota — pause {90*(attempt+1)} s (essai {attempt+1}/4)", flush=True)
                time.sleep(90 * (attempt + 1))
            else:
                print(f"erreur API: {ex}", flush=True)
                return None
        except Exception as ex:  # timeout, connexion coupée, etc.
            print(f"réseau: {ex} — pause 30 s (essai {attempt+1}/4)", flush=True)
            time.sleep(30)
    raise QuotaExceeded()


class QuotaExceeded(Exception):
    pass


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    entries = json.load(open("data/coins.json"))["entries"]
    smap = json.load(open(OUT)) if os.path.exists(OUT) else {}
    prog = json.load(open(PROGRESS)) if os.path.exists(PROGRESS) else {"i": 0}
    qcache = {}

    done = matched = 0
    try:
        for i in range(prog["i"], len(entries)):
            if done >= limit:
                break
            e = entries[i]
            key = entry_key(e)
            prog["i"] = i + 1
            if (e.get("section") or "").upper() in SKIP_SECTIONS or e.get("contentTable"):
                continue
            year = get_year(e)
            if not year:
                continue
            issuer = get_issuer(e)
            denom = get_denom(e)
            desc_words = [w for w in re.findall(r"[a-zA-Z]{5,}",
                          (e.get("description") or "").split(";")[0].lower())][:3]
            q = (issuer, denom, year, tuple(desc_words))
            if q not in qcache:
                qcache[q] = search_with_retry(issuer, denom, year, desc_words)
                time.sleep(PAUSE)
                done += 1
            if qcache[q]:
                smap[key] = qcache[q]
                matched += 1
            if done % 50 == 0:
                json.dump(smap, open(OUT, "w"), ensure_ascii=False)
                json.dump(prog, open(PROGRESS, "w"))
                print(f"{i+1}/{len(entries)} traités — {matched} images trouvées", flush=True)
    except QuotaExceeded:
        print("QUOTA API ÉPUISÉ — arrêt propre, relancer plus tard (la progression est sauvegardée)", flush=True)
    finally:
        json.dump(smap, open(OUT, "w"), ensure_ascii=False)
        json.dump(prog, open(PROGRESS, "w"))
    print(f"TERMINE: {matched} correspondances sur {len(smap)} liées, progression {prog['i']}/{len(entries)}")


if __name__ == "__main__":
    main()
