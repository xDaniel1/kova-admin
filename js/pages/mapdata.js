// Map data: coverage and on/off switches for the data the apps read from our database
// (speed limits, transit, indoor venues and plans, incident feeds).
'use strict';
import { html, raw, qsa, fmtNum, fmtDate, rel, href, table, badge, upgradeCard } from '../util.js';
import * as api from '../api.js';

const tile = (v, l, sub, to) => html`<${raw(to ? 'a' : 'div')} class="tile" ${raw(to ? `href="${to}"` : '')}><strong>${v}</strong><span>${l}</span>${sub ? html`<em class="delta muted" style="color:var(--muted)">${sub}</em>` : ''}</${raw(to ? 'a' : 'div')}>`;
const regionSwitch = (dataset, r) => html`<button type="button" class="sm ${r.enabled ? 'ghost' : 'danger'}" data-region="${dataset}|${r.region}" data-enabled="${r.enabled ? '1' : ''}">${r.enabled ? 'Turn off' : 'Turn on'}</button>`;
const state = on => on ? badge('Serving', 'ok') : badge('Off · hidden from apps', 'danger');

// The nightly job publishes OpenStreetMap indoor plans to kovamaps.com/indoor from the waypoint-site repo.
async function indoorPlans() {
  const [files, commits] = await Promise.all([
    fetch('https://api.github.com/repos/xDaniel1/waypoint-site/contents/indoor').then(r => r.ok ? r.json() : null),
    fetch('https://api.github.com/repos/xDaniel1/waypoint-site/commits?path=indoor&per_page=1').then(r => r.ok ? r.json() : null),
  ]);
  return { cells: Array.isArray(files) ? files.filter(f => /^indoor_.*\.json$/.test(f.name)).length : null, last: commits?.[0]?.commit?.committer?.date || null };
}

