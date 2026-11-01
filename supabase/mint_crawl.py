#!/usr/bin/env python3
"""Agent 4: crawl mint.ca coin product pages (from rcmsitemap.xml) and extract
title, specs and obverse/reverse image URLs. Output: data/mint_products.json
Resume-safe: already-fetched URLs are skipped.
"""
import json, re, os, sys, time, threading, urllib.request, queue

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITEMAP = '/tmp/rcmsitemap.xml'
OUT = os.path.join(BASE, 'data', 'mint_products.json')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'}

def coin_urls():
    xml = open(SITEMAP).read()
    urls = re.findall(r'<loc>([^<]+)</loc>', xml)
    out = []
    for u in urls:
        if '/en/shop/coins/' not in u:
            continue
        rest = u.split('/coins/')[1]
        year = rest.split('/')[0]
        if year == 'accessory':
            continue
        out.append(u)
    return out

IMG_RE = re.compile(r'https://www\.mint\.ca/globalassets/[^"\s\']+?_(?:obv|rev)[-_]\d+\.(?:png|jpg|jpeg)(?:\?hash=\d+)?')
SPEC_RE = re.compile(r'<div class="tmx-pdp__spec">\s*<span class="d-block font-weight-bold">([^<]+)</span>\s*<span class="d-block mt-1">(.*?)</span>', re.S)
OGT_RE = re.compile(r'<meta property="og:title" content="([^"]+)"')

def clean(s):
    s = re.sub(r'<[^>]+>', '', s)
    return re.sub(r'\s+', ' ', s).replace('&nbsp;', ' ').strip()

def parse(html, url):
    p = {'url': url}
    m = OGT_RE.search(html)
    title = m.group(1) if m else ''
    title = re.sub(r'\s*\|\s*The Royal Canadian Mint\s*$', '', title)
    p['title'] = clean(title)
    specs = {}
    for k, v in SPEC_RE.findall(html):
        specs[clean(k)] = clean(v)
    p['specs'] = specs
    obv = rev = None
    for im in IMG_RE.findall(html):
        name = im.split('?')[0]
        if '_obv' in name and obv is None:
            obv = im
        elif '_rev' in name and rev is None:
            rev = im
    # fall back to og:image for rev
    if rev is None:
        m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
        if m:
            rev = m.group(1)
    p['obv'] = obv
    p['rev'] = rev
    m = re.search(r'/coins/(\d{4}|pre-2010)/', url)
    p['year_folder'] = m.group(1) if m else None
    return p

def worker(q, results, lock, stats):
    while True:
        try:
            u = q.get_nowait()
        except queue.Empty:
            return
        try:
            req = urllib.request.Request(u, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                html = r.read().decode('utf-8', 'replace')
            p = parse(html, u)
            with lock:
                results[u] = p
                stats['ok'] += 1
        except Exception as e:
            with lock:
                results[u] = {'url': u, 'error': str(e)}
                stats['err'] += 1
        finally:
            q.task_done()
            time.sleep(0.15)

def main():
    urls = coin_urls()
    results = {}
    if os.path.exists(OUT):
        results = json.load(open(OUT))
    todo = [u for u in urls if u not in results or 'error' in results.get(u, {})]
    print(f'total={len(urls)} done={len(results)} todo={len(todo)}', flush=True)
    q = queue.Queue()
    for u in todo:
        q.put(u)
    lock = threading.Lock()
    stats = {'ok': 0, 'err': 0}
    threads = [threading.Thread(target=worker, args=(q, results, lock, stats)) for _ in range(4)]
    for t in threads:
        t.start()
    last = time.time()
    while any(t.is_alive() for t in threads):
        time.sleep(20)
        with lock:
            json.dump(results, open(OUT, 'w'), ensure_ascii=False)
            print(f"progress: {len(results)}/{len(urls)} ok={stats['ok']} err={stats['err']}", flush=True)
    json.dump(results, open(OUT, 'w'), ensure_ascii=False)
    print(f"DONE total={len(results)} ok={stats['ok']} err={stats['err']}", flush=True)

if __name__ == '__main__':
    main()
