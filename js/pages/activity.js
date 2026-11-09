// Everything that happened, newest first: sign-ups, sign-ins, reports, feedback and admin actions.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, dayKey, dayLabel, href, upgradeCard, empty } from '../util.js';
import * as api from '../api.js';
import { actionIcon, actionText, detailText, recordHref } from '../records.js';

const ADMIN_KINDS = ['note_added', 'note_edited', 'note_deleted', 'tag_added', 'tag_removed', 'feedback_updated', 'venue_added', 'venue_updated', 'venue_deleted', 'feed_added', 'feed_updated', 'feed_deleted', 'user_disabled', 'user_enabled', 'user_deleted', 'admin_granted', 'admin_revoked'];
const FILTERS = [['', 'All'], ['signup', 'Sign-ups'], ['signin', 'Sign-ins'], ['report', 'Reports'], ['feedback', 'Feedback'], ['admin', 'Admin actions']];
const kindsFor = f => f === 'admin' ? ADMIN_KINDS : f ? [f] : null;

export function eventItem(ev, label) {
  const actor = label(ev.actor);
  const who = actor ? (actor.display_name || actor.email) : ev.actor ? 'Deleted account' : 'Someone';
  const target = ev.target_type && ev.target_id ? recordHref(ev.target_type, ev.target_id) : null;
  const isAdminAction = !['signup', 'signin', 'report', 'feedback'].includes(ev.type);
  const what = isAdminAction
    ? html`<strong>${actionText(ev.type)}</strong> <span class="muted">by ${who}</span>${detailText(ev.details)}${target ? html` · <a href="${target}">open ${ev.target_type}</a>` : ''}`
    : ev.type === 'report' ? html`<a href="${target}"><strong>${ev.summary}</strong> reported</a> <span class="muted">by ${who}</span>`
    : ev.type === 'feedback' ? html`<a href="${target}">${ev.summary}</a> <span class="muted">from ${ev.actor ? who : 'anonymous'}</span>`
    : html`<a href="${target}"><strong>${who}</strong></a> ${ev.type === 'signup' ? 'signed up' : 'signed in'}${detailText(ev.details)}`;
  return html`<li class="ev">${actionIcon(ev.type)}<span class="what">${what}</span><span class="when" title="${fmtDate(ev.at)}">${rel(ev.at)}</span></li>`;
}

export function eventList(rows, label, { grouped = true } = {}) {
  if (!rows.length) return empty('No activity matches.');
  if (!grouped) return html`<ul class="timeline">${rows.map(r => eventItem(r, label))}</ul>`;
  const out = []; let day = null;
  for (const r of rows) { const k = dayKey(r.at); if (k !== day) { day = k; out.push(html`<li class="day">${dayLabel(r.at)}</li>`); } out.push(eventItem(r, label)); }
  return html`<ul class="timeline">${out}</ul>`;
}

export default async function activity(ctx) {
  const filter = ctx.query.kind || '';
  ctx.el.innerHTML = html`<section class="card">
    <div class="card-head"><h2>Activity</h2><div class="seg" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => html`<button type="button" data-filter="${k}" aria-pressed="${String(k === filter)}">${l}</button>`)}</div></div>
    <div data-list><p class="loading">Loading…</p></div>
    <div class="paging"><button data-more hidden>Load older</button><span class="muted small" data-status></span></div>
  </section>`.s;
  qsa('[data-filter]', ctx.el).forEach(b => b.onclick = () => { location.hash = href('/activity', { kind: b.dataset.filter }).slice(1); });
  const list = qs('[data-list]', ctx.el), more = qs('[data-more]', ctx.el), status = qs('[data-status]', ctx.el);
  let all = [], before = null;
  async function load() {
    more.disabled = true;
    try {
      const rows = await api.activity({ before, kinds: kindsFor(filter), size: 50 });
      if (!ctx.alive()) return;
      all = all.concat(rows); before = rows.length ? rows[rows.length - 1].at : before;
      const label = await api.labels(all.map(r => r.actor));
      if (!ctx.alive()) return;
      list.innerHTML = eventList(all, label).s;
      more.hidden = rows.length < 50; more.disabled = false;
      status.textContent = all.length ? `${all.length} events shown` : '';
    } catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { list.innerHTML = upgradeCard(); more.hidden = true; } else throw e; }
  }
  more.onclick = load;
  await load();
}
