/* ===== ROAD MINERS — page d'administration ===== */
"use strict";

const $ = (sel) => document.querySelector(sel);
let ADMIN = "";
let CODES = [];

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2200);
}

const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
};

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error("rpc " + res.status);
  return res.json();
}

/* ---------- Connexion ---------- */
async function login() {
  const code = $("#adm-code").value.trim();
  const err = $("#adm-err");
  if (!code) return;
  err.textContent = "Vérification…";
  try {
    const role = await rpc("verify_access", { p_code: code });
    if (role !== "admin") {
      err.textContent = "Code administrateur invalide.";
      return;
    }
    ADMIN = code.toUpperCase();
    sessionStorage.setItem("roadminer_admin", ADMIN);
    showDash();
  } catch {
    err.textContent = "Connexion impossible — réessayez.";
  }
}
async function tryRestore() {
  const saved = sessionStorage.getItem("roadminer_admin") || "";
  if (!saved) return;
  try {
    if ((await rpc("verify_access", { p_code: saved })) === "admin") {
      ADMIN = saved;
      showDash();
    } else {
      sessionStorage.removeItem("roadminer_admin");
    }
  } catch { /* réseau : l'utilisateur reconnectera */ }
}

function showDash() {
  $("#adm-login").hidden = true;
  $("#adm-dash").hidden = false;
  refreshStatus();
  loadCodes();
  loadTx();
  loadTrips();
  loadStats();
}

