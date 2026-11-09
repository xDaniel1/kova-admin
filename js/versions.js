// The per-platform version card used on Home and System.
'use strict';
import { html, fmtNum, rel, badge, table, href, versionLess } from './util.js';

const PLATFORMS = [['ios', 'iOS'], ['android', 'Android'], ['web', 'Web']];

export function versionsCard(v, { detailed = false } = {}) {
  const min = v.min || {}, latest = v.latest || {}, p = v.platforms || {};
  const rows = PLATFORMS.map(([k, label]) => {
    const s = p[k] || {}, newest = s.newest;
    const behind = newest && latest[k] && versionLess(newest.version, latest[k]);
    const blocked = newest && min[k] && versionLess(newest.version, min[k]);
    return [
      html`<strong>${label}</strong>`,
      newest ? html`${newest.version}${newest.build ? html` <span class="muted small">(${newest.build})</span>` : ''}<br><span class="muted small">seen ${rel(newest.last_seen)}</span>` : html`<span class="muted">No reports yet</span>`,
      latest[k] ? html`${latest[k]} ${behind ? badge('newer than in use', 'tone-seen') : ''}` : '—',
      min[k] ? html`${min[k]} ${blocked ? badge('newest client blocked', 'danger') : ''}` : '—',
      fmtNum(s.installs_30d ?? 0),
    ];
  });
  const mix = detailed ? PLATFORMS.map(([k, label]) => {
    const m = (p[k] || {}).mix || [];
    return m.length ? html`<div><h3 class="eyebrow">${label} · last 30 days</h3>${table(['Version', 'Build', 'Installs', 'Last seen'], m.map(x => [x.version, x.build || '—', fmtNum(x.n), rel(x.last_seen)]))}</div>` : '';
  }) : [];
  return html`<section class="card"><div class="card-head"><h2>App versions</h2><a class="small" href="${href('/controls')}">Edit version rules</a></div>
    ${table(['Platform', 'Newest in use', 'Latest released', 'Minimum supported', 'Installs · 30d'], rows)}
    <p class="muted small" style="margin:10px 0 0">"In use" comes from the apps reporting their version at launch. Latest and minimum are set on App controls.</p>
    ${detailed ? html`<div class="stack" style="margin-top:14px">${mix}</div>` : ''}</section>`;
}
