// Feedback inbox and the per-item record page.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, href, badge, isEmail, kindLabel, statusTone, upgradeCard } from '../util.js';
import * as api from '../api.js';
import { annotations, auditList, tagChips } from '../records.js';

const KINDS = ['bug', 'idea', 'map_data', 'other'], STATUSES = ['new', 'seen', 'done'];

export default async function feedback(ctx) {
  const q = { kind: ctx.query.kind || '', status: ctx.query.status || '', search: ctx.query.q || '' };
  ctx.el.innerHTML = html`<section class="card">
    <form class="toolbar" data-filter>
      <label>Search<input name="q" type="search" value="${q.search}" placeholder="Message contains…"></label>
      <label class="narrow">Kind<select name="kind"><option value="">All kinds</option>${KINDS.map(k => html`<option value="${k}" ${raw(k === q.kind ? 'selected' : '')}>${kindLabel[k]}</option>`)}</select></label>
      <label class="narrow">Status<select name="status"><option value="">All statuses</option>${STATUSES.map(s => html`<option value="${s}" ${raw(s === q.status ? 'selected' : '')}>${s}</option>`)}</select></label>
      <button type="submit">Apply</button>
    </form>
    <div data-list><p class="loading">Loading…</p></div>
    <div class="paging"><button data-more hidden>Load more</button><span class="muted small" data-status></span></div>
  </section>`.s;
  const form = qs('[data-filter]', ctx.el);
  form.onsubmit = e => { e.preventDefault(); const f = new FormData(form); location.hash = href('/feedback', { q: f.get('q').trim(), kind: f.get('kind'), status: f.get('status') }).slice(1); };
  qsa('select', form).forEach(s => s.onchange = () => form.requestSubmit());
  const list = qs('[data-list]', ctx.el), more = qs('[data-more]', ctx.el), status = qs('[data-status]', ctx.el);
  let rows = [];
  async function load(offset = 0) {
    more.disabled = true;
    const page = await api.feedback({ ...q, offset }); if (!ctx.alive()) return;
    rows = offset ? rows.concat(page) : page;
    let tags = {}; try { tags = await api.tagsFor('feedback', rows.map(r => r.id)); } catch (e) { if (!e.needsUpgrade) throw e; }
    if (!ctx.alive()) return;
    list.innerHTML = rows.length ? rows.map(r => { const d = r.diagnostics || {}; return html`<a class="feedback-item" href="${href('/feedback/' + r.id)}">
      <div class="top">${badge(kindLabel[r.kind] || r.kind)}${badge(r.status, statusTone[r.status])}<span title="${fmtDate(r.created_at)}">${rel(r.created_at)}</span>${r.contact ? html`<span>· ${r.contact}</span>` : ''}${d.app_version || d.appVersion ? html`<span>· v${d.app_version || d.appVersion}</span>` : ''}${r.screenshot_path ? html`<span>· 📎 screenshot</span>` : ''}${tagChips(tags[r.id])}</div>
      <p class="text">${r.message}</p>${r.admin_note ? html`<p class="muted small" style="margin:4px 0 0">Triage: ${r.admin_note}</p>` : ''}</a>`; }).join('') : '<p class="empty">No feedback matches these filters.</p>';
    more.hidden = page.length < api.PAGE; more.disabled = false; status.textContent = `${rows.length} shown`;
  }
  more.onclick = () => load(rows.length).catch(ctx.fail);
  await load();
}

