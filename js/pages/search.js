// One search across users, feedback, venues, feeds, notes and tags.
'use strict';
import { html, raw, qs, fmtDate, rel, href, badge, kindLabel, statusTone, upgradeCard } from '../util.js';
import * as api from '../api.js';
import { recordHref, typeLabel } from '../records.js';

export default async function search(ctx) {
  const q = (ctx.query.q || '').trim();
  ctx.title(q ? `Search · ${q}` : 'Search');
  const box = document.getElementById('search'); if (box && box.value !== q) box.value = q;
  if (!q) { ctx.el.innerHTML = '<section class="card"><h2>Search</h2><p class="muted">Type in the search box above to find users, feedback, venues, feeds, notes and tags.</p></section>'; return; }
  let r; try { r = await api.search(q); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const total = ['users', 'feedback', 'venues', 'feeds', 'notes', 'tags'].reduce((a, k) => a + (r[k] || []).length, 0);
  const group = (title, rows, render) => rows.length ? html`<div class="result-group"><h3>${title} <span class="muted small">${rows.length}${rows.length >= 10 ? '+' : ''}</span></h3>${rows.map(render)}</div>` : '';
  ctx.el.innerHTML = html`<section class="card"><div class="card-head"><h2>Results for “${q}”</h2><span class="muted small">${total ? total + ' matches' : 'Nothing matched'}</span></div>
    ${group('Users', r.users || [], u => html`<a class="feedback-item" href="${href('/users/' + u.user_id)}"><strong>${u.display_name || u.email || u.user_id}</strong>${u.display_name ? html` <span class="muted">${u.email}</span>` : ''} <span class="muted small">· last sign-in ${u.last_sign_in_at ? rel(u.last_sign_in_at) : 'never'}</span></a>`)}
    ${group('Feedback', r.feedback || [], f => html`<a class="feedback-item" href="${href('/feedback/' + f.id)}"><div class="top">${badge(kindLabel[f.kind] || f.kind)}${badge(f.status, statusTone[f.status])}<span>${rel(f.created_at)}</span></div><p class="text">${f.message}</p></a>`)}
    ${group('Venues', r.venues || [], v => html`<a class="feedback-item" href="${href('/venues/' + encodeURIComponent(v.short_name))}"><strong>${v.name}</strong> <span class="muted">${v.short_name} · ${v.kind}${v.enabled ? '' : ' · disabled'}</span></a>`)}
    ${group('Incident feeds', r.feeds || [], f => html`<a class="feedback-item" href="${href('/feeds/' + encodeURIComponent(f.url))}"><strong>${f.state} · ${f.name}</strong> <span class="muted small">${f.url}</span></a>`)}
    ${group('Notes', r.notes || [], n => html`<a class="feedback-item" href="${recordHref(n.target_type, n.target_id)}"><div class="top">${badge(typeLabel[n.target_type])}<span>${rel(n.created_at)}</span></div><p class="text">${n.body}</p></a>`)}
    ${group('Tagged records', r.tags || [], t => html`<a class="feedback-item" href="${recordHref(t.target_type, t.target_id)}"><span class="chip">${t.tag}</span> ${typeLabel[t.target_type]} <span class="mono muted">${t.target_id}</span></a>`)}
    ${total ? '' : html`<p class="empty">Try a different spelling, an email address, a tag name or a user ID.</p>`}
  </section>`.s;
}
