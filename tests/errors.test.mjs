// Errors page behaviour test (jsdom): Clear, refresh locks, Retry, filters, stale responses.
// Run: npm install && npm test
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'https://x.test/#/errors' });
for (const k of ['window','document','history','location','HTMLElement','Node','navigator','URLSearchParams']) { try { globalThis[k] = dom.window[k]; } catch {} }
globalThis.confirm = () => true;
// Build a throwaway copy of the page with stubbed api.js/app.js next to the real util.js and errors.js.
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'tower-errors-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
mkdirSync(join(tmp, 'js', 'pages'), { recursive: true });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
copyFileSync(join(root, 'js', 'util.js'), join(tmp, 'js', 'util.js'));
copyFileSync(join(root, 'js', 'pages', 'errors.js'), join(tmp, 'js', 'pages', 'errors.js'));
copyFileSync(join(here, 'stubs', 'api.js'), join(tmp, 'js', 'api.js'));
copyFileSync(join(here, 'stubs', 'app.js'), join(tmp, 'js', 'app.js'));
const api = await import(join(tmp, 'js', 'api.js'));
const { default: errors } = await import(join(tmp, 'js', 'pages', 'errors.js'));
const tick = (ms=0) => new Promise(r => setTimeout(r, ms));
let errs = [], notices = [];
const mkctx = (q={}) => ({ el: document.querySelector('main'), query: { ...q }, alive: () => true, notice: m => notices.push(m), fail: e => errs.push(e) });
process.on('unhandledRejection', e => { errs.push(e); });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const btns = () => [...document.querySelectorAll('[data-clear]')];

// 1. Clear success path
let ctx = mkctx(); await errors(ctx);
ok(btns().length === 2 && btns().every(b => !b.disabled), 'initial clear buttons enabled');
btns()[0].click(); await tick(5);
ok(errs.length === 0, 'Clear success: no ReferenceError ' + (errs[0]?.message || ''));
ok(api.calls.clear.length === 1 && api.calls.clear[0].ids.join() === '1,2' && typeof api.calls.clear[0].ids[0] === 'string', 'clearErrorGroup called with shown ids');
ok(notices.includes('Cleared 2 reports.'), 'notice shown');
await tick(5);
ok(api.calls.list.length === 2, 'refetch after clear');
ok(btns().every(b => !b.disabled), 'fresh results unlock Clear');

// 2. Clear with response for refresh pending: "Cleared · refresh pending"
let release; api.ctl.listImpl = (d,a,q) => new Promise(r => { release = () => r(api.mk('slow')); });
btns()[1].click(); await tick(5);
ok(btns()[1].textContent.startsWith('Cleared'), 'refresh-pending label: ' + btns()[1].textContent);
ok(btns().every(b => b.disabled), 'all Clear locked while refresh pending');
release(); await tick(5); api.ctl.listImpl = null;
ok(btns().every(b => !b.disabled), 'unlocked after refresh');

// 3. Clear failure -> fail called, banner key set; then success clears banner
api.ctl.clearImpl = () => Promise.reject(new Error('rpc down'));
btns()[0].click(); await tick(5);
ok(errs.length === 1 && errs[0].message === 'rpc down', 'clear failure routed to ctx.fail');
ok(!btns()[0].disabled, 'button re-enabled after failure'); errs = [];
api.ctl.clearImpl = null; globalThis.__bannerCleared = 0;
btns()[0].click(); await tick(10);
ok(globalThis.__bannerCleared === 1 && errs.length === 0, 'success clears its own banner');

// 4. Refresh failure -> Retry
api.ctl.listImpl = () => Promise.reject(new Error('net'));
const filter = document.querySelector('[data-filter]');
filter.value = 'boom'; filter.dispatchEvent(new dom.window.Event('input')); 
ok(btns().every(b => b.disabled), 'filter input locks Clear immediately');
await tick(300);
ok(!!document.querySelector('[data-retry]'), 'Retry shown after failed refresh');
ok(btns().every(b => b.disabled), 'stale list stays locked');
api.ctl.listImpl = null;
document.querySelector('[data-retry]').click(); await tick(5);
ok(errs.length === 0, 'Retry: no error ' + (errs[0]?.message||''));
ok(!document.querySelector('[data-retry]') && btns().every(b => !b.disabled), 'Retry succeeds and unlocks');
ok(api.calls.list.at(-1).q === 'boom', 'retry uses current filter');

// 5. App picker
const sel = document.querySelector('[data-app]');
ok([...sel.options].map(o=>o.value).join() === ',ios,web', 'picker options ' + [...sel.options].map(o=>o.value).join());
sel.value = 'ios'; sel.dispatchEvent(new dom.window.Event('change')); await tick(5);
ok(errs.length === 0 && api.calls.list.at(-1).app === 'ios', 'app picker refetches with app');
ok(location.hash.includes('app=ios') && location.hash.includes('q=boom'), 'URL kept: ' + location.hash);

// 6. Out-of-order responses: older slow response is dropped
const pend = []; api.ctl.listImpl = (d,a,q) => new Promise(r => pend.push(() => r(api.mk(q))));
filter.value = 'aaa'; filter.dispatchEvent(new dom.window.Event('input')); await tick(300);
filter.value = 'bbb'; filter.dispatchEvent(new dom.window.Event('input')); await tick(300);
pend[1](); await tick(5); pend[0](); await tick(5);
ok(document.querySelector('summary strong').textContent === 'boom bbb', 'stale response ignored: ' + document.querySelector('summary strong').textContent);
ok(btns().every(b => !b.disabled), 'Clear enabled for latest');
api.ctl.listImpl = null;

// 7. Click Clear while a debounce is pending -> guarded
filter.value = 'ccc'; filter.dispatchEvent(new dom.window.Event('input'));
const before = api.calls.clear.length; btns()[0].disabled = false; btns()[0].click(); await tick(5);
ok(api.calls.clear.length === before, 'Clear refused while newer filter pending (even if button forced enabled)');
await tick(300);
// 8. ctx dies mid-clear
let alive = true; ctx.alive = () => alive; let rel2; api.ctl.clearImpl = () => new Promise(r => rel2 = () => r(1));
btns()[0].click(); await tick(1); alive = false; rel2(); await tick(10);
ok(errs.length === 0, 'dead ctx after clear: no error');
console.log('unhandled/errs:', errs.map(e=>e.message));
