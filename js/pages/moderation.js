// Moderation: community traffic reports others flagged, who flags the most, and reporters blocked from posting.
// Two flags on a report remove it automatically (database trigger); blocking stops a user from filing reports.
'use strict';
import { html, qsa, fmtNum, rel, href, table, badge, mapsLink, upgradeCard } from '../util.js';
import * as api from '../api.js';
import { state } from '../app.js';

export default async function moderation(ctx) {
  let d;
  try { d = await api.moderation(); } catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const ids = [...(d.flagged || []).map(f => f.reporter), ...(d.flaggers || []).map(f => f.user_id), ...(d.blocked || []).map(b => b.user_id)];
  const label = await api.labels(ids); if (!ctx.alive()) return;
  const who = id => id ? html`<a href="${href('/users/' + id)}">${label(id)?.email || id.slice(0, 8)}</a>` : '—';
  const canWrite = state.role !== 'viewer';
  const blocked = new Set((d.blocked || []).map(b => b.user_id));
  const blockBtn = id => canWrite && id && !blocked.has(id) ? html`<button type="button" class="sm ghost" data-block="${id}">Block</button>` : '';
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
        ${table(['User', 'Reason', 'Since', ''], (d.blocked || []).map(b => [who(b.user_id), b.reason || '—', rel(b.created_at), canWrite ? html`<button type="button" class="sm ghost" data-unblock="${b.user_id}" data-who="${label(b.user_id)?.email || b.user_id.slice(0, 8)}">Unblock</button>` : '']), { emptyText: 'No one is blocked.' })}
        ${canWrite ? html`<form class="row" data-block-form style="margin-top:12px;align-items:flex-end"><label style="flex:1">Block a reporter<input name="id" placeholder="Email or user ID" required autocomplete="off"></label><button class="danger sm">Block</button></form>` : ''}</section>
    </div>`.s;
  const act = async (b, fn, msg) => { b.disabled = true; try { await fn(); if (!ctx.alive()) return; ctx.notice(msg); await moderation(ctx); } catch (e) { if (ctx.alive()) { ctx.fail(e); b.disabled = false; } } };
  qsa('[data-block]', ctx.el).forEach(b => b.onclick = () => { if (!canWrite) return; const reason = prompt(`Block ${label(b.dataset.block)?.email || b.dataset.block.slice(0, 8)} from filing traffic reports?\nReason (shown to admins only):`, 'Repeated false reports'); if (reason !== null) act(b, () => api.blockReporter(b.dataset.block, reason), 'Reporter blocked.'); });
  qsa('[data-unblock]', ctx.el).forEach(b => b.onclick = () => canWrite && confirm(`Unblock ${b.dataset.who}? They can file traffic reports again.`) && act(b, () => api.unblockReporter(b.dataset.unblock), 'Reporter unblocked.'));
  const form = ctx.el.querySelector('[data-block-form]');
  if (form) form.onsubmit = async e => { e.preventDefault(); if (!canWrite) return;
    const btn = form.querySelector('button'), q = new FormData(form).get('id').trim();
    btn.disabled = true;
    try {
      let id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q) ? q.toLowerCase() : null;
      if (!id) { if (!q.includes('@')) throw new Error('Enter an email address or a full user ID.'); id = await api.userByEmail(q); if (!id) throw new Error(`No account with the email ${q}.`); }
      if (!ctx.alive()) return;
      if (blocked.has(id)) { ctx.notice('Already blocked.'); return; }
      const reason = prompt(`Block ${q}${q.toLowerCase() === id ? '' : ' (' + id.slice(0, 8) + '…)'} from filing traffic reports?\nReason (shown to admins only):`, 'Repeated false reports');
      if (reason === null || !ctx.alive()) return;
      await api.blockReporter(id, reason); if (!ctx.alive()) return; ctx.notice('Reporter blocked.'); await moderation(ctx);
    } catch (err) { if (ctx.alive()) ctx.fail(err); } finally { btn.disabled = false; } };
}
