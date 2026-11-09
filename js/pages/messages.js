// In-app messages: to everyone or one person. The apps show each unread message once.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, href, badge, table, empty, debounce, upgradeCard } from '../util.js';
import * as api from '../api.js';

const levelTone = { info: 'tone-new', warning: 'tone-seen', critical: 'danger' };
const local = iso => iso ? new Date(iso).toISOString().slice(0, 16) : '';

export default async function messages(ctx) {
  let rows;
  try { rows = await api.messages(); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  let recipient = null;
  if (ctx.query.to) { try { const u = await api.userDetail(ctx.query.to); if (u) recipient = { id: u.user_id, email: u.email || u.user_id }; } catch {} }
  if (!ctx.alive()) return;
  const now = Date.now();
  const live = m => m.active && (!m.starts_at || new Date(m.starts_at) <= now) && (!m.ends_at || new Date(m.ends_at) > now);
  ctx.el.innerHTML = html`<div class="grid two">
    <section class="card"><h2>New message</h2>
      <p class="muted small" style="margin-top:-6px">Shows once in the app as a card the person dismisses. Use the announcement banner on App controls for something that should stay visible.</p>
      <form data-compose class="stack" style="margin-top:12px">
        <div class="seg" role="group" aria-label="Audience"><button type="button" data-aud="all" aria-pressed="${String(!recipient)}">Everyone</button><button type="button" data-aud="user" aria-pressed="${String(!!recipient)}">One person</button></div>
        <div data-pick ${raw(recipient ? '' : 'hidden')}><label>Recipient<input data-find type="search" placeholder="Search by email…" autocomplete="off" value="${recipient?.email || ''}"></label><div data-matches></div><p class="small" data-chosen>${recipient ? html`Sending to <strong>${recipient.email}</strong>` : ''}</p></div>
        <div class="form-grid"><label>Title<input name="title" required maxlength="120"></label><label>Level<select name="level"><option>info</option><option>warning</option><option>critical</option></select></label></div>
        <label>Message<textarea name="body" required maxlength="2000"></textarea></label>
        <div class="form-grid"><label>Link (optional)<input name="url" type="url" placeholder="https://"></label><label>Show from<input name="starts_at" type="datetime-local"></label><label>Until<input name="ends_at" type="datetime-local"></label></div>
        <div class="row"><button class="primary" type="submit">Send message</button></div>
      </form></section>
    <section class="card"><div class="card-head"><h2>Sent</h2><span class="muted small">${rows.filter(live).length} live</span></div>
      <div data-list>${rows.length ? rows.map(m => html`<article class="note" data-id="${m.id}">
        <div class="meta">${badge(m.level, levelTone[m.level])}${live(m) ? badge('Live', 'ok') : badge(m.active ? 'Scheduled or ended' : 'Withdrawn')}<span>${m.audience === 'all' ? 'Everyone' : html`To <a href="${href('/users/' + m.user_id)}">${m.email || m.user_id.slice(0, 8)}</a>`}</span><span>· ${rel(m.created_at)}</span><span>· ${m.reads} read</span>
          <span class="actions"><button type="button" class="sm ghost" data-toggle>${m.active ? 'Withdraw' : 'Reactivate'}</button><button type="button" class="sm ghost" data-del>Delete</button></span></div>
        <p class="body"><strong>${m.title}</strong><br>${m.body}</p>${m.url ? html`<p class="small"><a href="${m.url}" target="_blank" rel="noopener noreferrer">${m.url}</a></p>` : ''}
        ${m.starts_at || m.ends_at ? html`<p class="muted small">Window: ${m.starts_at ? fmtDate(m.starts_at) : 'now'} → ${m.ends_at ? fmtDate(m.ends_at) : 'no end'}</p>` : ''}
      </article>`) : empty('No messages sent yet.')}</div></section></div>`.s;

  const form = qs('[data-compose]', ctx.el), pick = qs('[data-pick]', ctx.el), find = qs('[data-find]', ctx.el), matches = qs('[data-matches]', ctx.el), chosen = qs('[data-chosen]', ctx.el);
  let audience = recipient ? 'user' : 'all';
  qsa('[data-aud]', ctx.el).forEach(b => b.onclick = () => { audience = b.dataset.aud; qsa('[data-aud]', ctx.el).forEach(x => x.setAttribute('aria-pressed', String(x === b))); pick.hidden = audience !== 'user'; });
  find.oninput = debounce(async () => {
    const q = find.value.trim(); if (q.length < 2) { matches.innerHTML = ''; return; }
    try { const r = await api.search(q); if (!ctx.alive()) return;
      matches.innerHTML = (r.users || []).map(u => html`<button type="button" class="sm ghost" data-pickid="${u.user_id}" data-email="${u.email || u.user_id}">${u.email || u.user_id}</button>`).join('') || '<p class="muted small">No accounts match.</p>';
      qsa('[data-pickid]', matches).forEach(b => b.onclick = () => { recipient = { id: b.dataset.pickid, email: b.dataset.email }; chosen.innerHTML = html`Sending to <strong>${recipient.email}</strong>`.s; matches.innerHTML = ''; find.value = recipient.email; });
    } catch (e) { ctx.fail(e); }
  }, 300);
  form.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(form), b = form.querySelector('button[type=submit]');
    if (audience === 'user' && !recipient) { ctx.notice('Pick a recipient first.'); return; }
    const m = { audience, user_id: audience === 'user' ? recipient.id : null, title: f.get('title').trim(), body: f.get('body').trim(), level: f.get('level'), url: f.get('url').trim() || null,
      starts_at: f.get('starts_at') ? new Date(f.get('starts_at')).toISOString() : null, ends_at: f.get('ends_at') ? new Date(f.get('ends_at')).toISOString() : null };
    if (audience === 'all' && !confirm(`Send "${m.title}" to every app user?`)) return;
    b.disabled = true;
    try { await api.sendMessage(m); ctx.notice('Message sent.'); if (ctx.alive()) { history.replaceState(null, '', '#/messages'); ctx.query = {}; await messages(ctx); } } catch (err) { ctx.fail(err); b.disabled = false; }
  };
  qsa('[data-id]', ctx.el).forEach(card => {
    const m = rows.find(r => r.id === card.dataset.id);
    qs('[data-toggle]', card).onclick = async () => { try { await api.updateMessage(m.id, { active: !m.active }); ctx.notice(m.active ? 'Message withdrawn.' : 'Message reactivated.'); await messages(ctx); } catch (e) { ctx.fail(e); } };
    qs('[data-del]', card).onclick = async () => { if (!confirm('Delete this message and its read receipts?')) return; try { await api.deleteMessage(m.id); ctx.notice('Message deleted.'); await messages(ctx); } catch (e) { ctx.fail(e); } };
  });
}