/* ---------- Statut du site ---------- */
async function refreshStatus() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_control?id=eq.1&select=blocked,message,updated_at`,
      { headers: HEADERS, cache: "no-store" });
    const row = (await res.json())[0] || {};
    const badge = $("#adm-status-badge");
    const blocked = !!row.blocked;
    badge.textContent = blocked ? "SITE BLOQUÉ" : "SITE EN LIGNE";
    badge.classList.toggle("no", blocked);
    badge.classList.toggle("info", !blocked);
    $("#adm-status-when").textContent = row.updated_at
      ? "Modifié le " + new Date(row.updated_at).toLocaleString("fr-CA")
      : "";
    $("#adm-msg").value = row.message || "";
    $("#adm-toggle").textContent = blocked ? "Débloquer le site" : "Bloquer le site";
  } catch {
    $("#adm-status-badge").textContent = "ERREUR RÉSEAU";
  }
}

async function setBlocked(blocked) {
  const msg = $("#adm-msg").value.trim();
  const label = blocked ? "bloquer" : "débloquer";
  if (!confirm(`Voulez-vous vraiment ${label} le site ?`)) return;
  const ok = await rpc("admin_set_blocked", { p_admin: ADMIN, p_blocked: blocked, p_message: msg || null });
  if (ok) {
    toast(blocked ? "Site bloqué" : "Site débloqué");
    refreshStatus();
  } else {
    toast("Action refusée");
  }
}

/* ---------- Codes d'accès ---------- */
async function loadCodes() {
  const box = $("#adm-codes");
  try {
    const codes = await rpc("admin_list_codes", { p_admin: ADMIN });
    CODES = codes || [];
    if (!codes || !codes.length) {
      box.innerHTML = `<p class="hint-note">Aucun code.</p>`;
      return;
    }
    box.innerHTML = "";
    for (const c of codes) {
      const row = document.createElement("div");
      row.className = "code-row";
      row.innerHTML = `
        <div class="code-main">
          <strong>${escapeHtml(c.code)}</strong>
          <span class="badge-cat">${c.role === "admin" ? "admin" : "invité"}</span>
          ${c.active ? "" : '<span class="badge-off">révoqué</span>'}
          <small>${escapeHtml(c.label || "")} · créé le ${new Date(c.created_at).toLocaleDateString("fr-CA")}</small>
        </div>
        <button class="btn-outline code-toggle">${c.active ? "Révoquer" : "Réactiver"}</button>
        <button class="row-del code-del" aria-label="Supprimer">&times;</button>`;
      row.querySelector(".code-toggle").addEventListener("click", async () => {
        const ok = await rpc("admin_set_active", { p_admin: ADMIN, p_code: c.code, p_active: !c.active });
        toast(ok ? (c.active ? "Code révoqué" : "Code réactivé") : "Action refusée");
        loadCodes();
      });
      row.querySelector(".code-del").addEventListener("click", async () => {
        if (!confirm(`Supprimer définitivement le code ${c.code} ?`)) return;
        const ok = await rpc("admin_delete_code", { p_admin: ADMIN, p_code: c.code });
        toast(ok ? "Code supprimé" : "Refusé (dernier admin actif ?)");
        loadCodes();
      });
      box.appendChild(row);
    }
  } catch {
    box.innerHTML = `<p class="hint-note">Erreur de chargement.</p>`;
  }
}

async function addCode() {
  const code = $("#adm-new-code").value.trim();
  const label = $("#adm-new-label").value.trim();
  const role = $("#adm-new-role").value;
  if (code.length < 4) { toast("Code trop court (4 caractères min.)"); return; }
  const ok = await rpc("admin_add_code", { p_admin: ADMIN, p_code: code, p_label: label, p_role: role });
  if (ok) {
    toast("Code ajouté : " + code.toUpperCase());
    $("#adm-new-code").value = "";
    $("#adm-new-label").value = "";
    loadCodes();
  } else {
    toast("Action refusée");
  }
}

/* ---------- Transactions + statistiques + export ---------- */
let TXS = [];

const money2 = (n) => Number(n || 0).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
const txDate = (t) => new Date(t.created_at);

function renderTxStats() {
  const box = $("#adm-tx-stats");
  if (!TXS.length) { box.innerHTML = `<p class="hint-note">Aucune transaction pour l'instant.</p>`; return; }
  const now = Date.now(), D = 86400000;
  const since = (ms) => TXS.filter((t) => now - txDate(t).getTime() < ms);
  const sum = (arr) => arr.reduce((s, t) => s + Number(t.total || 0), 0);
  const today = since(D), week = since(7 * D), month = since(30 * D);
  let html = `
    <div class="tx-stat-grid">
      <div class="tx-stat"><small>AUJOURD'HUI</small><strong>${money2(sum(today))}</strong><span>${today.length} transaction(s)</span></div>
      <div class="tx-stat"><small>7 JOURS</small><strong>${money2(sum(week))}</strong><span>${week.length} transaction(s)</span></div>
      <div class="tx-stat"><small>30 JOURS</small><strong>${money2(sum(month))}</strong><span>${month.length} transaction(s)</span></div>
      <div class="tx-stat"><small>TOTAL</small><strong>${money2(sum(TXS))}</strong><span>${TXS.length} au registre</span></div>
    </div>`;
  const perEmp = {};
  for (const t of TXS) {
    const k = t.seller_code || "—";
    perEmp[k] = perEmp[k] || { n: 0, sum: 0 };
    perEmp[k].n++;
    perEmp[k].sum += Number(t.total || 0);
  }
  html += `<div class="carac-side-title" style="margin-top:14px">PAR EMPLOYÉ</div>` +
    Object.entries(perEmp).sort((a, b) => b[1].sum - a[1].sum).map(([k, v]) =>
      `<div class="carac-row"><span class="carac-k">${escapeHtml(k)} (${v.n})</span><span class="carac-v">${money2(v.sum)}</span></div>`).join("");
  const perCat = {};
  for (const t of TXS) for (const it of (t.items || [])) {
    perCat[it.cat] = (perCat[it.cat] || 0) + Number(it.amount || 0);
  }
  const cats = Object.entries(perCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    html += `<div class="carac-side-title" style="margin-top:14px">PAR CATÉGORIE</div>` +
      cats.map(([k, v]) =>
        `<div class="carac-row"><span class="carac-k">${escapeHtml(k)}</span><span class="carac-v">${money2(v)}</span></div>`).join("");
  }
  box.innerHTML = html;
}

