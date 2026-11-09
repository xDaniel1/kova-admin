// The landing page: greeting, headline numbers, what needs attention, latest activity, trends.
'use strict';
import { html, raw, qs, fmtNum, rel, fmtDate, href, barChart, badge, kindLabel, statusTone, upgradeCard, empty } from '../util.js';
import * as api from '../api.js';
import { eventList } from './activity.js';
import { recordHref, typeLabel } from '../records.js';
import { versionsCard } from '../versions.js';

export default async function home(ctx) {
  const s = await ctx.refreshStats({ maxAge: 5000 });
  if (!ctx.alive()) return;
  if (!s) { ctx.el.innerHTML = upgradeCard(); return; }
  const meta = ctx.user.user_metadata || {};
  const first = (meta.full_name || meta.name || (ctx.user.email || '').split('@')[0] || 'there').split(/[\s._]+/)[0];
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const v3 = api.capabilities.v3;
  const lineBits = [today];
  if (s.feedback_new != null) lineBits.push(`${fmtNum(s.feedback_new)} new feedback`);
  if (s.reports_24h != null) lineBits.push(`${fmtNum(s.reports_24h)} reports today`);
  lineBits.push(`${fmtNum(s.total_users)} users`);

  const tile = (to, value, label, delta) => html`<a class="tile" href="${to}"><strong>${value}</strong><span>${label}</span>${delta ? html`<em class="delta">${delta}</em>` : ''}</a>`;
  ctx.el.innerHTML = html`
    <div class="hero"><p class="eyebrow">${today}</p><h1>Hi ${name}.</h1><p class="muted">${lineBits.slice(1).join(' · ')}</p></div>
    <div class="tiles">
      ${tile(href('/users'), fmtNum(s.total_users), 'Users', s.users_new_7d ? `+${fmtNum(s.users_new_7d)} in 7d` : '')}
      ${tile(href('/users'), fmtNum(s.users_signed_in_24h ?? s.users_signed_in_7d), s.users_signed_in_24h != null ? 'Signed in · 24h' : 'Signed in · 7d')}
      ${tile(href('/reports', { days: 1 }), fmtNum(s.reports_24h ?? Object.values(s.reports_24h_by_kind || {}).reduce((a, b) => a + +b, 0)), 'Reports · 24h')}
      ${tile(href('/feedback', { status: 'new' }), fmtNum(s.feedback_new ?? s.feedback_by_status?.new ?? 0), 'New feedback')}
      ${tile(href('/venues'), s.venues_enabled != null ? html`${fmtNum(s.venues_enabled)}<span class="muted">/${fmtNum(s.venues_count)}</span>` : fmtNum(s.venues_count), 'Venues enabled')}
      ${tile(href('/feeds'), s.feeds_enabled != null ? html`${fmtNum(s.feeds_enabled)}<span class="muted">/${fmtNum(s.feeds_count)}</span>` : fmtNum(s.feeds_count), 'Feeds enabled')}
      ${s.sync_users != null ? tile(href('/users', { filter: 'sync' }), fmtNum(s.sync_users), 'Users with sync') : ''}
      ${s.admins_count != null ? tile(href('/admins'), fmtNum(s.admins_count), 'Admins') : ''}
    </div>
    <div class="grid two" style="margin-top:16px">
      <section class="card"><div class="card-head"><h2>Needs attention</h2><a class="small" href="${href('/feedback', { status: 'new' })}">All new feedback</a></div><div data-attention><p class="loading">Loading…</p></div></section>
      <section class="card"><div class="card-head"><h2>Latest activity</h2><a class="small" href="#/activity">Full log</a></div><div data-activity><p class="loading">Loading…</p></div></section>
    </div>
    <div data-versions></div>
    <section class="card"><div class="card-head"><h2>Last 30 days</h2><span class="muted small">Per UTC day</span></div>
      ${Array.isArray(s.signups_by_day) ? html`${barChart('Sign-ups', s.signups_by_day)}${barChart('Reports', s.reports_by_day)}${barChart('Feedback', s.feedback_by_day)}` : html`<p class="muted">Daily charts appear after <code>supabase/admin-v3.sql</code> is applied.</p>`}
    </section>
    <div class="grid two">
      <section class="card"><h2>Breakdowns</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        ${[['Feedback by kind', s.feedback_by_kind, k => kindLabel[k] || k], ['Feedback by status', s.feedback_by_status, k => k], ['Reports · 7 days', s.reports_7d_by_kind, k => k]].map(([label, obj, f]) => html`<div><h3 class="muted small" style="margin-bottom:6px">${label}</h3>${Object.keys(obj || {}).length ? html`<dl class="kv">${Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => html`<dt>${f(k)}</dt><dd>${fmtNum(v)}</dd>`)}</dl>` : html`<p class="muted small">None yet.</p>`}</div>`)}
      </div></section>
      <section class="card"><div class="card-head"><h2>Recent notes</h2>${s.notes_count != null ? html`<span class="muted small">${fmtNum(s.notes_count)} total</span>` : ''}</div><div data-notes><p class="loading">Loading…</p></div></section>
    </div>`.s;

  const tasks = [];
  tasks.push((async () => { const host = qs('[data-versions]', ctx.el); try { const v = await api.versions(); if (ctx.alive()) host.innerHTML = versionsCard(v).s + '<div style="height:18px"></div>'; } catch (e) { if (!e.needsUpgrade) console.warn(e); } })());
  tasks.push((async () => {
    const host = qs('[data-attention]', ctx.el);
    try {
      const rows = (await api.feedback({ status: 'new' })).slice(0, 6);
      if (!ctx.alive()) return;
      host.innerHTML = rows.length ? rows.map(r => html`<a class="feedback-item" href="${href('/feedback/' + r.id)}"><div class="top">${badge(kindLabel[r.kind] || r.kind)}<span>${rel(r.created_at)}</span>${r.contact ? html`<span>· ${r.contact}</span>` : ''}</div><p class="text">${r.message}</p></a>`).join('') : empty('Inbox zero. No new feedback.').s;
    } catch (e) { if (ctx.alive()) host.innerHTML = html`<p class="muted">${e.message}</p>`.s; }
  })());
  tasks.push((async () => {
    const host = qs('[data-activity]', ctx.el);
    try {
      const rows = await api.activity({ size: 10 });
      if (!ctx.alive()) return;
      const label = await api.labels(rows.map(r => r.actor));
      if (!ctx.alive()) return;
      host.innerHTML = eventList(rows, label, { grouped: false }).s;
    } catch (e) { if (!ctx.alive()) return; host.innerHTML = e.needsUpgrade ? '<p class="muted">The activity log needs <code>supabase/admin-v3.sql</code>.</p>' : html`<p class="muted">${e.message}</p>`.s; }
  })());
  tasks.push((async () => {
    const host = qs('[data-notes]', ctx.el);
    try {
      const rows = await api.recentNotes(6);
      if (!ctx.alive()) return;
      const label = await api.labels(rows.map(r => r.author));
      if (!ctx.alive()) return;
      host.innerHTML = rows.length ? rows.map(n => html`<article class="note"><div class="meta"><a href="${recordHref(n.target_type, n.target_id)}">${typeLabel[n.target_type]} · ${n.target_type === 'user' || n.target_type === 'feedback' || n.target_type === 'report' ? n.target_id.slice(0, 8) : n.target_id}</a><span>${label(n.author)?.email || 'admin'} · ${rel(n.created_at)}</span></div><p class="body">${n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body}</p></article>`).join('') : empty('No notes yet. Open any record to add one.').s;
    } catch (e) { if (!ctx.alive()) return; host.innerHTML = e.needsUpgrade ? '<p class="muted">Notes need <code>supabase/admin-v3.sql</code>.</p>' : html`<p class="muted">${e.message}</p>`.s; }
  })());
  await Promise.all(tasks);
}
