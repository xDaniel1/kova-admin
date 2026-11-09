// Traffic reports from the app, and a record page per report.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, href, table, mapsLink, badge, upgradeCard, downloadCSV } from '../util.js';
import * as api from '../api.js';
import { annotations, auditList, tagChips } from '../records.js';

const KINDS = ['Accident', 'Hazard', 'Road Closed', 'Slow Traffic', 'Speed Trap'];

export default async function reports(ctx) {
  const q = { days: Number(ctx.query.days) || 7, kind: ctx.query.kind || '' };
  ctx.el.innerHTML = html`<section class="card">
    <form class="toolbar" data-filter>
      <label class="narrow">Range<select name="days">${[[1, 'Last 24 hours'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([d, l]) => html`<option value="${d}" ${raw(d === q.days ? 'selected' : '')}>${l}</option>`)}</select></label>
      <label class="narrow">Kind<select name="kind"><option value="">All kinds</option>${KINDS.map(k => html`<option ${raw(k === q.kind ? 'selected' : '')}>${k}</option>`)}</select></label>
      <span class="spacer"></span><button type="button" class="ghost" data-export title="Download the loaded rows as CSV">Export CSV</button>
    </form>
    <p class="muted small" style="margin:-6px 0 12px">Reports expire by design; this is not a historical archive. Purge old ones from <a href="#/system">System</a>.</p>
    <div data-list><p class="loading">Loading…</p></div>
    <div class="paging"><button data-more hidden>Load more</button><span class="muted small" data-status></span></div>
  </section>`.s;
  const form = qs('[data-filter]', ctx.el);
  qsa('select', form).forEach(s => s.onchange = () => { const f = new FormData(form); location.hash = href('/reports', { days: f.get('days'), kind: f.get('kind') }).slice(1); });
  const list = qs('[data-list]', ctx.el), more = qs('[data-more]', ctx.el), status = qs('[data-status]', ctx.el);
  let rows = [];
  qs('[data-export]', ctx.el).onclick = () => downloadCSV('reports', ['id', 'created_at', 'kind', 'latitude', 'longitude', 'user_id', 'reporter_email'], rows.map(r => [r.id, r.created_at, r.kind, r.latitude, r.longitude, r.user_id, api.labelFor(r.user_id)?.email]));
  async function load(offset = 0) {
    more.disabled = true;
    const page = await api.reports({ ...q, offset }); if (!ctx.alive()) return;
    rows = offset ? rows.concat(page) : page;
    const label = await api.labels(rows.map(r => r.user_id)); if (!ctx.alive()) return;
    let tags = {}; try { tags = await api.tagsFor('report', rows.map(r => r.id)); } catch (e) { if (!e.needsUpgrade) throw e; }
    if (!ctx.alive()) return;
    list.innerHTML = table(['Kind', 'When', 'Location', 'Reporter', 'Tags'], rows.map(r => [r.kind, html`<span title="${fmtDate(r.created_at)}">${rel(r.created_at)}</span>`, mapsLink(r.latitude, r.longitude), html`<a href="${href('/users/' + r.user_id)}">${label(r.user_id)?.email || r.user_id.slice(0, 8)}</a>`, html`<span class="chips">${tagChips(tags[r.id])}</span>`]), { clickable: true, rowAttr: i => `data-id="${rows[i].id}"`, emptyText: 'No reports in this window.' }).s;
    qsa('tr[data-id]', list).forEach(tr => tr.onclick = e => { if (e.target.closest('a')) return; location.hash = '/reports/' + tr.dataset.id; });
    more.hidden = page.length < api.PAGE; more.disabled = false; status.textContent = `${rows.length} shown`;
  }
  more.onclick = () => load(rows.length).catch(ctx.fail);
  await load();
}

export async function reportDetail(ctx) {
  const id = ctx.params[0];
  const r = await api.reportOne(id); if (!ctx.alive()) return;
  if (!r) { ctx.el.innerHTML = '<section class="card"><h2>Report not found</h2><p class="muted">It may have been purged. <a href="#/reports">Back to reports</a></p></section>'; return; }
  ctx.title(r.kind + ' report');
  const label = (await api.labels([r.user_id]))(r.user_id); if (!ctx.alive()) return;
  ctx.el.innerHTML = html`
    <p class="breadcrumb"><a href="#/reports">Reports</a> / ${id.slice(0, 8)}</p>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>${r.kind}</h2>${badge(rel(r.created_at))}</div>
        <dl class="kv"><dt>Reported</dt><dd>${fmtDate(r.created_at)}</dd><dt>Location</dt><dd>${mapsLink(r.latitude, r.longitude)}</dd>
        <dt>Reporter</dt><dd><a href="${href('/users/' + r.user_id)}">${label?.display_name || label?.email || r.user_id}</a></dd><dt>ID</dt><dd class="mono">${r.id}</dd></dl>
        <p class="muted small" style="margin-top:14px">Reports expire automatically in the app. Tag one to keep track of a pattern (e.g. <code>false-report</code>) before it is purged.</p>
        <div class="row" style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)"><button type="button" class="danger sm" data-delete>Delete this report</button><span class="muted small">Removes the pin from every map. Audited.</span></div></section>
      <div class="stack"><section class="card" data-annotations></section><section class="card"><h2>Admin history</h2><div data-audit></div></section></div>
    </div>`.s;
  qs('[data-delete]', ctx.el).onclick = async e => { if (!confirm('Delete this report? This cannot be undone.')) return; e.currentTarget.disabled = true; try { await api.deleteReport(id); ctx.notice('Report deleted.'); await ctx.refreshStats(); location.hash = '/reports'; } catch (err) { ctx.fail(err); e.currentTarget.disabled = false; } };
  await Promise.all([annotations(qs('[data-annotations]', ctx.el), 'report', id, ctx), auditList(qs('[data-audit]', ctx.el), 'report', id, ctx)]);
}
