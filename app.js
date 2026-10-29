/* ===== ROAD MINER — logique applicative ===== */
"use strict";

const PERCENTS = [5, 10, 15, 25, 35, 50, 75, 100];
const MAX_RESULTS = 60;

let DB = { entries: [], notes: [] };
let currentItem = null;
let currentPhoto = null; // dataURL (vue détail)
let lot = [];            // [{photo: dataURL, entry: null|obj}]
let pickerTarget = -1;   // index du lot en cours d'identification
let stream = null;       // flux caméra

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

function guidePageUrl(e) {
  const p = String(e.page).padStart(3, "0");
  return e.source === "catalogue" ? `pages2/p2-${p}.png` : `pages/page-${p}.png`;
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
  $("#quick-hints").style.display = query ? "none" : "block";
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

/* ---------- Détail ---------- */
function openDetail(e) {
  currentItem = e;
  currentPhoto = null;
  $("#photo-preview").hidden = true;
  $("#photo-input").value = "";
  $("#realprice").value = "";
  $("#margin-info").textContent = "";

  const isCatalog = e.source === "catalogue";
  const verdict = $("#verdict");
  verdict.textContent = isCatalog ? "VALEUR CATALOGUE" : "ON PREND";
  verdict.classList.remove("no");
  verdict.classList.toggle("info", isCatalog);
  $("#detail-price-label").textContent = isCatalog ? "Valeur catalogue (marchande)" : "Prix d'achat du guide";
  $("#detail-title").textContent = entryTitle(e);
  $("#detail-ref").textContent = entryRef(e) + (e.page ? `  •  ${isCatalog ? "Catalogue" : "Guide"} p. ${e.page}` : "");
  $("#detail-price").textContent = e.price != null ? fmt(e.price) : "—";
  $("#guide-page-link").href = guidePageUrl(e);

  const tiers = $("#tiers");
  tiers.innerHTML = "";
  for (const p of PERCENTS) {
    const div = document.createElement("div");
    div.className = "tier" + (p === 100 ? " full" : "");
    const val = e.price != null ? (e.price * p) / 100 : null;
    div.innerHTML = `<span class="pct">${p} %</span><span class="val">${val != null ? fmt(val) : "—"}</span>`;
    tiers.appendChild(div);
  }

  const q = encodeURIComponent(entryTitle(e) + " " + (e.series || ""));
  $("#pricecharting-link").href = "https://www.pricecharting.com/search-products?q=" + q;

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

/* ---------- Photo (vue détail) ---------- */
function shrinkImage(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function handlePhoto(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      currentPhoto = shrinkImage(img, 900, 0.7);
      const prev = $("#photo-preview");
      prev.src = currentPhoto;
      prev.hidden = false;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ---------- Caméra / Scanner ---------- */
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    $("#cam").srcObject = stream;
    $("#cam-off").style.display = "none";
  } catch (err) {
    console.warn("caméra", err);
    $("#cam-off").style.display = "grid";
    toast("Caméra inaccessible — vérifiez les permissions du navigateur");
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

function capturePhoto() {
  const video = $("#cam");
  if (!stream || !video.videoWidth) { toast("Activez la caméra d'abord"); return; }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const img = new Image();
  img.onload = () => {
    lot.push({ photo: shrinkImage(img, 900, 0.7), entry: null });
    renderLot();
    toast("Photo ajoutée au lot");
  };
  img.src = canvas.toDataURL("image/jpeg", 0.9);
}

/* ---------- Lot ---------- */
function renderLot() {
  const zone = $("#lot-list");
  $("#lot-count").textContent = lot.length;
  $("#lot-hint").style.display = lot.length ? "none" : "block";
  zone.innerHTML = "";

  lot.forEach((item, i) => {
    const card = document.createElement("div");
    card.className = "lot-item" + (item.entry ? " matched" : "");
    const e = item.entry;
    card.innerHTML = `
      <img src="${item.photo}" class="lot-thumb" alt="photo ${i + 1}">
      <div class="lot-info">
        ${e
          ? `<div class="lot-title">${escapeHtml(entryTitle(e))}</div>
             <div class="lot-sub">${escapeHtml(entryRef(e))}</div>
             <div class="lot-price">${e.price != null ? fmt(e.price) : "—"}</div>`
          : `<div class="lot-title unidentified">Non identifié — toucher pour identifier</div>`}
      </div>
      <button class="lot-del" data-i="${i}" aria-label="Retirer">&times;</button>`;
    card.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("lot-del")) {
        lot.splice(i, 1);
        renderLot();
        return;
      }
      openPicker(i);
    });
    zone.appendChild(card);
  });

  const matched = lot.filter((it) => it.entry && it.entry.price != null);
  const totalsZone = $("#lot-totals-zone");
  if (matched.length) {
    totalsZone.hidden = false;
    const total = matched.reduce((s, it) => s + it.entry.price, 0);
    const tiers = $("#lot-tiers");
    tiers.innerHTML = "";
    for (const p of PERCENTS) {
      const div = document.createElement("div");
      div.className = "tier" + (p === 100 ? " full" : "");
      div.innerHTML = `<span class="pct">${p} %</span><span class="val">${fmt(total * p / 100)}</span>`;
      tiers.appendChild(div);
    }
  } else {
    totalsZone.hidden = true;
  }
}

/* ---------- Modal d'identification ---------- */
function openPicker(i) {
  pickerTarget = i;
  $("#picker-photo").src = lot[i].photo;
  $("#picker-input").value = "";
  $("#picker-results").innerHTML = "";
  $("#picker").hidden = false;
  setTimeout(() => $("#picker-input").focus(), 50);
}

function closePicker() {
  $("#picker").hidden = true;
  pickerTarget = -1;
}

function pickerSearch(q) {
  const ul = $("#picker-results");
  ul.innerHTML = "";
  if (!q.trim()) return;
  for (const e of search(q)) {
    ul.appendChild(resultItem(e, (entry) => {
      if (pickerTarget >= 0) {
        lot[pickerTarget].entry = entry;
        renderLot();
      }
      closePicker();
    }));
  }
}

/* ---------- Cours en direct + calculateur de fonte ---------- */
let SPOT = null; // {updated, materials, spot, usdcad}
const METAL_LABELS = [["XAU", "Or"], ["XAG", "Argent"], ["XPT", "Platine"], ["XPD", "Palladium"]];

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

function renderSpotTicker() {
  const el = $("#spot-ticker");
  if (!SPOT || !SPOT.spot) { el.innerHTML = ""; return; }
  let when = "";
  if (SPOT.updated) {
    const d = new Date(SPOT.updated);
    if (!isNaN(d)) when = " · " + d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  el.innerHTML = METAL_LABELS.map(([k, label]) => {
    const m = SPOT.spot[k];
    if (!m || !m.usd_oz) return "";
    return `<div class="spot-chip"><span class="spot-name">${label}</span>
      <span class="spot-usd">${fmt(m.usd_oz)} <small>US/oz</small></span>
      <span class="spot-cad">${fmt(m.cad_oz)} <small>CA/oz</small></span></div>`;
  }).join("") + `<div class="spot-when">Cours en direct${when}</div>`;
}

/* --- Calculateur multi-matériaux --- */
let meltRows = [{ mat: 0, grams: "" }];

function materialOptions(selIdx) {
  return SPOT.materials
    .map((m, i) => `<option value="${i}"${i === selIdx ? " selected" : ""}>${m.name}</option>`)
    .join("");
}

function saveMeltRows() {
  try { localStorage.setItem("roadminer_meltrows", JSON.stringify(meltRows)); } catch {}
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
      <span class="melt-val" id="melt-val-${i}">—</span>
      ${meltRows.length > 1 ? `<button class="lot-del melt-del" data-i="${i}" aria-label="Retirer">&times;</button>` : `<span></span>`}
      <div class="melt-pcts" id="melt-pcts-${i}"></div>`;
    zone.appendChild(div);
  });
  zone.querySelectorAll(".melt-mat").forEach((s) =>
    s.addEventListener("change", (e) => {
      meltRows[+e.target.dataset.i].mat = +e.target.value;
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
  const m = SPOT.materials[row.mat] || SPOT.materials[0];
  const g = parseFloat(row.grams) || 0;
  const tier = m.tiers.reduce((best, t) => (g >= t.min_g ? t : best), m.tiers[0]);
  const per = tier.individual; // référence : prix NON-WHOLESALE Kitco
  return { per, val: per * g, g };
}

function updateMeltV2() {
  if (!SPOT || !SPOT.materials || !SPOT.materials.length) return;
  let total = 0, anyVal = false, details = [];
  meltRows.forEach((row, i) => {
    const { per, val, g } = meltRowValue(row);
    const span = $("#melt-val-" + i);
    if (span) {
      // prix AU GRAMME toujours visible ; total de la ligne dès qu'un poids est entré
      span.innerHTML = val > 0
        ? `${fmt(val)}<small>${fmt(per)}/g</small>`
        : `<small>${fmt(per)}/g</small>`;
    }
    // pourcentages à côté de chaque ligne
    const pcts = $("#melt-pcts-" + i);
    if (pcts) {
      pcts.innerHTML = val > 0
        ? PERCENTS.map((p) =>
            `<span class="mp"><b>${p} %</b> ${fmt(val * p / 100)}</span>`).join("")
        : "";
    }
    if (val > 0) {
      anyVal = true;
      details.push(`${fmt(per)}/g × ${g} g`);
    }
    total += val;
  });
  $("#melt-result").innerHTML = anyVal
    ? `<span class="melt-total-label">TOTAL (100 % = prix Non-Wholesale Kitco)</span> <strong class="melt-total">${fmt(total)}</strong><br><span class="hint-note">${details.join(" + ")}</span>`
    : `Entrez le poids en grammes de chaque matériau.`;
  const tiers = $("#melt-tiers");
  tiers.innerHTML = "";
  if (anyVal) {
    if (total !== updateMeltV2._lastTotal) goldBurst(); // pluie d'or
    updateMeltV2._lastTotal = total;
    for (const p of PERCENTS) {
      const div = document.createElement("div");
      div.className = "tier" + (p === 100 ? " full" : "");
      div.innerHTML = `<span class="pct">${p} %</span><span class="val">${fmt(total * p / 100)}</span>`;
      tiers.appendChild(div);
    }
  } else {
    updateMeltV2._lastTotal = 0;
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

/* ---------- Graphique d'évolution (derrière les cours) ---------- */
function drawSpotChart() {
  const cv = $("#spot-chart");
  if (!cv || !SPOT) return;
  cv.width = innerWidth;
  cv.height = innerHeight;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

  let hist = SPOT.history || {};
  // secours : accumulation locale d'échantillons au fil des rafraîchissements
  if (!Object.values(hist).some((s) => s && s.length >= 4)) {
    try {
      const acc = JSON.parse(localStorage.getItem("roadminer_hist")) || [];
      if (SPOT.spot?.XAU?.usd_oz) {
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

  const colors = { XAU: "212,175,55", XAG: "200,200,210", XPT: "150,220,200", XPD: "230,170,120" };
  for (const [metal, pts] of Object.entries(hist)) {
    if (!pts || pts.length < 3) continue;
    const vals = pts.map((p) => p[1]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - 6 - ((p[1] - min) / span) * (h - 14);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = `rgba(${colors[metal] || "212,175,55"}, .55)`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // zone dégradée sous la courbe
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${colors[metal] || "212,175,55"}, .10)`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fill();
  }
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
      toast("Enregistré (sans photo, mémoire pleine)");
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
    photo: currentPhoto,
  })) toast("Évaluation enregistrée");
}

