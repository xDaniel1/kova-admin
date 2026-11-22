// Client errors: what went wrong in the apps (the web app reports into client_errors today), grouped by
// message. Filtering by app and text happens in the database, before the 500-group cap.
'use strict';
import { html, raw, qs, qsa, fmtNum, fmtDate, rel, barChart, empty, badge, copy, debounce } from '../util.js';
import * as api from '../api.js';
import { state } from '../app.js';

const RANGES = [[1, '24 hours'], [7, '7 days'], [30, '30 days']];
const NEEDS_UPGRADE = html`<section class="card setup"><h2>Database update needed</h2><p>The Errors page needs <code>supabase/migrations/0022_error_filters.sql</code> (and <code>0023_clear_window.sql</code> for Clear).</p></section>`.s;

export default async function errors(ctx) {
  const days = +ctx.query.days || 7;
  const canWrite = state.role !== 'viewer';
  let d;
  try { d = await api.clientErrors(days, ctx.query.app || null, ctx.query.q || null); } catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { ctx.el.innerHTML = NEEDS_UPGRADE; return; } throw e; }
  if (!ctx.alive()) return;
  const apps = [...new Set([...(d.apps || []), ...(ctx.query.app ? [ctx.query.app] : [])])].sort();
  ctx.el.innerHTML = html`
    <section class="card"><div class="card-head"><h2 data-total></h2>
      <div class="seg">${RANGES.map(([n, l]) => html`<button type="button" data-days="${n}" aria-pressed="${n === days ? 'true' : 'false'}">${l}</button>`)}</div></div>
      <div data-chart>${barChart('Errors per day · 30 days' + (ctx.query.app ? ' · ' + ctx.query.app : ''), d.daily)}</div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><h2>By message</h2><span class="muted small">Newest first. Clearing deletes those reports.</span></div>
      <div class="toolbar"><label>Filter<input type="search" data-filter placeholder="Message, page or browser" value="${ctx.query.q || ''}"></label>
        ${apps.length ? html`<label class="narrow">App<select data-app><option value="">All apps</option>${apps.map(a => html`<option ${raw(a === ctx.query.app ? 'selected' : '')}>${a}</option>`)}</select></label>` : ''}</div>
      <div data-list></div></section>`.s;

  const list = qs('[data-list]', ctx.el);
  // Heading and list always come from the same accepted response and its filter snapshot.
  let rendered = { app: ctx.query.app || null, q: ctx.query.q || null };
  // Clear acts only on what is on screen: it is locked while the requested filters differ from the rendered ones.
  const syncClear = () => { const same = (ctx.query.app || null) === rendered.app && (ctx.query.q || null) === rendered.q;
    qsa('[data-clear]', ctx.el).forEach(b => { b.disabled = !same; b.title = same ? '' : 'Waiting for the new filter results'; }); };
  const render = (r, snap) => {
    rendered = snap;
    const groups = r.groups || [], since = Date.parse(r.since);
    const filtered = !!(snap.q || snap.app);
    // Before 0023 the total and chart cover all apps even when the list is filtered; say so.
    const perApp = r.clear === 'ids' && snap.app;
    qs('[data-chart]', ctx.el).innerHTML = barChart('Errors per day · 30 days' + (perApp ? ' · ' + snap.app : snap.app ? ' · all apps' : ''), r.daily).s;
    qs('[data-total]', ctx.el).textContent = `${fmtNum(r.total)} errors${perApp ? ' from ' + snap.app : snap.app ? ' (all apps)' : ''}`;
    list.innerHTML = html`<p class="muted small" style="margin:0 0 8px">${fmtNum(r.matching)} ${filtered ? 'matching ' : ''}distinct ${r.matching === 1 ? 'message' : 'messages'}${r.capped ? ' · showing the newest 500' : ''}</p>
      ${groups.length ? html`<div class="stack">${groups.map((g, i) => html`<details class="collapse error-group">
        <summary><strong>${g.message || '(no message)'}</strong> ${g.first_ever && Date.parse(g.first_ever) >= since ? badge('New', 'tone-new') : ''}<br><span class="muted small">${g.app || 'unknown app'} · ${fmtNum(g.n)} times · ${fmtNum(g.users)} signed-in users · last ${rel(g.last)} · first in window ${rel(g.first)}</span></summary>
        <dl class="kv" style="margin-top:10px"><dt>Page</dt><dd class="mono small">${g.url || '—'}</dd><dt>Browser</dt><dd class="small">${g.user_agent || '—'}</dd><dt>Last seen</dt><dd>${fmtDate(g.last)}</dd></dl>
        ${g.stack ? html`<pre class="mono small stack-trace">${g.stack}</pre>` : ''}
        <div class="row" style="margin-top:8px"><button type="button" class="sm ghost" data-copy="${i}">Copy details</button>${canWrite && r.clear === 'ids' ? (Array.isArray(g.ids) ? html`<button type="button" class="sm danger" data-clear="${i}">Clear ${fmtNum(g.n)} reports</button>` : html`<span class="muted small">Too many reports to clear at once (${fmtNum(g.n)}). Pick a shorter range, or clear in the database if this is already the 24-hour view.</span>`) : ''}</div></details>`)}</div>`
        : empty(filtered ? 'No errors match.' : 'No errors in this window.')}`.s;
    syncClear();
    qsa('[data-copy]', list).forEach(b => b.onclick = async () => { const g = groups[+b.dataset.copy];
      const ok = await copy(`${g.message || '(no message)'}\n${g.app || 'unknown app'} · ${g.n} times · last ${g.last}\nPage: ${g.url || '-'}\nBrowser: ${g.user_agent || '-'}\n\n${g.stack || ''}`);
      if (ctx.alive()) ctx.notice(ok ? 'Copied.' : 'Copy failed.'); });
    qsa('[data-clear]', list).forEach(b => b.onclick = async () => {
      if (!canWrite || b.disabled) return; const g = groups[+b.dataset.clear];
      if (!confirm(`Delete ${g.n} ${g.app || 'unknown app'} reports of "${(g.message || '').slice(0, 80)}"? Only these reports are deleted; any that arrived since are kept.`)) return;
      b.disabled = true;
      try { const n = await api.clearErrorGroup(g.app, g.message, g.ids); if (!ctx.alive()) return; ctx.notice(n ? `Cleared ${n} reports.` : 'Nothing was cleared (already gone).'); refetch(++seq); }
      catch (e) { if (ctx.alive()) { ctx.fail(e); b.disabled = false; } }
    });
  };
  let seq = 0;
  render(d, { app: ctx.query.app || null, q: ctx.query.q || null });

  const filter = qs('[data-filter]', ctx.el), appSel = qs('[data-app]', ctx.el);
  // Each change bumps the generation at once, so a response for an older filter is never painted.
  const refetch = async gen => { const snap = { app: ctx.query.app || null, q: ctx.query.q || null };
    try { const r = await api.clientErrors(days, snap.app, snap.q); if (!ctx.alive() || gen !== seq) return; render(r, snap);
      try { history.replaceState(null, '', '#/errors?' + new URLSearchParams({ days, ...(snap.q ? { q: snap.q } : {}), ...(snap.app ? { app: snap.app } : {}) })); } catch {} }
    catch (e) { if (!ctx.alive() || gen !== seq) return; if (e.needsUpgrade) ctx.el.innerHTML = NEEDS_UPGRADE; else ctx.fail(e); } };
  const debounced = debounce(gen => refetch(gen), 250);
  filter.oninput = () => { ctx.query.q = filter.value.trim(); syncClear(); debounced(++seq); };
  if (appSel) appSel.onchange = () => { ctx.query.app = appSel.value; syncClear(); refetch(++seq); };
  qsa('[data-days]', ctx.el).forEach(b => b.onclick = () => { location.hash = '/errors?' + new URLSearchParams({ days: b.dataset.days, ...(ctx.query.q ? { q: ctx.query.q } : {}), ...(ctx.query.app ? { app: ctx.query.app } : {}) }); });
}
