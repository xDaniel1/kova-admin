// The user directory and per-user profile pages. Account actions call the admin_* functions,
// which refuse to act on the signed-in admin's own account.
'use strict';
import { html, raw, qs, qsa, fmtDate, fmtNum, rel, href, badge, table, initials, mapsLink, kindLabel, statusTone, copy, upgradeCard, empty, downloadCSV } from '../util.js';
import * as api from '../api.js';
import { annotations, auditList } from '../records.js';

const FILTERS = [['', 'Everyone'], ['admins', 'Admins'], ['disabled', 'Disabled'], ['sync', 'With sync'], ['reporters', 'Has reported']];
const isBanned = u => u.banned_until && new Date(u.banned_until) > new Date();
const flags = u => html`${u.is_admin ? badge('Admin', 'accent') : ''} ${isBanned(u) ? badge('Disabled', 'danger') : ''}`;
const userLabel = u => u.display_name ? html`<strong>${u.display_name}</strong><br><span class="muted small">${u.email || 'No email'}</span>` : html`<strong>${u.email || 'No email'}</strong>`;

export default async function users(ctx) {
  const q = { search: ctx.query.q || '', sort: ctx.query.sort || 'desc', filter: ctx.query.filter || '' };
  ctx.el.innerHTML = html`<section class="card">
    <form class="toolbar" data-filter>
      <label>Search<input name="q" type="search" value="${q.search}" placeholder="Email or name contains…"></label>
      <label class="narrow">Show<select name="filter">${FILTERS.map(([v, l]) => html`<option value="${v}" ${raw(v === q.filter ? 'selected' : '')}>${l}</option>`)}</select></label>
      <label class="narrow">Last sign-in<select name="sort"><option value="desc" ${raw(q.sort === 'desc' ? 'selected' : '')}>Newest first</option><option value="asc" ${raw(q.sort === 'asc' ? 'selected' : '')}>Oldest first</option></select></label>
      <button type="submit">Apply</button><button type="button" class="ghost" data-export title="Download the loaded rows as CSV">Export CSV</button>
    </form>
    <div data-list><p class="loading">Loading…</p></div>
    <div class="paging"><button data-more hidden>Load more</button><span class="muted small" data-status></span></div>
  </section>`.s;
  const form = qs('[data-filter]', ctx.el);
  qs('[data-export]', ctx.el).onclick = () => downloadCSV('users', ['user_id', 'email', 'display_name', 'provider', 'created_at', 'last_sign_in_at', 'reports_count', 'feedback_count', 'has_sync', 'favorites_count', 'recents_count', 'is_admin', 'banned_until'], rows.map(u => [u.user_id, u.email, u.display_name, u.provider, u.created_at, u.last_sign_in_at, u.reports_count, u.feedback_count, u.has_sync, u.favorites_count, u.recents_count, u.is_admin, u.banned_until]));
  form.onsubmit = e => { e.preventDefault(); const f = new FormData(form); location.hash = href('/users', { q: f.get('q').trim(), filter: f.get('filter'), sort: f.get('sort') }).slice(1); };
  qsa('select', form).forEach(s => s.onchange = () => form.requestSubmit());
  const list = qs('[data-list]', ctx.el), more = qs('[data-more]', ctx.el), status = qs('[data-status]', ctx.el);
  let rows = [];
  async function load(offset = 0) {
    more.disabled = true;
    const page = await api.users({ ...q, offset });
    if (!ctx.alive()) return;
    rows = offset ? rows.concat(page) : page;
    list.innerHTML = table(['User', 'Provider', 'Joined', 'Last sign-in', 'Reports', 'Feedback', 'Sync', ''], rows.map(u => [
      html`${userLabel(u)}<br><span class="mono muted">${u.user_id.slice(0, 8)}</span>`, u.provider || '—', html`<span title="${fmtDate(u.created_at)}">${rel(u.created_at)}</span>`,
      html`<span title="${fmtDate(u.last_sign_in_at)}">${u.last_sign_in_at ? rel(u.last_sign_in_at) : 'Never'}</span>`, fmtNum(u.reports_count), u.feedback_count != null ? fmtNum(u.feedback_count) : '—',
      u.has_sync ? html`<span title="${fmtDate(u.sync_updated_at)}">${u.favorites_count != null ? `${u.favorites_count} fav · ${u.recents_count} recent` : 'Saved'}</span>` : html`<span class="muted">None</span>`, flags(u),
    ]), { clickable: true, rowAttr: i => `data-user="${rows[i].user_id}"`, emptyText: 'No users match.' }).s;
    qsa('tr[data-user]', list).forEach(tr => tr.onclick = e => { if (e.target.closest('a')) return; location.hash = '/users/' + tr.dataset.user; });
    more.hidden = page.length < api.PAGE; more.disabled = false;
    status.textContent = `${rows.length} shown`;
  }
  more.onclick = () => load(rows.length).catch(ctx.fail);
  await load();
}

