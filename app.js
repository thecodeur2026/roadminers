/* ===== ROAD MINER — logique applicative ===== */
"use strict";

const PERCENTS = [5, 10, 15, 25, 35, 50, 75, 100];
const MAX_RESULTS = 60;

let DB = { entries: [], notes: [] };
let currentItem = null;

/* ---------- Utilitaires ---------- */
const $ = (sel) => document.querySelector(sel);

function normalize(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2200);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Texte cherchable d'une entrée */
function entryText(e) {
  return normalize([e.section, e.category, e.series, e.date, e.description].join(" "));
}

function entryTitle(e) {
  const parts = [];
  if (e.date) parts.push(e.date);
  if (e.description) parts.push(e.description.split(";")[0]);
  return parts.join(" — ") || e.series || e.category || "Article";
}

function entryRef(e) {
  return [e.section, e.category, e.series].filter(Boolean).join(" › ");
}

/* ---------- Correspondance Numista (images pile/face) ---------- */
let NUMISTA = {};
let NUMISTA_DETAILS = {};
let MINT = {};

/* clé identique à entry_key() du script python (numista_match.py) */
function entryKey(e) {
  const price = e.price === null || e.price === undefined
    ? "None"
    : Number.isInteger(e.price) ? e.price.toFixed(1) : String(e.price);
  return [e.source, e.page, e.section, e.category, e.series, e.date, e.description, price]
    .map((x) => (x === null || x === undefined ? "" : String(x)))
    .join("|");
}

async function loadNumistaMap() {
  try {
    const res = await fetch("data/numista_map.json");
    if (res.ok) NUMISTA = await res.json();
  } catch { NUMISTA = {}; }
  try {
    const res = await fetch("data/numista_details.json");
    if (res.ok) NUMISTA_DETAILS = await res.json();
  } catch { NUMISTA_DETAILS = {}; }
  try {
    const res = await fetch("data/mint_map.json");
    if (res.ok) MINT = await res.json();
  } catch { MINT = {}; }
}

