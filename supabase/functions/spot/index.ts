// ROAD MINERS — Edge Function "spot"
// Sert les cours en direct (Kitco refining CAD + spot or/argent/platine/palladium)
// sans blocage CORS pour la PWA hébergée.
//
// Déploiement :
//   supabase functions deploy spot --no-verify-jwt
//
// Réponse JSON : { updated, usdcad, spot: {XAU,XAG,XPT,XPD}, materials: [...] }

const KITCO_URL = "https://online.kitco.com/refining/gold-silver-CAD.html";
const GOLDAPI_URL = "https://api.gold-api.com/price/";
const FX_URL = "https://open.er-api.com/v6/latest/USD";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function tierBounds(name: string): number[] {
  if ((name.includes("Silver") || name.includes("Sterling") || name.includes("Ag "))
      && !name.includes("Gold")) return [0, 30000, 150000];
  return [0, 500, 3000];
}

async function scrapeKitco() {
  const html = await (await fetch(KITCO_URL, { headers: { "User-Agent": UA } })).text();
  const rowRe = /<td>([^<]+?)<\/td>\s*((?:<td>\s*<div>\s*\$<span class="individual_price">[\d.]+<\/span><span class="wholesale_price">[\d.]+<\/span>\s*<\/div>\s*<\/td>\s*){1,3})/gs;
  const priceRe = /\$<span class="individual_price">([\d.]+)<\/span><span class="wholesale_price">([\d.]+)<\/span>/g;
  const materials = [];
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const name = m[1].replace(/\s+/g, " ").trim();
    const bounds = tierBounds(name);
    const tiers = [];
    let p, i = 0;
    priceRe.lastIndex = 0;
    while ((p = priceRe.exec(m[2])) !== null) {
      tiers.push({
        min_g: bounds[i] ?? bounds[bounds.length - 1],
        individual: parseFloat(p[1]),
        wholesale: parseFloat(p[2]),
      });
      i++;
    }
    if (tiers.length) materials.push({ name, tiers });
  }
  return materials;
}

async function scrapeSpot() {
  const spot: Record<string, unknown> = {};
  let rate = 1.40;
  try {
    const fx = await (await fetch(FX_URL)).json();
    rate = fx?.rates?.CAD ?? rate;
  } catch { /* ignore */ }
  for (const metal of ["XAU", "XAG", "XPT", "XPD"]) {
    try {
      const d = await (await fetch(GOLDAPI_URL + metal)).json();
      const price = d?.price ?? null;
      spot[metal] = price
        ? {
            usd_oz: price,
            cad_oz: Math.round(price * rate * 100) / 100,
            usd_g: Math.round((price / 31.1034768) * 10000) / 10000,
            cad_g: Math.round((price * rate / 31.1034768) * 10000) / 10000,
          }
        : { usd_oz: null, cad_oz: null, usd_g: null, cad_g: null };
    } catch {
      spot[metal] = { usd_oz: null, cad_oz: null, usd_g: null, cad_g: null };
    }
  }
  return { spot, rate };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const errors: string[] = [];
  let materials: unknown[] = [];
  let spot = {}, rate = null;
  try { materials = await scrapeKitco(); } catch (e) { errors.push(`kitco: ${e}`); }
  try { ({ spot, rate } = await scrapeSpot()); } catch (e) { errors.push(`spot: ${e}`); }
  const body = JSON.stringify({
    updated: new Date().toISOString(),
    usdcad: rate,
    spot,
    materials,
    errors,
  });
  return new Response(body, {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