async function loadTx() {
  const box = $("#adm-tx");
  try {
    TXS = (await rpc("admin_list_transactions", { p_admin: ADMIN })) || [];
    renderTxStats();
    if (!TXS.length) {
      box.innerHTML = `<p class="hint-note">Aucune transaction enregistrée.</p>`;
      return;
    }
    box.innerHTML = "";
    TXS.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "code-row tx-row-link";
      row.innerHTML = `
        <div class="code-main">
          <strong style="letter-spacing:0">${escapeHtml((t.client && t.client.nom) || "—")}</strong>
          <small>${txDate(t).toLocaleString("fr-CA")} · ${escapeHtml(t.seller_code)} · ${(t.items || []).length} article(s) · ${t.nb_photos} photo(s)</small>
        </div>
        <span class="agc-sub">${money2(t.total)}</span>`;
      row.addEventListener("click", () => openTxModal(i));
      box.appendChild(row);
    });
  } catch {
    box.innerHTML = `<p class="hint-note">Erreur de chargement.</p>`;
  }
}

async function openTxModal(i) {
  const t = TXS[i];
  const modal = $("#tx-modal");
  const body = $("#tx-modal-body");
  body.innerHTML = `<p class="hint-note">Chargement…</p>`;
  modal.hidden = false;
  let full = t;
  try {
    const rows = await rpc("admin_get_transaction", { p_admin: ADMIN, p_id: t.id });
    if (rows && rows[0]) full = rows[0];
  } catch {}
  const c = full.client || {};
  body.innerHTML = `
    <div class="carac-row"><span class="carac-k">Date</span><span class="carac-v">${txDate(full).toLocaleString("fr-CA")}</span></div>
    <div class="carac-row"><span class="carac-k">Employé</span><span class="carac-v">${escapeHtml(full.seller_code)}</span></div>
    <div class="carac-side"><div class="carac-side-title">CLIENT</div>
      <p>${escapeHtml(c.nom || "—")}<br>
      ${escapeHtml(c.tel || "")}${c.naissance ? " · né(e) le " + escapeHtml(c.naissance) : ""}<br>
      ${c.idnum ? "Pièce d'identité : " + escapeHtml(c.idnum) + "<br>" : ""}
      ${escapeHtml(c.adresse || "")}${c.sac ? " · Sac " + escapeHtml(c.sac) : ""}</p>
    </div>
    <div class="carac-side"><div class="carac-side-title">ARTICLES</div>
      ${(full.items || []).map((it) => `
        <div class="carac-row"><span class="carac-k" style="flex-shrink:1">${escapeHtml(it.label)}<br><small>${escapeHtml(it.cat)}</small></span><span class="carac-v">${money2(it.amount)}</span></div>`).join("")}
    </div>
    <p class="tx-total">TOTAL : <strong>${money2(full.total)}</strong></p>
    ${(full.photos || []).length ? `<div class="inv-photos">${full.photos.map((p) => `<img src="${p}" style="border-color:#333">`).join("")}</div>` : ""}`;
}

