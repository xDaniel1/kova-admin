// Indoor venues: list with inline enable toggles, an add form, and a record page with editing.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, href, table, mapsLink, badge, upgradeCard } from '../util.js';
import * as api from '../api.js';
import { annotations, auditList, tagChips } from '../records.js';

const KINDS = ['other', 'airport', 'station', 'mall'];
const fields = (v = {}) => html`<div class="form-grid">
  <label>Short name<input name="short_name" required maxlength="100" value="${v.short_name || ''}" ${raw(v.short_name ? 'readonly' : '')} placeholder="msp"></label>
  <label>Name<input name="name" required maxlength="300" value="${v.name || ''}" placeholder="Minneapolis–Saint Paul International Airport"></label>
  <label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required value="${v.latitude ?? ''}"></label>
  <label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required value="${v.longitude ?? ''}"></label>
  <label>Radius (m)<input name="radius_m" type="number" min="50" max="5000" step="1" required value="${v.radius_m ?? 200}"></label>
  <label>Kind<select name="kind">${KINDS.map(k => html`<option ${raw(k === (v.kind || 'other') ? 'selected' : '')}>${k}</option>`)}</select></label>
  <label>Sources (comma separated)<input name="sources" required value="${(v.sources || ['osm']).join(', ')}"></label>
</div>`;
function readForm(form) {
  const v = Object.fromEntries(new FormData(form));
  ['short_name', 'name'].forEach(k => { v[k] = v[k].trim(); if (!v[k]) throw new Error(k.replace('_', ' ') + ' is required.'); });
  ['latitude', 'longitude', 'radius_m'].forEach(k => { v[k] = Number(v[k]); });
  v.sources = v.sources.split(',').map(s => s.trim()).filter(Boolean);
  if (!v.sources.length) throw new Error('Enter at least one source.');
  return v;
}

export default async function venues(ctx) {
  ctx.el.innerHTML = html`<section class="card">
    <div class="card-head"><h2>Venues</h2><details class="collapse"><summary>Add venue</summary><form data-add class="stack" style="margin-top:10px">${fields()}<div class="row"><button class="primary">Add venue</button></div></form></details></div>
    <p class="muted small">Venues with floor plans. The app refreshes this list, so a change here reaches users without an update.</p>
    <div data-list><p class="loading">Loading…</p></div></section>`.s;
  qs('[data-add]', ctx.el).onsubmit = async e => {
    e.preventDefault(); const form = e.currentTarget, b = form.querySelector('button'); b.disabled = true;
    try { const v = readForm(form); await api.insertVenue(v); form.reset(); ctx.notice('Venue added.'); await ctx.refreshStats(); await load(); } catch (err) { ctx.fail(err); } finally { b.disabled = false; }
  };
  const list = qs('[data-list]', ctx.el);
  async function load() {
    const rows = await api.venues(); if (!ctx.alive()) return;
    let tags = {}; try { tags = await api.tagsFor('venue', rows.map(r => r.short_name)); } catch (e) { if (!e.needsUpgrade) throw e; }
    if (!ctx.alive()) return;
    list.innerHTML = table(['Short name', 'Name', 'Kind', 'Location', 'Radius', 'Sources', 'Updated', 'Enabled'], rows.map(r => [
      html`<strong>${r.short_name}</strong> <span class="chips">${tagChips(tags[r.short_name])}</span>`, r.name, r.kind, mapsLink(r.latitude, r.longitude), r.radius_m + ' m', (r.sources || []).join(', '), html`<span title="${fmtDate(r.updated_at)}">${rel(r.updated_at)}</span>`,
      html`<input type="checkbox" data-toggle="${r.short_name}" aria-label="Enabled: ${r.name}" ${raw(r.enabled ? 'checked' : '')}>`,
    ]), { clickable: true, rowAttr: i => `data-id="${rows[i].short_name}"`, emptyText: 'No venues yet.' }).s;
    qsa('tr[data-id]', list).forEach(tr => tr.onclick = e => { if (e.target.closest('a,input,button')) return; location.hash = '/venues/' + encodeURIComponent(tr.dataset.id); });
    qsa('[data-toggle]', list).forEach(el => el.onchange = async () => { el.disabled = true; try { await api.updateVenue(el.dataset.toggle, { enabled: el.checked }); ctx.notice(el.checked ? 'Venue enabled.' : 'Venue disabled.'); await ctx.refreshStats(); } catch (err) { el.checked = !el.checked; ctx.fail(err); } finally { el.disabled = false; } });
  }
  await load();
}

export async function venueDetail(ctx) {
  const id = ctx.params[0];
  const v = await api.venueOne(id); if (!ctx.alive()) return;
  if (!v) { ctx.el.innerHTML = '<section class="card"><h2>Venue not found</h2><p class="muted"><a href="#/venues">Back to venues</a></p></section>'; return; }
  ctx.title(v.name);
  ctx.el.innerHTML = html`
    <p class="breadcrumb"><a href="#/venues">Venues</a> / ${v.short_name}</p>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>${v.name}</h2><label class="inline" style="margin:0"><input type="checkbox" data-enabled ${raw(v.enabled ? 'checked' : '')}> Enabled</label></div>
        <dl class="kv"><dt>Location</dt><dd>${mapsLink(v.latitude, v.longitude)}</dd><dt>Updated</dt><dd>${fmtDate(v.updated_at)}</dd></dl>
        <h3 style="margin:16px 0 8px">Edit</h3>
        <form data-edit class="stack">${fields(v)}<div class="row"><button class="primary">Save changes</button><span class="muted small">The short name is the key and cannot change.</span></div></form></section>
      <div class="stack"><section class="card" data-annotations></section><section class="card"><h2>Admin history</h2><div data-audit></div></section></div>
    </div>`.s;
  qs('[data-enabled]', ctx.el).onchange = async e => { const el = e.currentTarget; el.disabled = true; try { await api.updateVenue(id, { enabled: el.checked }); ctx.notice(el.checked ? 'Venue enabled.' : 'Venue disabled.'); await ctx.refreshStats(); } catch (err) { el.checked = !el.checked; ctx.fail(err); } finally { el.disabled = false; } };
  qs('[data-edit]', ctx.el).onsubmit = async e => {
    e.preventDefault(); const b = e.currentTarget.querySelector('button'); b.disabled = true;
    try { const patch = readForm(e.currentTarget); delete patch.short_name; await api.updateVenue(id, patch); ctx.notice('Venue saved.'); if (ctx.alive()) await venueDetail(ctx); } catch (err) { ctx.fail(err); b.disabled = false; }
  };
  await Promise.all([annotations(qs('[data-annotations]', ctx.el), 'venue', id, ctx), auditList(qs('[data-audit]', ctx.el), 'venue', id, ctx)]);
}
