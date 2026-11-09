// Small helpers shared by every page. No framework: pages build HTML strings with the `html`
// tag (which escapes interpolations) and then bind events on the resulting elements.
'use strict';

export const $ = (id, root = document) => root.getElementById ? root.getElementById(id) : root.querySelector('#' + id);
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));
const part = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v);
/** Tagged template: `html\`<b>${userText}</b>\`` escapes values; wrap trusted markup with raw(). */
export const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));

export const fmtDate = value => value ? new Date(value).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : 'Never';
export const fmtDay = value => value ? new Date(value).toLocaleDateString(undefined, {dateStyle: 'medium'}) : '—';
export const fmtNum = value => value == null ? '—' : Number(value).toLocaleString();
export function rel(value) {
  if (!value) return 'never';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  const abs = Math.abs(diff), suffix = diff >= 0 ? ' ago' : ' from now';
  if (abs < 60) return 'just now';
  const units = [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [s, label] of units) if (abs >= s) return Math.floor(abs / s) + label + suffix;
  return 'just now';
}
export const dayKey = value => new Date(value).toDateString();
export function dayLabel(value) {
  const d = new Date(value), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'});
}

export const safeURL = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
export const extLink = (url, label) => { const safe = safeURL(url); return safe ? html`<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : raw(esc(label)); };
export const mapsLink = (lat, lon) => extLink('https://maps.apple.com/?ll=' + encodeURIComponent(lat + ',' + lon), (+lat).toFixed(5) + ', ' + (+lon).toFixed(5));
export const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

export const initials = (name, email) => {
  const src = (name || '').trim() || (email || '').split('@')[0] || '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
};

export const escapeLike = s => s.replace(/[\\%_]/g, '\\$&');
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const copy = async text => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };

// Routes are hash based so GitHub Pages never has to serve a deep link.
export const href = (path, query) => {
  const q = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  return '#' + path + q;
};
export const go = (path, query) => { location.hash = href(path, query).slice(1); };

export const badge = (text, tone = '') => html`<span class="badge ${tone}">${text}</span>`;
export const empty = (text = 'Nothing here yet.') => html`<div class="empty"><span class="empty-mark" aria-hidden="true"></span><p>${text}</p></div>`;
export const table = (headers, rows, opts = {}) => rows.length
  ? html`<div class="scroll"><table class="${opts.clickable ? 'clickable' : ''}"><thead><tr>${headers.map(h => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows.map((cells, i) => html`<tr ${opts.rowAttr ? raw(opts.rowAttr(i)) : ''}>${cells.map(c => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>`
  : empty(opts.emptyText);

/** Compact single-series bar chart; data is [{day, n}]. One series, so no legend. */
export function barChart(label, days) {
  if (!Array.isArray(days) || !days.length) return raw('');
  const max = Math.max(1, ...days.map(d => +d.n)), total = days.reduce((a, d) => a + +d.n, 0);
  const w = 600, h = 100, pad = 2, bw = w / days.length;
  const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  const bars = days.map((d, i) => { const bh = Math.round(+d.n / max * (h - 14)); return html`<rect x="${(i * bw + pad).toFixed(1)}" y="${h - bh}" width="${(bw - pad * 2).toFixed(1)}" height="${bh}" rx="2"><title>${fmt(d.day)}: ${d.n}</title></rect>`; });
  return html`<div class="chart"><div class="chart-head"><h3>${label}</h3><span class="muted small">${fmtNum(total)} total · peak ${fmtNum(max)}/day</span></div>
    <svg viewBox="0 0 ${w} ${h + 14}" role="img" aria-label="${label}, ${total} total"><defs><linearGradient id="towerBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent-deep)"/></linearGradient></defs><line x1="0" y1="${h}" x2="${w}" y2="${h}"/>${bars}<text class="axis" x="0" y="${h + 12}">${fmt(days[0].day)}</text><text class="axis" x="${w}" y="${h + 12}" text-anchor="end">${fmt(days[days.length - 1].day)}</text></svg>
    <details><summary>Show as table</summary>${table(['Day', 'Count'], days.filter(d => +d.n).map(d => [d.day, d.n]), {emptyText: 'No activity in this window.'})}</details></div>`;
}

export const kindLabel = { bug: 'Bug', idea: 'Idea', map_data: 'Map data', other: 'Other' };
export const statusTone = { new: 'tone-new', seen: 'tone-seen', done: 'tone-done' };

export const upgradeCard = () => html`<section class="card setup"><h2>Database update needed</h2><p>This part of Tower reads tables and functions added by <code>supabase/admin-v3.sql</code> in the kova-admin repository. Run that file in the Supabase SQL Editor as the database owner (it is safe to rerun), then refresh this page.</p></section>`.s;

/** Download rows as a CSV file. Cells are quoted; formulas are neutralised so spreadsheets stay safe. */
export function downloadCSV(name, headers, rows) {
  const cell = v => { let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const body = [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const fmtBytes = n => { n = Number(n) || 0; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + ' ' + u[i]; };

/** a < b for dotted numeric versions; unparseable values never compare as older. */
export function versionLess(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x < y; }
  return false;
}