/* ---------- Chargement des données ---------- */
async function loadData() {
  try {
    let entries = null;
    // Supabase si configuré, sinon le fichier local
    if (typeof SUPABASE_ANON_KEY !== "undefined" && SUPABASE_ANON_KEY) {
      entries = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/entries?select=source,page,section,category,series,date,description,price,uncertain,content_table&order=id&offset=${from}&limit=${pageSize}`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY } });
        if (!res.ok) throw new Error("supabase " + res.status);
        const rows = await res.json();
        rows.forEach((r) => entries.push({
          source: r.source, page: r.page, section: r.section, category: r.category,
          series: r.series, date: r.date, description: r.description,
          price: r.price === null ? null : Number(r.price),
          uncertain: r.uncertain, contentTable: r.content_table,
        }));
        if (rows.length < pageSize) break;
      }
    }
    if (entries && entries.length) {
      DB = { entries, notes: [] };
    } else {
      const res = await fetch("data/coins.json");
      DB = await res.json();
    }
    DB.entries.forEach((e, i) => {
      e._id = i;
      e._text = entryText(e);
    });
  } catch (err) {
    console.error("Données non chargées", err);
    DB = { entries: [], notes: [] };
  }
}

/* ---------- Recherche ---------- */
const SYNONYMS = {
  "morgan": ["morgan", "liberty head"],
  "penny": ["penny", "cent"],
  "pennies": ["pennies", "cent"],
  "nickel": ["nickel", "five cents"],
  "dime": ["dime", "ten cents"],
  "quarter": ["quarter", "twenty five cents", "twenty-five cents"],
  "loonie": ["loonie", "dollar"],
  "toonie": ["toonie", "two dollars"],
  "souverain": ["souverain", "sovereign"],
  "feuille": ["feuille", "maple"]
};

function search(query) {
  const q = normalize(query);
  if (!q) return [];
  const groups = q.split(" ").map((t) => SYNONYMS[t] || [t]);
  const scored = [];
  for (const e of DB.entries) {
    let ok = true;
    for (const g of groups) {
      if (!g.some((alt) => e._text.includes(alt))) { ok = false; break; }
    }
    if (ok) {
      let score = 0;
      const d = normalize(e.date + " " + (e.description || ""));
      for (const g of groups) if (g.some((alt) => d.includes(alt))) score += 2;
      if (groups[0].some((alt) => d.startsWith(alt))) score += 1;
      if (e.source === "guide") score += 1; // le guide d'achat d'abord
      scored.push({ e, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS).map((s) => s.e);
}

function resultItem(e, onPick) {
  const li = document.createElement("li");
  const badge = e.source === "catalogue" ? "cat." : "";
  li.innerHTML = `
    <span class="result-price">${e.price != null ? fmt(e.price) : "—"}</span>
    <div class="result-title">${escapeHtml(entryTitle(e))} ${badge ? `<span class="badge-cat">${badge}</span>` : ""}</div>
    <div class="result-sub">${escapeHtml(entryRef(e))}</div>`;
  li.addEventListener("click", () => onPick(e));
  return li;
}

function renderResults(list, query) {
  const ul = $("#results");
  const count = $("#results-count");
  // page d'accueil (cours + fonte + exemples) visible seulement sans recherche
  $("#home-zone").style.display = query ? "none" : "";
  ul.innerHTML = "";
  if (!query) { count.textContent = ""; return; }
  if (list.length === 0) {
    count.innerHTML = `Aucun article trouvé pour « ${escapeHtml(query)} ».<br>
      <strong style="color:var(--red)">Cet article ne figure pas dans le guide → on ne le prend pas.</strong>`;
    return;
  }
  for (const e of list) ul.appendChild(resultItem(e, openDetail));
  count.textContent = list.length >= MAX_RESULTS
    ? `Plus de ${MAX_RESULTS} résultats — précisez la recherche.`
    : `${list.length} résultat${list.length > 1 ? "s" : ""}`;
}

/* ---------- Fiche caractéristiques (Numista ou Monnaie royale) ---------- */
function renderCaracs(nm, mint) {
  const zone = $("#caracs-zone");
  const box = $("#caracs");
  const title = $("#caracs-title");
  const d = nm && NUMISTA_DETAILS[String(nm.id)];
  if (d) {
    title.textContent = "Caractéristiques (Numista)";
    const rows = [
      ["Émetteur", d.issuer],
      ["Type", d.type],
      ["Période", d.years],
      d.rulers && d.rulers.length ? ["Dirigeant", d.rulers.join(", ")] : null,
      ["Valeur", d.value],
      ["Devise", d.currency],
      ["Composition", d.composition],
      ["Poids", d.weight != null ? d.weight + " g" : null],
      ["Diamètre", d.size != null ? d.size + " mm" : null],
      ["Épaisseur", d.thickness != null ? d.thickness + " mm" : null],
      ["Forme", d.shape],
      ["Technique", d.technique],
      ["Orientation", d.orientation],
      ["Tranche", d.edge],
      ["Démonétisée", d.demonetized === true ? "Oui" : d.demonetized === false ? "Non" : null],
      d.mints && d.mints.length ? ["Atelier", d.mints.join(", ")] : null,
      d.references && d.references.length ? ["Références", d.references.join(" · ")] : null,
    ].filter(Boolean);
    let html = rows.map(([k, v]) =>
      `<div class="carac-row"><span class="carac-k">${k}</span><span class="carac-v">${escapeHtml(String(v))}</span></div>`
    ).join("");
    for (const [label, side] of [["Avers", d.obverse], ["Revers", d.reverse]]) {
      if (side && (side.description || side.lettering)) {
        html += `<div class="carac-side"><div class="carac-side-title">${label}</div>`;
        if (side.description) html += `<p>${escapeHtml(side.description)}</p>`;
        if (side.lettering) html += `<p class="carac-lettering">${escapeHtml(side.lettering)}</p>`;
        if (side.engravers && side.engravers.length)
          html += `<p class="carac-eng">Graveur : ${escapeHtml(side.engravers.join(", "))}</p>`;
        html += `</div>`;
      }
    }
    box.innerHTML = html;
    zone.hidden = false;
    return;
  }
  // secours : specs de la fiche officielle mint.ca (format "Clé: valeur; ...")
  if (mint && mint.specs) {
    title.textContent = "Caractéristiques (Monnaie royale canadienne)";
    const pairs = mint.specs.split(";").map((s) => s.trim()).filter(Boolean);
    const html = pairs.map((p) => {
      const i = p.indexOf(":");
      if (i < 0) return `<div class="carac-row"><span class="carac-v">${escapeHtml(p)}</span></div>`;
      return `<div class="carac-row"><span class="carac-k">${escapeHtml(p.slice(0, i).trim())}</span><span class="carac-v">${escapeHtml(p.slice(i + 1).trim())}</span></div>`;
    }).join("");
    box.innerHTML = html;
    zone.hidden = false;
    return;
  }
  zone.hidden = true;
}

/* ---------- Images Google en secours (via proxy serveur sécurisé) ---------- */
async function googleImageFor(e, cb) {
  const key = entryKey(e);
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem("roadminer_gimg")) || {}; } catch {}
  if (key in cache) return cb(cache[key]);
  try {
    const q = encodeURIComponent(entryTitle(e) + " " + (e.series || "") + " coin");
    const r = await fetch(`${SUPABASE_URL}/functions/v1/gimg?q=${q}`, { cache: "no-store" });
    const d = await r.json();
    const url = d.url || null;
    cache[key] = url;
    try { localStorage.setItem("roadminer_gimg", JSON.stringify(cache)); } catch {}
    cb(url);
  } catch { cb(null); }
}

/* ---------- Thème clair / sombre ---------- */
function initTheme() {
  const btn = $("#btn-theme");
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    btn.textContent = t === "light" ? "☾" : "☀";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === "light" ? "#f6f3ea" : "#0a0a0a";
  };
  let t = "dark";
  try { t = localStorage.getItem("roadminer_theme") || "dark"; } catch {}
  apply(t);
  btn.addEventListener("click", () => {
    t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("roadminer_theme", t); } catch {}
    apply(t);
  });
}

/* ---------- Pièce 3D : rotation lente + manipulation doigt/souris ---------- */
let coinAngle = 0, coinAuto = true, coinDragX = null;

function initCoinDrag() {
  const coin = $(".coin3d");
  const scene = $(".coin3d-scene");
  if (!coin || !scene || initCoinDrag._done) return;
  initCoinDrag._done = true;
  const apply = () => { coin.style.transform = `rotateY(${coinAngle}deg)`; };
  scene.addEventListener("pointerdown", (e) => {
    coinAuto = false;
    coinDragX = e.clientX;
    try { scene.setPointerCapture(e.pointerId); } catch {}
  });
  scene.addEventListener("pointermove", (e) => {
    if (coinDragX === null) return;
    coinAngle += (e.clientX - coinDragX) * 0.6;
    coinDragX = e.clientX;
    apply();
  });
  const end = () => { coinDragX = null; coinAuto = true; };
  scene.addEventListener("pointerup", end);
  scene.addEventListener("pointercancel", end);
  (function spin() {
    if (coinAuto) { coinAngle += 1.08; apply(); } // ~65°/s — 65 % de la vitesse d'origine
    requestAnimationFrame(spin);
  })();
}

/* ---------- Détail ---------- */
function openDetail(e) {
  currentItem = e;
  $("#realprice").value = "";
  $("#margin-info").textContent = "";

  const isCatalog = e.source === "catalogue";
  const nm = NUMISTA[entryKey(e)];
  const mint = MINT[entryKey(e)];
  const verdict = $("#verdict");
  verdict.textContent = isCatalog ? "VALEUR CATALOGUE" : "ON PREND";
  verdict.classList.remove("no");
  verdict.classList.toggle("info", isCatalog);
  $("#detail-price-label").textContent = isCatalog ? "Valeur catalogue (marchande)" : "Prix d'achat du guide";
  $("#detail-title").textContent = entryTitle(e);
  $("#detail-ref").textContent = entryRef(e) + (e.page ? `  •  ${isCatalog ? "Catalogue" : "Guide"} p. ${e.page}` : "");
  $("#detail-price").textContent = e.price != null ? fmt(e.price) : "—";
  // référence externe : Numista, sinon mint.ca, sinon rien (bouton caché)
  const link = $("#guide-page-link");
  if (nm && nm.id) {
    link.hidden = false;
    link.href = "https://en.numista.com/catalogue/pieces" + nm.id + ".html";
    link.innerHTML = "Voir la référence sur Numista &nearr;";
  } else if (mint && mint.url) {
    link.hidden = false;
    link.href = mint.url;
    link.innerHTML = "Voir la fiche officielle sur mint.ca &nearr;";
  } else {
    link.hidden = true;
  }
  renderCaracs(nm, mint);

  // prix réel : mint.ca si la pièce y est, sinon recherche Google
  const pcLink = $("#pricecharting-link");
  if (mint && mint.url) {
    pcLink.href = mint.url;
    pcLink.innerHTML = "Prix officiel sur mint.ca &nearr;";
  } else {
    pcLink.href = "https://www.google.com/search?q=" +
      encodeURIComponent(entryTitle(e) + " " + (e.series || "") + " prix");
    pcLink.innerHTML = "Rechercher le prix sur Google &nearr;";
  }

  const tiers = $("#tiers");
  tiers.innerHTML = "";
  for (const p of PERCENTS) {
    const div = document.createElement("div");
    div.className = "tier" + (p === 100 ? " full" : "");
    const val = e.price != null ? (e.price * p) / 100 : null;
    div.innerHTML = `<span class="pct">${p} %</span><span class="val">${val != null ? fmt(val) : "—"}</span>`;
    tiers.appendChild(div);
  }

  // pièce 3D : vraies images Numista / mint.ca (même une seule face), sinon Google, sinon faces dorées
  const title = entryTitle(e);
  const front = $("#coin-front"), back = $("#coin-back");
  const obv = (nm && nm.obv) || (mint && mint.obv) || null;
  const rev = (nm && nm.rev) || (mint && mint.rev) || null;
  const applyImg = (o, r) => {
    front.classList.toggle("has-img", !!o);
    back.classList.toggle("has-img", !!r);
    front.style.backgroundImage = o ? `url("${o}")` : "";
    back.style.backgroundImage = r ? `url("${r}")` : "";
  };
  if (obv || rev) {
    applyImg(obv || rev, rev || obv);
    front.innerHTML = `<div class="cf-badge">${escapeHtml(title.length > 36 ? title.slice(0, 36) + "…" : title)}</div>`;
    back.innerHTML = `<div class="cf-badge">${e.price != null ? fmt(e.price) : ""}</div>`;
  } else {
    // secours : image Google (si configurée) — sinon faces dorées
    googleImageFor(e, (url) => {
      if (url && currentItem === e) {
        applyImg(url, url);
        front.innerHTML = `<div class="cf-badge">${escapeHtml(title.slice(0, 36))}</div>`;
        back.innerHTML = `<div class="cf-badge">${e.price != null ? fmt(e.price) : ""}</div>`;
      }
    });
    applyImg("", "");
    front.innerHTML = `
      <div class="cf-logo">R</div>
      <div class="cf-title">${escapeHtml(title.length > 42 ? title.slice(0, 42) + "…" : title)}</div>
      <div class="cf-sub">${escapeHtml(e.category || e.section || "ROAD MINERS")}</div>`;
    back.innerHTML = `
      <div class="cf-sub">${isCatalog ? "VALEUR CATALOGUE" : "ON PREND"}</div>
      <div class="cf-price">${e.price != null ? fmt(e.price) : "—"}</div>
      <div class="cf-sub">100 % ${isCatalog ? "valeur" : "prix du guide"}</div>`;
  }

  showView("view-detail");
  window.scrollTo(0, 0);
}

function updateMargin() {
  const real = parseFloat($("#realprice").value);
  const info = $("#margin-info");
  if (!currentItem || currentItem.price == null || isNaN(real)) {
    info.textContent = "";
    return;
  }
  const diff = real - currentItem.price;
  const pct = currentItem.price > 0 ? (diff / currentItem.price) * 100 : 0;
  const sign = diff >= 0 ? "+" : "";
  info.innerHTML = `Marge potentielle : <strong>${sign}${fmt(diff)}</strong> (${sign}${pct.toFixed(1)} % par rapport au prix du guide)`;
}

/* ---------- Cours en direct + calculateur de fonte ---------- */
let SPOT = null; // {updated, materials, spot, usdcad, history}
const METAL_LABELS = [["XAU", "Or"], ["XAG", "Argent"], ["XPT", "Platine"], ["XPD", "Palladium"]];
const METAL_INFO = {
  XAU: { label: "OR", code: "XAU/USD", color: "212,175,55" },
  XAG: { label: "ARGENT", code: "XAG/USD", color: "190,190,205" },
  XPT: { label: "PLATINE", code: "XPT/USD", color: "150,220,200" },
  XPD: { label: "PALLADIUM", code: "XPD/USD", color: "230,170,120" },
};

async function loadSpot() {
  // 1) affichage IMMÉDIAT depuis le cache local (aucune attente réseau)
  if (!SPOT) {
    try {
      const cached = JSON.parse(localStorage.getItem("roadminer_spotdata"));
      if (cached) {
        SPOT = cached;
        renderSpotTicker();
        initMeltV2();
        initAgc();
        mergeHistory();
        renderCmp();
        drawSpotChart();
      }
    } catch {}
  }
  // 2) puis mise à jour fraîche
  let data = null;
  const urls = [];
  // Edge Function Supabase si configurée (HTTPS, sans CORS), sinon proxy local
  if (typeof SUPABASE_ANON_KEY !== "undefined" && SUPABASE_ANON_KEY) {
    urls.push(SUPABASE_URL + "/functions/v1/spot");
  }
  urls.push("/api/spot.json");
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        if (d && (d.materials?.length || d.spot?.XAU?.usd_oz)) {
          data = d;
          localStorage.setItem("roadminer_spotdata", JSON.stringify(d));
          break;
        }
      }
    } catch {}
  }
  if (!data && !SPOT) {
    try {
      const r = await fetch("data/spot-fallback.json");
      if (r.ok) data = await r.json();
    } catch {}
  }
  if (data) SPOT = data;
  renderSpotTicker();
  initMeltV2();
  initAgc();
  mergeHistory();
  renderCmp();
  drawSpotChart();
}

function metalChange(k) {
  const pts = (SPOT.history || {})[k];
  if (!pts || pts.length < 2) return { pct: 0, abs: 0 };
  const last = pts[pts.length - 1][1];
  const ref = pts.length > 25 ? pts[pts.length - 25][1] : pts[0][1]; // ~24 h
  return { pct: ref ? ((last - ref) / ref) * 100 : 0, abs: last - ref };
}

function updateLiveSince() {
  const el = $("#live-since");
  if (!el || !SPOT || !SPOT.updated) return;
  const t = new Date(SPOT.updated).getTime();
  if (!isNaN(t)) el.textContent = Math.max(0, Math.round((Date.now() - t) / 1000));
}

function renderSpotTicker() {
  const el = $("#spot-ticker");
  if (!SPOT || !SPOT.spot) { el.innerHTML = ""; return; }
  el.innerHTML = METAL_LABELS.map(([k]) => {
    const m = SPOT.spot[k];
    if (!m || !m.usd_oz) return "";
    const info = METAL_INFO[k];
    const { pct, abs } = metalChange(k);
    const up = pct >= 0;
    return `<div class="spot-chip">
      <div class="spot-chip-head">
        <span class="spot-dot" style="background:rgb(${info.color})"></span>
        <div><div class="spot-name">${info.label}</div><div class="spot-code">${info.code}</div></div>
      </div>
      <div class="spot-big">${fmt(m.usd_oz)}</div>
      <div class="spot-changes">
        <span class="chg ${up ? "up" : "down"}">${up ? "&#8599;" : "&#8600;"} ${up ? "+" : ""}${pct.toFixed(2)} %</span>
        <span class="chg ${up ? "up" : "down"}">${up ? "+" : "&minus;"}${fmt(Math.abs(abs))}</span>
      </div>
      <div class="spot-cad">${fmt(m.cad_oz)} <small>CA/oz</small></div>
      <canvas class="spark" data-metal="${k}"></canvas>
    </div>`;
  }).join("") + `<div class="spot-when"><span class="live-dot"></span>LIVE &middot; Mis à jour il y a <span id="live-since">0</span> s</div>`;
  document.querySelectorAll(".spark").forEach((cv) => drawSpark(cv));
  updateLiveSince();
}

function drawSpark(cv) {
  const k = cv.dataset.metal;
  const pts = (SPOT.history || {})[k];
  if (!pts || pts.length < 3) return;
  const w = (cv.width = cv.offsetWidth), h = (cv.height = cv.offsetHeight);
  const ctx = cv.getContext("2d");
  const vals = pts.map((p) => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const color = METAL_INFO[k].color;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - 3 - ((p[1] - min) / span) * (h - 8);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = `rgba(${color}, .95)`;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(${color}, .22)`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fill();
}

/* --- Comparaison des prix : aujourd'hui vs 1 jour / 1 semaine / 1 mois / 3 mois --- */
const CMP = { metal: "XAU", unit: "oz", hist: {} };
const CMP_PERIODS = [
  ["Aujourd'hui", 0],
  ["1 jour", 86400000],
  ["1 semaine", 7 * 86400000],
  ["1 mois", 30 * 86400000],
  ["3 mois", 91 * 86400000],
];

/* fusionne l'historique serveur + le point actuel dans l'accumulation locale */
function mergeHistory() {
  if (!SPOT) return;
  let store = {};
  try { store = JSON.parse(localStorage.getItem("roadminer_histv2")) || {}; } catch { store = {}; }
  for (const [k] of METAL_LABELS) {
    const arr = Array.isArray(store[k]) ? store[k] : [];
    const seen = new Set(arr.map((p) => p[0]));
    for (const p of ((SPOT.history || {})[k] || [])) {
      if (Array.isArray(p) && p.length === 2 && !seen.has(p[0])) arr.push(p);
    }
    if (SPOT.spot && SPOT.spot[k] && SPOT.spot[k].usd_oz) {
      arr.push([Date.now(), SPOT.spot[k].usd_oz]);
    }
    arr.sort((a, b) => a[0] - b[0]);
    store[k] = arr.slice(-3000);
  }
  try { localStorage.setItem("roadminer_histv2", JSON.stringify(store)); } catch {}
  CMP.hist = store;
}

function renderCmp() {
  const metalsEl = $("#cmp-metals");
  if (!metalsEl) return;
  if (!metalsEl.children.length) {
    for (const [k] of METAL_LABELS) {
      const b = document.createElement("button");
      b.className = "cmp-m" + (k === CMP.metal ? " active" : "");
      b.dataset.m = k;
      b.textContent = METAL_INFO[k].label;
      b.addEventListener("click", () => { CMP.metal = k; renderCmp(); });
      metalsEl.appendChild(b);
    }
    document.querySelectorAll(".cmp-u").forEach((b) =>
      b.addEventListener("click", () => {
        CMP.unit = b.dataset.u;
        document.querySelectorAll(".cmp-u").forEach((x) => x.classList.toggle("active", x === b));
        renderCmp();
      }));
  }
  metalsEl.querySelectorAll(".cmp-m").forEach((b) =>
    b.classList.toggle("active", b.dataset.m === CMP.metal));
  const row = $("#cmp-row");
  if (!SPOT || !SPOT.spot || !SPOT.spot[CMP.metal]) { row.innerHTML = ""; return; }
  const usdcad = SPOT.usdcad || 1;
  const nowUsd = SPOT.spot[CMP.metal].usd_oz;
  const pts = CMP.hist[CMP.metal] || (SPOT.history || {})[CMP.metal] || [];
  const now = Date.now();
  const priceOf = (usdOz) =>
    (usdOz * usdcad / (CMP.unit === "g" ? 31.1034768 : 1))
      .toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  row.innerHTML = CMP_PERIODS.map(([label, back]) => {
    let price = null;
    if (!back) {
      price = nowUsd;
    } else {
      const target = now - back;
      let best = null, bd = Infinity;
      for (const p of pts) {
        const dd = Math.abs(p[0] - target);
        if (dd < bd) { bd = dd; best = p; }
      }
      const tol = Math.max(12 * 3600000, back * 0.25);
      if (best && bd <= tol) price = best[1];
    }
    const pct = price != null ? ((nowUsd - price) / price) * 100 : null;
    const up = pct == null || pct >= 0;
    return `<div class="cmp-item">
      <div class="cmp-label">${label}</div>
      <div class="cmp-price">${price != null ? priceOf(price) : "—"}</div>
      <div class="cmp-unit-label">CAD / ${CMP.unit === "g" ? "Gramme" : "Once"}</div>
      ${pct != null
        ? `<span class="chg ${up ? "up" : "down"}">${up ? "+" : "−"}${Math.abs(pct).toFixed(2)} %</span>`
        : `<span class="chg cmp-na">pas de données</span>`}
    </div>`;
  }).join("");
  $("#cmp-note").textContent =
    "Historique accumulé sur cet appareil + serveur : les périodes sans données affichent « — » et se remplissent au fil des visites. Prix passés convertis au taux USD→CAD actuel.";
}

/* --- Calculateur argent : lots de pièces (quantité × prix Kitco au gramme) --- */
const AGC_TYPES = [
  { label: "10 ¢ canadien (1966 et avant)", fineness: "80 %", g: 2.33, fine: 0.8, mat: "0.8000 Canadian Silver Coin (1966 or earlier)" },
  { label: "25 ¢ canadien (1966 et avant)", fineness: "80 %", g: 5.83, fine: 0.8, mat: "0.8000 Canadian Silver Coin (1966 or earlier)" },
  { label: "50 ¢ canadien (1966 et avant)", fineness: "80 %", g: 11.66, fine: 0.8, mat: "0.8000 Canadian Silver Coin (1966 or earlier)" },
  { label: "1 $ canadien argent (1967 et avant)", fineness: "80 %", g: 23.33, fine: 0.8, mat: "0.8000 Canadian Silver Coin (1966 or earlier)" },
  { label: "25 ¢ canadien 1967 (50 %)", fineness: "50 %", g: 5.83, fine: 0.5, mat: "0.5000 Canadian Silver Coin (1968)" },
  { label: "25 ¢ canadien 1968 (50 %)", fineness: "50 %", g: 5.83, fine: 0.5, mat: "0.5000 Canadian Silver Coin (1968)" },
  { label: "Dollar commémoratif 1971–1991", fineness: "50 %", g: 23.33, fine: 0.5, mat: "0.5000 Canadian Silver Coin (1968)" },
  { label: "Dollar commémoratif 1992–2002", fineness: "92,5 %", g: 25.175, fine: 0.925, mat: "Sterling Metallic" },
  { label: "Olympique 5 $ Montréal", fineness: "92,5 %", g: 24.3, fine: 0.925, mat: "Sterling Metallic" },
  { label: "Olympique 10 $ Montréal", fineness: "92,5 %", g: 48.6, fine: 0.925, mat: "Sterling Metallic" },
  { label: "10 ¢ américain (1964 et avant)", fineness: "90 %", g: 2.5, fine: 0.9, mat: "0.9000 US Silver Coin (1964 or earlier)" },
  { label: "25 ¢ américain (1964 et avant)", fineness: "90 %", g: 6.25, fine: 0.9, mat: "0.9000 US Silver Coin (1964 or earlier)" },
  { label: "50 ¢ américain (1964 et avant)", fineness: "90 %", g: 12.5, fine: 0.9, mat: "0.9000 US Silver Coin (1964 or earlier)" },
  { label: "1 $ américain Morgan / Peace", fineness: "90 %", g: 26.73, fine: 0.9, mat: "0.9000 US Silver Coin (1964 or earlier)" },
  { label: "50 ¢ Kennedy 1965–1969", fineness: "40 %", g: 11.5, fine: 0.4, mat: "0.4000 US Silver Coin \"Kennedy Half Dollar\" (1965-1970)" },
];
let agcQty = {}; // index → quantité
let agcPct = 100; // offre en % du 100 % Kitco (persistée)

function agcPricePerG(t) {
  if (SPOT && SPOT.materials) {
    const m = SPOT.materials.find((x) => x.name === t.mat);
    if (m) return m.tiers[0].individual;
    const pure = SPOT.materials.find((x) => /pure silver/i.test(x.name));
    if (pure) return pure.tiers[0].individual * t.fine;
  }
  const cadG = SPOT && SPOT.spot && SPOT.spot.XAG && SPOT.spot.XAG.cad_g;
  return cadG ? cadG * t.fine : 0;
}

function renderAgcRows() {
  const zone = $("#agc-rows");
  zone.innerHTML = "";
  AGC_TYPES.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "agc-row";
    div.innerHTML = `
      <span class="agc-label">${t.label}<small>${t.fineness} · ${t.g} g</small></span>
      <input class="agc-qty" data-i="${i}" type="number" min="0" step="1" placeholder="0" value="${agcQty[i] ?? ""}" aria-label="Quantité">
      <span class="agc-sub" id="agc-sub-${i}">—</span>`;
    zone.appendChild(div);
  });
  zone.querySelectorAll(".agc-qty").forEach((s) =>
    s.addEventListener("input", (e) => {
      agcQty[+e.target.dataset.i] = e.target.value;
      try { localStorage.setItem("roadminer_agc", JSON.stringify(agcQty)); } catch {}
      updateAgc();
    }));
  const paidInp = $("#agc-paid");
  try { paidInp.value = localStorage.getItem("roadminer_agcpaid") || ""; } catch {}
  paidInp.addEventListener("input", () => {
    try { localStorage.setItem("roadminer_agcpaid", paidInp.value); } catch {}
    updateAgc();
  });
  // sélecteur d'offre en % (paliers)
  const pctSel = $("#agc-pct");
  try {
    const saved = localStorage.getItem("roadminer_agcpct");
    if (saved) agcPct = +saved || 100;
  } catch {}
  pctSel.innerHTML = pctOptions(agcPct);
  pctSel.addEventListener("change", () => {
    agcPct = +pctSel.value;
    try { localStorage.setItem("roadminer_agcpct", pctSel.value); } catch {}
    updateAgc();
  });
}

