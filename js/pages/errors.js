// Client errors: what crashed in the apps (the web app reports into client_errors today), grouped by message.
'use strict';
import { html, raw, qsa, fmtNum, fmtDate, rel, table, barChart, upgradeCard, empty } from '../util.js';
import * as api from '../api.js';

const RANGES = [[1, '24 hours'], [7, '7 days'], [30, '30 days']];

export default async function errors(ctx) {
  const days = +ctx.query.days || 7;
  let d;
  try { d = await api.clientErrors(days); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const groups = d.groups || [];
  ctx.el.innerHTML = html`
    <section class="card"><div class="card-head"><h2>${fmtNum(d.total)} errors · ${fmtNum(groups.length)} distinct</h2>
      <div class="seg">${RANGES.map(([n, l]) => html`<button type="button" data-days="${n}" aria-pressed="${n === days ? 'true' : 'false'}">${l}</button>`)}</div></div>
      ${barChart('Errors per day · 30 days', d.daily)}</section>
    <section class="card" style="margin-top:18px"><div class="card-head"><h2>By message</h2><span class="muted small">Newest first. Clearing deletes those reports.</span></div>
      ${groups.length ? html`<div class="stack">${groups.map((g, i) => html`<details class="collapse error-group">
        <summary><strong>${g.message || '(no message)'}</strong><br><span class="muted small">${g.app} · ${fmtNum(g.n)} times · ${fmtNum(g.users)} signed-in users · last ${rel(g.last)} · first ${rel(g.first)}</span></summary>
        <dl class="kv" style="margin-top:10px"><dt>Page</dt><dd class="mono small">${g.url || '—'}</dd><dt>Browser</dt><dd class="small">${g.user_agent || '—'}</dd><dt>Last seen</dt><dd>${fmtDate(g.last)}</dd></dl>
        ${g.stack ? html`<pre class="mono small stack-trace">${g.stack}</pre>` : ''}
        <div class="row" style="margin-top:8px"><button type="button" class="sm danger" data-clear="${i}">Clear ${fmtNum(g.n)} reports</button></div></details>`)}</div>` : empty('No errors in this window.')}</section>`.s;
  qsa('[data-days]', ctx.el).forEach(b => b.onclick = () => { location.hash = '/errors?days=' + b.dataset.days; });
  qsa('[data-clear]', ctx.el).forEach(b => b.onclick = async () => {
    const g = groups[+b.dataset.clear]; if (!confirm(`Delete ${g.n} reports of "${(g.message || '').slice(0, 80)}"?`)) return;
    b.disabled = true;
    try { await api.clearErrors(g.ids); ctx.notice('Cleared.'); if (ctx.alive()) await errors(ctx); } catch (e) { ctx.fail(e); b.disabled = false; }
  });
}
