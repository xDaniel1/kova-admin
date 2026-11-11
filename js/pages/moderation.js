// Moderation: community traffic reports others flagged, who flags the most, and reporters blocked from posting.
// Two flags on a report remove it automatically (database trigger); blocking stops a user from filing reports.
'use strict';
import { html, raw, qsa, fmtNum, fmtDate, rel, href, table, badge, mapsLink, upgradeCard, empty } from '../util.js';
import * as api from '../api.js';

export default async function moderation(ctx) {
  let d;
  try { d = await api.moderation(); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const ids = [...(d.flagged || []).map(f => f.reporter), ...(d.flaggers || []).map(f => f.user_id), ...(d.blocked || []).map(b => b.user_id)];
  const label = await api.labels(ids); if (!ctx.alive()) return;
  const who = id => id ? html`<a href="${href('/users/' + id)}">${label(id)?.email || id.slice(0, 8)}</a>` : '—';
  const blocked = new Set((d.blocked || []).map(b => b.user_id));
  const blockBtn = id => id && !blocked.has(id) ? html`<button type="button" class="sm ghost" data-block="${id}">Block</button>` : '';
  ctx.el.innerHTML = html`
    <section class="card"><div class="card-head"><h2>Flagged reports</h2><span class="muted small">${fmtNum(d.flags_30d)} flags in 30 days · two flags remove a report</span></div>
      ${table(['Report', 'Flags', 'Last flag', 'Reporter', 'Status', ''], (d.flagged || []).map(f => [
        f.removed ? html`<span class="muted">${f.report_id.slice(0, 8)}</span>` : html`<a href="${href('/reports/' + f.report_id)}">${f.kind || 'Report'}</a><br><span class="small">${mapsLink(f.latitude, f.longitude)}</span>`,
        fmtNum(f.flags), rel(f.last), who(f.reporter), f.removed ? badge('Removed', 'tone-done') : badge('Live', 'tone-seen'), blockBtn(f.reporter)]),
        { emptyText: 'No reports have been flagged.' })}</section>
    <div class="grid two" style="margin-top:18px">
      <section class="card"><div class="card-head"><h2>Most flags given · 30 days</h2></div>
        ${table(['User', 'Flags', 'Last'], (d.flaggers || []).map(f => [who(f.user_id), fmtNum(f.flags), rel(f.last)]), { emptyText: 'Nobody has flagged anything.' })}</section>
      <section class="card"><div class="card-head"><h2>Blocked reporters</h2><span class="muted small">Cannot file traffic reports</span></div>
        ${table(['User', 'Reason', 'Since', ''], (d.blocked || []).map(b => [who(b.user_id), b.reason || '—', rel(b.created_at), html`<button type="button" class="sm ghost" data-unblock="${b.user_id}">Unblock</button>`]), { emptyText: 'No one is blocked.' })}
        <form class="row" data-block-form style="margin-top:12px"><input name="id" placeholder="User ID to block" required pattern="[0-9a-fA-F-]{36}" style="flex:1"><button class="danger sm">Block</button></form></section>
    </div>`.s;
  const act = async (b, fn, msg) => { b.disabled = true; try { await fn(); ctx.notice(msg); if (ctx.alive()) await moderation(ctx); } catch (e) { ctx.fail(e); b.disabled = false; } };
  qsa('[data-block]', ctx.el).forEach(b => b.onclick = () => { const reason = prompt('Reason (shown to admins only):', 'Repeated false reports'); if (reason !== null) act(b, () => api.blockReporter(b.dataset.block, reason), 'Reporter blocked.'); });
  qsa('[data-unblock]', ctx.el).forEach(b => b.onclick = () => act(b, () => api.unblockReporter(b.dataset.unblock), 'Reporter unblocked.'));
  const form = ctx.el.querySelector('[data-block-form]');
  form.onsubmit = e => { e.preventDefault(); const id = new FormData(form).get('id').trim(), reason = prompt('Reason:', ''); if (reason !== null) act(form.querySelector('button'), () => api.blockReporter(id, reason), 'Reporter blocked.'); };
}
