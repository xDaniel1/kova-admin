// Home's "Live status": what the apps in people's hands are doing right now. Maintenance, switches
// that are off, and every counted build seen in the last 7 days with the car-screen switch it reads,
// so a switch that reaches a known-bad build stands out before anyone has to go looking.
'use strict';
import { html, raw, fmtNum, rel, href, badge } from './util.js';
import * as api from './api.js';

const PLATFORM = { ios: 'iOS', android: 'Android', web: 'Web' };
// Car-screen keys per iOS build range (contract §2). A key whose builds crash on a CarPlay trip is flagged.
const CAR_KEYS = [
  { key: 'carplay', builds: '7–14', bad: true },
  { key: 'carplay_safe', builds: '15–16', bad: true },
  { key: 'carplay_b17', builds: '17+', bad: false },
];
const COUNTED = new Set(['production', 'beta', null, undefined]);
const buildNum = b => /^\d+$/.test(b || '') ? +b : -1;

export async function liveStatusCard() {
  const [cfg, clients] = await Promise.all([api.config(), api.recentClients()]);
  const conf = Object.fromEntries(cfg.map(r => [r.key, r.value]));
  const features = conf.features || {}, overrides = conf.platform_overrides || {};
  const on = (platform, key) => features[key] !== false && overrides[platform]?.features?.[key] !== false;

  // Alerts: maintenance, announcements, switches off.
  const alerts = [];
  if (conf.maintenance?.enabled) alerts.push(['danger', 'Maintenance is on everywhere']);
  for (const [p, label] of Object.entries(PLATFORM)) {
    if (overrides[p]?.maintenance?.enabled) alerts.push(['danger', `${label} is in maintenance`]);
    const off = Object.entries(overrides[p]?.features || {}).filter(([, v]) => v === false).map(([k]) => k);
    if (off.length) alerts.push(['warn', `${label}: ${off.join(', ')} off`]);
  }
  const globalOff = Object.entries(features).filter(([, v]) => v === false).map(([k]) => k);
  if (globalOff.length) alerts.push(['warn', `Off for everyone: ${globalOff.join(', ')}`]);
  if (conf.announcement?.enabled) alerts.push(['info', 'Announcement is live']);

  // Builds seen in the last 7 days, counted channels only.
  const since = Date.now() - 7 * 864e5;
  const groups = new Map();
  for (const c of clients) {
    if (new Date(c.last_seen) < since || !COUNTED.has(c.channel) || !c.build || c.build === 'dev') continue;
    const id = `${c.platform}|${c.app_version}|${c.build}`;
    const g = groups.get(id) || { platform: c.platform, version: c.app_version, build: c.build, n: 0, beta: 0, last: c.last_seen, keys: new Set() };
    g.n++; if (c.channel === 'beta') g.beta++;
    if (c.last_seen > g.last) g.last = c.last_seen;
    (c.config_keys || []).forEach(k => g.keys.add(k));
    groups.set(id, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.platform.localeCompare(b.platform) || buildNum(b.build) - buildNum(a.build));

  const risky = [];
  const carCell = g => {
    if (g.platform !== 'ios') return html`<span class="muted">—</span>`;
    const car = CAR_KEYS.find(k => g.keys.has('features.' + k.key));
    if (!car) return html`<span class="muted small">${buildNum(g.build) >= 7 ? 'not reported' : 'no CarPlay'}</span>`;
    const live = on('ios', car.key);
    if (car.bad && live) risky.push(g);
    return html`<code>${car.key}</code> ${live ? badge(car.bad ? 'On · crashes' : 'On', car.bad ? 'danger' : 'ok') : badge('Off', car.bad ? 'ok' : 'tone-seen')}`;
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
