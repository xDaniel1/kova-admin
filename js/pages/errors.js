// Client errors: what went wrong in the apps (the web app reports into client_errors today), grouped by
// message. Filtering by app and text happens in the database, before the 500-group cap.
'use strict';
import { html, raw, qs, qsa, fmtNum, fmtDate, rel, barChart, upgradeCard, empty, badge, copy, debounce } from '../util.js';
import * as api from '../api.js';
import { state } from '../app.js';

const RANGES = [[1, '24 hours'], [7, '7 days'], [30, '30 days']];

export default async function errors(ctx) {
  const days = +ctx.query.days || 7;
  const canWrite = state.role !== 'viewer';
  let d;
  try { d = await api.clientErrors(days, ctx.query.app || null, ctx.query.q || null); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const apps = [...new Set([...(d.apps || []), ...(ctx.query.app ? [ctx.query.app] : [])])].sort();
  ctx.el.innerHTML = html`
    <section class="card"><div class="card-head"><h2>${fmtNum(d.total)} errors</h2>
      <div class="seg">${RANGES.map(([n, l]) => html`<button type="button" data-days="${n}" aria-pressed="${n === days ? 'true' : 'false'}">${l}</button>`)}</div></div>
      ${barChart('Errors per day · 30 days', d.daily)}</section>
    <section class="card" style="margin-top:18px"><div class="card-head"><h2>By message</h2><span class="muted small">Newest first. Clearing deletes those reports.</span></div>
      <div class="toolbar"><label>Filter<input type="search" data-filter placeholder="Message, page or browser" value="${ctx.query.q || ''}"></label>
        ${apps.length ? html`<label class="narrow">App<select data-app><option value="">All apps</option>${apps.map(a => html`<option ${raw(a === ctx.query.app ? 'selected' : '')}>${a}</option>`)}</select></label>` : ''}</div>
      <div data-list></div></section>`.s;

  const list = qs('[data-list]', ctx.el);
  const render = r => {
    const groups = r.groups || [], since = Date.parse(r.since);
    const filtered = !!(ctx.query.q || ctx.query.app);
    list.innerHTML = html`<p class="muted small" style="margin:0 0 8px">${fmtNum(r.matching)} ${filtered ? 'matching ' : ''}distinct ${r.matching === 1 ? 'message' : 'messages'}${r.capped ? ' · showing the newest 500' : ''}</p>
      ${groups.length ? html`<div class="stack">${groups.map((g, i) => html`<details class="collapse error-group">
        <summary><strong>${g.message || '(no message)'}</strong> ${g.first_ever && Date.parse(g.first_ever) >= since ? badge('New', 'tone-new') : ''}<br><span class="muted small">${g.app || 'unknown app'} · ${fmtNum(g.n)} times · ${fmtNum(g.users)} signed-in users · last ${rel(g.last)} · first in window ${rel(g.first)}</span></summary>
        <dl class="kv" style="margin-top:10px"><dt>Page</dt><dd class="mono small">${g.url || '—'}</dd><dt>Browser</dt><dd class="small">${g.user_agent || '—'}</dd><dt>Last seen</dt><dd>${fmtDate(g.last)}</dd></dl>
        ${g.stack ? html`<pre class="mono small stack-trace">${g.stack}</pre>` : ''}
        <div class="row" style="margin-top:8px"><button type="button" class="sm ghost" data-copy="${i}">Copy details</button>${canWrite ? html`<button type="button" class="sm danger" data-clear="${i}">Clear ${fmtNum(g.n)} reports</button>` : ''}</div></details>`)}</div>`
        : empty(filtered ? 'No errors match.' : 'No errors in this window.')}`.s;
    qsa('[data-copy]', list).forEach(b => b.onclick = async () => { const g = groups[+b.dataset.copy];
      ctx.notice(await copy(`${g.message || '(no message)'}\n${g.app || 'unknown app'} · ${g.n} times · last ${g.last}\nPage: ${g.url || '-'}\nBrowser: ${g.user_agent || '-'}\n\n${g.stack || ''}`) ? 'Copied.' : 'Copy failed.'); });
    qsa('[data-clear]', list).forEach(b => b.onclick = async () => {
      if (!canWrite) return; const g = groups[+b.dataset.clear];
      if (!confirm(`Delete ${g.n} reports of "${(g.message || '').slice(0, 80)}"? Reports that arrive after ${fmtDate(g.last)} are kept.`)) return;
      b.disabled = true;
      try { const n = await api.clearErrorGroup(g.app, g.message, g.last); ctx.notice(n ? `Cleared ${n} reports.` : 'Nothing was cleared (already gone).'); if (ctx.alive()) await errors(ctx); }
      catch (e) { ctx.fail(e); b.disabled = false; }
    });
  };
  render(d);

  const filter = qs('[data-filter]', ctx.el), appSel = qs('[data-app]', ctx.el);
  const url = () => '#/errors?' + new URLSearchParams({ days, ...(ctx.query.q ? { q: ctx.query.q } : {}), ...(ctx.query.app ? { app: ctx.query.app } : {}) });
  let seq = 0;
  const refetch = async () => { const mine = ++seq;
    try { const r = await api.clientErrors(days, ctx.query.app || null, ctx.query.q || null); if (!ctx.alive() || mine !== seq) return; render(r); try { history.replaceState(null, '', url()); } catch {} }
    catch (e) { if (ctx.alive()) ctx.fail(e); } };
  const debounced = debounce(refetch, 250);
  filter.oninput = () => { ctx.query.q = filter.value.trim(); debounced(); };
  if (appSel) appSel.onchange = () => { ctx.query.app = appSel.value; refetch(); };
  qsa('[data-days]', ctx.el).forEach(b => b.onclick = () => { location.hash = '/errors?' + new URLSearchParams({ days: b.dataset.days, ...(ctx.query.q ? { q: ctx.query.q } : {}), ...(ctx.query.app ? { app: ctx.query.app } : {}) }); });
}
