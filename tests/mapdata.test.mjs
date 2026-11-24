// Map data tile card (jsdom) and the tower-tiles lane-coverage counter.
import { JSDOM } from 'jsdom';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..');

// 1. The Edge Function's `runs` counter: rows of inclusive x runs.
const src = readFileSync(join(root, 'supabase', 'functions', 'tower-tiles', 'index.ts'), 'utf8');
const expr = /const runs = (\(o: unknown\)[\s\S]*?: null;)/.exec(src)[1].replace(/: unknown|: number|as Record<string, unknown>/g, '');
const runs = eval(expr.replace(/;$/, ''));
ok(runs({ 10: [[5, 7]], 11: [[1, 1]] }) === 4, 'lane coverage counts tiles in runs (4)');
ok(runs(null) === null, 'no coverage object: null');
ok(runs({ 1: [[7, 5]], 2: [], 3: [['a', 'b']] }) === 0, 'reversed, empty and non-numeric runs count 0');
ok(/x-client-info/.test(src), 'CORS allows x-client-info (supabase-js sends it)');

// 2. The card.
const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'https://x.test/#/map-data' });
for (const k of ['window', 'document', 'history', 'location', 'HTMLElement', 'Node', 'navigator', 'URLSearchParams']) { try { globalThis[k] = dom.window[k]; } catch {} }
globalThis.fetch = async () => ({ ok: false, json: async () => null });
const tmp = mkdtempSync(join(tmpdir(), 'tower-mapdata-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
mkdirSync(join(tmp, 'js', 'pages'), { recursive: true });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
copyFileSync(join(root, 'js', 'util.js'), join(tmp, 'js', 'util.js'));
copyFileSync(join(root, 'js', 'pages', 'mapdata.js'), join(tmp, 'js', 'pages', 'mapdata.js'));
copyFileSync(join(here, 'stubs-mapdata', 'api.js'), join(tmp, 'js', 'api.js'));
const api = await import(join(tmp, 'js', 'api.js'));
const { default: mapData } = await import(join(tmp, 'js', 'pages', 'mapdata.js'));
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
const ctx = () => ({ el: document.querySelector('main'), query: {}, alive: () => true, notice: () => {}, fail: e => { throw e; } });
const card = () => document.querySelector('[data-tiles]')?.textContent || '';
api.ctl.tileData = { trees: { tiles: 142267, with_single_trees: 900, updated_at: '2026-11-16T00:00:00Z', sample: { x: 1, y: 2 } }, indoor_reports: { total: 5, new: 2, last_30d: 3 } };
api.ctl.tileStatus = { lanes: { generation: 'g1', built: '2026-11-24T00:00:00Z', fresh_until: '2020-01-01T00:00:00Z', tile_count: 10073, covered: 4, populated: 3 }, sample: { trees: { status: 200 }, buildings: { status: 404 } } };
await mapData(ctx()); await tick(30);
ok(card().includes('4 tiles covered'), 'coverage shown in tiles');
ok(card().includes('past their fresh-until date'), 'stale lane tiles warned');
api.ctl.tileData = null; api.ctl.tileDataErr = Object.assign(new Error('permission denied'), { code: '42501' });
await mapData(ctx()); await tick(30);
ok(!card().includes('migration 0026') && card().includes('unavailable: permission denied'), 'non-upgrade error is not called a missing migration');
api.ctl.tileDataErr = Object.assign(new Error('missing'), { needsUpgrade: true });
await mapData(ctx()); await tick(30);
ok(card().includes('needs migration 0026'), 'missing function says it needs migration 0026');
