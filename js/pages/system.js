// System: database and storage health, retention tools.
'use strict';
import { html, raw, qs, fmtDate, fmtNum, fmtBytes, rel, table, upgradeCard } from '../util.js';
import * as api from '../api.js';
import { versionsCard, loadSiteLive } from '../versions.js';

export default async function system(ctx) {
  let s;
  try { s = await api.system(); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const tile = (v, l, sub) => html`<div class="tile"><strong>${v}</strong><span>${l}</span>${sub ? html`<em class="delta muted" style="color:var(--muted)">${sub}</em>` : ''}</div>`;
  ctx.el.innerHTML = html`
    <div class="tiles">
      ${tile(fmtBytes(s.database_bytes), 'Database size', 'Postgres ' + String(s.postgres_version).split(' ')[0])}
      ${tile(fmtNum(s.reports?.count), 'Traffic reports', s.reports?.oldest ? 'oldest ' + rel(s.reports.oldest) : 'none')}
      ${tile(fmtNum(s.feedback?.count), 'Feedback items', fmtNum(s.feedback?.with_screenshot) + ' with screenshots')}
      ${tile(fmtBytes(s.screenshots?.bytes), 'Screenshot storage', fmtNum(s.screenshots?.count) + ' files')}
      ${tile(fmtNum(s.sessions?.count), 'Active sessions', fmtNum(s.sessions?.users) + ' users signed in')}
      ${tile(fmtNum(s.audit_rows), 'Audit entries', 'since Tower v3')}
    </div>
    <div data-versions style="margin-top:18px"></div>
    <div class="grid two" style="margin-top:18px">
      <section class="card"><div class="card-head"><h2>Tables</h2><span class="muted small">Live row estimates</span></div>
        ${table(['Table', 'Rows', 'Size'], (s.tables || []).map(t => [html`<span class="mono">${t.name}</span>`, fmtNum(t.rows), fmtBytes(t.bytes)]))}</section>
      <section class="card danger-zone"><div class="card-head"><h2>Retention</h2></div>
        <p class="muted small">Traffic reports are short-lived by design. Purging old ones keeps the table small and removes stale pins from the map. Feedback is never purged from here; delete items one at a time from their record page.</p>
        <form data-purge class="row" style="margin-top:12px"><label class="narrow" style="flex:0 1 220px">Delete reports older than<select name="days">${[7, 14, 30, 90].map(d => html`<option value="${d}" ${raw(d === 30 ? 'selected' : '')}>${d} days</option>`)}</select></label><button class="danger" type="submit">Purge reports</button></form>
        <p class="muted small" style="margin-top:12px">Every purge is written to the audit log with the count removed.</p>
        <p class="muted small" style="margin-top:14px">Generated ${fmtDate(s.generated_at)}. <a href="#/system">Refresh</a></p></section>
    </div>`.s;
  api.versions().then(v => { if (ctx.alive()) { const host = qs('[data-versions]', ctx.el); host.innerHTML = versionsCard(v, { detailed: true }).s; loadSiteLive(host, v.released); } }).catch(e => { if (!e.needsUpgrade) ctx.fail(e); });
  qs('[data-purge]', ctx.el).onsubmit = async e => {
    e.preventDefault(); const days = Number(new FormData(e.currentTarget).get('days'));
    if (!confirm(`Permanently delete every traffic report older than ${days} days? This cannot be undone.`)) return;
    const b = e.currentTarget.querySelector('button'); b.disabled = true;
    try { const n = await api.purgeReports(days); ctx.notice(`${n} report${n === 1 ? '' : 's'} purged.`); await ctx.refreshStats(); if (ctx.alive()) await system(ctx); } catch (err) { ctx.fail(err); b.disabled = false; }
  };
}