export async function feedbackDetail(ctx) {
  const id = ctx.params[0];
  const r = await api.feedbackOne(id); if (!ctx.alive()) return;
  if (!r) { ctx.el.innerHTML = '<section class="card"><h2>Feedback not found</h2><p class="muted"><a href="#/feedback">Back to feedback</a></p></section>'; return; }
  ctx.title(`${kindLabel[r.kind] || r.kind} feedback`);
  const d = r.diagnostics && typeof r.diagnostics === 'object' ? r.diagnostics : {};
  const userLabel = r.user_id ? (await api.labels([r.user_id]))(r.user_id) : null; if (!ctx.alive()) return;
  ctx.el.innerHTML = html`
    <p class="breadcrumb"><a href="#/feedback">Feedback</a> / ${id.slice(0, 8)}</p>
    <div class="grid two">
      <section class="card">
        <div class="card-head"><div class="row">${badge(kindLabel[r.kind] || r.kind)}<span class="muted">${fmtDate(r.created_at)}</span></div>
          <label class="inline" style="margin:0">Status <select data-status>${['new', 'seen', 'done'].map(s => html`<option ${raw(s === r.status ? 'selected' : '')}>${s}</option>`)}</select></label></div>
        <p class="message">${r.message}</p>
        <dl class="kv" style="margin-top:14px">
          <dt>From</dt><dd>${r.user_id ? html`<a href="${href('/users/' + r.user_id)}">${userLabel?.display_name || userLabel?.email || r.user_id}</a>` : 'Anonymous (not signed in)'}</dd>
          <dt>Contact</dt><dd>${r.contact ? (isEmail(r.contact) ? html`<a href="mailto:${encodeURIComponent(r.contact)}?subject=${encodeURIComponent('Re: your Kova Maps feedback')}">${r.contact}</a>` : r.contact) : 'Not provided'}</dd>
          <dt>Screenshot</dt><dd>${r.screenshot_path ? html`<button type="button" class="sm" data-shot>Open screenshot (5-minute link)</button>` : 'None'}</dd>
          <dt>ID</dt><dd class="mono">${r.id}</dd>
        </dl>
        <h3 style="margin:16px 0 6px">Diagnostics</h3>
        ${Object.keys(d).length ? html`<dl class="kv">${Object.entries(d).map(([k, v]) => html`<dt>${k}</dt><dd>${typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>`)}</dl>` : html`<p class="muted">None attached.</p>`}
        <h3 style="margin:16px 0 6px">Triage note</h3>
        <p class="muted small" style="margin-top:0">A short working note on the item itself. Longer discussion belongs in Notes.</p>
        <textarea data-triage maxlength="4000" placeholder="e.g. Reproduced on iOS 27.1, fix in 1.1">${r.admin_note || ''}</textarea>
        <div class="row" style="margin-top:8px"><button type="button" data-save-triage>Save triage note</button><span class="muted small" data-saved></span></div>
      </section>
      <div class="stack">
        <section class="card" data-annotations></section>
        <section class="card"><h2>Admin history</h2><div data-audit></div></section>
      </div>
    </div>`.s;
  qs('[data-status]', ctx.el).onchange = async e => { const el = e.currentTarget; el.disabled = true; try { await api.updateFeedback(id, { status: el.value }); ctx.notice('Status saved.'); await ctx.refreshStats(); } catch (err) { ctx.fail(err); el.value = r.status; } finally { el.disabled = false; } };
  qs('[data-save-triage]', ctx.el).onclick = async e => { const b = e.currentTarget; b.disabled = true; try { await api.updateFeedback(id, { admin_note: qs('[data-triage]', ctx.el).value.trim() || null }); qs('[data-saved]', ctx.el).textContent = 'Saved ' + new Date().toLocaleTimeString(); } catch (err) { ctx.fail(err); } finally { b.disabled = false; } };
  const shot = qs('[data-shot]', ctx.el);
  if (shot) shot.onclick = async () => { shot.disabled = true; try { const url = await api.screenshotURL(r.screenshot_path); if (!ctx.alive()) return; const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'View screenshot · expires in 5 minutes'; shot.replaceWith(a); } catch (err) { ctx.fail(err); shot.disabled = false; } };
  await Promise.all([annotations(qs('[data-annotations]', ctx.el), 'feedback', id, ctx), auditList(qs('[data-audit]', ctx.el), 'feedback', id, ctx)]);
}
