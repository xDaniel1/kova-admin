// App controls: the remote switches the apps read at launch. Every save is audited.
'use strict';
import { html, raw, qs, qsa, fmtDate, rel, badge, upgradeCard, versionLess, announcementLive, announcementReach, parseInstant } from '../util.js';
import * as api from '../api.js';
import { state } from '../app.js';
import { annotations, auditList } from '../records.js';

const field = (label, name, value, opts = {}) => html`<label>${label}<input name="${name}" type="${opts.type || 'text'}" value="${value ?? ''}" ${raw(opts.attrs || '')} placeholder="${opts.placeholder || ''}"></label>`;
const toggle = (label, name, on, hint) => html`<label class="inline switch"><input type="checkbox" name="${name}" ${raw(on ? 'checked' : '')}><span><strong>${label}</strong>${hint ? html`<br><span class="muted small">${hint}</span>` : ''}</span></label>`;
const VER = 'pattern="[0-9]+(\\.[0-9]+)*" title="Numbers separated by dots, e.g. 1.2.0"';
// datetime-local fields hold local wall-clock time; convert from the stored UTC instant.
// Back from a datetime-local value to an instant. An untouched field keeps its stored instant (seconds and
// the repeated DST hour included). A time that doesn't exist (spring-forward gap) is refused; a time that
// happens twice (fall-back) asks which one is meant.
const fromLocal = (value, orig, label, drop = false) => {
  // A stored bound that isn't a valid date is never silently opened up: it must be replaced or removed on purpose.
  if (!value) { if (orig && !local(orig) && !drop) throw new Error(`${label}: the stored date (${orig}) is invalid. Enter a new one or tick the box to remove it.`); return null; }
  if (orig && local(orig) === value) return orig;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`${label}: enter a date and time.`);
  // Every instant whose local wall time is this value: try each UTC offset from -14h to +14h in 15-minute
  // steps, so half-hour and 30-minute DST zones are handled too.
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const hits = [];
  for (let k = -56; k <= 56; k++) { const t = asUtc - k * 9e5; if (local(new Date(t).toISOString()) === value && !hits.includes(t)) hits.push(t); }
  hits.sort((a, b) => a - b);
  const pretty = value.replace('T', ' ');
  if (!hits.length) throw new Error(`${label}: ${pretty} doesn't exist in your time zone (the clocks skip it). Pick another time.`);
  if (hits.length === 1) return new Date(hits[0]).toISOString();
  const [early, late] = [hits[0], hits[hits.length - 1]].map(t => new Date(t));
  return (confirm(`${label}: ${pretty} happens twice when the clocks go back. OK for the first one (${early.toISOString().slice(11, 16)} UTC), Cancel for the second (${late.toISOString().slice(11, 16)} UTC).`) ? early : late).toISOString();
};
// The full config, set before each render so platform badges can apply global maintenance and fallback.
let CONF = {}, BUILDS = null; // BUILDS: admin_live_builds rows, so badges count who actually sees an announcement
const local = iso => { if (Number.isNaN(parseInstant(iso))) return ''; const d = new Date(iso); return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// Every switch the apps can read. Who reads it today is in the hint; a switch an app does not read yet is harmless.
export const FEATURES = [
  ['indoor_maps', 'Indoor maps', 'Floor plans inside airports, stations and malls · iOS, web'],
  ['traffic_reports', 'Traffic reports', 'Submitting and showing community reports · iOS, web'],
  ['feedback', 'Feedback form', 'Send feedback and shake-to-report · iOS, web'],
  ['incident_feeds', 'Incident feeds', 'State DOT work zones (FDOT and others) · iOS, web'],
  ['sync', 'Cloud sync', 'Favorites and recents across devices · iOS, web'],
  ['speed_limits', 'Speed limits', 'Posted limits from our database (Florida, New York State) and OpenStreetMap · iOS build 6+, web 1.0.2+'],
  ['traffic_coloring', 'Traffic colouring', 'Live traffic colours on routes and the map · iOS build 6+, web 1.0.2+'],
  ['transit', 'Transit', 'Transit stops and rail lines outside New York · iOS build 6+, web 1.0.2+'],
  ['voice_guidance', 'Voice guidance', 'Spoken turn-by-turn directions · iOS build 6+, web 1.0.2+'],
  ['carplay_b17', 'CarPlay (build 17+)', 'Kova on the car screen for the build with the trip-crash fix · iOS build 17+'],
  ['carplay_safe', 'CarPlay (builds 15–16)', 'Car screen on builds 15 and 16, which can still crash when a trip starts · switch off to keep them off the car'],
  ['carplay', 'CarPlay (builds 7–14)', 'Car screen on builds 7–14, which crash when a trip starts · switch off to keep them off the car'],
  ['android_auto', 'Android Auto', 'Kova on the car screen · Android (not yet reading)'],
  ['place_labels', 'Place labels', 'Shops, restaurants and attractions named on the map at venues and on streets · web 1.0.3+ (iOS shows them but ignores the switch)'],
  ['flat_turns', 'Flat map for turns', 'Driving map drops to 2D before each turn · iOS build 9+ draws it, ignores the switch'],
  ['rural_detail', 'Rural map detail', 'Minor roads, small towns and unpaved surfaces drawn clearer · web 1.0.3+'],
  ['map_trees', '3D trees', 'Trees planted from satellite tree cover (Florida) · iOS build 19+, web 1.0.7+'],
  ['route_road_matching', 'Routes on map roads', 'Driving routes matched to Mapbox roads so the line is on the right carriageway · iOS build 53+'],
];
// Earliest build (iOS) or version (web) that honours each switch, for the reach estimate shown until
// apps send config_keys.
const SINCE = {
  speed_limits: { ios: 6, web: '1.0.2' }, traffic_coloring: { ios: 6, web: '1.0.2' }, transit: { ios: 6, web: '1.0.2' },
  voice_guidance: { ios: 6, web: '1.0.2' }, carplay: { ios: 7, iosTo: 14 }, carplay_safe: { ios: 15, iosTo: 16 }, carplay_b17: { ios: 17 },
  place_labels: { web: '1.0.3' }, rural_detail: { web: '1.0.3' }, map_trees: { ios: 19, web: '1.0.7' }, route_road_matching: { ios: 53 }, platform_overrides: { ios: 6, web: '1.0.2' },
  indoor_maps: { ios: 5, web: '1.0.0' }, traffic_reports: { ios: 5, web: '1.0.0' }, feedback: { ios: 5, web: '1.0.0' },
  incident_feeds: { ios: 5, web: '1.0.0' }, sync: { ios: 5, web: '1.0.0' },
};
const PLATFORMS = [['ios', 'iOS'], ['android', 'Android'], ['web', 'Web']];
const REL = [['ios', 'iOS', 'build'], ['android', 'Android', 'versionCode'], ['web', 'Web app', 'build'], ['site', 'Site']];
const ORDER = ['maintenance', 'released_versions', 'min_version', 'latest_version', 'features', 'platform_overrides', 'announcement'];
const SECTIONS = {
  maintenance: {
    title: 'Maintenance mode', blurb: 'Stops network features in the apps and shows a message. Use it during a bad deploy or a Supabase incident.',
    form: v => html`${toggle('Maintenance mode is on', 'enabled', v.enabled === true, 'Apps show the message and pause sync, reports and feedback.')}<label>Message<textarea name="message" maxlength="300">${v.message || ''}</textarea></label>`,
    read: f => ({ enabled: f.get('enabled') === 'on', message: f.get('message').trim() }),
    status: v => v.enabled === true ? badge('ON · apps paused', 'danger') : badge('Off', 'ok'),
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
    form: v => html`<div class="switches">${FEATURES.map(([k, l, h]) => html`<div>${toggle(l, k, v[k] !== false, h)}<span class="badge unread pending" data-unread="${k}">Checking readers…</span><span class="reader small muted" data-reader="features.${k}"></span></div>`)}</div>`,
    // Keeps keys this page does not know, so a newer app's switch is never wiped by saving here.
    read: (f, cur = {}) => ({ ...cur, ...Object.fromEntries(FEATURES.map(([k]) => [k, f.get(k) === 'on'])) }),
    status: v => { const off = FEATURES.filter(([k]) => v[k] === false).map(([, l]) => l); return off.length ? badge(off.length + ' off: ' + off.join(', '), 'tone-seen') : badge('All on', 'ok'); },
  },
  platform_overrides: {
    title: 'Platform overrides', blurb: 'Switch a feature off, pause, or announce on one platform only. A feature runs only if it is on in Feature switches and not off here. Read by iOS build 6+ and web 1.0.2+; Android not yet.',
    form: v => html`${PLATFORMS.map(([p, label]) => { const o = v[p] || {}, f = o.features || {}, m = o.maintenance || {}, a = o.announcement || {}; return html`
      <fieldset class="stack platform-override"><legend>${label}</legend>
        ${toggle(label + ' maintenance mode', p + '_maint', m.enabled === true, 'Pauses network features on ' + label + ' only.')}
        <label>Maintenance message<input name="${p}_maint_msg" maxlength="300" value="${m.message || ''}"></label>
        <details class="collapse"><summary>Features on ${label} (${FEATURES.filter(([k]) => f[k] === false).length} off)</summary><div class="switches" style="margin-top:8px">${FEATURES.map(([k, l]) => toggle(l, p + '_f_' + k, f[k] !== false))}</div></details>
        <details class="collapse"><summary>${label} announcement ${!announcementLive(a) ? (a.enabled === true ? '(on, not showing)' : '') : (() => { if (p === 'android') return '(set, Android does not read it yet)'; const all = announcementReach({ ...CONF, platform_overrides: v }, BUILDS); if (!all) return '(install reach unavailable)'; const r = all.filter(x => x.platform === p && x.source === 'platform'); return r.some(x => x.state === 'live') ? '(live)' : r.some(x => x.state === 'hidden') ? '(set, hidden by maintenance)' : r.some(x => x.state === 'blocked') ? '(set, installs need the required update)' : '(set, not reaching anyone)'; })()}</summary><div class="stack" style="margin-top:8px">
          ${toggle('Show on ' + label, p + '_ann', a.enabled === true, 'Replaces the global announcement on ' + label + ' while live.')}
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
    status: v => { const unknownReach = !BUILDS && ['ios', 'web'].some(p => announcementLive(v[p]?.announcement)); const bits = (unknownReach ? ['announcement reach unavailable'] : []).concat(PLATFORMS.flatMap(([p, l]) => { const o = v[p] || {}; return [p !== 'android' && o.maintenance?.enabled === true && l + ' paused', Object.values(o.features || {}).includes(false) && l + ' ' + Object.values(o.features).filter(x => x === false).length + ' off', (announcementReach({ ...CONF, platform_overrides: v }, BUILDS) || []).some(x => x.platform === p && x.source === 'platform' && x.state === 'live') && l + ' announcing'].filter(Boolean); })); return bits.length ? badge(bits.join(' · '), bits.some(b => b.includes('paused')) ? 'danger' : 'tone-seen') : badge('None', 'ok'); },
  },
  announcement: {
    title: 'Announcement banner', blurb: 'A banner in the apps. Leave the window empty to show it whenever it is enabled.',
    form: v => html`${toggle('Show the announcement', 'enabled', v.enabled === true)}<div class="form-grid">${field('Title', 'title', v.title, { attrs: 'maxlength="80"' })}<label>Level<select name="level">${['info', 'warning', 'critical'].map(l => html`<option ${raw(l === (v.level || 'info') ? 'selected' : '')}>${l}</option>`)}</select></label></div><label>Body<textarea name="body" maxlength="500">${v.body || ''}</textarea></label><div class="form-grid">${field('Link (optional)', 'url', v.url, { type: 'url', placeholder: 'https://' })}${field('Starts (your local time)', 'starts_at', local(v.starts_at), { type: 'datetime-local' })}${field('Ends (your local time)', 'ends_at', local(v.ends_at), { type: 'datetime-local' })}${['starts_at', 'ends_at'].filter(k => v[k] != null && v[k] !== '' && !local(v[k])).map(k => html`<label class="inline" style="color:var(--danger)"><input type="checkbox" name="${k}_drop"> The stored ${k === 'starts_at' ? 'start' : 'end'} (${String(v[k])}) is not a valid date. Tick to remove it, or enter a new one.</label>`)}<input type="hidden" name="starts_at_orig" value="${v.starts_at == null ? '' : typeof v.starts_at === 'string' ? v.starts_at : JSON.stringify(v.starts_at)}"><input type="hidden" name="ends_at_orig" value="${v.ends_at == null ? '' : typeof v.ends_at === 'string' ? v.ends_at : JSON.stringify(v.ends_at)}"></div>`,
    read: f => ({ enabled: f.get('enabled') === 'on', title: f.get('title').trim(), body: f.get('body').trim(), level: f.get('level'), url: f.get('url').trim() || null, starts_at: fromLocal(f.get('starts_at'), f.get('starts_at_orig'), 'Starts', f.get('starts_at_drop') === 'on'), ends_at: fromLocal(f.get('ends_at'), f.get('ends_at_orig'), 'Ends', f.get('ends_at_drop') === 'on') }),
    status: v => {
      if (!announcementLive(v)) return v.enabled === true ? badge('On · not showing (empty, scheduled or expired)', 'tone-seen') : badge('Hidden');
      // Counted by install cohort: older builds that read only global settings can still see it.
      const all = announcementReach({ ...CONF, announcement: v }, BUILDS);
      if (!all) return badge('On · install reach unavailable', 'tone-seen');
      const r = all.filter(x => x.source === 'global');
      return r.some(x => x.state === 'live') ? badge('Live', 'accent') : r.some(x => x.state === 'hidden') ? badge('On · hidden by maintenance', 'tone-seen')
        : r.some(x => x.state === 'blocked') ? badge('On · installs need the required update', 'tone-seen')
        : all.some(x => x.source === 'platform') ? badge('On · replaced by platform announcements', 'tone-seen') : badge('On · no eligible installs', 'tone-seen');
    },
  },
};

export default async function controls(ctx) {
  let rows;
  try { [rows, BUILDS] = await Promise.all([api.config(), api.liveBuilds().catch(() => null)]);
    if (!Array.isArray(BUILDS)) BUILDS = null; /* unknown, never treated as zero installs */ } catch (e) { if (!ctx.alive()) return; if (e.needsUpgrade) { ctx.el.innerHTML = upgradeCard(); return; } throw e; }
  if (!ctx.alive()) return;
  CONF = Object.fromEntries(rows.map(r => [r.key, r.value]));
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
        <details class="collapse" data-history style="margin-top:14px"><summary>Notes and history</summary><div class="stack" style="margin-top:12px"><div data-annotations></div><div><h3 class="eyebrow">History</h3><div data-audit></div></div></div></details>
      </section>`; })}</div>`.s;
  const P = { ios: 'iOS', android: 'Android', web: 'Web' };
  // Reach: counted installs seen in the last 7 days on builds that honour a switch (admin_live_builds,
  // one row per actual build). Reported readers take priority; estimates only fill in where none reported.
  const reachOf = (since, builds) => ['ios', 'web'].filter(p => since[p] != null).map(p => { const m = builds.filter(x => x.platform === p); const all = m.reduce((a, x) => a + +x.n, 0);
    const ok = m.filter(x => !x.reports_keys).filter(x => p === 'ios' ? +x.build >= since.ios && +x.build <= (since.iosTo ?? Infinity) : !versionLess(x.version, since.web)).reduce((a, x) => a + +x.n, 0);
    return { label: p === 'ios' ? 'iOS' : 'web', ok, all }; });
  Promise.allSettled([api.configReaders(), BUILDS ? Promise.resolve(BUILDS) : Promise.reject(new Error('live builds unavailable'))]).then(([rd, lb]) => { if (!ctx.alive()) return;
    const readers = rd.status === 'fulfilled' ? rd.value : null, builds = lb.status === 'fulfilled' ? lb.value : null;
    qsa('[data-reader]', ctx.el).forEach(el => { const key = el.dataset.reader, r = readers?.[key];
      const real = r && Object.entries(r).some(([p, x]) => P[p] && !x.test && +x.installs_30d > 0);
      const since = SINCE[key.replace(/^features\./, '')], reach = since && builds ? reachOf(since, builds) : null;
      const reached = reach?.some(x => x.ok > 0);
      if (r) el.textContent = 'Last seen reading this: ' + Object.entries(r).sort(([, a], [, b]) => a.test - b.test).map(([p, x]) => `${P[p] || (P[p.split(' ')[0]] + ' (test)')} ${x.version}${x.build ? ' (' + x.build + ')' : ''} ${rel(x.last_seen)}, ${x.installs_30d} installs`).join(' · ');
      else if (reach) el.textContent = 'Estimated reach (installs on older builds that honour it but don\'t report config_keys, 7 days): ' + reach.map(x => `${x.label} ${x.ok} of ${x.all}`).join(' · ');
      const u = el.parentElement?.querySelector('[data-unread]'); if (!u) return;
      u.classList.remove('pending');
      if (real) u.remove();
      else if (!readers) { u.textContent = 'Reader check unavailable'; u.title = 'Could not load config_keys reports, so this is unknown'; }
      else if (since && !builds) { u.textContent = 'No reported readers · estimate unavailable'; u.title = 'Live builds could not be loaded'; }
      else if (reached) { u.textContent = 'Unconfirmed · estimated from build numbers'; u.title = 'Only older builds that do not report config_keys are thought to read it'; }
      else if (r) { u.textContent = 'Only test or inactive builds read this'; u.title = 'No counted install read it in 30 days'; }
      else { u.textContent = 'No app reads this yet'; u.title = 'No counted install reads it; flipping it changes nothing today'; } });
  });
  if (state.role === 'viewer') qsa('[data-form]', ctx.el).forEach(f => { f.querySelectorAll('input,select,textarea').forEach(i => { i.disabled = true; }); f.querySelector('button[type=submit]')?.remove(); });
  qsa('.control', ctx.el).forEach(card => {
    const key = card.dataset.key, s = SECTIONS[key], form = qs('[data-form]', card);
    form.onsubmit = async e => {
      e.preventDefault(); if (state.role === 'viewer') return; const b = form.querySelector('button[type=submit]'); b.disabled = true;
      try {
        const f = new FormData(form);
        const value = s ? s.read(f, rows.find(r => r.key === key)?.value || {}) : JSON.parse(f.get('json'));
        if (key === 'min_version') { const cur = rows.find(r => r.key === 'latest_version')?.value || {}; const bad = ['ios', 'android', 'web'].filter(p => value[p] && cur[p] && versionLess(cur[p], value[p])); if (bad.length && !confirm(`The minimum for ${bad.join(', ')} is above the latest released version. Every user on that platform would be blocked. Save anyway?`)) return; }
        if (key === 'released_versions') { const cur = rows.find(r => r.key === key)?.value || {}; const down = ['ios', 'android', 'web'].filter(p => cur[p]?.build && value[p].build && Number(value[p].build) < Number(cur[p].build)); if (down.length) throw new Error(`Build numbers only go up: ${down.map(p => `${p} is ${cur[p].build}`).join(', ')}.`); }
        if (key === 'platform_overrides') { const on = PLATFORMS.filter(([p]) => value[p].maintenance.enabled && rows.find(r => r.key === key)?.value?.[p]?.maintenance?.enabled !== true).map(([, l]) => l); if (on.length && !confirm(`Turn on maintenance for ${on.join(', ')}? Those users lose network features until you turn it off.`)) return; }
        if (key === 'maintenance' && value.enabled && rows.find(r => r.key === 'maintenance')?.value?.enabled !== true && !confirm('Turn on maintenance mode? Every app user will see the message and lose network features until you turn it off.')) return;
        await api.saveConfig(key, value); if (!ctx.alive()) return; ctx.notice(`${s?.title || key} saved.`); await controls(ctx);
      } catch (err) { if (ctx.alive()) ctx.fail(err); } finally { b.disabled = false; }
    };
    const details = qs('details[data-history]', card);
    details.ontoggle = () => { if (details.open && !details.dataset.loaded) { details.dataset.loaded = '1'; annotations(qs('[data-annotations]', card), 'config', key, ctx); auditList(qs('[data-audit]', card), 'config', key, ctx); } };
  });
}
