// System: database and storage health, retention tools.
'use strict';
import { html, raw, qs, fmtDate, fmtNum, fmtBytes, rel, table, badge, upgradeCard } from '../util.js';
import * as api from '../api.js';
import { versionsCard, loadSiteLive } from '../versions.js';
import * as push from '../push.js';

export default async function system(ctx) {
  let s;
  try { s = await api.system(); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const tile = (v, l, sub) => html`<div class="tile"><strong>${v}</strong><span>${l}</span>${sub ? html`<em class="delta muted" style="color:var(--muted)">${sub}</em>` : ''}</div>`;
  ctx.el.innerHTML = html`
    <div class="tiles">
      ${tile(fmtBytes(s.database_bytes), 'Database size', 'Postgres ' + String(s.postgres_version).split(' ')[0])}
      ${tile(fmtNum(s.reports?.count), 'Traffic reports', s.reports?.oldest ? 'oldest ' + rel(s.reports.oldest) : 'none')}
      ${tile(fmtNum(s.feedback?.count), 'Feedback items', fmtNum(s.feedback?.with_screenshot) + ' with screenshots')}
      ${tile(fmtBytes(s.screenshots?.bytes), 'Screenshot storage', fmtNum(s.screenshots?.count) + ' files')}
      ${tile(fmtNum(s.sessions?.count), 'Active sessions', fmtNum(s.sessions?.users) + ' users signed in')}
      ${tile(fmtNum(s.audit_rows), 'Audit entries', 'since migration 0003')}
    </div>
    <div data-versions style="margin-top:18px"></div>
    <section class="card" style="margin-top:18px" data-push><div class="card-head"><h2>Notifications on this device</h2><span data-push-badge></span></div><div data-push-body><p class="loading">Checking…</p></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><h2>Tower on your iPhone</h2>${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? badge('Installed here', 'ok') : ''}</div>
      <ol class="steps"><li>Open <strong>tower.kovamaps.com</strong> in Safari on the iPhone.</li><li>Tap Share, then <strong>Add to Home Screen</strong>, then Add.</li><li>Open Tower from the new icon and sign in with Google, or request an email link and paste it in (press and hold <em>Sign in</em> in the email, Copy Link).</li></ol>
      <p class="muted small" style="margin:8px 0 0">It is the same Tower, full screen, talking to the same Supabase project, with every change live. Pull down to refresh; it also refreshes when you come back to it. Updates arrive on their own the next time you open it.</p></section>
    <div class="grid two" style="margin-top:18px">
      <section class="card"><div class="card-head"><h2>Tables</h2><span class="muted small">Live row estimates</span></div>
        ${table(['Table', 'Rows', 'Size'], (s.tables || []).map(t => [html`<span class="mono">${t.name}</span>`, fmtNum(t.rows), fmtBytes(t.bytes)]))}</section>
      <section class="card danger-zone"><div class="card-head"><h2>Retention</h2></div>
        <p class="muted small">Traffic reports are short-lived by design. Purging old ones keeps the table small and removes stale pins from the map. Feedback is never purged from here; delete items one at a time from their record page.</p>
        <form data-purge class="row" style="margin-top:12px"><label class="narrow" style="flex:0 1 220px">Delete reports older than<select name="days">${[7, 14, 30, 90].map(d => html`<option value="${d}" ${raw(d === 30 ? 'selected' : '')}>${d} days</option>`)}</select></label><button class="danger" type="submit">Purge reports</button></form>
        <p class="muted small" style="margin-top:12px">Every purge is written to the audit log with the count removed.</p>
        <p class="muted small" style="margin-top:14px">Generated ${fmtDate(s.generated_at)}. <a href="#/system">Refresh</a></p></section>
    </div>`.s;
  renderPush(ctx);
  api.versions().then(v => { if (ctx.alive()) { const host = qs('[data-versions]', ctx.el); host.innerHTML = versionsCard(v, { detailed: true }).s; loadSiteLive(host, v.released); } }).catch(e => { if (!e.needsUpgrade) ctx.fail(e); });
  qs('[data-purge]', ctx.el).onsubmit = async e => {
    e.preventDefault(); const days = Number(new FormData(e.currentTarget).get('days'));
    if (!confirm(`Permanently delete every traffic report older than ${days} days? This cannot be undone.`)) return;
    const b = e.currentTarget.querySelector('button'); b.disabled = true;
    try { const n = await api.purgeReports(days); ctx.notice(`${n} report${n === 1 ? '' : 's'} purged.`); await ctx.refreshStats(); if (ctx.alive()) await system(ctx); } catch (err) { ctx.fail(err); b.disabled = false; }
  };
}

async function renderPush(ctx) {
  const card = ctx.el.querySelector('[data-push]'); if (!card) return;
  const body = card.querySelector('[data-push-body]'), badgeEl = card.querySelector('[data-push-badge]');
  const st = await push.status().catch(() => 'unsupported'); if (!ctx.alive()) return;
  const T = [['feedback', 'New feedback'], ['signups', 'New accounts']];
  badgeEl.innerHTML = st === 'on' ? badge('On', 'ok').s : '';
  if (st === 'install-first') { body.innerHTML = '<p class="muted">On iPhone, notifications work in the installed app. Add Tower to your Home Screen (steps below), open it from the icon, then turn notifications on here.</p>'; return; }
  if (st === 'unsupported') { body.innerHTML = '<p class="muted">This browser cannot receive push notifications.</p>'; return; }
  if (st === 'denied') { body.innerHTML = '<p class="muted">Notifications are blocked for Tower on this device. Allow them in the system settings (iPhone: Settings → Notifications → Tower), then reload.</p>'; return; }
  const on = st === 'on', current = on ? await push.topics() : ['feedback', 'signups'];
  body.innerHTML = html`<p class="muted small" style="margin-top:0">Get a notification on this device when something needs you. Each device is set up on its own.</p>
    <div class="switches">${T.map(([k, l]) => html`<label class="inline switch"><input type="checkbox" data-topic="${k}" ${raw(current.includes(k) ? 'checked' : '')}><span><strong>${l}</strong></span></label>`)}</div>
    <div class="row" style="margin-top:12px">${on ? html`<button type="button" class="primary" data-push-test>Send a test</button><button type="button" class="ghost" data-push-off>Turn off on this device</button>` : html`<button type="button" class="primary" data-push-on>Turn on notifications</button>`}</div>`.s;
  const chosen = () => [...body.querySelectorAll('[data-topic]:checked')].map(i => i.dataset.topic);
  const run = async (b, fn, msg) => { b.disabled = true; try { await fn(); if (msg) ctx.notice(msg); await renderPush(ctx); } catch (e) { ctx.fail(e); b.disabled = false; } };
  body.querySelector('[data-push-on]')?.addEventListener('click', e => run(e.currentTarget, () => push.enable(chosen()), 'Notifications are on for this device.'));
  body.querySelector('[data-push-off]')?.addEventListener('click', e => run(e.currentTarget, () => push.disable(), 'Notifications are off for this device.'));
  body.querySelector('[data-push-test]')?.addEventListener('click', e => run(e.currentTarget, async () => { const r = await push.test(); if (!r?.sent) throw new Error('No notification was delivered (' + (r?.devices ?? 0) + ' devices). Turn notifications off and on again.'); }, 'Test sent.'));
  if (on) body.querySelectorAll('[data-topic]').forEach(i => i.onchange = () => push.setTopics(chosen()).then(() => ctx.notice('Saved.')).catch(ctx.fail));
}