function updateAgc() {
  let total = 0, total100 = 0;
  AGC_TYPES.forEach((t, i) => {
    const qty = parseFloat(agcQty[i]) || 0;
    const val100 = qty * t.g * agcPricePerG(t);
    const val = val100 * agcPct / 100;
    const sub = $("#agc-sub-" + i);
    if (sub) sub.innerHTML = val > 0
      ? `${fmt(val)}${agcPct !== 100 ? `<small style="display:block;font-weight:600;color:var(--text-dim)">${fmt(val100)} à 100 %</small>` : ""}`
      : "—";
    total += val;
    total100 += val100;
  });
  const res = $("#agc-result");
  if (!res) return;
  res.innerHTML = total > 0
    ? `<span class="melt-total-label">VALEUR DU LOT À ${agcPct} % (offre)</span> <strong class="melt-total">${fmt(total)}</strong><br><span class="hint-note">Référence 100 % Kitco : ${fmt(total100)}</span>`
    : `Entrez la quantité de chaque type de pièce.`;
  const tiers = $("#agc-tiers");
  if (tiers) {
    tiers.innerHTML = "";
    if (total > 0) {
      for (const p of PERCENTS) {
        const div = document.createElement("div");
        div.className = "tier" + (p === agcPct ? " full" : "");
        div.innerHTML = `<span class="pct">${p} %</span><span class="val">${fmt(total100 * p / 100)}</span>`;
        tiers.appendChild(div);
      }
    }
  }
  const paidRow = $("#agc-paid-row");
  if (paidRow) paidRow.hidden = total <= 0;
  const agcTx = $("#agc-to-tx");
  if (agcTx) agcTx.hidden = total <= 0;
  const paidInp = $("#agc-paid");
  const paidOut = $("#agc-paid-pct");
  if (paidInp && paidOut) {
    const v = parseFloat(paidInp.value);
    paidOut.textContent = (!isNaN(v) && v > 0 && total100 > 0)
      ? `= ${(v / total100 * 100).toFixed(1)} %`
      : "—";
  }
}

