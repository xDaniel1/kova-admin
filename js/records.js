// The annotation panel every record page shares: tags as chips, then threaded notes.
// Both live in admin_notes / admin_tags, which exist only after admin-v3.sql.
'use strict';
import { html, raw, qsa, qs, fmtDate, rel, href, upgradeCard } from './util.js';
import * as api from './api.js';

export const typeLabel = { user: 'User', feedback: 'Feedback', report: 'Report', venue: 'Venue', feed: 'Feed' };
export const recordHref = (type, id) => href(`/${type === 'feedback' ? 'feedback' : type + 's'}/${encodeURIComponent(id)}`);

export const tagChips = (tags, type) => (tags || []).map(t => html`<a class="chip" href="${href('/search', { q: t })}" title="Search for ${t}">${t}</a>`);

/** Render tags and notes for one record into `el`. Re-renders itself after each change. */
export async function annotations(el, type, id, ctx) {
  el.innerHTML = '<p class="loading">Loading notes…</p>';
  let tags, notes;
  try { [tags, notes] = await Promise.all([api.tags(type, id), api.notes(type, id)]); }
  catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const label = await api.labels(notes.map(n => n.author));
  if (!ctx.alive()) return;
  const who = uid => { const l = label(uid); return l ? (l.display_name || l.email) : uid === ctx.user.id ? 'You' : 'Former admin'; };
  el.innerHTML = html`
    <div class="card-head"><h2>Tags</h2></div>
    <div class="chips" data-tags>
      ${tags.map(t => html`<span class="chip">${t.tag}<button type="button" data-untag="${t.tag}" aria-label="Remove tag ${t.tag}">×</button></span>`)}
      <form data-tag-form class="row" style="gap:6px"><input class="chip-input" name="tag" placeholder="add-tag" pattern="[a-z0-9][a-z0-9_-]{0,39}" title="Lower-case letters, digits, hyphen or underscore" maxlength="40" required aria-label="New tag"><button class="sm" type="submit">Add</button></form>
    </div>
    <div class="card-head" style="margin-top:18px"><h2>Notes</h2><span class="muted small">${notes.length ? notes.length + (notes.length === 1 ? ' note' : ' notes') : 'Visible to admins only'}</span></div>
    <form data-note-form class="stack" style="gap:8px"><textarea name="body" placeholder="Write a note for the team…" maxlength="8000" required aria-label="New note"></textarea><div class="row"><button class="primary" type="submit">Add note</button></div></form>
    <div data-notes>${notes.length ? notes.map(n => html`
      <article class="note" data-note="${n.id}">
        <div class="meta"><strong>${who(n.author)}</strong><span title="${fmtDate(n.created_at)}">${rel(n.created_at)}${n.updated_at !== n.created_at ? ' · edited' : ''}</span>
          <span class="actions"><button type="button" class="sm ghost" data-edit>Edit</button><button type="button" class="sm ghost" data-delete>Delete</button></span></div>
        <p class="body">${n.body}</p>
      </article>`) : html`<p class="empty">No notes yet.</p>`}</div>`.s;

  const rerender = () => annotations(el, type, id, ctx);
  qs('[data-tag-form]', el).onsubmit = async e => {
    e.preventDefault(); const input = e.currentTarget.elements.namedItem('tag'); const tag = input.value.trim().toLowerCase(); if (!tag) return;
    e.currentTarget.querySelector('button').disabled = true;
    try { await api.addTag(type, id, tag, ctx.user.id); ctx.notice('Tag added.'); await rerender(); }
    catch (err) { if (/duplicate|unique/i.test(err.message)) ctx.notice('That tag is already on this record.'); else ctx.fail(err); e.currentTarget.querySelector('button').disabled = false; }
  };
  qsa('[data-untag]', el).forEach(b => b.onclick = async () => { b.disabled = true; try { await api.removeTag(type, id, b.dataset.untag); await rerender(); } catch (err) { ctx.fail(err); b.disabled = false; } });
  qs('[data-note-form]', el).onsubmit = async e => {
    e.preventDefault(); const body = e.currentTarget.elements.namedItem('body').value.trim(); if (!body) return;
    e.currentTarget.querySelector('button').disabled = true;
    try { await api.addNote(type, id, body, ctx.user.id); ctx.notice('Note added.'); await rerender(); }
    catch (err) { ctx.fail(err); e.currentTarget.querySelector('button').disabled = false; }
  };
  qsa('[data-note]', el).forEach(card => {
    const noteId = card.dataset.note, note = notes.find(n => n.id === noteId);
    qs('[data-delete]', card).onclick = async () => { if (!confirm('Delete this note?')) return; try { await api.deleteNote(noteId); ctx.notice('Note deleted.'); await rerender(); } catch (err) { ctx.fail(err); } };
    qs('[data-edit]', card).onclick = () => {
      const body = qs('.body', card);
      body.replaceWith(Object.assign(document.createElement('form'), { className: 'stack', innerHTML: html`<textarea name="body" maxlength="8000" required>${note.body}</textarea><div class="row"><button class="primary" type="submit">Save</button><button type="button" class="ghost" data-cancel>Cancel</button></div>`.s }));
      const form = qs('form', card);
      form.onsubmit = async e => { e.preventDefault(); try { await api.editNote(noteId, form.elements.namedItem('body').value.trim()); ctx.notice('Note saved.'); await rerender(); } catch (err) { ctx.fail(err); } };
      qs('[data-cancel]', form).onclick = rerender;
    };
  });
}

