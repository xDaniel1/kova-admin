// Client errors: what crashed in the apps (the web app reports into client_errors today), grouped by message.
'use strict';
import { html, raw, qs, qsa, fmtNum, fmtDate, rel, table, barChart, upgradeCard, empty, badge, copy, debounce } from '../util.js';
import * as api from '../api.js';

const RANGES = [[1, '24 hours'], [7, '7 days'], [30, '30 days']];

export default async function errors(ctx) {
  const days = +ctx.query.days || 7;
  let d;
  try { d = await api.clientErrors(days); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const groups = d.groups || [];
  const apps = [...new Set(groups.map(g => g.app).filter(Boolean))].sort();
  const since = Date.now() - days * 864e5;
  ctx.el.innerHTML = html`
    <section class="card"><div class="card-head"><h2>${fmtNum(d.total)} errors · ${fmtNum(groups.length)} distinct</h2>
      <div class="seg">${RANGES.map(([n, l]) => html`<button type="button" data-days="${n}" aria-pressed="${n === days ? 'true' : 'false'}">${l}</button>`)}</div></div>
      ${barChart('Errors per day · 30 days', d.daily)}</section>
    <section class="card" style="margin-top:18px"><div class="card-head"><h2>By message</h2><span class="muted small">Newest first. Clearing deletes those reports.</span></div>
      ${groups.length ? html`<div class="toolbar"><label>Filter<input type="search" data-filter placeholder="Message, page or browser"></label>${apps.length > 1 ? html`<label class="narrow">App<select data-app><option value="">All apps</option>${apps.map(a => html`<option>${a}</option>`)}</select></label>` : ''}<span class="muted small" data-shown></span></div>
      <div class="stack">${groups.map((g, i) => html`<details class="collapse error-group" data-i="${i}">
        <summary><strong>${g.message || '(no message)'}</strong> ${new Date(g.first) >= since ? badge('New', 'tone-new') : ''}<br><span class="muted small">${g.app} · ${fmtNum(g.n)} times · ${fmtNum(g.users)} signed-in users · last ${rel(g.last)} · first ${rel(g.first)}</span></summary>
        <dl class="kv" style="margin-top:10px"><dt>Page</dt><dd class="mono small">${g.url || '—'}</dd><dt>Browser</dt><dd class="small">${g.user_agent || '—'}</dd><dt>Last seen</dt><dd>${fmtDate(g.last)}</dd></dl>
        ${g.stack ? html`<pre class="mono small stack-trace">${g.stack}</pre>` : ''}
        <div class="row" style="margin-top:8px">${g.stack ? html`<button type="button" class="sm ghost" data-copy="${i}">Copy details</button>` : ''}<button type="button" class="sm danger" data-clear="${i}">Clear ${fmtNum(g.n)} reports</button></div></details>`)}</div>` : empty('No errors in this window.')}</section>`.s;
  const filter = qs('[data-filter]', ctx.el), appSel = qs('[data-app]', ctx.el), shown = qs('[data-shown]', ctx.el);
  const apply = () => { const q = (filter?.value || '').toLowerCase(), a = appSel?.value || ''; let n = 0;
    qsa('[data-i]', ctx.el).forEach(el => { const g = groups[+el.dataset.i]; const ok = (!a || g.app === a) && (!q || [g.message, g.url, g.user_agent].some(x => (x || '').toLowerCase().includes(q))); el.hidden = !ok; n += ok; });
    if (shown) shown.textContent = n === groups.length ? '' : `${n} of ${groups.length} shown`; };
  if (filter) filter.oninput = debounce(apply, 120); if (appSel) appSel.onchange = apply;
  qsa('[data-copy]', ctx.el).forEach(b => b.onclick = async () => { const g = groups[+b.dataset.copy];
    ctx.notice(await copy(`${g.message}\n${g.app} · ${g.n} times · last ${g.last}\nPage: ${g.url || '-'}\nBrowser: ${g.user_agent || '-'}\n\n${g.stack || ''}`) ? 'Copied.' : 'Copy failed.'); });
  qsa('[data-days]', ctx.el).forEach(b => b.onclick = () => { location.hash = '/errors?days=' + b.dataset.days; });
  qsa('[data-clear]', ctx.el).forEach(b => b.onclick = async () => {
    const g = groups[+b.dataset.clear]; if (!confirm(`Delete ${g.n} reports of "${(g.message || '').slice(0, 80)}"?`)) return;
    b.disabled = true;
    try { await api.clearErrors(g.ids); ctx.notice('Cleared.'); if (ctx.alive()) await errors(ctx); } catch (e) { ctx.fail(e); b.disabled = false; }
  });
}