export default async function mapData(ctx) {
  let d;
  try { d = await api.mapData(); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const sl = d.speed_limits || [], tr = d.transit || [], ven = d.venues || [], feeds = d.feeds || {};
  const sum = (a, k) => a.reduce((n, x) => n + (+x[k] || 0), 0);
  const venTotal = sum(ven, 'total'), venOn = sum(ven, 'enabled');
  ctx.el.innerHTML = html`
    <div class="tiles">
      ${tile(fmtNum(sum(sl, 'segments')), 'Speed-limit segments', sl.length ? sl.map(r => r.region).join(', ') : 'none yet')}
      ${tile(fmtNum(sum(tr, 'stops')), 'Transit stops', fmtNum(sum(tr, 'agencies')) + ' agencies · ' + fmtNum(sum(tr, 'lines')) + ' rail lines')}
      ${tile(`${venOn}/${venTotal}`, 'Indoor venues on', fmtNum(sum(ven, 'mapbox')) + ' with Mapbox plans', href('/venues'))}
      ${tile(html`<span data-cells>…</span>`, 'Indoor plan cells', html`<span data-cells-sub>nightly OpenStreetMap job</span>`)}
      ${tile(`${feeds.enabled ?? 0}/${feeds.total ?? 0}`, 'Incident feeds on', feeds.states || 'none', href('/feeds'))}
    </div>

    <section class="card" style="margin-top:18px"><div class="card-head"><h2>Speed limits</h2><span class="muted small">speed_limit_segments</span></div>
      ${table(['Region', 'Segments', 'Counties', 'Limits', 'Source', 'Updated', 'Status', ''], sl.map(r => [
        html`<strong>${r.region}</strong>`, fmtNum(r.segments), fmtNum(r.counties), html`${r.min_mph}–${r.max_mph} mph <span class="muted small">avg ${r.avg_mph}</span>`,
        html`<span class="mono small">${r.sources}</span>`, html`<span title="${fmtDate(r.updated_at)}">${rel(r.updated_at)}</span>`, state(r.enabled), regionSwitch('speed_limits', r)]),
        { emptyText: 'No speed limits imported yet.' })}
      ${(d.speed_limits_by_mph || []).length ? html`<details class="collapse" style="margin-top:10px"><summary>Segments by posted limit</summary>${table(['Limit', 'Segments'], d.speed_limits_by_mph.map(x => [x.mph + ' mph', fmtNum(x.n)]))}</details>` : ''}
      <p class="muted small" style="margin:10px 0 0">The apps read these ahead of OpenStreetMap inside each region. Turning a region off hides its rows from every app at once (enforced in the database), and they fall back to OpenStreetMap. Imports run from the iOS repo's <code>supabase/imports/</code>.</p></section>

    <section class="card" style="margin-top:18px"><div class="card-head"><h2>Transit</h2><span class="muted small">transit_stops · transit_lines</span></div>
      ${table(['Region', 'Stops', 'Rail stops', 'Rail lines', 'Agencies', 'Updated', 'Status', ''], tr.map(r => [
        html`<strong>${r.region}</strong>`, fmtNum(r.stops), fmtNum(r.rail_stops), fmtNum(r.lines), fmtNum(r.agencies), rel(r.updated_at), state(r.enabled), regionSwitch('transit', r)]),
        { emptyText: 'No transit imported yet.' })}
      ${(d.transit_agencies || []).length ? html`<details class="collapse" style="margin-top:10px"><summary>${fmtNum(d.transit_agencies.length)} agencies</summary>${table(['Agency', 'Region', 'Stops', 'Modes', 'Updated'], d.transit_agencies.map(a => [html`${a.agency_name} <span class="muted small mono">${a.agency}</span>`, a.region, fmtNum(a.stops), a.modes, rel(a.updated_at)]))}</details>` : ''}
      <p class="muted small" style="margin:10px 0 0">New York transit ships inside the apps; these are the regions served from the database. Built from each agency's GTFS feed.</p></section>

    <section class="card" style="margin-top:18px"><div class="card-head"><h2>Indoor maps</h2><a class="small" href="${href('/venues')}">Manage venues</a></div>
      ${table(['Kind', 'Venues', 'On', 'With Mapbox plans', 'Updated'], ven.map(v => [html`<strong>${v.kind}</strong>`, fmtNum(v.total), fmtNum(v.enabled), fmtNum(v.mapbox), rel(v.updated_at)]), { emptyText: 'No venues.' })}
      <p class="muted small" style="margin:10px 0 0">Airports draw Mapbox's floor plans; stations, malls and others draw OpenStreetMap plans that a nightly job publishes to kovamaps.com/indoor (<span data-cells-line>checking…</span>). A venue switched off disappears from the apps' venue list. The Indoor maps switch on App controls turns the whole feature off.</p></section>`.s;

  qsa('[data-region]', ctx.el).forEach(b => b.onclick = async () => {
    const [dataset, region] = b.dataset.region.split('|'), on = !b.dataset.enabled;
    const what = dataset === 'speed_limits' ? 'speed limits' : 'transit';
    if (!on && !confirm(`Turn off ${what} for ${region}? Every app stops showing this data for ${region} right away.`)) return;
    b.disabled = true;
    try { await api.setDataRegion(dataset, region, on); ctx.notice(`${region} ${what} turned ${on ? 'on' : 'off'}.`); if (ctx.alive()) await mapData(ctx); }
    catch (e) { ctx.fail(e); b.disabled = false; }
  });
  indoorPlans().then(p => {
    if (!ctx.alive()) return;
    const cells = ctx.el.querySelector('[data-cells]'), sub = ctx.el.querySelector('[data-cells-sub]'), line = ctx.el.querySelector('[data-cells-line]');
    if (cells) cells.textContent = p.cells == null ? '—' : fmtNum(p.cells);
    const when = p.last ? 'refreshed ' + rel(p.last) : 'refresh time unavailable';
    if (sub) sub.textContent = when;
    if (line) line.textContent = (p.cells == null ? 'cell count unavailable' : fmtNum(p.cells) + ' cells') + ', ' + when;
  }).catch(() => {});
}