function initAgc() {
  if (!SPOT || !$("#agc-rows")) return;
  try {
    const saved = JSON.parse(localStorage.getItem("roadminer_agc"));
    if (saved && typeof saved === "object" && !initAgc._restored) {
      agcQty = saved;
      initAgc._restored = true;
    }
  } catch {}
  if (!$("#agc-rows").children.length) renderAgcRows();
  updateAgc();
}

/* --- Calculateur multi-matériaux --- */
let meltRows = [{ mat: -1, grams: "", pct: 100 }]; // mat:-1 → sera 10 K par défaut

function defaultMatIndex() {
  if (!SPOT || !SPOT.materials) return 0;
  const i = SPOT.materials.findIndex((m) => /^10\s?K/i.test(m.name));
  return i >= 0 ? i : 0;
}

function materialOptions(selIdx) {
  const sel = selIdx >= 0 ? selIdx : defaultMatIndex();
  return SPOT.materials
    .map((m, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${m.name}</option>`)
    .join("");
}

function saveMeltRows() {
  try { localStorage.setItem("roadminer_meltrows", JSON.stringify(meltRows)); } catch {}
}

function pctOptions(selPct) {
  return PERCENTS.map((p) => `<option value="${p}"${p === selPct ? " selected" : ""}>${p} %</option>`).join("");
}

function renderMeltRows() {
  const zone = $("#melt-rows");
  zone.innerHTML = "";
  meltRows.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "melt-row-item";
    div.innerHTML = `
      <select class="melt-mat" data-i="${i}" aria-label="Matériau">${materialOptions(row.mat)}</select>
      <input class="melt-g" data-i="${i}" type="number" min="0" step="0.01" placeholder="grammes" value="${row.grams}" aria-label="Grammes">
      <select class="melt-pct" data-i="${i}" aria-label="Pourcentage">${pctOptions(row.pct ?? 100)}</select>
      <span class="melt-val" id="melt-val-${i}">—</span>
      ${meltRows.length > 1 ? `<button class="row-del melt-del" data-i="${i}" aria-label="Retirer">&times;</button>` : `<span></span>`}
      <div class="melt-pcts" id="melt-pcts-${i}"></div>`;
    zone.appendChild(div);
  });
  zone.querySelectorAll(".melt-mat").forEach((s) =>
    s.addEventListener("change", (e) => {
      meltRows[+e.target.dataset.i].mat = +e.target.value;
      saveMeltRows();
      updateMeltV2();
    }));
  zone.querySelectorAll(".melt-pct").forEach((s) =>
    s.addEventListener("change", (e) => {
      meltRows[+e.target.dataset.i].pct = +e.target.value;
      saveMeltRows();
      updateMeltV2();
    }));
  zone.querySelectorAll(".melt-g").forEach((s) =>
    s.addEventListener("input", (e) => {
      meltRows[+e.target.dataset.i].grams = e.target.value;
      saveMeltRows();
      updateMeltV2();
    }));
  zone.querySelectorAll(".melt-del").forEach((b) =>
    b.addEventListener("click", (e) => {
      meltRows.splice(+e.target.dataset.i, 1);
      saveMeltRows();
      renderMeltRows();
      updateMeltV2();
    }));
}

function initMeltV2() {
  if (!SPOT || !SPOT.materials || !SPOT.materials.length) {
    $("#melt-result").textContent = "Cours indisponibles — vérifiez la connexion.";
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem("roadminer_meltrows"));
    if (Array.isArray(saved) && saved.length && !initMeltV2._restored) {
      meltRows = saved;
      initMeltV2._restored = true;
    }
  } catch {}
  if (!$("#melt-rows").children.length) renderMeltRows();
  updateMeltV2();
}

function meltRowValue(row) {
  const m = SPOT.materials[row.mat >= 0 ? row.mat : defaultMatIndex()] || SPOT.materials[0];
  const g = parseFloat(row.grams) || 0;
  const tier = m.tiers.reduce((best, t) => (g >= t.min_g ? t : best), m.tiers[0]);
  const per = tier.individual; // référence : prix NON-WHOLESALE Kitco
  const pct = row.pct ?? 100;
  return { per, pct, val100: per * g, val: per * g * pct / 100, g };
}

function updateMeltV2() {
  if (!SPOT || !SPOT.materials || !SPOT.materials.length) return;
  let total = 0, total100 = 0, anyVal = false, details = [];
  meltRows.forEach((row, i) => {
    const { per, pct, val, val100, g } = meltRowValue(row);
    const span = $("#melt-val-" + i);
    if (span) {
      // prix AU GRAMME toujours visible ; valeur de la ligne au % choisi
      span.innerHTML = val100 > 0
        ? `${fmt(val)}<small>${fmt(per)}/g · ${pct} %</small>`
        : `<small>${fmt(per)}/g</small>`;
    }
    // pourcentages de référence sous chaque ligne (le % choisi est mis en avant)
    const pcts = $("#melt-pcts-" + i);
    if (pcts) {
      pcts.innerHTML = val100 > 0
        ? PERCENTS.map((p) =>
            `<span class="mp${p === pct ? " mp-sel" : ""}"><b>${p} %</b> ${fmt(val100 * p / 100)}</span>`).join("")
        : "";
    }
    if (val100 > 0) {
      anyVal = true;
      details.push(`${fmt(per)}/g × ${g} g × ${pct} %`);
    }
    total += val;
    total100 += val100;
  });
  // % personnalisé (uniquement sur le total de référence 100 % Kitco)
  $("#custom-pct-zone").hidden = !anyVal;
  $("#melt-to-tx").hidden = !anyVal;
  updateCustomPct(total100);
  $("#melt-result").innerHTML = anyVal
    ? `<span class="melt-total-label">TOTAL À PAYER (vos % par article)</span> <strong class="melt-total">${fmt(total)}</strong><br><span class="hint-note">${details.join(" + ")}</span>`
    : `Entrez le poids en grammes de chaque matériau.`;
  const tiers = $("#melt-tiers");
  tiers.innerHTML = "";
  if (anyVal) {
    if (total !== updateMeltV2._lastTotal) goldBurst(); // pluie d'or
    updateMeltV2._lastTotal = total;
    // référence : ce que vaudrait le lot à 100 % Kitco, avec les paliers
    const ref = document.createElement("p");
    ref.className = "hint-note";
    ref.style.cssText = "margin:8px 0 4px;grid-column:1/-1";
    ref.textContent = `Référence 100 % Non-Wholesale Kitco : ${fmt(total100)} — paliers sur cette base :`;
    tiers.appendChild(ref);
    for (const p of PERCENTS) {
      const div = document.createElement("div");
      div.className = "tier" + (p === 100 ? " full" : "");
      div.innerHTML = `<span class="pct">${p} %</span><span class="val">${fmt(total100 * p / 100)}</span>`;
      tiers.appendChild(div);
    }
  } else {
    updateMeltV2._lastTotal = 0;
  }
}

/* % personnalisé — mémorisé entre les sessions */
let customPctBase = 0;

function updateCustomPct(base) {
  customPctBase = base;
  const inp = $("#custom-pct");
  const out = $("#custom-pct-val");
  if (!inp || !out) return;
  const p = parseFloat(inp.value);
  out.textContent = (!isNaN(p) && base > 0) ? fmt(base * p / 100) : "—";
  // montant payé au total → pourcentage réel du 100 % Kitco
  const paidInp = $("#custom-paid");
  const paidOut = $("#custom-paid-pct");
  if (paidInp && paidOut) {
    const v = parseFloat(paidInp.value);
    paidOut.textContent = (!isNaN(v) && v > 0 && base > 0)
      ? `= ${(v / base * 100).toFixed(1)} %`
      : "—";
  }
}

/* ---------- Effet « pluie de grains d'or » (3D) ---------- */
let fxCanvas = null, fxCtx = null, fxParts = [], fxRunning = false;

function initGoldFx() {
  fxCanvas = $("#gold-fx");
  if (!fxCanvas) return;
  fxCtx = fxCanvas.getContext("2d");
  const resize = () => {
    fxCanvas.width = fxCanvas.offsetWidth;
    fxCanvas.height = fxCanvas.offsetHeight;
  };
  new ResizeObserver(resize).observe(fxCanvas);
  resize();
}

function goldBurst() {
  if (!fxCtx) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const w = fxCanvas.width;
  for (let i = 0; i < 30; i++) {
    fxParts.push({
      x: Math.random() * w,
      y: -8 - Math.random() * 60,
      r: 2 + Math.random() * 4.5,
      vy: 0.8 + Math.random() * 2.4,
      vx: (Math.random() - 0.5) * 1.1,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.18,
      life: 1
    });
  }
  if (!fxRunning) {
    fxRunning = true;
    requestAnimationFrame(goldTick);
  }
}

function goldTick() {
  const ctx = fxCtx, w = fxCanvas.width, h = fxCanvas.height;
  ctx.clearRect(0, 0, w, h);
  fxParts = fxParts.filter((p) => p.life > 0 && p.y < h + 24);
  for (const p of fxParts) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    if (p.y > h * 0.75) p.life -= 0.045; // fondu vers le bas
    // grain 3D : ellipse qui pivote sur elle-même
    const squash = 0.25 + 0.75 * Math.abs(Math.sin(p.rot * 2));
    const grad = ctx.createRadialGradient(0, -p.r * 0.3, 0, 0, 0, p.r);
    grad.addColorStop(0, `rgba(255, 238, 180, ${p.life})`);
    grad.addColorStop(0.55, `rgba(212, 175, 55, ${p.life})`);
    grad.addColorStop(1, `rgba(120, 90, 20, 0)`);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, squash);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (fxParts.length) requestAnimationFrame(goldTick);
  else { fxRunning = false; ctx.clearRect(0, 0, w, h); }
}

/* ---------- Graphique d'évolution organique (fond du site) ---------- */
let chartSeries = null, chartRunning = false;

function drawSpotChart() {
  // prépare les séries normalisées puis lance l'animation organique
  let hist = (SPOT && SPOT.history) || {};
  if (!Object.values(hist).some((s) => s && s.length >= 4)) {
    try {
      const acc = JSON.parse(localStorage.getItem("roadminer_hist")) || [];
      if (SPOT && SPOT.spot?.XAU?.usd_oz) {
        acc.push({
          t: Date.now(),
          XAU: SPOT.spot.XAU.usd_oz, XAG: SPOT.spot.XAG?.usd_oz,
          XPT: SPOT.spot.XPT?.usd_oz, XPD: SPOT.spot.XPD?.usd_oz
        });
        localStorage.setItem("roadminer_hist", JSON.stringify(acc.slice(-300)));
      }
      hist = {};
      for (const k of ["XAU", "XAG", "XPT", "XPD"]) {
        hist[k] = acc.filter((p) => p[k]).map((p) => [p.t, p[k]]);
      }
    } catch { return; }
  }
  const series = [];
  let phase = 0;
  for (const [metal, pts] of Object.entries(hist)) {
    if (!pts || pts.length < 3) continue;
    const vals = pts.map((p) => p[1]);
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    series.push({
      color: (METAL_INFO[metal] || { color: "212,175,55" }).color,
      pts: vals.map((v) => (v - min) / span),
      ph: (phase += 1.7),
    });
  }
  if (!series.length) return;
  chartSeries = series;
  if (!chartRunning) {
    chartRunning = true;
    animateChart();
  }
}

function animateChart() {
  const cv = $("#spot-chart");
  if (!cv) { chartRunning = false; return; }
  const ctx = cv.getContext("2d");
  let phase = Math.random() * 10;
  (function frame() {
    if (!chartSeries) { chartRunning = false; return; }
    if (cv.width !== innerWidth || cv.height !== innerHeight) {
      cv.width = innerWidth;
      cv.height = innerHeight;
    }
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    phase += 0.006;
    for (const s of chartSeries) {
      const n = s.pts.length;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * (w + 80) - 40 + Math.sin(phase * 0.5 + s.ph) * 6;
        const y = h * 0.5 - (s.pts[i] - 0.5) * h * 0.72
          + Math.sin(phase + i * 0.14 + s.ph) * 9
          + Math.cos(phase * 0.7 + i * 0.05 + s.ph * 2) * 5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${s.color}, .5)`;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.lineTo(w + 60, h); ctx.lineTo(-60, h); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `rgba(${s.color}, .07)`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fill();
    }
    requestAnimationFrame(frame);
  })();
}

