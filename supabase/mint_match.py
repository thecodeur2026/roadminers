#!/usr/bin/env python3
"""Agent 4: match uncovered Canadian coins.json entries to crawled mint.ca
products (data/mint_products.json) and write data/mint_map.json.

Anti-false-positive rules:
- year must match (entry date year == product title/folder year)
- denomination must match (entry category/description vs product Face Value)
- at least one distinctive keyword from the entry must appear in the title
- the best candidate must be strictly better than the runner-up
"""
import json, re, os, unicodedata, collections, html as html_mod

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load(name):
    return json.load(open(os.path.join(BASE, 'data', name)))

coins = load('coins.json')['entries']
numista = load('numista_map.json')
products = load('mint_products.json')

def key(e):
    def f(v):
        if v is None: return 'None'
        if isinstance(v, float) and v.is_integer(): return f'{v}'
        return str(v)
    return '|'.join(f(e.get(k)) for k in ['source', 'page', 'section', 'category', 'series', 'date', 'description', 'price'])

CAN_SECS = {'CANADA', 'MONNAIES DE CIRCULATION', 'MONNAIES DE COLLECTION',
            'MONNAIES DE COLLECTION — ARGENT', 'MONNAIES DE COLLECTION - MÉTAUX NON PRÉCIEUX',
            'ENSEMBLES DE COLLECTION'}

