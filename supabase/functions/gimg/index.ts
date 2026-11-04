// ROAD MINERS — Edge Function "gimg"
// Proxy image Google Custom Search : la clé API reste côté serveur (secret),
// invisible dans le code client.
//
// GET /functions/v1/gimg?q=recherche → { "url": "https://..." } ou { "url": null }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const jsonHeaders = { ...CORS, "Content-Type": "application/json" };
  try {
    const q = new URL(req.url).searchParams.get("q") || "";
    if (!q) return new Response(JSON.stringify({ url: null }), { headers: jsonHeaders });

    const key = Deno.env.get("GOOGLE_CSE_KEY");
    const cx = Deno.env.get("GOOGLE_CSE_CX");
    let img = null;

    // 1) Google Custom Search (si la clé est active)
    if (key && cx) {
      try {
        const api = "https://www.googleapis.com/customsearch/v1?key=" + key +
          "&cx=" + cx + "&searchType=image&num=1&imgSize=medium&q=" + encodeURIComponent(q);
        const d = await (await fetch(api)).json();
        img = d?.items?.[0]?.link ?? null;
      } catch { /* fallback ci-dessous */ }
    }

    // 2) Secours : Wikimedia Commons (sans clé)
    if (!img) {
      const wm = "https://commons.wikimedia.org/w/api.php?action=query&format=json" +
        "&generator=search&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=500" +
        "&gsrsearch=" + encodeURIComponent(q);
      const d = await (await fetch(wm, {
        headers: { "User-Agent": "RoadMiners/1.0 (contact: roadminers.com)" },
      })).json();
      const pages = d?.query?.pages ? Object.values(d.query.pages) : [];
      img = pages[0]?.imageinfo?.[0]?.thumburl ?? pages[0]?.imageinfo?.[0]?.url ?? null;
    }

    return new Response(JSON.stringify({ url: img }), {
      headers: { ...jsonHeaders, "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ url: null, error: String(e) }), { headers: jsonHeaders });
  }
});
