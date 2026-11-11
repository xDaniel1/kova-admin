// The version registry card used on Home and System: per product, what shipped, the update rules, and what clients report.
'use strict';
import { VERSION as TOWER_VERSION, BUILD as TOWER_BUILD } from './version.js';
import { html, fmtNum, rel, badge, table, href, versionLess } from './util.js';

const PLATFORMS = [['ios', 'iOS'], ['android', 'Android'], ['web', 'Web app'], ['site', 'Marketing site']];
const REPORTING = new Set(['ios', 'android', 'web']);
const rel_ = r => r?.version ? html`${r.version}${r.build ? html` <span class="muted small">build ${r.build}</span>` : ''}${r.tag ? html`<br><span class="mono small muted">${r.tag}</span>` : ''}${r.pending_build ? html`<br>${badge('build ' + r.pending_build + ' pending', 'tone-seen')}` : ''}` : html`<span class="muted">—</span>`;

export function versionsCard(v, { detailed = false } = {}) {
  const min = v.min || {}, latest = v.latest || {}, p = v.platforms || {}, released = v.released || {};
  const rows = PLATFORMS.map(([k, label]) => {
    const s = p[k] || {}, newest = s.newest;
    const behind = newest && latest[k] && versionLess(newest.version, latest[k]);
    const blocked = newest && min[k] && versionLess(newest.version, min[k]);
    const r = released[k] || {};
    const ahead = newest && r.version && (versionLess(r.version, newest.version) || (newest.version === r.version && /^\d+$/.test(newest.build || '') && /^\d+$/.test(r.build || '') && Number(newest.build) > Number(r.build)));
    return [
      html`<strong>${label}</strong>`,
      rel_(released[k]),
      latest[k] ? html`${latest[k]} ${behind ? badge('newer than in use', 'tone-seen') : ''}` : '—',
      min[k] ? html`${min[k]} ${blocked ? badge('newest client blocked', 'danger') : ''}` : '—',
      k === 'site' ? html`<span data-site-live class="muted small">Checking kovamaps.com…</span>` : html`${newest ? html`${newest.version}${newest.build ? html` <span class="muted small">(${newest.build})</span>` : ''} ${ahead ? badge('ahead of registry', 'tone-seen') : ''}<br><span class="muted small">seen ${rel(newest.last_seen)}</span>` : html`<span class="muted">No reports yet</span>`}${s.dev_30d ? html`<br><span class="muted small">+ ${fmtNum(s.dev_30d)} dev, test and CI installs, not counted</span>` : ''}`,
      REPORTING.has(k) ? fmtNum(s.installs_30d ?? 0) : '—',
    ];
  });
  const mix = detailed ? PLATFORMS.filter(([k]) => REPORTING.has(k)).map(([k, label]) => {
    const m = (p[k] || {}).mix || [];
    return m.length ? html`<div><h3 class="eyebrow">${label} · last 30 days</h3>${table(['Version', 'Build', 'Installs', 'Last seen'], m.map(x => [x.version, x.build || '—', fmtNum(x.n), rel(x.last_seen)]))}</div>` : '';
  }) : [];
  return html`<section class="card"><div class="card-head"><h2>Version registry</h2><a class="small" href="${href('/controls')}">Edit versions</a></div>
    ${table(['Product', 'Released', 'Latest', 'Minimum supported', 'Last reported', 'Installs · 30d'], rows)}
    <p class="muted small" style="margin:10px 0 0">Released is what shipped (one shared version, build numbers only go up). Latest drives the update nudge and minimum blocks older builds. Last reported comes from the apps at launch. All three are edited on App controls. This console is Tower ${TOWER_VERSION} (build ${TOWER_BUILD}).</p>
    ${detailed ? html`<div class="stack" style="margin-top:14px">${mix}</div>` : ''}</section>`;
}

// The marketing site publishes /version.json; read it live so the registry shows what is deployed.
export async function loadSiteLive(root, released) {
  const el = root?.querySelector('[data-site-live]'); if (!el) return;
  try {
    const res = await fetch('https://kovamaps.com/version.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const j = await res.json(), want = released?.site?.version;
    el.className = '';
    el.innerHTML = html`${j.version} <span class="muted small">live${j.commit ? ' · ' + j.commit : ''}</span> ${want && j.version !== want ? badge('differs from registry', 'tone-seen') : ''}<br><span class="muted small">built ${rel(j.built_at)}</span>`.s;
  } catch { el.textContent = 'Could not read kovamaps.com/version.json'; }
}
