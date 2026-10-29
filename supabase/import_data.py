#!/usr/bin/env python3
"""Importe data/coins.json vers Supabase (table entries).

Usage :
  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_KEY=service_role_key \
      python3 supabase/import_data.py

La clé « service_role » est requise pour l'insertion en masse
(Settings → API dans le tableau de bord Supabase).
"""
import json
import os
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_KEY"]
BATCH = 500


def post(rows):
    req = urllib.request.Request(
        f"{URL}/rest/v1/entries",
        data=json.dumps(rows).encode(),
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()


def main():
    data = json.load(open("data/coins.json"))
    rows = []
    for e in data["entries"]:
        rows.append({
            "source": e.get("source", "guide"),
            "page": e.get("page"),
            "section": e.get("section", ""),
            "category": e.get("category", ""),
            "series": e.get("series", ""),
            "date": e.get("date", ""),
            "description": e.get("description", ""),
            "price": e.get("price"),
            "uncertain": bool(e.get("uncertain")),
            "content_table": bool(e.get("contentTable")),
        })
    print(f"{len(rows)} entrées à importer…")
    for i in range(0, len(rows), BATCH):
        post(rows[i:i + BATCH])
        print(f"  {min(i + BATCH, len(rows))}/{len(rows)}")
    print("Terminé.")


if __name__ == "__main__":
    main()
