// Who can open Tower, with what role, and who gets the daily digest.
'use strict';
import { html, raw, qs, qsa, fmtDate, fmtNum, rel, href, table, badge, upgradeCard, debounce, empty } from '../util.js';
import * as api from '../api.js';
import { state } from '../app.js';

const ROLES = [['owner', 'Owner', 'Everything, including accounts and admin access'], ['editor', 'Editor', 'All edits except accounts and admin access'], ['viewer', 'Viewer', 'Read-only']];
const roleSelect = (value, attrs = '') => html`<select ${raw(attrs)}>${ROLES.map(([v, l]) => html`<option value="${v}" ${raw(v === value ? 'selected' : '')}>${l}</option>`)}</select>`;

export default async function admins(ctx) {
  const owner = state.role === 'owner';
  ctx.el.innerHTML = html`<div class="grid two">
    <section class="card"><div class="card-head"><h2>Admins</h2><span class="muted small">Roles are enforced by the database</span></div><div data-list><p class="loading">Loading…</p></div>
      <dl class="kv" style="margin-top:14px">${ROLES.map(([, l, d]) => html`<dt>${l}</dt><dd class="muted small">${d}</dd>`)}</dl></section>
    <div class="stack">
      ${owner ? html`<section class="card"><h2>Add an admin</h2><p class="muted small">The person must have signed in to Kova Maps or Tower once. Search by email, choose a role, grant.</p>
        <div class="form-grid" style="margin-top:10px"><label>Find account<input data-find type="search" placeholder="Start typing an email…" autocomplete="off"></label><label>Role${roleSelect('editor', 'data-newrole')}</label></div><div data-matches style="margin-top:10px"></div></section>` : ''}
      <section class="card"><div class="card-head"><h2>Daily digest</h2><label class="inline" style="margin:0"><input type="checkbox" data-digest> Email me</label></div>
        <p class="muted small" style="margin-top:-4px">A morning email with sign-ups, reports, new feedback and admin actions from the last 24 hours. Preview of what it would say right now:</p>
        <div data-preview><p class="loading">Loading…</p></div></section>
    </div></div>`.s;
  const list = qs('[data-list]', ctx.el);
  async function load() {
    let rows; try { rows = await api.admins(); } catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { list.innerHTML = upgradeCard(); return; } throw e; }
    if (!ctx.alive()) return;
    const me = rows.find(a => a.user_id === ctx.user.id);
    const dg = qs('[data-digest]', ctx.el); if (me && 'digest' in me) dg.checked = !!me.digest; else dg.disabled = true;
    dg.onchange = async () => { try { await api.setDigest(dg.checked); ctx.notice(dg.checked ? 'You will get the daily digest.' : 'Digest turned off.'); } catch (e) { dg.checked = !dg.checked; ctx.fail(e); } };
    list.innerHTML = table(['Admin', 'Role', 'Last sign-in', ''], rows.map(a => [
      html`<a href="${href('/users/' + a.user_id)}">${a.email || a.user_id}</a>${a.user_id === ctx.user.id ? html` ${badge('You')}` : ''}<br><span class="muted small">added ${fmtDate(a.added_at)}</span>`,
      a.role ? (owner && a.user_id !== ctx.user.id ? roleSelect(a.role, `data-role="${a.user_id}"`) : badge(a.role, a.role === 'owner' ? 'accent' : '')) : '—',
      a.last_sign_in_at ? rel(a.last_sign_in_at) : 'Never',
      owner && a.user_id !== ctx.user.id ? html`<button type="button" class="sm danger" data-revoke="${a.user_id}" data-email="${a.email || a.user_id}">Revoke</button>` : '',
    ]), { emptyText: 'No admins listed.' }).s;
    qsa('[data-role]', list).forEach(s => s.onchange = async () => { try { await api.setRole(s.dataset.role, s.value); ctx.notice('Role updated.'); } catch (e) { ctx.fail(e); await load(); } });
    qsa('[data-revoke]', list).forEach(b => b.onclick = async () => { if (!confirm(`Remove admin access from ${b.dataset.email}?`)) return; b.disabled = true; try { await api.revokeAdmin(b.dataset.revoke); ctx.notice('Admin access revoked.'); await ctx.refreshStats(); await load(); } catch (err) { ctx.fail(err); b.disabled = false; } });
  }
  const find = qs('[data-find]', ctx.el), matches = qs('[data-matches]', ctx.el);
  if (find) find.oninput = debounce(async () => {
    const q = find.value.trim(); if (q.length < 2) { matches.innerHTML = ''; return; }
    try {
      const res = await api.search(q); if (!ctx.alive() || find.value.trim() !== q) return;
      const users = res.users || [];
      matches.innerHTML = users.length ? table(['Account', 'Last sign-in', ''], users.map(u => [html`${u.display_name ? html`<strong>${u.display_name}</strong><br>` : ''}${u.email || u.user_id}`, u.last_sign_in_at ? rel(u.last_sign_in_at) : 'Never', html`<button type="button" class="sm primary" data-grant="${u.user_id}" data-email="${u.email || u.user_id}">Grant</button>`])).s : empty('No accounts match.').s;
      qsa('[data-grant]', matches).forEach(b => b.onclick = async () => { const role = qs('[data-newrole]', ctx.el).value; if (!confirm(`Give ${b.dataset.email} ${role} access to Tower?`)) return; b.disabled = true; try { await api.grantAdmin(b.dataset.grant, role); ctx.notice('Admin access granted.'); find.value = ''; matches.innerHTML = ''; await ctx.refreshStats(); await load(); } catch (err) { ctx.fail(err); b.disabled = false; } });
    } catch (e) { if (ctx.alive()) matches.innerHTML = e.needsUpgrade ? upgradeCard() : html`<p class="muted">${e.message}</p>`.s; }
  }, 300);
  const preview = qs('[data-preview]', ctx.el);
  (async () => {
    try { const d = await api.digest(); if (!ctx.alive()) return;
      preview.innerHTML = html`<dl class="kv"><dt>New sign-ups</dt><dd>${fmtNum(d.signups)}</dd><dt>Active users</dt><dd>${fmtNum(d.active_users)} of ${fmtNum(d.total_users)}</dd><dt>Traffic reports</dt><dd>${fmtNum(d.reports)}</dd><dt>New feedback</dt><dd>${fmtNum(d.feedback)} <span class="muted small">(${fmtNum(d.feedback_new_total)} untriaged in total)</span></dd><dt>Admin actions</dt><dd>${fmtNum(d.admin_actions)}</dd><dt>Recipients</dt><dd class="small">${(d.recipients || []).join(', ') || 'nobody opted in'}</dd></dl>`.s;
    } catch (e) { if (ctx.alive()) preview.innerHTML = e.needsUpgrade ? '<p class="muted small">Needs <code>supabase/migrations/0005_messages_roles.sql</code>.</p>' : html`<p class="muted small">${e.message}</p>`.s; }
  })();
  await load();
}
