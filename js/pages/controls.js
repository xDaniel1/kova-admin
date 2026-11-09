// App controls: the remote switches the apps read at launch. Every save is audited.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, badge, upgradeCard, versionLess } from '../util.js';
import * as api from '../api.js';
import { annotations, auditList } from '../records.js';

const field = (label, name, value, opts = {}) => html`<label>${label}<input name="${name}" type="${opts.type || 'text'}" value="${value ?? ''}" ${raw(opts.attrs || '')} placeholder="${opts.placeholder || ''}"></label>`;
const toggle = (label, name, on, hint) => html`<label class="inline switch"><input type="checkbox" name="${name}" ${raw(on ? 'checked' : '')}><span><strong>${label}</strong>${hint ? html`<br><span class="muted small">${hint}</span>` : ''}</span></label>`;
const VER = 'pattern="[0-9]+(\\.[0-9]+)*" title="Numbers separated by dots, e.g. 1.2.0"';
const local = iso => iso ? new Date(iso).toISOString().slice(0, 16) : '';

const REL = [['ios', 'iOS', 'build'], ['android', 'Android', 'versionCode'], ['web', 'Web app', 'build'], ['site', 'Site']];
const ORDER = ['maintenance', 'released_versions', 'min_version', 'latest_version', 'features', 'announcement'];
const SECTIONS = {
  maintenance: {
    title: 'Maintenance mode', blurb: 'Stops network features in the apps and shows a message. Use it during a bad deploy or a Supabase incident.',
    form: v => html`${toggle('Maintenance mode is on', 'enabled', v.enabled, 'Apps show the message and pause sync, reports and feedback.')}<label>Message<textarea name="message" maxlength="300">${v.message || ''}</textarea></label>`,
    read: f => ({ enabled: f.get('enabled') === 'on', message: f.get('message').trim() }),
    status: v => v.enabled ? badge('ON · apps paused', 'danger') : badge('Off', 'ok'),
  },
  released_versions: {
    title: 'Released versions', blurb: 'What has shipped. One shared version across products, plus a build number per platform that only goes up. Informational: the apps do not act on it.',
    form: v => html`<div class="form-grid">${REL.map(([k, l, b]) => html`${field(l + ' version', k, (v[k] || {}).version, { placeholder: '1.0.0', attrs: VER })}${b ? field(l + ' ' + b, k + '_build', (v[k] || {}).build, { placeholder: '1', attrs: 'pattern="[0-9]+" title="A whole number"' }) : ''}`)}</div>`,
    read: f => Object.fromEntries(REL.map(([k, , b]) => [k, { version: f.get(k).trim(), build: b ? f.get(k + '_build').trim() || null : null }])),
    status: v => badge(REL.map(([k, l]) => `${l} ${(v[k] || {}).version || '–'}${(v[k] || {}).build ? ' (' + v[k].build + ')' : ''}`).join(' · ')),
  },
  min_version: {
    title: 'Minimum supported version', blurb: 'Builds below these must update before they continue. Leave a platform empty to never block it.',
    form: v => html`<div class="form-grid">${field('iOS', 'ios', v.ios, { placeholder: '1.0', attrs: VER })}${field('Android', 'android', v.android, { placeholder: '1.0', attrs: VER })}${field('Web', 'web', v.web, { placeholder: '0.1', attrs: VER })}</div><label>Message<textarea name="message" maxlength="300">${v.message || ''}</textarea></label>`,
    read: f => ({ ios: f.get('ios').trim(), android: f.get('android').trim(), web: f.get('web').trim(), message: f.get('message').trim() }),
    status: v => badge(`iOS ≥ ${v.ios || '–'} · Android ≥ ${v.android || '–'} · web ≥ ${v.web || '–'}`),
  },
  latest_version: {
    title: 'Latest released version', blurb: 'Apps older than this show a dismissible "update available" nudge. It never blocks.',
    form: v => { const u = v.store_urls || {}; return html`<div class="form-grid">${field('iOS', 'ios', v.ios, { placeholder: '1.0.0', attrs: VER })}${field('Android', 'android', v.android, { placeholder: '1.0.0', attrs: VER })}${field('Web', 'web', v.web, { placeholder: '0.1.0', attrs: VER })}</div><label>Message<textarea name="message" maxlength="300">${v.message || ''}</textarea></label><div class="form-grid">${field('App Store link', 'url_ios', u.ios, { type: 'url' })}${field('Play Store link', 'url_android', u.android, { type: 'url' })}${field('Web app link', 'url_web', u.web, { type: 'url' })}</div>`; },
    read: f => ({ ios: f.get('ios').trim(), android: f.get('android').trim(), web: f.get('web').trim(), message: f.get('message').trim(), store_urls: { ios: f.get('url_ios').trim() || null, android: f.get('url_android').trim() || null, web: f.get('url_web').trim() || null } }),
    status: v => badge(`iOS ${v.ios || '–'} · Android ${v.android || '–'} · web ${v.web || '–'}`),
  },
  features: {
    title: 'Feature switches', blurb: 'Turn parts of the product off without shipping a build.',
    form: v => html`<div class="switches">${[['indoor_maps', 'Indoor maps', 'Floor plans inside venues'], ['traffic_reports', 'Traffic reports', 'Submitting and showing community reports'], ['feedback', 'Feedback form', 'Send feedback and shake-to-report'], ['incident_feeds', 'Incident feeds', 'State DOT work-zone data'], ['sync', 'Cloud sync', 'Favorites and recents across devices']].map(([k, l, h]) => toggle(l, k, v[k] !== false, h))}</div>`,
    read: f => Object.fromEntries(['indoor_maps', 'traffic_reports', 'feedback', 'incident_feeds', 'sync'].map(k => [k, f.get(k) === 'on'])),
    status: v => { const off = Object.entries(v).filter(([, on]) => on === false).map(([k]) => k.replace('_', ' ')); return off.length ? badge(off.length + ' off: ' + off.join(', '), 'tone-seen') : badge('All on', 'ok'); },
  },
  announcement: {
    title: 'Announcement banner', blurb: 'A banner in the apps. Leave the window empty to show it whenever it is enabled.',
    form: v => html`${toggle('Show the announcement', 'enabled', v.enabled)}<div class="form-grid">${field('Title', 'title', v.title, { attrs: 'maxlength="80"' })}<label>Level<select name="level">${['info', 'warning', 'critical'].map(l => html`<option ${raw(l === (v.level || 'info') ? 'selected' : '')}>${l}</option>`)}</select></label></div><label>Body<textarea name="body" maxlength="500">${v.body || ''}</textarea></label><div class="form-grid">${field('Link (optional)', 'url', v.url, { type: 'url', placeholder: 'https://' })}${field('Starts', 'starts_at', local(v.starts_at), { type: 'datetime-local' })}${field('Ends', 'ends_at', local(v.ends_at), { type: 'datetime-local' })}</div>`,
    read: f => ({ enabled: f.get('enabled') === 'on', title: f.get('title').trim(), body: f.get('body').trim(), level: f.get('level'), url: f.get('url').trim() || null, starts_at: f.get('starts_at') ? new Date(f.get('starts_at')).toISOString() : null, ends_at: f.get('ends_at') ? new Date(f.get('ends_at')).toISOString() : null }),
    status: v => v.enabled ? badge('Live', 'accent') : badge('Hidden'),
  },
};

