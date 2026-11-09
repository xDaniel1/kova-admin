// Work-zone incident feeds (WZDx) the app pulls from, keyed by URL.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, href, table, extLink, safeURL, badge, upgradeCard, downloadCSV } from '../util.js';
import * as api from '../api.js';
import { annotations, auditList, tagChips } from '../records.js';

const fields = (f = {}) => html`<div class="form-grid">
  <label>State<input name="state" required maxlength="2" pattern="[A-Za-z]{2}" title="Two-letter state code" value="${f.state || ''}" placeholder="MN"></label>
  <label>Name<input name="name" required maxlength="100" value="${f.name || ''}" placeholder="Minnesota DOT"></label>
  <label>Feed URL<input name="url" type="url" required maxlength="500" value="${f.url || ''}" ${raw(f.url ? 'readonly' : '')} placeholder="https://…/wzdx"></label>
  <label>Format<select name="format"><option ${raw((f.format || 'wzdx') === 'wzdx' ? 'selected' : '')}>wzdx</option></select></label>
  <label>Terms URL<input name="terms_url" type="url" maxlength="500" value="${f.terms_url || ''}" placeholder="Optional"></label>
</div>`;
function readForm(form) {
  const f = Object.fromEntries(new FormData(form));
  f.state = f.state.trim().toUpperCase(); f.name = f.name.trim(); f.url = f.url.trim(); f.terms_url = f.terms_url.trim() || null;
  if (!safeURL(f.url)) throw new Error('Feed URL must be http(s).');
  if (f.terms_url && !safeURL(f.terms_url)) throw new Error('Terms URL must be http(s).');
  return f;
}

export default async function feeds(ctx) {
  ctx.el.innerHTML = html`<section class="card">
    <div class="card-head"><h2>Incident feeds</h2><div class="row"><button type="button" class="ghost sm" data-export>Export CSV</button><details class="collapse"><summary>Add feed</summary><form data-add class="stack" style="margin-top:10px">${fields()}<div class="row"><button class="primary">Add feed</button></div></form></details></div></div>
    <p class="muted small">State DOT work-zone feeds. Disabled feeds stay listed but are skipped by the app.</p>
    <div data-list><p class="loading">Loading…</p></div></section>`.s;
  qs('[data-add]', ctx.el).onsubmit = async e => {
    e.preventDefault(); const form = e.currentTarget, b = form.querySelector('button'); b.disabled = true;
    try { await api.insertFeed(readForm(form)); form.reset(); ctx.notice('Feed added.'); await ctx.refreshStats(); await load(); } catch (err) { ctx.fail(err); } finally { b.disabled = false; }
  };
  const list = qs('[data-list]', ctx.el);
  let current = [];
  qs('[data-export]', ctx.el).onclick = () => downloadCSV('incident-feeds', ['state', 'name', 'url', 'format', 'enabled', 'terms_url', 'updated_at'], current.map(r => [r.state, r.name, r.url, r.format, r.enabled, r.terms_url, r.updated_at]));
  async function load() {
    const rows = await api.feeds(); if (!ctx.alive()) return; current = rows;
    let tags = {}; try { tags = await api.tagsFor('feed', rows.map(r => r.url)); } catch (e) { if (!e.needsUpgrade) throw e; }
    if (!ctx.alive()) return;
    list.innerHTML = table(['State', 'Name', 'Format', 'Feed', 'Terms', 'Updated', 'Enabled'], rows.map(r => [
      html`<strong>${r.state}</strong>`, html`${r.name} <span class="chips">${tagChips(tags[r.url])}</span>`, r.format, extLink(r.url, 'Feed URL'), r.terms_url ? extLink(r.terms_url, 'Terms') : '—', html`<span title="${fmtDate(r.updated_at)}">${rel(r.updated_at)}</span>`,
      html`<input type="checkbox" data-toggle="${r.url}" aria-label="Enabled: ${r.name}" ${raw(r.enabled ? 'checked' : '')}>`,
    ]), { clickable: true, rowAttr: i => `data-id="${rows[i].url}"`, emptyText: 'No feeds configured.' }).s;
    qsa('tr[data-id]', list).forEach(tr => tr.onclick = e => { if (e.target.closest('a,input,button')) return; location.hash = '/feeds/' + encodeURIComponent(tr.dataset.id); });
    qsa('[data-toggle]', list).forEach(el => el.onchange = async () => { el.disabled = true; try { await api.updateFeed(el.dataset.toggle, { enabled: el.checked }); ctx.notice(el.checked ? 'Feed enabled.' : 'Feed disabled.'); await ctx.refreshStats(); } catch (err) { el.checked = !el.checked; ctx.fail(err); } finally { el.disabled = false; } });
  }
  await load();
}

export async function feedDetail(ctx) {
  const url = ctx.params[0];
  const f = await api.feedOne(url); if (!ctx.alive()) return;
  if (!f) { ctx.el.innerHTML = '<section class="card"><h2>Feed not found</h2><p class="muted"><a href="#/feeds">Back to feeds</a></p></section>'; return; }
  ctx.title(f.name);
  ctx.el.innerHTML = html`
    <p class="breadcrumb"><a href="#/feeds">Incident feeds</a> / ${f.state}</p>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>${f.name}</h2><label class="inline" style="margin:0"><input type="checkbox" data-enabled ${raw(f.enabled ? 'checked' : '')}> Enabled</label></div>
        <dl class="kv"><dt>Feed</dt><dd>${extLink(f.url, f.url)}</dd><dt>Terms</dt><dd>${f.terms_url ? extLink(f.terms_url, f.terms_url) : '—'}</dd><dt>Updated</dt><dd>${fmtDate(f.updated_at)}</dd></dl>
        <h3 style="margin:16px 0 8px">Edit</h3>
        <form data-edit class="stack">${fields(f)}<div class="row"><button class="primary">Save changes</button><span class="muted small">The URL is the key and cannot change.</span></div></form></section>
      <div class="stack"><section class="card" data-annotations></section><section class="card"><h2>Admin history</h2><div data-audit></div></section></div>
    </div>`.s;
  qs('[data-enabled]', ctx.el).onchange = async e => { const el = e.currentTarget; el.disabled = true; try { await api.updateFeed(url, { enabled: el.checked }); ctx.notice(el.checked ? 'Feed enabled.' : 'Feed disabled.'); await ctx.refreshStats(); } catch (err) { el.checked = !el.checked; ctx.fail(err); } finally { el.disabled = false; } };
  qs('[data-edit]', ctx.el).onsubmit = async e => {
    e.preventDefault(); const b = e.currentTarget.querySelector('button'); b.disabled = true;
    try { const patch = readForm(e.currentTarget); delete patch.url; await api.updateFeed(url, patch); ctx.notice('Feed saved.'); if (ctx.alive()) await feedDetail(ctx); } catch (err) { ctx.fail(err); b.disabled = false; }
  };
  await Promise.all([annotations(qs('[data-annotations]', ctx.el), 'feed', url, ctx), auditList(qs('[data-audit]', ctx.el), 'feed', url, ctx)]);
}