/* ---------- Arrière-plan animé (poussière d'or) ---------- */
let bgRunning = false;

function initBgFx() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("#bg-fx");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
  addEventListener("resize", resize);
  resize();
  const parts = [];
  for (let i = 0; i < 26; i++) {
    parts.push({
      x: Math.random() * cv.width,
      y: Math.random() * cv.height,
      r: 0.8 + Math.random() * 2.4,
      vx: (Math.random() - 0.5) * 0.16,
      vy: -0.08 - Math.random() * 0.22,
      a: 0.15 + Math.random() * 0.35,
      tw: Math.random() * Math.PI * 2
    });
  }
  if (bgRunning) return;
  bgRunning = true;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.tw += 0.02;
      if (p.y < -6) { p.y = cv.height + 6; p.x = Math.random() * cv.width; }
      if (p.x < -6) p.x = cv.width + 6;
      if (p.x > cv.width + 6) p.x = -6;
      const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
      g.addColorStop(0, `rgba(242, 213, 126, ${alpha})`);
      g.addColorStop(1, "rgba(212, 175, 55, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(tick);
  })();
}

/* ---------- Transaction (achat comptoir) ---------- */
const TX_CATS = [
  "PIÈCES EN ARGENT", "PIÈCES EN OR", "BIJOUX EN OR", "BIJUX / OBJETS EN ARGENT",
  "MONNAIE ET BILLET DE COLLECTION", "MONTRES", "DIAMANTS",
  "CARTE DE SPORT / NON-SPORT", "JOUETS / PUBLICITÉS", "TABLEAUX",
  "OBJETS MILITAIRE", "AUTRES",
];
let txItems = [];   // {label, cat, amount}
let txPhotos = [];  // dataURLs (compressées)

