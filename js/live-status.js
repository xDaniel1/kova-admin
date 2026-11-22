// Home's "Live status": what the apps in people's hands are doing right now. Maintenance, switches
// that are off, and every counted build seen in the last 7 days with the car-screen switch it reads,
// so a switch that reaches a known-bad build stands out before anyone has to go looking.
'use strict';
import { html, raw, fmtNum, rel, href, badge, versionLess, announcementLive, announcementReach, installCohort } from './util.js';
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
  // Platforms whose apps read Tower (Android from build 3, contract adoption table).
  const READS = Object.entries(PLATFORM);
  if (conf.maintenance?.enabled === true) alerts.push(['danger', 'Maintenance is on for every app']);
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
  // Only counted cohorts (n > 0) are claims about installs; platforms with no check-ins return a config-only
  // fallback (n: null) that is not shown here.
  const reach = (announcementReach(conf, rows || [], now) || []).filter(x => x.n > 0);
  const tag = x => `${x.label}${x.source === 'platform' ? ' (its own)' : ''}${x.n != null ? ` · ${fmtNum(x.n)}` : ''}`;
  const shown = reach.filter(x => x.state === 'live').map(tag), hidden = reach.filter(x => x.state === 'hidden').map(tag), blocked = reach.filter(x => x.state === 'blocked').map(tag);
  if (shown.length) alerts.push(['info', `Announcement live on ${shown.join(', ')}`]);
  if (hidden.length) alerts.push(['warn', `Announcement set for ${hidden.join(', ')} but hidden by maintenance there`]);
  if (blocked.length) alerts.push(['warn', `Announcement not seen by ${blocked.join(', ')}: they get the required-update screen`]);
  // Older installs still in use (iOS build 5, web before 1.0.2) read only the global settings, so say so
  // whenever a platform-only setting is active. Same adoption and update rules as announcementReach.
  for (const [p, label] of READS) {
    const o = overrides[p] || {};
    const active = (o.maintenance?.enabled === true && conf.maintenance?.enabled !== true) || Object.values(o.features || {}).includes(false) || announcementLive(o.announcement, now);
    const legacy = (rows || []).filter(g => g.platform === p).filter(g => { const c = installCohort(p, g, conf); return c.kind === 'global' && !c.blocked; }).reduce((a, g) => a + +g.n, 0);
    if (active && legacy) alerts.push(['warn', `${fmtNum(legacy)} ${label} install${legacy === 1 ? '' : 's'} on ${p === 'ios' ? 'build 5' : 'versions before 1.0.2'} ignore${legacy === 1 ? 's' : ''} ${label}-only settings and follow the global ones`]);
  }
  if (conf.announcement?.enabled === true && !announcementLive(conf.announcement, now)) alerts.push(['info', 'Announcement is switched on but not showing (empty, scheduled or expired)']);
  else if (announcementLive(conf.announcement, now) && !reach.some(x => x.source === 'global')) alerts.push(['info', 'Announcement is live but reaches no counted installs (none read it, or each platform shows its own)']);

  rows = (rows || []).map(g => ({ ...g, keys: new Set(g.car_keys || []) }))
    .sort((a, b) => a.platform.localeCompare(b.platform) || (versionLess(a.version, b.version) ? 1 : versionLess(b.version, a.version) ? -1 : 0) || buildNum(b.build) - buildNum(a.build));

  const risky = [];
  const carCell = g => {
    if (g.platform === 'android') { // Android Auto answers to android_auto from build 3 (or any install that reports keys)
      if (installCohort('android', g, conf).kind !== 'override') return html`<span class="muted small">doesn't read Tower</span>`;
      const liveA = on('android', 'android_auto');
      return html`<code>android_auto</code> ${liveA ? badge('On', 'ok') : badge('Off', 'tone-seen')}`;
    }
    if (g.platform !== 'ios') return html`<span class="muted">—</span>`;
    // The car-screen key of every known iOS build is documented (contract adoption table): 7-14 read
    // `carplay`, 15-16 `carplay_safe`, 17+ `carplay_b17`. That decides the warning; check-in telemetry that
    // disagrees is shown beside it, never instead of it.
    const n = buildNum(g.build);
    const car = CAR_KEYS.find(k => n >= k.from && n <= k.to);
    if (!car) return html`<span class="muted small">no CarPlay</span>`;
    const live = on('ios', car.key);
    if (car.bad && live) risky.push(g);
    const others = CAR_KEYS.filter(k => k !== car && g.keys.has('features.' + k.key)).map(k => k.key);
    const confirmed = g.keys.has('features.' + car.key);
    return html`<code>${car.key}</code>${confirmed ? '' : html`<span class="muted small"> (by build)</span>`} ${live ? badge(car.bad ? 'On · crashes' : 'On', car.bad ? 'danger' : 'ok') : badge('Off', car.bad ? 'ok' : 'tone-seen')}${others.length ? html`<br><span class="muted small">telemetry also reports ${others.join(', ')}</span>` : ''}`;
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