def norm(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower()

STOP = set('''piece pieces monnaie monnaies coin coins the of and de la le les des du un une en au aux avec sur par pour dans
edition tirage prix emission quantite mintage issue quantity grade variete variety reverse obverse avers revers
canada canadian canadienne canadien royal mint monnaie royale pure argent silver gold or bronze nickel dollar dollars
cent cents proof specimen brilliant uncirculated hors-circulation circulation set ensemble serie series annee year
fine pur plaque placage plating plated selective selectif coloree colore color colour colored coloured
sets gift holiday card pack mintage anniversary anniversaire anniv oz'''.split())

# product types that are not the coin itself -> reject unless entry says the same
PACKAGING = re.compile(r'\b(roll|rolls|wafer|wafers|dispenser|pez|gift card|bar|bars|bezels?|pendant|necklace|frame|print)\b', re.I)

def canon(t):
    if t.startswith('colou') or t.startswith('color'):
        return 'colored'
    if t.startswith('colonis') or t.startswith('coloniz'):
        return 'colonized'
    return t

def tokens(s):
    out = []
    for t in re.findall(r'[a-z0-9]+', norm(s)):
        if len(t) >= 4 and t not in STOP and not t.isdigit():
            out.append(canon(t))
    return out

def oz_weight(s):
    """Extract troy-oz weights mentioned in a string, e.g. '1/2 oz', '3.5 oz.', '1 oz.'."""
    out = set()
    for m in re.finditer(r'(\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?)\s*[-\u2013]?\s*oz', norm(s)):
        frac = m.group(1).replace(',', '.').replace(' ', '')
        try:
            if '/' in frac:
                a, b = frac.split('/')
                out.add(round(float(a) / float(b), 4))
            else:
                out.add(round(float(frac), 4))
        except ValueError:
            pass
    return out

# ---------- denomination parsing (entry side) ----------
NUMWORDS = {'one': 1, 'two': 2, 'three': 3, 'five': 5, 'ten': 10, 'twenty': 20}

def entry_denom(e):
    """Return denomination in cents, or None."""
    cat = norm(e.get('category') or '')
    desc = e.get('description') or ''
    m = re.match(r'\s*(\d+(?:[.,]\d+)?)\s*([¢$c])', desc)
    if m:
        val = float(m.group(1).replace(',', '.'))
        return val if m.group(2) in '¢c' else val * 100
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*(dollar|cent)', cat)
    if m:
        val = float(m.group(1).replace(',', '.'))
        return val * 100 if m.group(2) == 'dollar' else val
    for w, v in NUMWORDS.items():
        if re.search(r'\b%s\b' % w, cat):
            return v * 100 if 'dollar' in cat else (v if 'cent' in cat else None)
    return None

def entry_years(e):
    ys = [int(y) for y in re.findall(r'(?:18|19|20)\d{2}', e.get('date') or '')]
    if len(ys) >= 2 and ys[-1] - ys[0] >= 10:
        return [ys[-1]]  # double date -> issue year
    return ys[:1] if ys else []

def entry_phrase(e):
    """Main identifying phrase: description head + series."""
    head = (e.get('description') or '').split(';')[0]
    head = re.sub(r'^\s*\d+(?:[.,]\d+)?\s*[¢$c]\s*,?\s*', '', head)
    return head + ' ' + (e.get('series') or '')

# ---------- product side ----------
def prod_year(p):
    m = re.match(r'\s*((?:19|20)\d{2})\b', p.get('title') or '')
    if m:
        return int(m.group(1))
    yf = p.get('year_folder')
    return int(yf) if yf and yf.isdigit() else None

def prod_denom(p):
    fv = norm((p.get('specs') or {}).get('Face Value') or '')
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*(doll+ar|cent)', fv)
    if m:
        val = float(m.group(1).replace(',', '.'))
        return val * 100 if m.group(2).startswith('doll') else val
    m = re.fullmatch(r'\s*(?:\$\s*)?(\d+(?:[.,]\d+)?)\s*', fv)
    if m:  # bare number on mint.ca = dollars (e.g. '20', '$20')
        return float(m.group(1).replace(',', '.')) * 100
    return None

prod_list = [p for p in products.values() if 'error' not in p and p.get('title')]
by_year = collections.defaultdict(list)
for p in prod_list:
    y = prod_year(p)
    if y:
        by_year[y].append(p)

# tokens too generic to justify a link on their own
WEAK = {'black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple', 'orange', 'brown', 'grey', 'gray'}

def metal_of(text):
    t = norm(text)
    if re.search(r'\b(gold|or)\b', t):
        return 'gold'
    if re.search(r'\b(silver|argent|sterling)\b', t):
        return 'silver'
    if re.search(r'\b(platinum|platine)\b', t):
        return 'platinum'
    return None

def entry_metal(e):
    return metal_of((e.get('category') or '') + ' ' + (e.get('series') or '') + ' ' + (e.get('description') or '').split(';')[0])

def prod_metal(p):
    comp = (p.get('specs') or {}).get('Composition') or ''
    m = metal_of(comp)
    return m or metal_of(p.get('title') or '')

def match(e):
    ys = entry_years(e)
    if not ys:
        return None, 'no-year'
    den = entry_denom(e)
    head = (e.get('description') or '').split(';')[0]
    head = re.sub(r'^\s*\d+(?:[.,]\d+)?\s*[¢$c]\s*,?\s*', '', head)
    head_toks = tokens(head)
    series_toks = tokens(e.get('series') or '')
    e_oz = oz_weight(head)
    e_metal = entry_metal(e)
    is_set_entry = bool(re.search(r'ensemble|set', norm(head))) or 'COLLECTOR SETS' in (e.get('category') or '') or 'ENSEMBLES' in (e.get('section') or '')
    best, second = None, None
    for y in ys:
        for p in by_year.get(y, []):
            title = p['title']
            if PACKAGING.search(title) and not is_set_entry and not PACKAGING.search(head):
                continue
            pm = prod_metal(p)
            p_oz = oz_weight(title)
            ptoks = set(tokens(title))
            head_common = [t for t in head_toks if t in ptoks]
            if not head_common or all(t in WEAK for t in head_common):
                continue
            if pm and e_metal and pm != e_metal:
                continue  # conflicting metals
            if pm and not e_metal:
                # entry doesn't state a metal: only trust the link if the
                # weight matches or at least 2 strong keywords do
                strong = [t for t in head_common if t not in WEAK]
                oz_ok = e_oz and p_oz and e_oz == p_oz
                if not oz_ok and len(strong) < 2:
                    continue
            if den is not None:
                pd = prod_denom(p)
                if pd is None or abs(pd - den) > 0.001:
                    continue
            if e_oz and p_oz and e_oz != p_oz:
                continue
            score = len(head_common) * 2 + len([t for t in series_toks if t in ptoks])
            if best is None or score > best[0]:
                second = best
                best = (score, p, head_common)
            elif second is None or score > second[0]:
                second = (score, p, head_common)
    if best is None:
        return None, 'no-candidate'
    if second is not None and second[0] == best[0]:
        return None, 'ambiguous'
    return best[1], 'ok'

out = {}
stats = collections.Counter()
for e in coins:
    if e['section'] not in CAN_SECS:
        continue
    k = key(e)
    if k in numista:
        continue
    p, why = match(e)
    stats[why] += 1
    if p is None:
        continue
    specs = p.get('specs') or {}
    spec_txt = '; '.join(f'{sk}: {sv}' for sk, sv in specs.items() if sk != 'Product Number')
    out[k] = {
        'source_site': 'mint.ca',
        'title': html_mod.unescape(p['title']),
        'url': p['url'],
        'obv': p.get('obv'),
        'rev': p.get('rev'),
        'specs': html_mod.unescape(spec_txt),
    }

json.dump(out, open(os.path.join(BASE, 'data', 'mint_map.json'), 'w'), ensure_ascii=False, indent=1)
print(dict(stats))
print('matched:', len(out))
