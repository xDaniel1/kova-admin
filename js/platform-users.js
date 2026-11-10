// "Users by platform" card used on Home and Users: active installs and signed-in accounts per app.
'use strict';
import { html, fmtNum, table, barChart } from './util.js';

const PLATFORMS = [['ios', 'iOS app'], ['android', 'Android app'], ['web', 'Web app']];

export function platformUsersCard(d, { charts = true } = {}) {
  const p = d.platforms || {};
  const sum = k => PLATFORMS.reduce((a, [id]) => a + (+(p[id] || {})[k] || 0), 0);
  const row = (label, s) => [html`<strong>${label}</strong>`, fmtNum(s.dau), fmtNum(s.wau), fmtNum(s.mau), fmtNum(s.signed_in_30d), fmtNum(s.new_7d), fmtNum(s.installs_total)];
  const rows = PLATFORMS.map(([id, label]) => row(label, p[id] || {}));
  rows.push([html`<strong>All platforms</strong>`, fmtNum(sum('dau')), fmtNum(sum('wau')), fmtNum(sum('mau')),
    html`${fmtNum(d.accounts_30d)}${d.accounts_multi_platform_30d ? html` <span class="muted small">(${fmtNum(d.accounts_multi_platform_30d)} on 2+)</span>` : ''}`,
    fmtNum(sum('new_7d')), fmtNum(sum('installs_total'))]);
  return html`<section class="card"><div class="card-head"><h2>Users by platform</h2><span class="muted small">Updated each app launch</span></div>
    ${table(['Platform', 'Active today', '7 days', '30 days', 'Signed in · 30d', 'New · 7d', 'All-time installs'], rows)}
    <p class="muted small" style="margin:10px 0 0">Active counts are installs (a phone or a browser) that opened the app, from each app's launch check-in. Signed in counts distinct accounts; the all-platforms figure counts each account once. Local and test builds are left out.</p>
    ${charts ? html`<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:14px">${PLATFORMS.map(([id, label]) => barChart(label + ' · daily active', (p[id] || {}).daily))}</div>` : ''}</section>`;
}