function shrinkImage(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function txTotal() {
  return txItems.reduce((s, it) => s + (it.amount || 0), 0);
}

function addTxItem(label, cat, amount) {
  if (!(amount > 0)) return;
  txItems.push({ label, cat, amount });
  renderTx();
  toast("Ajouté à la transaction : " + fmt(amount));
}

function renderTx() {
  const box = $("#tx-items");
  if (!box) return;
  if (!txItems.length) {
    box.innerHTML = `<p class="hint-note">Aucun article — ajoutez depuis la recherche, la fonte, le lot de pièces, ou une ligne libre ci-dessous.</p>`;
  } else {
    box.innerHTML = "";
    txItems.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "code-row";
      row.innerHTML = `
        <div class="code-main">
          <strong style="letter-spacing:0">${escapeHtml(it.label)}</strong>
          <small>${escapeHtml(it.cat)}</small>
        </div>
        <span class="agc-sub">${fmt(it.amount)}</span>
        <button class="row-del" aria-label="Retirer">&times;</button>`;
      row.querySelector(".row-del").addEventListener("click", () => {
        txItems.splice(i, 1);
        renderTx();
      });
      box.appendChild(row);
    });
  }
  // totaux par catégorie (style formulaire comptoir)
  const cats = $("#tx-cats");
  const sums = {};
  for (const it of txItems) sums[it.cat] = (sums[it.cat] || 0) + it.amount;
  const used = TX_CATS.filter((c) => sums[c]);
  cats.innerHTML = used.length
    ? used.map((c) => `<div class="tx-cat"><span>${c}</span><strong>${fmt(sums[c])}</strong></div>`).join("")
    : "";
  $("#tx-total").textContent = fmt(txTotal());
}

function meltCatFor(matName) {
  if (/gold|K\b/i.test(matName)) return "BIJOUX EN OR";
  if (/silver|sterling|ag /i.test(matName)) return "BIJUX / OBJETS EN ARGENT";
  return "AUTRES";
}

function sendMeltToTx() {
  let n = 0;
  for (const row of meltRows) {
    const { val, pct, g } = meltRowValue(row);
    if (val > 0) {
      const m = SPOT.materials[row.mat >= 0 ? row.mat : defaultMatIndex()] || SPOT.materials[0];
      addTxItem(`Fonte ${m.name} — ${g} g × ${pct} %`, meltCatFor(m.name), Math.round(val * 100) / 100);
      n++;
    }
  }
  if (n) showView("view-tx");
}

function sendAgcToTx() {
  let n = 0;
  AGC_TYPES.forEach((t, i) => {
    const qty = parseFloat(agcQty[i]) || 0;
    const val = qty * t.g * agcPricePerG(t) * agcPct / 100;
    if (val > 0) {
      addTxItem(`${qty} × ${t.label} (${t.fineness}) × ${agcPct} %`, "PIÈCES EN ARGENT", Math.round(val * 100) / 100);
      n++;
    }
  });
  if (n) showView("view-tx");
}

function sendFaceToTx() {
  const g = parseFloat($("#face-grams").value);
  const m = parseFloat($("#face-mult").value);
  if (!(g > 0) || !(m > 0)) return;
  const face = g / 23.32;
  addTxItem(`Argent au poids — ${g} g → ${face.toFixed(2)} $ facial × ${m}`,
    "PIÈCES EN ARGENT", Math.round(face * m * 100) / 100);
  showView("view-tx");
}

function addDetailToTx() {
  if (!currentItem) return;
  const real = parseFloat($("#realprice").value);
  const amount = (!isNaN(real) && real > 0) ? real : currentItem.price;
  addTxItem(entryTitle(currentItem), "MONNAIE ET BILLET DE COLLECTION", amount || 0);
}

function handleTxPhotos(files) {
  for (const file of Array.from(files).slice(0, 5 - txPhotos.length)) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        txPhotos.push(shrinkImage(img, 500, 0.6));
        renderTxPhotos();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
}

function renderTxPhotos() {
  const box = $("#tx-photos");
  box.innerHTML = "";
  txPhotos.forEach((p, i) => {
    const wrap = document.createElement("div");
    wrap.className = "tx-photo";
    wrap.innerHTML = `<img src="${p}" alt="photo ${i + 1}"><button class="row-del" aria-label="Retirer">&times;</button>`;
    wrap.querySelector(".row-del").addEventListener("click", () => {
      txPhotos.splice(i, 1);
      renderTxPhotos();
    });
    box.appendChild(wrap);
  });
}

