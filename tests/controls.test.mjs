// Controls page test (jsdom): an older render's slow reader check never overwrites the newer render's badges.
import { JSDOM } from 'jsdom';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'https://x.test/#/controls' });
for (const k of ['window', 'document', 'history', 'location', 'HTMLElement', 'Node', 'navigator', 'URLSearchParams', 'FormData', 'HTMLInputElement', 'HTMLTextAreaElement']) { try { globalThis[k] = dom.window[k]; } catch {} }
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'tower-controls-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
mkdirSync(join(tmp, 'js', 'pages'), { recursive: true });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
for (const f of ['util.js', 'records.js', 'icons.js']) copyFileSync(join(root, 'js', f), join(tmp, 'js', f));
copyFileSync(join(root, 'js', 'pages', 'controls.js'), join(tmp, 'js', 'pages', 'controls.js'));
copyFileSync(join(here, 'stubs-controls', 'api.js'), join(tmp, 'js', 'api.js'));
copyFileSync(join(here, 'stubs-controls', 'app.js'), join(tmp, 'js', 'app.js'));
const api = await import(join(tmp, 'js', 'api.js'));
const { default: controls } = await import(join(tmp, 'js', 'pages', 'controls.js'));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const ctx = { el: document.querySelector('main'), query: {}, alive: () => true, notice: () => {}, fail: e => { throw e; } };
const badge = k => document.querySelector(`[data-unread="${k}"]`);

await controls(ctx); await tick(5);          // render 1 (its reader check stays pending)
await controls(ctx); await tick(5);          // render 2, same ctx, like a save re-render
ok(api.ctl.readers.length === 2, 'two reader checks in flight');
// Newer render answers first: map_trees has a real web reader, flat_turns none.
api.ctl.readers[1]({ 'features.map_trees': { web: { version: '1.0.8', build: '57', installs_30d: 3, last_seen: '2026-11-21T00:00:00Z', test: false } } });
await tick(5);
ok(!badge('map_trees'), 'newer render: map_trees badge removed (real reader)');
ok(badge('flat_turns')?.textContent === 'No app reads this yet', 'newer render: flat_turns marked unread');
// Older render answers last with nothing reported: it must not touch the newer cards.
// It reports a real reader for flat_turns, which the newer render must not apply.
api.ctl.readers[0]({ 'features.flat_turns': { web: { version: '1.0.8', build: '57', installs_30d: 3, last_seen: '2026-11-21T00:00:00Z', test: false } } });
await tick(5);
ok(!badge('map_trees'), 'older render did not bring back a badge');
ok(badge('flat_turns')?.textContent === 'No app reads this yet', 'older render did not remove the newer flat_turns badge');
ok(document.querySelector('[data-reader="features.map_trees"]')?.textContent.startsWith('Last seen reading this'), 'newer reader text kept');
