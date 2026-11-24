// Tile data status for Tower's Map data page. tiles.kovamaps.com (Cloudflare R2) sends no CORS header,
// so the browser can't read it; this reads the public lane manifest and probes one tree and building
// tile server-side. Everything it returns is public. Deploy with Verify JWT ON (Tower calls it signed in).
const HOST = "https://tiles.kovamaps.com";
const cors = { "Access-Control-Allow-Origin": "https://tower.kovamaps.com", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Vary": "Origin" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
const int = (v: string | null) => (v && /^\d{1,6}$/.test(v) ? Number(v) : null);

async function probe(path: string) {
  try {
    const r = await fetch(`${HOST}/${path}`, { method: "HEAD" });
    return { status: r.status, last_modified: r.headers.get("last-modified"), bytes: Number(r.headers.get("content-length")) || null };
  } catch (e) { return { status: 0, error: String(e).slice(0, 200) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const x = int(url.searchParams.get("x")), y = int(url.searchParams.get("y"));
  let lanes: unknown = null;
  try {
    const r = await fetch(`${HOST}/lanes/v1/manifest.json`);
    if (r.ok) {
      const m = await r.json();
      lanes = { generation: m.generation, built: m.built, fresh_until: m.fresh_until, tile_count: m.tile_count,
                covered: m.covered && typeof m.covered === "object" ? Object.keys(m.covered).length : null,
                populated: m.populated && typeof m.populated === "object" ? Object.keys(m.populated).length : null,
                sources: Array.isArray(m.sources) ? m.sources.map((s: Record<string, unknown>) => (s && (s.name ?? s.region ?? s.id)) ?? null).slice(0, 20) : null };
    } else lanes = { status: r.status };
  } catch (e) { lanes = { status: 0, error: String(e).slice(0, 200) }; }
  const sample = x != null && y != null ? { trees: await probe(`trees/v1/14/${x}/${y}.json`), buildings: await probe(`buildings/v1/14/${x}/${y}.json`) } : null;
  return json(200, { host: HOST, lanes, sample, checked_at: new Date().toISOString() });
});