function exportTxCsv() {
  if (!TXS.length) { toast("Aucune transaction à exporter"); return; }
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["Date", "Employé", "Nom client", "Téléphone", "Naissance",
    "Pièce d'identité", "Adresse", "Langue", "No de sac", "Articles", "Total"];
  const lines = [head.map(esc).join(";")];
  for (const t of TXS) {
    const c = t.client || {};
    const arts = (t.items || [])
      .map((it) => `${it.label} [${it.cat}] ${Number(it.amount).toFixed(2)}$`)
      .join(" | ");
    lines.push([
      txDate(t).toLocaleString("fr-CA"), t.seller_code, c.nom, c.tel, c.naissance,
      c.idnum, c.adresse, c.langue, c.sac, arts, Number(t.total).toFixed(2),
    ].map(esc).join(";"));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "registre-achats-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  toast("Registre exporté (" + TXS.length + " transactions)");
}

/* ---------- Voyages (tournées employés) ---------- */
let TRIPS = [];
let TRIP_DAYS = [];   // brouillon en cours d'édition
let TRIP_EDIT_ID = null;

function availableCodes(excludeTripId) {
  const usedElsewhere = new Set();
  for (const tr of TRIPS) {
    if (tr.id === excludeTripId) continue;
    for (const e of (tr.employees || [])) usedElsewhere.add(e.code);
  }
  return CODES.filter((c) => c.active && !usedElsewhere.has(c.code));
}

function fillTripSelects(sel1, sel2) {
  const avail = availableCodes(TRIP_EDIT_ID);
  const opt = (c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label || c.code)}</option>`;
  $("#trip-emp1").innerHTML = avail.map(opt).join("");
  $("#trip-emp2").innerHTML = `<option value="">— Aucun —</option>` + avail.map(opt).join("");
  if (sel1) $("#trip-emp1").value = sel1;
  if (sel2) $("#trip-emp2").value = sel2;
  // le coéquipier ne peut pas être l'employé principal
  const sync = () => {
    const v1 = $("#trip-emp1").value;
    $("#trip-emp2").querySelectorAll("option").forEach((o) => {
      o.disabled = !!o.value && o.value === v1;
    });
    if ($("#trip-emp2").value === v1) $("#trip-emp2").value = "";
  };
  $("#trip-emp1").onchange = sync;
  sync();
}

async function loadTrips() {
  const box = $("#trip-list");
  try {
    TRIPS = (await rpc("admin_list_trips", { p_admin: ADMIN })) || [];
    if (!TRIPS.length) {
      box.innerHTML = `<p class="hint-note">Aucun voyage. Créez-en un avec le bouton ci-dessous.</p>`;
      return;
    }
    box.innerHTML = "";
    TRIPS.forEach((tr, i) => {
      const days = (tr.days || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const range = days.length
        ? `${new Date(days[0].date + "T12:00:00").toLocaleDateString("fr-CA", { day: "numeric", month: "short" })} → ${new Date(days[days.length - 1].date + "T12:00:00").toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}`
        : "sans dates";
      const det = document.createElement("details");
      det.className = "guide-block";
      det.innerHTML = `
        <summary>${escapeHtml(tr.title || "Voyage")}</summary>
        <div class="guide-body">
          <p><strong>Équipe :</strong> ${(tr.employees || []).map((e) => escapeHtml(e.label || e.code)).join(" + ") || "—"} · ${days.length} jour(s) · ${range}</p>
          ${days.map((d) => `
            <div class="trip-dayline">
              <strong>${new Date(d.date + "T12:00:00").toLocaleDateString("fr-CA", { weekday: "short", day: "numeric", month: "short" })}</strong>
              — ${escapeHtml((d.hotel && d.hotel.city) || "—")}${d.event && d.event.city ? " → " + escapeHtml(d.event.city) : ""}
            </div>`).join("")}
          <div class="adm-btn-row">
            <button class="btn-outline code-toggle" style="flex:1">Modifier l'itinéraire</button>
            <button class="row-del" aria-label="Supprimer">&times;</button>
          </div>
        </div>`;
      det.querySelector(".code-toggle").addEventListener("click", () => editTrip(i));
      det.querySelector(".row-del").addEventListener("click", async () => {
        if (!confirm(`Supprimer le voyage « ${tr.title} » ?`)) return;
        const ok = await rpc("admin_delete_trip", { p_admin: ADMIN, p_id: tr.id });
        toast(ok ? "Voyage supprimé" : "Action refusée");
        loadTrips();
      });
      box.appendChild(det);
    });
  } catch {
    box.innerHTML = `<p class="hint-note">Erreur de chargement.</p>`;
  }
}

const EMPTY_DAY = () => ({
  date: "",
  hotel: { city: "", name: "", addr: "", tel: "", conf: "" },
  event: { city: "", name: "", addr: "", tel: "", urg: "", contact: "" },
});

function renderTripDays() {
  const box = $("#trip-days");
  box.innerHTML = "";
  TRIP_DAYS.forEach((d, i) => {
    // tolère les jours sans hôtel ou sans événement (ex. null dans les données)
    d.hotel = d.hotel || EMPTY_DAY().hotel;
    d.event = d.event || EMPTY_DAY().event;
    const det = document.createElement("details");
    det.className = "guide-block";
    det.open = !d.date;
    det.innerHTML = `
      <summary>${d.date ? new Date(d.date + "T12:00:00").toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" }) : "Nouveau jour"}</summary>
      <div class="guide-body">
        <label class="adm-label" style="margin-top:2px">Date :</label>
        <input type="date" class="adm-input" data-i="${i}" data-f="date" value="${d.date || ""}">
        <div class="carac-side-title" style="margin-top:10px">COUCHE (HÔTEL)</div>
        <div class="tx-grid">
          <input class="adm-input" data-i="${i}" data-g="hotel" data-f="city" placeholder="Ville" value="${escapeHtml(d.hotel.city)}">
          <input class="adm-input" data-i="${i}" data-g="hotel" data-f="name" placeholder="Hôtel" value="${escapeHtml(d.hotel.name)}">
          <input class="adm-input" data-i="${i}" data-g="hotel" data-f="addr" placeholder="Adresse" value="${escapeHtml(d.hotel.addr)}">
          <div class="tx-grid-2col">
            <input class="adm-input" data-i="${i}" data-g="hotel" data-f="tel" placeholder="Téléphone" value="${escapeHtml(d.hotel.tel)}">
            <input class="adm-input" data-i="${i}" data-g="hotel" data-f="conf" placeholder="No confirmation" value="${escapeHtml(d.hotel.conf)}">
          </div>
        </div>
        <div class="carac-side-title" style="margin-top:10px">JOURNÉE D'ACHAT (ÉVÉNEMENT)</div>
        <div class="tx-grid">
          <input class="adm-input" data-i="${i}" data-g="event" data-f="city" placeholder="Ville" value="${escapeHtml(d.event.city)}">
          <input class="adm-input" data-i="${i}" data-g="event" data-f="name" placeholder="Lieu (ex. Royal Canadian Legion)" value="${escapeHtml(d.event.name)}">
          <input class="adm-input" data-i="${i}" data-g="event" data-f="addr" placeholder="Adresse" value="${escapeHtml(d.event.addr)}">
          <div class="tx-grid-2col">
            <input class="adm-input" data-i="${i}" data-g="event" data-f="tel" placeholder="Téléphone" value="${escapeHtml(d.event.tel)}">
            <input class="adm-input" data-i="${i}" data-g="event" data-f="urg" placeholder="Urgence (URG)" value="${escapeHtml(d.event.urg)}">
          </div>
          <input class="adm-input" data-i="${i}" data-g="event" data-f="contact" placeholder="Contact sur place" value="${escapeHtml(d.event.contact)}">
        </div>
        <button class="row-del trip-day-del" data-i="${i}" style="margin-top:6px" aria-label="Supprimer ce jour">&times; Supprimer ce jour</button>
      </div>`;
    det.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", () => {
        const t = TRIP_DAYS[+inp.dataset.i];
        if (inp.dataset.g) t[inp.dataset.g][inp.dataset.f] = inp.value;
        else t[inp.dataset.f] = inp.value;
        if (inp.dataset.f === "date") {
          det.querySelector("summary").textContent = inp.value
            ? new Date(inp.value + "T12:00:00").toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })
            : "Nouveau jour";
        }
      }));
    det.querySelector(".trip-day-del").addEventListener("click", () => {
      TRIP_DAYS.splice(i, 1);
      renderTripDays();
    });
    box.appendChild(det);
  });
}

function openTripForm() {
  $("#trip-form").hidden = false;
  $("#trip-new").hidden = true;
  $("#trip-list").hidden = true;
}

function closeTripForm() {
  $("#trip-form").hidden = true;
  $("#trip-new").hidden = false;
  $("#trip-list").hidden = false;
  TRIP_EDIT_ID = null;
  loadTrips();
}

function editTrip(i) {
  const tr = TRIPS[i];
  TRIP_EDIT_ID = tr.id;
  $("#trip-title").value = tr.title || "";
  TRIP_DAYS = JSON.parse(JSON.stringify(tr.days || []));
  fillTripSelects(tr.employees?.[0]?.code || null, tr.employees?.[1]?.code || null);
  renderTripDays();
  openTripForm();
}

async function saveTrip() {
  const title = $("#trip-title").value.trim();
  const emp1 = $("#trip-emp1").value;
  const emp2 = $("#trip-emp2").value;
  if (!title) { toast("Nom du voyage requis"); return; }
  if (!emp1) { toast("Choisissez au moins un employé"); return; }
  if (!TRIP_DAYS.length || TRIP_DAYS.some((d) => !d.date)) {
    toast("Chaque jour doit avoir une date");
    return;
  }
  const ok = await rpc("admin_save_trip", {
    p_admin: ADMIN, p_id: TRIP_EDIT_ID, p_title: title,
    p_employees: emp2 ? [emp1, emp2] : [emp1],
    p_days: TRIP_DAYS.slice().sort((a, b) => a.date.localeCompare(b.date)),
  });
  if (ok && ok.ok) {
    toast("Voyage enregistré");
    closeTripForm();
  } else {
    toast("Action refusée");
  }
}

/* ---------- Système ---------- */
async function loadStats() {
  const box = $("#adm-stats");
  const rows = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/entries?select=id&limit=1`,
      { method: "HEAD", headers: { ...HEADERS, Prefer: "count=exact" } });
    const range = res.headers.get("content-range") || "";
    rows1("Entrées dans la base", range.split("/")[1] || "—");
  } catch { rows1("Entrées dans la base", "—"); }
  try {
    const d = await (await fetch(`${SUPABASE_URL}/functions/v1/spot`, { cache: "no-store" })).json();
    rows1("Cours en direct", d.updated
      ? `OK — ${d.materials.length} matériaux, maj ${new Date(d.updated).toLocaleString("fr-CA")}`
      : "—");
    if (d.spot?.XAU?.cad_oz) rows1("Or (CAD/oz)", d.spot.XAU.cad_oz.toLocaleString("fr-CA") + " $");
    if (d.spot?.XAG?.cad_oz) rows1("Argent (CAD/oz)", d.spot.XAG.cad_oz.toLocaleString("fr-CA") + " $");
  } catch { rows1("Cours en direct", "injoignable"); }
  try {
    const sw = await (await fetch("sw.js", { cache: "no-store" })).text();
    const m = sw.match(/roadminer-v\d+/);
    rows1("Version du cache (SW)", m ? m[0] : "—");
  } catch { rows1("Version du cache (SW)", "—"); }
  rows1("Page admin", location.href);

  function rows1(k, v) { rows.push([k, v]); }
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="carac-row"><span class="carac-k">${k}</span><span class="carac-v">${escapeHtml(String(v))}</span></div>`
  ).join("");
}

/* ---------- Thème clair / sombre (partagé avec l'app) ---------- */
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

/* ---------- Init ---------- */
initTheme();
document.querySelectorAll(".adm-tab-btn").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".adm-tab-btn").forEach((x) =>
      x.classList.toggle("active", x === b));
    document.querySelectorAll(".adm-tab").forEach((p) =>
      p.classList.toggle("active", p.id === b.dataset.tab));
  }));
$("#adm-login-btn").addEventListener("click", login);
$("#adm-code").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("#adm-toggle").addEventListener("click", () => {
  const blocked = $("#adm-status-badge").textContent.includes("BLOQUÉ");
  setBlocked(!blocked);
});
$("#adm-save-msg").addEventListener("click", async () => {
  // enregistre le message sans changer l'état : on relit l'état courant
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_control?id=eq.1&select=blocked`,
      { headers: HEADERS, cache: "no-store" });
    const row = (await res.json())[0] || {};
    const ok = await rpc("admin_set_blocked", {
      p_admin: ADMIN, p_blocked: !!row.blocked, p_message: $("#adm-msg").value.trim() || null,
    });
    toast(ok ? "Message enregistré" : "Action refusée");
    refreshStatus();
  } catch { toast("Erreur réseau"); }
});
$("#adm-add").addEventListener("click", addCode);
$("#adm-tx-export").addEventListener("click", exportTxCsv);
$("#tx-modal-close").addEventListener("click", () => { $("#tx-modal").hidden = true; });
$("#tx-modal").addEventListener("click", (e) => {
  if (e.target.id === "tx-modal") $("#tx-modal").hidden = true;
});
$("#trip-new").addEventListener("click", () => {
  TRIP_EDIT_ID = null;
  $("#trip-title").value = "";
  TRIP_DAYS = [EMPTY_DAY()];
  fillTripSelects(null, null);
  renderTripDays();
  openTripForm();
});
$("#trip-add-day").addEventListener("click", () => {
  TRIP_DAYS.push(EMPTY_DAY());
  renderTripDays();
});
$("#trip-save").addEventListener("click", saveTrip);
$("#trip-cancel").addEventListener("click", closeTripForm);
$("#adm-logout").addEventListener("click", () => {
  sessionStorage.removeItem("roadminer_admin");
  ADMIN = "";
  $("#adm-dash").hidden = true;
  $("#adm-login").hidden = false;
  $("#adm-code").value = "";
});
tryRestore();
