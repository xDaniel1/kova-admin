// Tile data status for Tower's Map data page. tiles.kovamaps.com (Cloudflare R2) sends no CORS header,
// so the browser can't read it; this reads the public lane manifest and probes one tree and building
// tile server-side. Everything it returns is public. Deploy with Verify JWT ON (Tower calls it signed in).
const HOST = "https://tiles.kovamaps.com";
const cors = { "Access-Control-Allow-Origin": "https://tower.kovamaps.com", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
// Lane manifest rows: keys are tile rows (y), values are inclusive runs of x ([from, to]).
const runs = (o: unknown) => o && typeof o === "object" ? Object.values(o as Record<string, unknown>).reduce((n: number, r) => n + (Array.isArray(r) ? r.reduce((k: number, p) => k + (Array.isArray(p) && p.length === 2 ? Number(p[1]) - Number(p[0]) + 1 : 0), 0) : 0), 0) : null;
// R2 can be slow; never hold the card past a few seconds.
const timed = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
const int = (v: string | null) => (v && /^\d{1,6}$/.test(v) ? Number(v) : null);

async function probe(path: string) {
  try {
    const r = await timed(`${HOST}/${path}`, { method: "HEAD" });
    return { status: r.status, last_modified: r.headers.get("last-modified"), bytes: Number(r.headers.get("content-length")) || null };
  } catch (e) { return { status: 0, error: String(e).slice(0, 200) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const x = int(url.searchParams.get("x")), y = int(url.searchParams.get("y"));
  let lanes: unknown = null;
  try {
    const r = await timed(`${HOST}/lanes/v1/manifest.json`);
    if (r.ok) {
      const m = await r.json();
      lanes = { generation: m.generation, built: m.built, fresh_until: m.fresh_until, tile_count: m.tile_count,
                covered: runs(m.covered), populated: runs(m.populated),
                sources: Array.isArray(m.sources) ? m.sources.map((s: Record<string, unknown>) => (s && (s.name ?? s.region ?? s.id)) ?? null).slice(0, 20) : null };
    } else lanes = { status: r.status };
  } catch (e) { lanes = { status: 0, error: String(e).slice(0, 200) }; }
  const sample = x != null && y != null ? await Promise.all([probe(`trees/v1/14/${x}/${y}.json`), probe(`buildings/v1/14/${x}/${y}.json`)]).then(([trees, buildings]) => ({ trees, buildings })) : null;
  return json(200, { host: HOST, lanes, sample, checked_at: new Date().toISOString() });
});
