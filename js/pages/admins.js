// Who can open Tower. Granting and revoking go through admin_grant / admin_revoke.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, href, table, badge, upgradeCard, debounce } from '../util.js';
import * as api from '../api.js';

export default async function admins(ctx) {
  ctx.el.innerHTML = html`<div class="grid two">
    <section class="card"><div class="card-head"><h2>Admins</h2><span class="muted small">Everyone here sees all user data</span></div><div data-list><p class="loading">Loading…</p></div></section>
    <section class="card"><h2>Add an admin</h2><p class="muted small">The person must have signed in to Kova Maps (or Tower) at least once so an account exists. Search by email, then grant.</p>
      <label>Find account<input data-find type="search" placeholder="Start typing an email…" autocomplete="off"></label><div data-matches style="margin-top:10px"></div></section>
  </div>`.s;
  const list = qs('[data-list]', ctx.el), matches = qs('[data-matches]', ctx.el), find = qs('[data-find]', ctx.el);
  async function load() {
    let rows; try { rows = await api.admins(); } catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { list.innerHTML = upgradeCard(); find.disabled = true; return; } throw e; }
    if (!ctx.alive()) return;
    list.innerHTML = table(['Admin', 'Added', 'Last sign-in', ''], rows.map(a => [html`<a href="${href('/users/' + a.user_id)}">${a.email || a.user_id}</a>${a.user_id === ctx.user.id ? html` ${badge('You')}` : ''}`, fmtDate(a.added_at), a.last_sign_in_at ? rel(a.last_sign_in_at) : 'Never', html`<button type="button" class="sm danger" data-revoke="${a.user_id}" data-email="${a.email || a.user_id}" ${raw(a.user_id === ctx.user.id ? 'disabled title="You cannot remove yourself"' : '')}>Revoke</button>`]), { emptyText: 'No admins listed.' }).s;
    qsa('[data-revoke]', list).forEach(b => b.onclick = async () => { if (!confirm(`Remove admin access from ${b.dataset.email}?`)) return; b.disabled = true; try { await api.revokeAdmin(b.dataset.revoke); ctx.notice('Admin access revoked.'); await ctx.refreshStats(); await load(); } catch (err) { ctx.fail(err); b.disabled = false; } });
  }
  find.oninput = debounce(async () => {
    const q = find.value.trim(); if (q.length < 2) { matches.innerHTML = ''; return; }
    try {
      const res = await api.search(q); if (!ctx.alive() || find.value.trim() !== q) return;
      const users = res.users || [];
      matches.innerHTML = users.length ? table(['Account', 'Last sign-in', ''], users.map(u => [html`${u.display_name ? html`<strong>${u.display_name}</strong><br>` : ''}${u.email || u.user_id}`, u.last_sign_in_at ? rel(u.last_sign_in_at) : 'Never', html`<button type="button" class="sm primary" data-grant="${u.user_id}" data-email="${u.email || u.user_id}">Grant admin</button>`])).s : '<p class="empty">No accounts match.</p>';
      qsa('[data-grant]', matches).forEach(b => b.onclick = async () => { if (!confirm(`Give ${b.dataset.email} full admin access to Tower?`)) return; b.disabled = true; try { await api.grantAdmin(b.dataset.grant); ctx.notice('Admin access granted.'); find.value = ''; matches.innerHTML = ''; await ctx.refreshStats(); await load(); } catch (err) { ctx.fail(err); b.disabled = false; } });
    } catch (e) { if (ctx.alive()) matches.innerHTML = e.needsUpgrade ? upgradeCard() : html`<p class="muted">${e.message}</p>`.s; }
  }, 300);
  await load();
}
