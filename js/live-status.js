// Home's "Live status": what the apps in people's hands are doing right now. Maintenance, switches
// that are off, and every counted build seen in the last 7 days with the car-screen switch it reads,
// so a switch that reaches a known-bad build stands out before anyone has to go looking.
'use strict';
import { html, raw, fmtNum, rel, href, badge, versionLess, announcementLive, platformAnnouncement } from './util.js';
import * as api from './api.js';

const PLATFORM = { ios: 'iOS', android: 'Android', web: 'Web' };
// Car-screen keys per iOS build range (contract §2). A key whose builds crash on a CarPlay trip is flagged.
const CAR_KEYS = [
  { key: 'carplay', from: 7, to: 14, bad: true },
  { key: 'carplay_safe', from: 15, to: 16, bad: true },
  { key: 'carplay_b17', from: 17, to: Infinity, bad: false },
];
const buildNum = b => /^\d+$/.test(b || '') ? +b : -1;

export async function liveStatusCard() {
  let cfg, rows;
  try { [cfg, rows] = await Promise.all([api.config(), api.liveBuilds()]); }
  catch (e) { return html`<section class="card live"><div class="card-head"><h2>Live status</h2></div><p class="alert alert-warn" style="margin:0">Live status unavailable: ${e.needsUpgrade ? 'apply supabase/migrations/0021_b73_trees.sql' : e.message}. Check App controls directly.</p></section>`; }
  const conf = Object.fromEntries(cfg.map(r => [r.key, r.value]));
  const features = conf.features || {}, overrides = conf.platform_overrides || {};
  const on = (platform, key) => features[key] !== false && overrides[platform]?.features?.[key] !== false;

  const alerts = [];
  // Apps honour only a real true (contract fail-safe rules); Android reads no config yet, so it is left out.
  const READS = Object.entries(PLATFORM).filter(([p]) => p !== 'android');
  const inMaint = p => conf.maintenance?.enabled === true || overrides[p]?.maintenance?.enabled === true;
  if (conf.maintenance?.enabled === true) alerts.push(['danger', 'Maintenance is on for iOS and web']);
  for (const [p, label] of READS) {
    if (overrides[p]?.maintenance?.enabled === true) alerts.push(['danger', `${label} is in maintenance`]);
    const off = Object.entries(overrides[p]?.features || {}).filter(([, v]) => v === false).map(([k]) => k);
    if (off.length) alerts.push(['warn', `${label}: ${off.join(', ')} off`]);
  }
  const globalOff = Object.entries(features).filter(([, v]) => v === false).map(([k]) => k);
  if (globalOff.length) alerts.push(['warn', `Off for everyone: ${globalOff.join(', ')}`]);
  // Contract §announcement: live when enabled, has a title or body, and now is inside [starts_at, ends_at).
  // A live platform announcement replaces the global one on that platform.
  // Apps hide it while that platform is in maintenance, and treat malformed values as absent.
  const now = Date.now();
  const isLive = x => announcementLive(x, now);
  const shown = [], hidden = [];
  // Android 1.0.0 reads no config yet (contract adoption table), so it is left out.
  for (const [p, label] of READS) {
    const st = platformAnnouncement(conf, p, now); if (st === 'none') continue;
    const tag = announcementLive(overrides[p]?.announcement, now) ? `${label} (its own)` : label;
    (st === 'live' ? shown : hidden).push(tag);
  }
  if (shown.length) alerts.push(['info', `Announcement live on ${shown.join(', ')}`]);
  if (hidden.length) alerts.push(['warn', `Announcement set for ${hidden.join(', ')} but hidden by maintenance there`]);
  // Contract adoption table: platform_overrides are read from iOS build 6 and web 1.0.2. Older installs
  // still in use follow only the global settings, so say so whenever an override is active for them.
  const OVERRIDES_FROM = { ios: g => buildNum(g.build) >= 6, web: g => !versionLess(g.version, '1.0.2') };
  for (const [p, label] of READS) {
    const o = overrides[p] || {};
    const active = o.maintenance?.enabled === true || Object.values(o.features || {}).includes(false) || announcementLive(o.announcement, now);
    const legacy = (rows || []).filter(g => g.platform === p && !OVERRIDES_FROM[p](g)).reduce((a, g) => a + +g.n, 0);
    if (active && legacy) alerts.push(['warn', `${fmtNum(legacy)} ${label} install${legacy === 1 ? '' : 's'} on ${p === 'ios' ? 'builds before 6' : 'versions before 1.0.2'} ignore${legacy === 1 ? 's' : ''} ${label}-only settings and follow the global ones`]);
  }
  if (!shown.length && !hidden.length && conf.announcement?.enabled === true) alerts.push(['info', 'Announcement is switched on but not showing (empty, scheduled or expired)']);

  rows = (rows || []).map(g => ({ ...g, keys: new Set(g.car_keys || []) }))
    .sort((a, b) => a.platform.localeCompare(b.platform) || (versionLess(a.version, b.version) ? 1 : versionLess(b.version, a.version) ? -1 : 0) || buildNum(b.build) - buildNum(a.build));

  const risky = [];
  const carCell = g => {
    if (g.platform !== 'ios') return html`<span class="muted">—</span>`;
    // Builds 7-11 predate config_keys (build 12), so their key follows from the build number. A later
    // build that reports no car key is shown as unconfirmed rather than guessed.
    const n = buildNum(g.build);
    const reported = CAR_KEYS.filter(k => g.keys.has('features.' + k.key));
    const cars = reported.length ? reported : n >= 7 && n <= 11 ? [CAR_KEYS[0]] : [];
    if (!cars.length) return html`<span class="muted small">${n >= 12 ? 'reader unconfirmed' : 'no CarPlay'}</span>`;
    // If installs of one build report different keys, warn when any crash-prone key among them is on.
    if (cars.some(c => c.bad && on('ios', c.key))) risky.push(g);
    return html`${cars.map((car, i) => { const live = on('ios', car.key);
      return html`${i ? html`<br>` : ''}<code>${car.key}</code>${reported.length ? '' : html`<span class="muted small"> (by build)</span>`} ${live ? badge(car.bad ? 'On · crashes' : 'On', car.bad ? 'danger' : 'ok') : badge('Off', car.bad ? 'ok' : 'tone-seen')}`; })}${cars.length > 1 ? html`<br><span class="muted small">installs disagree</span>` : ''}`;
  };
  const body = rows.map(g => html`<tr>
      <td><span class="plat plat-${g.platform}">${PLATFORM[g.platform] || g.platform}</span></td>
      <td><strong>${g.version}</strong> <span class="muted">· ${g.build}</span></td>
      <td>${fmtNum(g.n)}${g.beta ? html` <span class="muted small">(${g.beta} beta)</span>` : ''}</td>
      <td>${carCell(g)}</td>
      <td class="muted small">${rel(g.last)}</td></tr>`);

  if (risky.length) {
    const n = risky.reduce((a, g) => a + g.n, 0);
    alerts.unshift(['danger', raw(html`CarPlay is on for ${risky.length === 1 ? 'a build' : 'builds'} that crash when a trip starts (${risky.map(g => 'b' + g.build).join(', ')}, ${fmtNum(n)} installs). <a href="#/controls">Switch off in App controls</a>`.s)]);
  }
  const pill = ([tone, text]) => html`<li class="alert alert-${tone}">${text}</li>`;
  return html`<section class="card live">
    <div class="card-head"><div><h2>Live status</h2><p class="muted small" style="margin:2px 0 0">Counted installs seen in the last 7 days, and the switches they obey</p></div>
      <a class="small" href="${href('/controls')}">App controls</a></div>
    ${alerts.length ? html`<ul class="alerts">${alerts.map(pill)}</ul>` : html`<p class="all-clear"><span class="dot"></span>All systems normal · no maintenance, every switch on</p>`}
    ${rows.length ? html`<div class="scroll"><table><thead><tr><th>App</th><th>Version · build</th><th>Installs</th><th>Car screen</th><th>Last seen</th></tr></thead><tbody>${body}</tbody></table></div>` : html`<p class="muted">No counted installs this week.</p>`}
  </section>`;
}
