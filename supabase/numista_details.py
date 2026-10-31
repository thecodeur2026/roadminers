#!/usr/bin/env python3
"""Enrichit les pièces liées avec les caractéristiques complètes Numista (/types/{id}).

Entrée : data/numista_map.json (clés d'articles → id Numista)
Sortie : data/numista_details.json (id Numista → caractéristiques)
Reprise sur interruption : sauvegarde en continu.

Usage : NUMISTA_API_KEY=... python3 supabase/numista_details.py
"""
import json
import os
import time
import urllib.request

KEY = os.environ["NUMISTA_API_KEY"]
OUT = "data/numista_details.json"
PAUSE = 0.35


def api(path):
    req = urllib.request.Request("https://api.numista.com/v3" + path,
                                 headers={"Numista-API-Key": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def curate(t):
    def side(s):
        s = s or {}
        return {
            "description": s.get("description"),
            "lettering": s.get("lettering"),
            "engravers": s.get("engravers") or [],
            "picture": s.get("picture"),
        }
    return {
        "title": t.get("title"),
        "url": t.get("url"),
        "issuer": (t.get("issuer") or {}).get("name"),
        "type": t.get("type"),
        "years": f"{t.get('min_year','?')} – {t.get('max_year','?')}",
        "rulers": [r.get("name") for r in (t.get("ruler") or [])],
        "value": (t.get("value") or {}).get("text"),
        "currency": ((t.get("value") or {}).get("currency") or {}).get("full_name"),
        "composition": (t.get("composition") or {}).get("text"),
        "weight": t.get("weight"),
        "size": t.get("size"),
        "thickness": t.get("thickness"),
        "shape": t.get("shape"),
        "technique": (t.get("technique") or {}).get("text"),
        "orientation": t.get("orientation"),
        "edge": (t.get("edge") or {}).get("description"),
        "demonetized": (t.get("demonetization") or {}).get("is_demonetized"),
        "mints": [m.get("name") for m in (t.get("mints") or [])],
        "references": [f"{(r.get('catalogue') or {}).get('code','')}# {r.get('number','')}"
                       for r in (t.get("references") or [])],
        "obverse": side(t.get("obverse")),
        "reverse": side(t.get("reverse")),
    }


def main():
    smap = json.load(open("data/numista_map.json"))
    ids = sorted({v["id"] for v in smap.values()})
    details = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [i for i in ids if str(i) not in details]
    print(f"{len(ids)} ids uniques, {len(todo)} à enrichir")
    done = 0
    try:
        for nid in todo:
            for attempt in range(4):
                try:
                    details[str(nid)] = curate(api(f"/types/{nid}"))
                    break
                except urllib.error.HTTPError as ex:
                    if ex.code == 429:
                        print(f"429 quota — pause {90*(attempt+1)} s", flush=True)
                        time.sleep(90 * (attempt + 1))
                    else:
                        print(f"erreur {ex.code} sur {nid}", flush=True)
                        break
                except Exception as ex:
                    print(f"réseau: {ex} — pause 30 s", flush=True)
                    time.sleep(30)
            else:
                print("QUOTA ÉPUISÉ — arrêt propre (progression sauvegardée)", flush=True)
                break
            done += 1
            time.sleep(PAUSE)
            if done % 40 == 0:
                json.dump(details, open(OUT, "w"), ensure_ascii=False)
                print(f"{done}/{len(todo)} enrichis", flush=True)
    finally:
        json.dump(details, open(OUT, "w"), ensure_ascii=False)
    print(f"TERMINE: {len(details)}/{len(ids)} pièces enrichies")


if __name__ == "__main__":
    main()