export default async function controls(ctx) {
  let rows;
  try { rows = await api.config(); } catch (e) { if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  const label = await api.labels(rows.map(r => r.updated_by)); if (!ctx.alive()) return;
  const endpoint = `${api.client().supabaseUrl || window.KOVA_SUPABASE.url}/rest/v1/app_config?select=key,value`;
  ctx.el.innerHTML = html`
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h2>How the apps read these</h2></div>
      <p class="muted small" style="margin:0">Public, read-only JSON at <code>${endpoint}</code> with the anon key. The iOS, Android and web apps fetch it at launch and on returning to the foreground, and fall back to normal behaviour on any error. The full contract is <a href="https://github.com/xDaniel1/kova-admin/blob/main/docs/app-controls-contract.md" target="_blank" rel="noopener noreferrer">docs/app-controls-contract.md</a>. Changes are audited; see each control's history below.</p></section>
    <div class="grid two">${rows.slice().sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)).map(r => { const s = SECTIONS[r.key]; const v = r.value || {}; return html`
      <section class="card control" data-key="${r.key}">
        <div class="card-head"><div><h2>${s?.title || r.key}</h2><p class="muted small" style="margin:2px 0 0">${s?.blurb || r.description || ''}</p></div>${s ? s.status(v) : ''}</div>
        <form class="stack" data-form>${s ? s.form(v) : html`<label>JSON<textarea name="json" class="mono">${JSON.stringify(v, null, 2)}</textarea></label>`}
          <div class="row"><button class="primary" type="submit">Save</button><span class="muted small">Updated ${rel(r.updated_at)}${r.updated_by ? ' by ' + (label(r.updated_by)?.email || 'an admin') : ''}</span></div></form>
        <details class="collapse" style="margin-top:14px"><summary>Notes and history</summary><div class="stack" style="margin-top:12px"><div data-annotations></div><div><h3 class="eyebrow">History</h3><div data-audit></div></div></div></details>
      </section>`; })}</div>`.s;
  qsa('.control', ctx.el).forEach(card => {
    const key = card.dataset.key, s = SECTIONS[key], form = qs('[data-form]', card);
    form.onsubmit = async e => {
      e.preventDefault(); const b = form.querySelector('button[type=submit]'); b.disabled = true;
      try {
        const f = new FormData(form);
        const value = s ? s.read(f) : JSON.parse(f.get('json'));
        if (key === 'min_version') { const cur = rows.find(r => r.key === 'latest_version')?.value || {}; const bad = ['ios', 'android', 'web'].filter(p => value[p] && cur[p] && versionLess(cur[p], value[p])); if (bad.length && !confirm(`The minimum for ${bad.join(', ')} is above the latest released version. Every user on that platform would be blocked. Save anyway?`)) return; }
        if (key === 'released_versions') { const cur = rows.find(r => r.key === key)?.value || {}; const down = ['ios', 'android', 'web'].filter(p => cur[p]?.build && value[p].build && Number(value[p].build) < Number(cur[p].build)); if (down.length) throw new Error(`Build numbers only go up: ${down.map(p => `${p} is ${cur[p].build}`).join(', ')}.`); }
        if (key === 'maintenance' && value.enabled && !confirm('Turn on maintenance mode? Every app user will see the message and lose network features until you turn it off.')) return;
        await api.saveConfig(key, value); ctx.notice(`${s?.title || key} saved.`); if (ctx.alive()) await controls(ctx);
      } catch (err) { ctx.fail(err); } finally { b.disabled = false; }
    };
    const details = qs('details', card);
    details.ontoggle = () => { if (details.open && !details.dataset.loaded) { details.dataset.loaded = '1'; annotations(qs('[data-annotations]', card), 'config', key, ctx); auditList(qs('[data-audit]', card), 'config', key, ctx); } };
  });
}