/** Audit entries about one record (admin actions only). */
export async function auditList(el, type, id, ctx) {
  let rows;
  try { rows = await api.auditFor(type, id); } catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const label = await api.labels(rows.map(r => r.actor));
  if (!ctx.alive()) return;
  el.innerHTML = rows.length ? html`<ul class="timeline">${rows.map(r => html`<li class="ev"><span class="ico" aria-hidden="true">${actionIcon(r.action)}</span><span class="what"><strong>${actionText(r.action)}</strong> <span class="muted">by ${label(r.actor)?.email || 'an admin'}</span>${detailText(r.details)}</span><span class="when" title="${fmtDate(r.at)}">${rel(r.at)}</span></li>`)}</ul>`.s : '<p class="empty">No admin actions recorded for this record.</p>';
}
export const actionIcon = a => ({ signup: '✦', signin: '→', report: '⚠', feedback: '✉' }[a] || (a?.startsWith('note') ? '✎' : a?.startsWith('tag') ? '#' : a?.startsWith('user') ? '◉' : a?.startsWith('admin') ? '★' : a?.startsWith('venue') ? '▦' : a?.startsWith('feed') ? '⇅' : '•'));
export const actionText = a => ({
  signup: 'Signed up', signin: 'Signed in', report: 'Reported', feedback: 'Sent feedback',
  note_added: 'Note added', note_edited: 'Note edited', note_deleted: 'Note deleted', tag_added: 'Tag added', tag_removed: 'Tag removed',
  feedback_updated: 'Feedback triaged', venue_added: 'Venue added', venue_updated: 'Venue updated', venue_deleted: 'Venue deleted',
  feed_added: 'Feed added', feed_updated: 'Feed updated', feed_deleted: 'Feed deleted',
  user_disabled: 'Account disabled', user_enabled: 'Account enabled', user_deleted: 'Account deleted', admin_granted: 'Admin access granted', admin_revoked: 'Admin access revoked',
}[a] || a || 'Event');
export function detailText(d) {
  if (!d || typeof d !== 'object') return raw('');
  const bits = [];
  if (d.tag) bits.push('#' + d.tag);
  if (d.preview) bits.push('“' + d.preview + '”');
  if (d.status && typeof d.status === 'object') bits.push(`status ${d.status.from} → ${d.status.to}`);
  if (d.enabled != null) bits.push(d.enabled ? 'enabled' : 'disabled');
  if (d.until) bits.push('until ' + fmtDate(d.until));
  if (d.email) bits.push(d.email);
  if (d.provider) bits.push('via ' + d.provider);
  return bits.length ? html` <span class="muted">· ${bits.join(' · ')}</span>` : raw('');
}
