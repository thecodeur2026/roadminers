/* ===== ROAD MINERS — page d'administration ===== */
"use strict";

const $ = (sel) => document.querySelector(sel);
let ADMIN = "";

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

/* ---------- Init ---------- */
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
$("#adm-logout").addEventListener("click", () => {
  sessionStorage.removeItem("roadminer_admin");
  ADMIN = "";
  $("#adm-dash").hidden = true;
  $("#adm-login").hidden = false;
  $("#adm-code").value = "";
});
tryRestore();