async function saveTx() {
  if (!txItems.length) { toast("Aucun article dans la transaction"); return; }
  if (!$("#tx-nom").value.trim()) { toast("Nom du client requis"); $("#tx-nom").focus(); return; }
  let code = $("#tx-emp").value.trim() || localStorage.getItem("roadminer_access") || "";
  if (!code) { toast("Code employé requis"); $("#tx-emp").focus(); return; }
  let role;
  try { role = await verifyAccessCode(code); } catch { toast("Connexion impossible"); return; }
  if (role === "denied") { toast("Code employé invalide"); return; }
  localStorage.setItem("roadminer_access", code);
  const client = {
    nom: $("#tx-nom").value.trim(),
    tel: $("#tx-tel").value.trim(),
    naissance: $("#tx-naissance").value,
    idnum: $("#tx-idnum").value.trim(),
    adresse: $("#tx-adresse").value.trim(),
    langue: $("#tx-langue").value,
    sac: $("#tx-sac").value.trim(),
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_transaction`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json" },
      body: JSON.stringify({
        p_code: code, p_client: client,
        p_items: txItems, p_photos: txPhotos, p_total: txTotal(),
      }),
    });
    const ok = await res.json();
    if (ok === true) {
      toast("Transaction enregistrée");
      pushHistory({
        type: "lot", when: new Date().toISOString(),
        title: `Transaction — ${client.nom}`,
        ref: txItems.map((it) => it.label).join(" • "),
        guidePrice: txTotal(), realPrice: null,
      });
    } else {
      toast("Enregistrement refusé");
    }
  } catch { toast("Erreur réseau — transaction NON enregistrée"); }
}

function printTx() {
  const inv = $("#invoice");
  const now = new Date();
  const sums = {};
  for (const it of txItems) sums[it.cat] = (sums[it.cat] || 0) + it.amount;
  inv.innerHTML = `
    <div class="inv-head">
      <h1>ROAD MINERS</h1>
      <p>TRADE • VALUE • SECURITY</p>
      <h2>Facture d'achat comptoir</h2>
      <p>Date : ${now.toLocaleDateString("fr-CA")} ${now.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })}</p>
    </div>
    <div class="inv-block">
      <strong>Client</strong><br>
      Nom : ${escapeHtml($("#tx-nom").value.trim())}<br>
      Téléphone : ${escapeHtml($("#tx-tel").value.trim())} &nbsp;•&nbsp;
      Naissance : ${escapeHtml($("#tx-naissance").value)}<br>
      No pièce d'identité : ${escapeHtml($("#tx-idnum").value.trim())}<br>
      Adresse : ${escapeHtml($("#tx-adresse").value.trim())} &nbsp;•&nbsp;
      Langue : ${escapeHtml($("#tx-langue").value)} &nbsp;•&nbsp;
      No de sac : ${escapeHtml($("#tx-sac").value.trim())}
    </div>
    <table class="inv-table">
      <thead><tr><th>Article</th><th>Catégorie</th><th>Montant</th></tr></thead>
      <tbody>
        ${txItems.map((it) => `<tr><td>${escapeHtml(it.label)}</td><td>${escapeHtml(it.cat)}</td><td>${fmt(it.amount)}</td></tr>`).join("")}
      </tbody>
    </table>
    <div class="inv-block">
      ${Object.keys(sums).map((c) => `${c} : <strong>${fmt(sums[c])}</strong>`).join(" &nbsp;•&nbsp; ")}
    </div>
    <p class="inv-total">TOTAL PAYÉ : ${fmt(txTotal())}</p>
    ${txPhotos.length ? `<div class="inv-photos">${txPhotos.map((p) => `<img src="${p}">`).join("")}</div>` : ""}
    <p class="inv-legal">Encan International n'est aucunement responsable d'infractions à la loi sur l'impôt. Il est de votre devoir de déclarer tout gain en capital. Le client déclare être le propriétaire de la marchandise vendue ayant acquis celle-ci au courant de transactions légales.</p>
    <div class="inv-sign">
      <div>Signature du client</div>
      <div>Signature de l'employé</div>
    </div>`;
  window.print();
}

function resetTx() {
  if (txItems.length && !confirm("Vider la transaction en cours ?")) return;
  txItems = [];
  txPhotos = [];
  for (const id of ["tx-nom", "tx-tel", "tx-naissance", "tx-idnum", "tx-adresse", "tx-sac"]) {
    $("#" + id).value = "";
  }
  $("#tx-langue").value = "Français";
  $("#tx-free-label").value = "";
  $("#tx-free-amount").value = "";
  renderTx();
  renderTxPhotos();
}

/* ---------- Voyage (employé) ---------- */
const mapsUrl = (addr) =>
  "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(addr);
const telUrl = (tel) => "tel:" + (tel || "").replace(/[^0-9+]/g, "");

function tripDayCard(d, isToday) {
  const dateStr = new Date(d.date + "T12:00:00")
    .toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" });
  const block = (title, icon, o, conf) => {
    if (!o || !(o.name || o.city || o.addr)) return "";
    return `
      <div class="trip-block">
        <div class="carac-side-title">${icon} ${title}${o.city ? " — " + escapeHtml(o.city) : ""}</div>
        ${o.name ? `<div class="trip-name">${escapeHtml(o.name)}</div>` : ""}
        ${o.addr ? `<a class="btn-outline trip-map" href="${mapsUrl(o.addr)}" target="_blank" rel="noopener">&#128205; ${escapeHtml(o.addr)} — Itinéraire &nearr;</a>` : ""}
        <div class="trip-meta">
          ${o.tel ? `<a href="${telUrl(o.tel)}">&#128222; ${escapeHtml(o.tel)}</a>` : ""}
          ${o.urg ? `<a href="${telUrl(o.urg)}">URG ${escapeHtml(o.urg)}</a>` : ""}
          ${o.contact ? `<span>Contact : ${escapeHtml(o.contact)}</span>` : ""}
          ${conf && o.conf ? `<span>Conf : ${escapeHtml(o.conf)}</span>` : ""}
        </div>
      </div>`;
  };
  return `
    <div class="trip-day${isToday ? " trip-today" : ""}">
      ${isToday ? '<div class="verdict" style="margin-bottom:8px">AUJOURD\'HUI</div>' : ""}
      <div class="trip-date">${dateStr}</div>
      ${block("COUCHE", "&#127976;", d.hotel, true)}
      ${block("JOURNÉE D'ACHAT", "&#128184;", d.event, false)}
    </div>`;
}

async function loadMyTrips() {
  const content = $("#trip-content");
  const loginBox = $("#trip-login");
  let code = "";
  try { code = localStorage.getItem("roadminer_access") || ""; } catch {}
  if (!code) {
    loginBox.hidden = false;
    content.innerHTML = "";
    return;
  }
  loginBox.hidden = true;
  content.innerHTML = `<p class="hint-note">Chargement de votre voyage…</p>`;
  let trips = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_trip`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: code }),
    });
    trips = await res.json();
  } catch {}
  if (!Array.isArray(trips) || !trips.length) {
    content.innerHTML = `<div class="detail-card"><p class="hint-note" style="margin:0">Aucun voyage assigné à ce code pour l'instant.</p></div>`;
    return;
  }
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  content.innerHTML = trips.map((tr) => {
    const others = (tr.employees || []).filter((e) => e.code !== code.toUpperCase());
    const days = (tr.days || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    // le jour courant toujours en premier, puis à venir, puis passés
    const todayDays = days.filter((d) => d.date === todayStr);
    const future = days.filter((d) => d.date > todayStr);
    const past = days.filter((d) => d.date < todayStr);
    const ordered = [...todayDays, ...future, ...past];
    return `
      <div class="detail-card" style="margin-bottom:16px">
        <h2 style="font-size:17px">${escapeHtml(tr.title || "Voyage")}</h2>
        ${others.length ? `<p class="detail-ref">Avec : ${others.map((e) => escapeHtml(e.label || e.code)).join(" + ")}</p>` : ""}
        ${ordered.map((d) => tripDayCard(d, d.date === todayStr)).join("")}
      </div>`;
  }).join("");
}

/* ---------- Historique ---------- */
const HIST_KEY = "roadminer_history";

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; }
  catch { return []; }
}

function pushHistory(record) {
  const hist = getHistory();
  hist.unshift(record);
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 100)));
    return true;
  } catch {
    delete record.photos;
    delete record.photo;
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 50)));
      toast("Enregistré (mémoire pleine)");
      return true;
    } catch { toast("Erreur : mémoire pleine"); return false; }
  }
}

function saveEvaluation() {
  if (!currentItem) return;
  if (pushHistory({
    type: "item",
    when: new Date().toISOString(),
    title: entryTitle(currentItem),
    ref: entryRef(currentItem),
    guidePrice: currentItem.price,
    realPrice: parseFloat($("#realprice").value) || null,
  })) toast("Évaluation enregistrée");
}

function renderHistory() {
  const ul = $("#history-list");
  const hist = getHistory();
  ul.innerHTML = "";
  $("#history-empty").style.display = hist.length ? "none" : "block";
  for (const h of hist) {
    const li = document.createElement("li");
    const d = new Date(h.when);
    li.innerHTML = `
      ${h.photo ? `<img src="${h.photo}" style="width:100%;border-radius:8px;margin-bottom:8px">` : ""}
      <div><strong>${escapeHtml(h.title)}</strong>${h.type === "lot" ? ' <span class="badge-cat">lot</span>' : ""}</div>
      <div class="h-date">${escapeHtml(h.ref || "")}</div>
      <div>Guide : <span class="h-price">${h.guidePrice != null ? fmt(h.guidePrice) : "—"}</span>
      ${h.realPrice != null ? ` • Réel : <span class="h-price">${fmt(h.realPrice)}</span>` : ""}</div>
      <div class="h-date">${d.toLocaleDateString("fr-CA")} ${d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })}</div>`;
    ul.appendChild(li);
  }
}

/* ---------- Navigation ---------- */
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("#" + id).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === id));
  if (id === "view-history") renderHistory();
  if (id === "view-trip") loadMyTrips();
}

