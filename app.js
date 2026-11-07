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
      <div class="melt-pcts" id="melt-pcts-${i}"></div>
      <div class="melt-paid-row">
        <label for="melt-paid-${i}">Payé</label>
        <input class="melt-paid" id="melt-paid-${i}" data-i="${i}" type="number" min="0" step="0.01" placeholder="montant $" value="${row.paid ?? ""}" aria-label="Montant payé">
        <span class="melt-paid-pct" id="melt-paid-pct-${i}"></span>
      </div>`;
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
  zone.querySelectorAll(".melt-paid").forEach((s) =>
    s.addEventListener("input", (e) => {
      meltRows[+e.target.dataset.i].paid = e.target.value;
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
    // montant payé → pourcentage réel par rapport au 100 % Kitco de la ligne
    const paidOut = $("#melt-paid-pct-" + i);
    if (paidOut) {
      const paid = parseFloat(row.paid);
      paidOut.textContent = (!isNaN(paid) && paid > 0 && val100 > 0)
        ? `≈ ${(paid / val100 * 100).toFixed(1)} %`
        : "";
    }
    total += val;
    total100 += val100;
  });
  // % personnalisé (uniquement sur le total de référence 100 % Kitco)
  $("#custom-pct-zone").hidden = !anyVal;
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

  // valeur faciale : poids total (g) ÷ 23,32 g = valeur faciale ($)
  const faceInp = $("#face-grams");
  faceInp.addEventListener("input", () => {
    const g = parseFloat(faceInp.value);
    $("#face-result").textContent = (!isNaN(g) && g > 0)
      ? (g / 23.32).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $ facial"
      : "—";
  });

  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view)));

  $("#btn-clear-history").addEventListener("click", () => {
    if (confirm("Vider tout l'historique ?")) {
      localStorage.removeItem(HIST_KEY);
      renderHistory();
      toast("Historique vidé");
    }
  });
}

/* ---------- Service worker ---------- */
function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  }
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
  await loadData();
  bindEvents();
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
})();
