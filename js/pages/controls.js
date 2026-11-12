// App controls: the remote switches the apps read at launch. Every save is audited.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, badge, upgradeCard, versionLess } from '../util.js';
import * as api from '../api.js';
import { annotations, auditList } from '../records.js';

const field = (label, name, value, opts = {}) => html`<label>${label}<input name="${name}" type="${opts.type || 'text'}" value="${value ?? ''}" ${raw(opts.attrs || '')} placeholder="${opts.placeholder || ''}"></label>`;
const toggle = (label, name, on, hint) => html`<label class="inline switch"><input type="checkbox" name="${name}" ${raw(on ? 'checked' : '')}><span><strong>${label}</strong>${hint ? html`<br><span class="muted small">${hint}</span>` : ''}</span></label>`;
const VER = 'pattern="[0-9]+(\\.[0-9]+)*" title="Numbers separated by dots, e.g. 1.2.0"';
const local = iso => iso ? new Date(iso).toISOString().slice(0, 16) : '';

// Every switch the apps can read. Who reads it today is in the hint; a switch an app does not read yet is harmless.
export const FEATURES = [
  ['indoor_maps', 'Indoor maps', 'Floor plans inside airports, stations and malls · iOS, web'],
  ['traffic_reports', 'Traffic reports', 'Submitting and showing community reports · iOS, web'],
  ['feedback', 'Feedback form', 'Send feedback and shake-to-report · iOS, web'],
  ['incident_feeds', 'Incident feeds', 'State DOT work zones (FDOT and others) · iOS, web'],
  ['sync', 'Cloud sync', 'Favorites and recents across devices · iOS, web'],
  ['speed_limits', 'Speed limits', 'Posted limits from our database (Florida) and OpenStreetMap · iOS build 6+, web 1.0.2+'],
  ['traffic_coloring', 'Traffic colouring', 'Live traffic colours on routes and the map · iOS build 6+, web 1.0.2+'],
  ['transit', 'Transit', 'Transit stops and rail lines outside New York · iOS build 6+, web 1.0.2+'],
  ['voice_guidance', 'Voice guidance', 'Spoken turn-by-turn directions · iOS build 6+, web 1.0.2+'],
  ['carplay', 'CarPlay', 'Kova on the car screen · iOS build 7+ (CarPlay entitlement)'],
  ['android_auto', 'Android Auto', 'Kova on the car screen · Android (not yet reading)'],
  ['place_labels', 'Place labels', 'Shops, restaurants and attractions named on the map at venues and on streets · iOS build 8 (not yet reading the switch)'],
  ['flat_turns', 'Flat map for turns', 'Driving map drops to 2D before each turn · iOS build 9 (not yet reading the switch)'],
  ['rural_detail', 'Rural map detail', 'Minor roads, small towns and unpaved surfaces drawn clearer · web 1.0.2 (not yet reading the switch)'],
];
// Earliest build (iOS) or version (web) that honours each switch, for the reach estimate shown until
// apps send config_keys.
const SINCE = {
  speed_limits: { ios: 6, web: '1.0.2' }, traffic_coloring: { ios: 6, web: '1.0.2' }, transit: { ios: 6, web: '1.0.2' },
  voice_guidance: { ios: 6, web: '1.0.2' }, carplay: { ios: 7 }, platform_overrides: { ios: 6, web: '1.0.2' },
  indoor_maps: { ios: 5, web: '1.0.0' }, traffic_reports: { ios: 5, web: '1.0.0' }, feedback: { ios: 5, web: '1.0.0' },
  incident_feeds: { ios: 5, web: '1.0.0' }, sync: { ios: 5, web: '1.0.0' },
};
const PLATFORMS = [['ios', 'iOS'], ['android', 'Android'], ['web', 'Web']];
const REL = [['ios', 'iOS', 'build'], ['android', 'Android', 'versionCode'], ['web', 'Web app', 'build'], ['site', 'Site']];
const ORDER = ['maintenance', 'released_versions', 'min_version', 'latest_version', 'features', 'platform_overrides', 'announcement'];
const SECTIONS = {
  maintenance: {
    title: 'Maintenance mode', blurb: 'Stops network features in the apps and shows a message. Use it during a bad deploy or a Supabase incident.',
    form: v => html`${toggle('Maintenance mode is on', 'enabled', v.enabled, 'Apps show the message and pause sync, reports and feedback.')}<label>Message<textarea name="message" maxlength="300">${v.message || ''}</textarea></label>`,
    read: f => ({ enabled: f.get('enabled') === 'on', message: f.get('message').trim() }),
    status: v => v.enabled ? badge('ON · apps paused', 'danger') : badge('Off', 'ok'),
  },
  released_versions: {
    title: 'Released versions', blurb: 'What has shipped. One shared version across products, plus a build number per platform that only goes up. Informational: the apps do not act on it.',
    form: v => html`<div class="form-grid">${REL.map(([k, l, b]) => html`${field(l + ' version', k, (v[k] || {}).version, { placeholder: '1.0.0', attrs: VER })}${b ? field(l + ' ' + b, k + '_build', (v[k] || {}).build, { placeholder: '1', attrs: 'pattern="[0-9]+" title="A whole number"' }) : ''}${b ? field(l + ' pending ' + b, k + '_pending', (v[k] || {}).pending_build, { placeholder: 'in review', attrs: 'pattern="[0-9]*" title="A whole number, or empty"' }) : ''}${b ? field(l + ' release tag', k + '_tag', (v[k] || {}).tag, { placeholder: k + '-v1.0.0-b5' }) : ''}${k === 'ios' || k === 'android' ? field(l + ' public beta build', k + '_beta', (v[k] || {}).beta_build, { placeholder: 'TestFlight / beta link', attrs: 'pattern="[0-9]*"' }) : ''}`)}</div>`,
    read: (f, cur = {}) => Object.fromEntries(REL.map(([k, , b]) => [k, { ...(cur[k] || {}), version: f.get(k).trim(), build: b ? f.get(k + '_build').trim() || null : null,
      ...(b ? { pending_build: f.get(k + '_pending').trim() || null, tag: f.get(k + '_tag').trim() || null } : {}), ...(k === 'ios' || k === 'android' ? { beta_build: f.get(k + '_beta').trim() || null } : {}) }])),
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
    title: 'Feature switches', blurb: 'Turn parts of the product off everywhere without shipping a build. Per-platform switches are in Platform overrides.',
    form: v => html`<div class="switches">${FEATURES.map(([k, l, h]) => html`<div>${toggle(l, k, v[k] !== false, h)}<span class="reader small muted" data-reader="features.${k}"></span></div>`)}</div>`,
    // Keeps keys this page does not know, so a newer app's switch is never wiped by saving here.
    read: (f, cur = {}) => ({ ...cur, ...Object.fromEntries(FEATURES.map(([k]) => [k, f.get(k) === 'on'])) }),
    status: v => { const off = FEATURES.filter(([k]) => v[k] === false).map(([, l]) => l); return off.length ? badge(off.length + ' off: ' + off.join(', '), 'tone-seen') : badge('All on', 'ok'); },
  },
  platform_overrides: {
    title: 'Platform overrides', blurb: 'Switch a feature off, pause, or announce on one platform only. A feature runs only if it is on in Feature switches and not off here. Read by iOS build 6+ and web 1.0.2+; Android not yet.',
    form: v => html`${PLATFORMS.map(([p, label]) => { const o = v[p] || {}, f = o.features || {}, m = o.maintenance || {}, a = o.announcement || {}; return html`
      <fieldset class="stack platform-override"><legend>${label}</legend>
        ${toggle(label + ' maintenance mode', p + '_maint', m.enabled, 'Pauses network features on ' + label + ' only.')}
        <label>Maintenance message<input name="${p}_maint_msg" maxlength="300" value="${m.message || ''}"></label>
        <details class="collapse"><summary>Features on ${label} (${FEATURES.filter(([k]) => f[k] === false).length} off)</summary><div class="switches" style="margin-top:8px">${FEATURES.map(([k, l]) => toggle(l, p + '_f_' + k, f[k] !== false))}</div></details>
        <details class="collapse"><summary>${label} announcement ${a.enabled ? '(live)' : ''}</summary><div class="stack" style="margin-top:8px">
          ${toggle('Show on ' + label, p + '_ann', a.enabled, 'Replaces the global announcement on ' + label + ' while live.')}
          <div class="form-grid"><label>Title<input name="${p}_ann_title" maxlength="80" value="${a.title || ''}"></label><label>Level<select name="${p}_ann_level">${['info', 'warning', 'critical'].map(l => html`<option ${raw(l === (a.level || 'info') ? 'selected' : '')}>${l}</option>`)}</select></label></div>
          <label>Body<textarea name="${p}_ann_body" maxlength="500">${a.body || ''}</textarea></label>
          <label>Link (optional)<input name="${p}_ann_url" type="url" value="${a.url || ''}" placeholder="https://"></label></div></details>
      </fieldset>`; })}`,
    read: (f, cur = {}) => Object.fromEntries(PLATFORMS.map(([p]) => { const prev = cur[p] || {}; return [p, {
      ...prev,
      // Only switches that are off are stored; unknown keys from newer apps are kept as they were.
      features: { ...Object.fromEntries(Object.entries(prev.features || {}).filter(([k]) => !FEATURES.some(([x]) => x === k))), ...Object.fromEntries(FEATURES.filter(([k]) => f.get(p + '_f_' + k) !== 'on').map(([k]) => [k, false])) },
      maintenance: { enabled: f.get(p + '_maint') === 'on', message: f.get(p + '_maint_msg').trim() },
      announcement: { ...(prev.announcement || {}), enabled: f.get(p + '_ann') === 'on', title: f.get(p + '_ann_title').trim(), body: f.get(p + '_ann_body').trim(), level: f.get(p + '_ann_level'), url: f.get(p + '_ann_url').trim() || null },
    }]; })),
    status: v => { const bits = PLATFORMS.flatMap(([p, l]) => { const o = v[p] || {}; return [o.maintenance?.enabled && l + ' paused', Object.values(o.features || {}).includes(false) && l + ' ' + Object.values(o.features).filter(x => x === false).length + ' off', o.announcement?.enabled && l + ' announcing'].filter(Boolean); }); return bits.length ? badge(bits.join(' · '), bits.some(b => b.includes('paused')) ? 'danger' : 'tone-seen') : badge('None', 'ok'); },
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
        <div class="card-head"><div><h2>${s?.title || r.key}</h2><p class="muted small" style="margin:2px 0 0">${s?.blurb || r.description || ''}</p><p class="reader small muted" data-reader="${r.key}" style="margin:4px 0 0"></p></div>${s ? s.status(v) : ''}</div>
        <form class="stack" data-form>${s ? s.form(v) : html`<label>JSON<textarea name="json" class="mono">${JSON.stringify(v, null, 2)}</textarea></label>`}
          <div class="row"><button class="primary" type="submit">Save</button><span class="muted small">Updated ${rel(r.updated_at)}${r.updated_by ? ' by ' + (label(r.updated_by)?.email || 'an admin') : ''}</span></div></form>
        <details class="collapse" style="margin-top:14px"><summary>Notes and history</summary><div class="stack" style="margin-top:12px"><div data-annotations></div><div><h3 class="eyebrow">History</h3><div data-audit></div></div></div></details>
      </section>`; })}</div>`.s;
  let mix = null;
  const reach = since => ['ios', 'web'].filter(p => since[p] != null).map(p => { const m = mix[p] || []; const all = m.reduce((a, x) => a + +x.n, 0);
    const ok = m.filter(x => p === 'ios' ? +x.build >= since.ios : !versionLess(x.version, since.web)).reduce((a, x) => a + +x.n, 0);
    return `${p === 'ios' ? 'iOS' : 'web'} ${ok} of ${all}`; }).join(' · ');
  Promise.all([api.configReaders(), api.versions().then(v => { mix = Object.fromEntries(Object.entries(v.platforms || {}).map(([p, x]) => [p, x.mix || []])); }).catch(() => {})]).then(([readers]) => { if (!ctx.alive()) return;
    const P = { ios: 'iOS', android: 'Android', web: 'Web' };
    qsa('[data-reader]', ctx.el).forEach(el => { const r = readers[el.dataset.reader];
      if (r) { el.textContent = 'Last seen reading this: ' + Object.entries(r).map(([p, x]) => `${P[p] || p} ${x.version}${x.build ? ' (' + x.build + ')' : ''} ${rel(x.last_seen)}, ${x.installs_30d} installs`).join(' · '); return; }
      const since = SINCE[el.dataset.reader.replace(/^features\./, '')];
      el.textContent = el.dataset.reader === 'released_versions' ? '' : since && mix ? 'Estimated reach (builds that honour it, 30 days): ' + reach(since) : 'No build has reported reading this yet.'; }); }).catch(() => {});
  qsa('.control', ctx.el).forEach(card => {
    const key = card.dataset.key, s = SECTIONS[key], form = qs('[data-form]', card);
    form.onsubmit = async e => {
      e.preventDefault(); const b = form.querySelector('button[type=submit]'); b.disabled = true;
      try {
        const f = new FormData(form);
        const value = s ? s.read(f, rows.find(r => r.key === key)?.value || {}) : JSON.parse(f.get('json'));
        if (key === 'min_version') { const cur = rows.find(r => r.key === 'latest_version')?.value || {}; const bad = ['ios', 'android', 'web'].filter(p => value[p] && cur[p] && versionLess(cur[p], value[p])); if (bad.length && !confirm(`The minimum for ${bad.join(', ')} is above the latest released version. Every user on that platform would be blocked. Save anyway?`)) return; }
        if (key === 'released_versions') { const cur = rows.find(r => r.key === key)?.value || {}; const down = ['ios', 'android', 'web'].filter(p => cur[p]?.build && value[p].build && Number(value[p].build) < Number(cur[p].build)); if (down.length) throw new Error(`Build numbers only go up: ${down.map(p => `${p} is ${cur[p].build}`).join(', ')}.`); }
        if (key === 'platform_overrides') { const on = PLATFORMS.filter(([p]) => value[p].maintenance.enabled && !(rows.find(r => r.key === key)?.value?.[p]?.maintenance?.enabled)).map(([, l]) => l); if (on.length && !confirm(`Turn on maintenance for ${on.join(', ')}? Those users lose network features until you turn it off.`)) return; }
        if (key === 'maintenance' && value.enabled && !confirm('Turn on maintenance mode? Every app user will see the message and lose network features until you turn it off.')) return;
        await api.saveConfig(key, value); ctx.notice(`${s?.title || key} saved.`); if (ctx.alive()) await controls(ctx);
      } catch (err) { ctx.fail(err); } finally { b.disabled = false; }
    };
    const details = qs('details', card);
    details.ontoggle = () => { if (details.open && !details.dataset.loaded) { details.dataset.loaded = '1'; annotations(qs('[data-annotations]', card), 'config', key, ctx); auditList(qs('[data-audit]', card), 'config', key, ctx); } };
  });
}