function saveLot() {
  if (!lot.length) return;
  const matched = lot.filter((it) => it.entry);
  const total = matched.reduce((s, it) => s + (it.entry.price || 0), 0);
  if (pushHistory({
    type: "lot",
    when: new Date().toISOString(),
    title: `Lot de ${lot.length} article(s)`,
    ref: matched.map((it) => entryTitle(it.entry)).join(" • "),
    guidePrice: total,
    realPrice: null,
    photo: lot[0].photo,
  })) toast("Lot enregistré");
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
  if (id === "view-scan" && !stream) startCamera();
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
  $("#btn-photo").addEventListener("click", () => $("#photo-input").click());
  $("#photo-input").addEventListener("change", (ev) => handlePhoto(ev.target.files[0]));
  $("#realprice").addEventListener("input", updateMargin);
  $("#btn-save").addEventListener("click", saveEvaluation);

  // scanner
  $("#btn-cam-on").addEventListener("click", startCamera);
  $("#btn-capture").addEventListener("click", capturePhoto);
  $("#btn-save-lot").addEventListener("click", saveLot);
  $("#btn-clear-lot").addEventListener("click", () => {
    if (confirm("Vider le lot en cours ?")) { lot = []; renderLot(); }
  });
  $("#btn-add-material").addEventListener("click", () => {
    meltRows.push({ mat: 0, grams: "" });
    renderMeltRows();
    updateMeltV2();
    const inputs = document.querySelectorAll(".melt-g");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  // modal identification
  $("#picker-close").addEventListener("click", closePicker);
  $("#picker-skip").addEventListener("click", closePicker);
  let pickerDebounce;
  $("#picker-input").addEventListener("input", (ev) => {
    clearTimeout(pickerDebounce);
    pickerDebounce = setTimeout(() => pickerSearch(ev.target.value), 120);
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

/* ---------- Init ---------- */
(async function init() {
  await loadData();
  bindEvents();
  loadSpot();                    // cours en direct
  setInterval(loadSpot, 300000); // rafraîchissement toutes les 5 min
  initGoldFx();                  // effet pluie d'or
  initBgFx();                    // arrière-plan animé
  addEventListener("resize", () => drawSpotChart());
  registerSW();
  startCamera(); // la caméra s'active dès l'ouverture
})();