export async function userProfile(ctx) {
  const id = ctx.params[0];
  let u;
  try { u = await api.userDetail(id); } catch (e) { if (e.needsUpgrade) { await legacyProfile(ctx, id); return; } throw e; }
  if (!ctx.alive()) return;
  if (!u) { ctx.el.innerHTML = '<section class="card"><h2>User not found</h2><p class="muted">This account may have been deleted. <a href="#/users">Back to users</a>.</p></section>'; return; }
  ctx.title(u.display_name || u.email || 'User');
  const self = u.user_id === ctx.user.id, banned = isBanned(u);
  const tabs = [['overview', 'Overview'], ['places', 'Saved places'], ['reports', `Reports (${fmtNum(u.reports_count)})`], ['feedback', `Feedback (${fmtNum(u.feedback_count)})`], ['notes', 'Notes & tags'], ['history', 'Admin history']];
  const tab = ctx.query.tab || 'overview';
  ctx.el.innerHTML = html`
    <p class="breadcrumb"><a href="#/users">Users</a> / ${u.email || u.user_id}</p>
    <section class="card">
      <div class="profile-head">
        <div class="avatar">${u.avatar_url ? html`<img src="${u.avatar_url}" alt="" referrerpolicy="no-referrer">` : initials(u.display_name, u.email)}</div>
        <div class="who"><h2>${u.display_name || u.email || 'No email'}</h2><p class="muted" style="margin:0">${u.display_name ? u.email + ' · ' : ''}<span class="mono">${u.user_id}</span> <button type="button" class="sm ghost" data-copy="${u.user_id}">Copy ID</button></p>
          <div class="chips" style="margin-top:6px">${u.is_admin ? badge('Admin', 'accent') : ''}${banned ? badge('Disabled until ' + fmtDate(u.banned_until), 'danger') : badge('Active', 'ok')}${self ? badge('This is you') : ''}${u.email_confirmed_at ? '' : badge('Email unconfirmed', 'tone-seen')}</div></div>
        <div class="actions row">
          ${banned ? html`<button type="button" data-act="enable" ${raw(self ? 'disabled' : '')}>Enable account</button>` : html`<button type="button" data-act="disable" ${raw(self ? 'disabled' : '')}>Disable account</button>`}
          ${u.is_admin ? html`<button type="button" data-act="revoke" ${raw(self ? 'disabled' : '')}>Revoke admin</button>` : html`<button type="button" data-act="grant">Make admin</button>`}
          <a class="btn" href="${href('/messages', { to: u.user_id })}">Send message</a>
          <button type="button" data-act="signout" ${raw(self ? 'disabled' : '')} title="Revoke every session on every device">Sign out everywhere</button>
          <button type="button" class="danger" data-act="delete" ${raw(self ? 'disabled' : '')}>Delete account</button>
        </div>
      </div>
      <div class="tiles" style="margin-top:16px">
        <div class="tile"><strong>${fmtNum(u.reports_count)}</strong><span>Traffic reports</span></div>
        <div class="tile"><strong>${fmtNum(u.feedback_count)}</strong><span>Feedback sent</span></div>
        <div class="tile"><strong>${u.sync ? fmtNum(u.sync.favorites_count ?? 0) : '—'}</strong><span>Favorites synced</span></div>
        <div class="tile"><strong>${u.last_sign_in_at ? rel(u.last_sign_in_at).replace(' ago', '') : 'Never'}</strong><span>Since last sign-in</span></div>
      </div>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<button type="button" role="tab" data-tab="${k}" aria-selected="${String(k === tab)}">${l}</button>`)}</div>
      <div data-panel></div>
    </section>`.s;
  qs('[data-copy]', ctx.el).onclick = async e => { ctx.notice((await copy(e.currentTarget.dataset.copy)) ? 'User ID copied.' : 'Could not copy.'); };
  qsa('[data-tab]', ctx.el).forEach(b => b.onclick = () => { history.replaceState(null, '', href('/users/' + id, { tab: b.dataset.tab })); qsa('[data-tab]', ctx.el).forEach(x => x.setAttribute('aria-selected', String(x === b))); showTab(b.dataset.tab); });
  qsa('[data-act]', ctx.el).forEach(b => b.onclick = () => act(b.dataset.act));
  const panel = qs('[data-panel]', ctx.el);

  async function showTab(which) {
    panel.innerHTML = '<p class="loading">Loading…</p>';
    try {
      if (which === 'overview') {
        panel.innerHTML = html`<div class="grid two"><div><h3 class="muted small" style="margin-bottom:8px">Account</h3><dl class="kv">
            <dt>Email</dt><dd>${u.email || '—'}</dd><dt>Phone</dt><dd>${u.phone || '—'}</dd>
            <dt>Sign-in providers</dt><dd>${(u.identities || []).length ? u.identities.map(i => html`${i.provider} <span class="muted small">(linked ${rel(i.created_at)})</span>`).reduce((a, b) => html`${a}<br>${b}`) : (u.provider || '—')}</dd>
            <dt>Joined</dt><dd>${fmtDate(u.created_at)}</dd><dt>Last sign-in</dt><dd>${fmtDate(u.last_sign_in_at)}</dd><dt>Email confirmed</dt><dd>${u.email_confirmed_at ? fmtDate(u.email_confirmed_at) : 'No'}</dd>
            <dt>Status</dt><dd>${banned ? 'Disabled until ' + fmtDate(u.banned_until) : 'Active'}</dd></dl></div>
          <div><h3 class="muted small" style="margin-bottom:8px">Sync</h3>${u.sync ? html`<dl class="kv"><dt>Last synced</dt><dd>${fmtDate(u.sync.updated_at)}</dd><dt>Favorites</dt><dd>${fmtNum(u.sync.favorites_count)}</dd><dt>Recent searches</dt><dd>${fmtNum(u.sync.recents_count)}</dd></dl>` : html`<p class="muted">This user has never synced from the app.</p>`}</div></div>`.s;
      } else if (which === 'places') {
        const s = await api.userSync(id); if (!ctx.alive()) return;
        const favs = Array.isArray(s?.favorites) ? s.favorites : [], recents = Array.isArray(s?.recents) ? s.recents : [];
        panel.innerHTML = html`<p class="muted small">Private user data. Shown here for support purposes only.</p>
          <h3 style="margin:12px 0 6px">Favorites (${favs.length})</h3>${table(['Place', 'Address', 'Location'], favs.map(f => [html`${f.emoji ? f.emoji + ' ' : ''}${f.customTitle || f.title}${f.customTitle ? html` <span class="muted small">(${f.title})</span>` : ''}`, f.subtitle || '—', mapsLink(f.latitude, f.longitude)]), { emptyText: 'No favorites synced.' })}
          <h3 style="margin:18px 0 6px">Recent searches (${recents.length})</h3>${table(['Place', 'Address', 'When', 'Location'], recents.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map(r => [r.title, r.subtitle || '—', fmtDate(r.date), mapsLink(r.latitude, r.longitude)]), { emptyText: 'No recent searches synced.' })}`.s;
      } else if (which === 'reports') {
        const rows = await api.userReports(id); if (!ctx.alive()) return;
        panel.innerHTML = table(['Kind', 'When', 'Location', ''], rows.map(r => [r.kind, fmtDate(r.created_at), mapsLink(r.latitude, r.longitude), html`<a href="${href('/reports/' + r.id)}">Open</a>`]), { emptyText: 'No traffic reports from this user.' }).s;
      } else if (which === 'feedback') {
        const rows = await api.userFeedback(id); if (!ctx.alive()) return;
        panel.innerHTML = rows.length ? rows.map(r => html`<a class="feedback-item" href="${href('/feedback/' + r.id)}"><div class="top">${badge(kindLabel[r.kind] || r.kind)}${badge(r.status, statusTone[r.status])}<span>${fmtDate(r.created_at)}</span></div><p class="text">${r.message}</p></a>`).join('') : empty('No feedback from this user.').s;
      } else if (which === 'notes') {
        await annotations(panel, 'user', id, ctx);
      } else if (which === 'history') {
        await auditList(panel, 'user', id, ctx);
      }
    } catch (e) { if (ctx.alive()) panel.innerHTML = e.needsUpgrade ? upgradeCard() : html`<p class="muted">${e.message}</p>`.s; }
  }
  async function act(kind) {
    const who = u.email || u.user_id;
    try {
      if (kind === 'disable') {
        const answer = prompt(`Disable ${who}?\n\nThey will be signed out and unable to sign in. Enter a number of days, or leave blank to disable indefinitely.`, '');
        if (answer === null) return;
        const days = answer.trim() === '' ? null : Number(answer);
        if (days !== null && !(days > 0)) { ctx.notice('Enter a positive number of days or leave it blank.'); return; }
        const until = days === null ? '2999-01-01T00:00:00Z' : new Date(Date.now() + days * 86400000).toISOString();
        await api.setBanned(id, until); ctx.notice('Account disabled.');
      } else if (kind === 'enable') { await api.setBanned(id, null); ctx.notice('Account enabled.'); }
      else if (kind === 'signout') { if (!confirm(`Sign ${who} out on every device? They will need to sign in again.`)) return; const n = await api.signOutUser(id); ctx.notice(`${n} session${n === 1 ? '' : 's'} revoked.`); }
      else if (kind === 'grant') { if (!confirm(`Give ${who} full admin access to Tower?`)) return; await api.grantAdmin(id); ctx.notice('Admin access granted.'); }
      else if (kind === 'revoke') { if (!confirm(`Remove admin access from ${who}?`)) return; await api.revokeAdmin(id); ctx.notice('Admin access revoked.'); }
      else if (kind === 'delete') {
        const typed = prompt(`Permanently delete ${who}?\n\nThis removes the account, its sync snapshot and its traffic reports. Feedback they sent is kept anonymously. This cannot be undone.\n\nType the email address (or user ID if there is no email) to confirm:`);
        if (typed === null) return;
        if (typed.trim().toLowerCase() !== who.toLowerCase()) { ctx.notice('Confirmation did not match. Nothing was deleted.'); return; }
        await api.deleteUser(id); ctx.notice('Account deleted.'); await ctx.refreshStats(); location.hash = '/users'; return;
      }
      await ctx.refreshStats();
      if (ctx.alive()) await userProfile(ctx);
    } catch (e) { ctx.fail(e); }
  }
  await showTab(tab);
}

// Before admin-v3.sql there is no detail function, so show what the overview RPC knows.
async function legacyProfile(ctx, id) {
  const rows = await api.users({ offset: 0 }); const u = rows.find(r => r.user_id === id);
  if (!ctx.alive()) return;
  ctx.el.innerHTML = html`<p class="breadcrumb"><a href="#/users">Users</a> / ${u?.email || id}</p>
    <section class="card"><h2>${u?.email || 'User'}</h2><dl class="kv"><dt>ID</dt><dd class="mono">${id}</dd>${u ? html`<dt>Provider</dt><dd>${u.provider || '—'}</dd><dt>Joined</dt><dd>${fmtDate(u.created_at)}</dd><dt>Last sign-in</dt><dd>${fmtDate(u.last_sign_in_at)}</dd><dt>Reports</dt><dd>${fmtNum(u.reports_count)}</dd>` : ''}</dl></section>${raw(upgradeCard())}`.s;
}