/* ---------- Événements ---------- */
function bindEvents() {
  const input = $("#search-input");
  let debounce;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderResults(search(input.value), input.value.trim()), 120);
  });
  $("#btn-clear").addEventListener("click", () => {
    input.value = "";
    renderResults([], "");
    input.focus();
  });
  document.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      input.value = c.dataset.q;
      renderResults(search(c.dataset.q), c.dataset.q);
    }));

  $("#btn-back").addEventListener("click", () => showView("view-search"));
  $("#realprice").addEventListener("input", updateMargin);
  $("#btn-save").addEventListener("click", saveEvaluation);

  $("#btn-add-material").addEventListener("click", () => {
    meltRows.push({ mat: defaultMatIndex(), grams: "", pct: 100 });
    renderMeltRows();
    updateMeltV2();
    const inputs = document.querySelectorAll(".melt-g");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  const customInp = $("#custom-pct");
  try { customInp.value = localStorage.getItem("roadminer_custompct") || ""; } catch {}
  customInp.addEventListener("input", () => {
    localStorage.setItem("roadminer_custompct", customInp.value);
    updateCustomPct(customPctBase);
  });
  const customPaid = $("#custom-paid");
  try { customPaid.value = localStorage.getItem("roadminer_custompaid") || ""; } catch {}
  customPaid.addEventListener("input", () => {
    try { localStorage.setItem("roadminer_custompaid", customPaid.value); } catch {}
    updateCustomPct(customPctBase);
  });

  // valeur faciale : poids total (g) ÷ 23,32 g = valeur faciale ($) ; × multiplicateur = prix
  const faceInp = $("#face-grams");
  const faceMult = $("#face-mult");
  try { faceMult.value = localStorage.getItem("roadminer_facemult") || ""; } catch {}
  const updateFace = () => {
    const g = parseFloat(faceInp.value);
    const face = (!isNaN(g) && g > 0) ? g / 23.32 : null;
    $("#face-result").textContent = face != null
      ? face.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $ facial"
      : "—";
    const m = parseFloat(faceMult.value);
    $("#face-mult-result").textContent = (face != null && !isNaN(m) && m > 0)
      ? fmt(face * m)
      : "—";
    $("#face-to-tx").hidden = !(face != null && !isNaN(m) && m > 0);
  };
  faceInp.addEventListener("input", updateFace);
  faceMult.addEventListener("input", () => {
    try { localStorage.setItem("roadminer_facemult", faceMult.value); } catch {}
    updateFace();
  });

  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view)));

  // écran de blocage
  $("#blocker-go").addEventListener("click", submitBlockerCode);
  $("#blocker-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitBlockerCode();
  });

  // transaction
  $("#tx-free-cat").innerHTML = TX_CATS.map((c) => `<option>${c}</option>`).join("");
  try { $("#tx-emp").value = localStorage.getItem("roadminer_access") || ""; } catch {}
  $("#tx-add-free").addEventListener("click", () => {
    const label = $("#tx-free-label").value.trim();
    const amount = parseFloat($("#tx-free-amount").value);
    if (!label || !(amount > 0)) { toast("Libellé et montant requis"); return; }
    addTxItem(label, $("#tx-free-cat").value, amount);
    $("#tx-free-label").value = "";
    $("#tx-free-amount").value = "";
  });
  $("#tx-photo-btn").addEventListener("click", () => $("#tx-photo-input").click());
  $("#tx-photo-input").addEventListener("change", (ev) => {
    handleTxPhotos(ev.target.files);
    ev.target.value = "";
  });
  $("#tx-save").addEventListener("click", saveTx);
  $("#tx-print").addEventListener("click", printTx);
  $("#tx-reset").addEventListener("click", resetTx);
  $("#melt-to-tx").addEventListener("click", sendMeltToTx);
  $("#agc-to-tx").addEventListener("click", sendAgcToTx);
  $("#face-to-tx").addEventListener("click", sendFaceToTx);
  $("#btn-add-tx").addEventListener("click", addDetailToTx);

  // voyage employé
  $("#trip-code-btn").addEventListener("click", async () => {
    const code = $("#trip-code").value.trim();
    if (!code) return;
    try {
      const role = await verifyAccessCode(code);
      if (role === "denied") { toast("Code invalide ou révoqué"); return; }
      localStorage.setItem("roadminer_access", code);
      loadMyTrips();
    } catch { toast("Connexion impossible — réessayez"); }
  });
  $("#trip-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#trip-code-btn").click();
  });

  $("#btn-clear-history").addEventListener("click", () => {
    if (confirm("Vider tout l'historique ?")) {
      localStorage.removeItem(HIST_KEY);
      renderHistory();
      toast("Historique vidé");
    }
  });
}

/* ---------- Contrôle d'accès (blocage du site via admin) ---------- */
async function verifyAccessCode(code) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_access`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_code: code }),
  });
  return res.ok ? await res.json() : "denied"; // 'guest' | 'admin' | 'denied'
}

async function checkAccess() {
  if (typeof SUPABASE_ANON_KEY === "undefined" || !SUPABASE_ANON_KEY) return;
  const overlay = $("#blocker");
  let blocked = false, message = "";
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_control?id=eq.1&select=blocked,message`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY },
        cache: "no-store" });
    const rows = await res.json();
    blocked = !!(rows && rows[0] && rows[0].blocked);
    message = (rows && rows[0] && rows[0].message) || "";
  } catch { return; } // réseau en panne : ne pas bloquer
  if (!blocked) { overlay.hidden = true; return; }
  const saved = localStorage.getItem("roadminer_access") || "";
  if (saved) {
    try {
      if ((await verifyAccessCode(saved)) !== "denied") { overlay.hidden = true; return; }
    } catch { overlay.hidden = true; return; } // RPC injoignable : ne pas piéger l'utilisateur
    localStorage.removeItem("roadminer_access"); // code révoqué
  }
  if (message) $("#blocker-msg").textContent = message;
  overlay.hidden = false;
  setTimeout(() => $("#blocker-code").focus(), 100);
}

async function submitBlockerCode() {
  const inp = $("#blocker-code");
  const err = $("#blocker-err");
  const code = inp.value.trim();
  if (!code) return;
  err.textContent = "Vérification…";
  try {
    const role = await verifyAccessCode(code);
    if (role === "denied") {
      err.textContent = "Code invalide ou révoqué.";
      inp.select();
      return;
    }
    localStorage.setItem("roadminer_access", code);
    $("#blocker").hidden = true;
    showWelcome(role);
  } catch {
    err.textContent = "Connexion impossible — réessayez.";
  }
}

/* ---------- Bienvenue après code valide : message + paillettes ---------- */
function showWelcome(role) {
  const ov = $("#welcome");
  if (!ov) return;
  $("#welcome-title").textContent = role === "admin" ? "Bienvenue, boss !" : "Bienvenue !";
  $("#welcome-sub").textContent = role === "admin"
    ? "Que tes trouvailles du jour soient en or. Bonne journée !"
    : "Bonne chasse aux trésors — que tes trouvailles brillent comme l'or, l'argent et le diamant !";
  ov.hidden = false;
  ov.classList.remove("welcome-out");
  const close = () => {
    if (ov.hidden) return;
    ov.classList.add("welcome-out");
    setTimeout(() => { ov.hidden = true; }, 450);
  };
  ov.onclick = close; // toucher pour passer
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setTimeout(close, 1800);
    return;
  }
  const cv = $("#welcome-fx");
  const ctx = cv.getContext("2d");
  cv.width = innerWidth;
  cv.height = innerHeight;
  // or, or clair, argent, argent clair, diamant bleuté, blanc
  const COLORS = [[212,175,55],[242,213,126],[192,192,205],[232,232,240],[191,239,255],[255,255,255]];
  const parts = [];
  for (let i = 0; i < 110; i++) {
    parts.push({
      x: Math.random() * cv.width,
      y: -20 - Math.random() * cv.height * 0.5,
      r: 1.5 + Math.random() * 3.5,
      vy: 1.2 + Math.random() * 2.6,
      vx: (Math.random() - 0.5) * 1.2,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
      tw: Math.random() * Math.PI * 2,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      star: Math.random() < 0.25, // éclats en croix = diamant
    });
  }
  const t0 = performance.now();
  (function tick(t) {
    const el = (t - t0) / 1000;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx + Math.sin(el * 2 + p.tw) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > cv.height + 20) { p.y = -20; p.x = Math.random() * cv.width; }
      const alpha = Math.max(0, Math.min(1, 1.4 - el / 2.2)) * (0.55 + 0.45 * Math.sin(el * 6 + p.tw));
      const [r, g, b] = p.c;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.star) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-p.r * 2.2, 0); ctx.lineTo(p.r * 2.2, 0);
        ctx.moveTo(0, -p.r * 2.2); ctx.lineTo(0, p.r * 2.2);
        ctx.stroke();
      } else {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r * 2);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(0.4, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, p.r * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (el < 2.6 && !ov.hidden) requestAnimationFrame(tick);
    else close();
  })(t0);
}

/* ---------- Service worker ---------- */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  // rechargement automatique quand une NOUVELLE version prend le contrôle
  // (pas à la première installation : pas de contrôleur existant)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
}

/* ---------- Installation PWA ---------- */
let deferredInstall = null;

function initInstall() {
  const btn = $("#btn-install");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInstalled = matchMedia("(display-mode: standalone)").matches
    || navigator.standalone === true;

  if (isInstalled) { btn.hidden = true; return; }

  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    btn.hidden = false;
  });

  addEventListener("appinstalled", () => {
    btn.hidden = true;
    deferredInstall = null;
    toast("ROAD MINERS installée !");
  });

  btn.addEventListener("click", async () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      const choice = await deferredInstall.userChoice;
      if (choice.outcome === "accepted") btn.hidden = true;
      deferredInstall = null;
    } else if (isIOS) {
      alert("Pour installer ROAD MINERS sur iPhone :\n\n1. Touche le bouton Partager (carré avec flèche)\n2. Choisis « Sur l'écran d'accueil »\n3. Touche « Ajouter »");
    } else {
      alert("Pour installer ROAD MINERS :\n\n• Chrome/Edge : icône d'installation dans la barre d'adresse\n• ou menu ⋮ → « Installer l'application »");
    }
  });
}

/* ---------- Init ---------- */
(async function init() {
  loadNumistaMap(); // en parallèle, non bloquant
  bindEvents();     // interface interactive TOUT DE SUITE
  const dataReady = loadData(); // base en arrière-plan, sans bloquer l'affichage
  loadSpot();                    // cours en direct
  setInterval(loadSpot, 60000);  // rafraîchissement chaque minute
  setInterval(updateLiveSince, 1000); // compteur LIVE « il y a X s »
  initGoldFx();                  // effet pluie d'or
  initBgFx();                    // arrière-plan animé
  addEventListener("resize", () => drawSpotChart());
  initInstall();                 // bouton d'installation PWA
  initTheme();                   // thème clair / sombre
  initCoinDrag();                // pièce 3D manipulable
  registerSW();
  checkAccess();                 // blocage éventuel du site (admin)
  setInterval(checkAccess, 60000);
  await dataReady;
  // si l'utilisateur a déjà tapé une recherche pendant le chargement, l'afficher
  const q = $("#search-input").value.trim();
  if (q) renderResults(search(q), q);
})();
