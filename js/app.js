// Boot, sign-in, theme, navigation and the hash router. Pages live in ./pages/*.js and export
// a default async render(ctx). Nothing private renders until is_admin() says yes.
'use strict';
import { $, qsa, html, raw, upgradeCard } from './util.js';
import { icon } from './icons.js';
import * as api from './api.js';
// Pages load on first visit, so the first paint only waits for the shell and one page.
const lazy = (file, name = 'default') => async ctx => (await import(`./pages/${file}.js`))[name](ctx);
const home = lazy('home'), activity = lazy('activity'), users = lazy('users'), userProfile = lazy('users', 'userProfile');
const feedback = lazy('feedback'), feedbackDetail = lazy('feedback', 'feedbackDetail'), reports = lazy('reports'), reportDetail = lazy('reports', 'reportDetail');
const venues = lazy('venues'), venueDetail = lazy('venues', 'venueDetail'), feeds = lazy('feeds'), feedDetail = lazy('feeds', 'feedDetail');
const admins = lazy('admins'), search = lazy('search'), controls = lazy('controls'), system = lazy('system'), messagesPage = lazy('messages');

const routes = [
  [/^\/?$/, home, 'Home'],
  [/^\/activity$/, activity, 'Activity'],
  [/^\/users$/, users, 'Users'],
  [/^\/users\/([^/]+)$/, userProfile, 'User'],
  [/^\/feedback$/, feedback, 'Feedback'],
  [/^\/feedback\/([^/]+)$/, feedbackDetail, 'Feedback'],
  [/^\/reports$/, reports, 'Reports'],
  [/^\/reports\/([^/]+)$/, reportDetail, 'Report'],
  [/^\/venues$/, venues, 'Venues'],
  [/^\/venues\/([^/]+)$/, venueDetail, 'Venue'],
  [/^\/feeds$/, feeds, 'Incident feeds'],
  [/^\/feeds\/([^/]+)$/, feedDetail, 'Incident feed'],
  [/^\/admins$/, admins, 'Admins'],
  [/^\/search$/, search, 'Search'],
  [/^\/controls$/, controls, 'App controls'],
  [/^\/system$/, system, 'System'],
  [/^\/messages$/, messagesPage, 'Messages'],
];

const NAV = [
  ['/', 'Home', 'home'], ['/activity', 'Activity', 'activity'],
  ['group', 'Records'],
  ['/users', 'Users', 'users'], ['/feedback', 'Feedback', 'feedback', 'feedback_new'], ['/reports', 'Reports', 'reports'],
  ['/venues', 'Venues', 'venues'], ['/feeds', 'Incident feeds', 'feeds'],
  ['group', 'Console'],
  ['/messages', 'Messages', 'message'], ['/controls', 'App controls', 'controls'], ['/system', 'System', 'system'], ['/admins', 'Admins', 'admins'],
];

export const state = { session: null, authorized: false, epoch: 0, stats: null, user: null, role: 'owner' };

export const fail = error => { const b = $('banner'); b.textContent = error?.message || String(error); b.hidden = false; console.error(error); };
export const clearBanner = () => { $('banner').hidden = true; };
let noticeTimer;
export const notice = text => { const n = $('notice'); n.textContent = text; n.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { n.hidden = true; }, 3200); };

// ---- Theme -------------------------------------------------------------------------------------
function applyTheme(next) {
  if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
  try { next ? localStorage.setItem('tower-theme', next) : localStorage.removeItem('tower-theme'); } catch {}
}
$('theme').innerHTML = icon('theme'); $('menu').innerHTML = icon('menu'); $('search-form').insertAdjacentHTML('afterbegin', icon('search'));
$('theme').onclick = () => {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
  applyTheme(current === 'dark' ? 'light' : 'dark');
};

// ---- Sidebar ----------------------------------------------------------------------------------
const sidebar = $('sidebar'), scrim = $('scrim');
function openMenu(open) { sidebar.classList.toggle('open', open); scrim.hidden = !open; $('menu').setAttribute('aria-expanded', String(open)); }
$('menu').onclick = () => openMenu(!sidebar.classList.contains('open'));
scrim.onclick = () => openMenu(false);

export function renderNav() {
  const path = currentPath();
  const counts = { ...(state.stats || {}) };
  if (counts.feedback_new == null) counts.feedback_new = counts.feedback_by_status?.new;
  $('nav').innerHTML = NAV.map(([p, label, iconName, countKey]) => p === 'group'
    ? html`<div class="group">${label}</div>`
    : html`<a href="#${p}" ${raw(path === p || (p !== '/' && path.startsWith(p + '/')) ? 'aria-current="page"' : '')}><span class="ico">${raw(icon(iconName))}</span><span>${label}</span>${countKey && counts[countKey] ? html`<span class="badge accent count">${counts[countKey]}</span>` : ''}</a>`
  ).join('');
}
let statsAt = 0, statsInFlight = null;
export async function refreshStats({ maxAge = 0 } = {}) {
  if (state.stats && Date.now() - statsAt < maxAge) return state.stats;
  // Callers arriving while a fetch is running share it instead of starting another.
  statsInFlight ||= api.stats().then(s => { state.stats = s; statsAt = Date.now(); renderNav(); return s; }).finally(() => { statsInFlight = null; });
  try { await statsInFlight; } catch (e) { if (!e.needsUpgrade) throw e; }
  return state.stats;
}

// ---- Search box --------------------------------------------------------------------------------
document.addEventListener('keydown', e => { if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && state.authorized) { e.preventDefault(); $('search').focus(); $('search').select(); } });
$('search-form').onsubmit = e => { e.preventDefault(); const q = $('search').value.trim(); if (q) location.hash = '/search?q=' + encodeURIComponent(q); };

// ---- Router -----------------------------------------------------------------------------------
const currentPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
let renderToken = 0;
export async function route() {
  if (!state.authorized) return;
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qsPart] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(qsPart || ''));
  const token = ++renderToken, epoch = state.epoch;
  openMenu(false); clearBanner();
  // Keep sidebar counts (new feedback) fresh while moving around, without a call per click.
  if (Date.now() - statsAt > 30000) refreshStats().catch(() => {});
  const outlet = $('outlet');
  for (const [re, page, title] of routes) {
    const m = path.match(re);
    if (!m) continue;
    renderNav();
    setTitle(title);
    outlet.innerHTML = '<p class="loading">Loading…</p>';
    const ctx = {
      el: outlet, params: m.slice(1).map(decodeURIComponent), query, user: state.user,
      alive: () => token === renderToken && epoch === state.epoch && state.authorized,
      title: setTitle, notice, fail, refreshStats,
    };
    try { await page(ctx); } catch (e) { if (ctx.alive()) renderError(outlet, e); }
    if (ctx.alive()) $('main').focus({ preventScroll: true });
    return;
  }
  renderNav(); setTitle('Not found');
  outlet.innerHTML = '<section class="card"><h2>Not found</h2><p class="muted">That page does not exist. <a href="#/">Go home</a>.</p></section>';
}
export function renderError(el, e) {
  if (e?.needsUpgrade) el.innerHTML = upgradeCard();
  else { el.innerHTML = html`<section class="card"><h2>Something went wrong</h2><p class="muted">${e?.message || String(e)}</p></section>`.s; }
}
function setTitle(text) { $('page-title').textContent = text; document.title = text === 'Home' ? 'Kova Tower' : text + ' · Kova Tower'; }
window.addEventListener('hashchange', route);

// ---- Auth -------------------------------------------------------------------------------------
function showLogin(show) {
  $('login').hidden = !show; $('outlet').hidden = show; $('search-form').hidden = show; $('signed-in').hidden = show; $('signout').hidden = show;
  if (show) { $('nav').innerHTML = ''; setTitle('Kova Tower'); }
}
function clearPrivate() {
  state.authorized = false; state.user = null; state.stats = null; state.role = 'owner'; state.epoch++; document.body.classList.remove('role-viewer'); $('role-note').hidden = true;
  $('outlet').replaceChildren(); showLogin(true);
}
let accepting = null;
function acceptSession(session) {
  if (!session) { clearPrivate(); return Promise.resolve(); }
  if (state.authorized && state.user?.id === session.user.id) return Promise.resolve();
  if (accepting?.id === session.user.id) return accepting.promise;
  const promise = doAccept(session).finally(() => { if (accepting?.promise === promise) accepting = null; });
  accepting = { id: session.user.id, promise };
  return promise;
}
async function doAccept(session) {
  clearPrivate(); const epoch = state.epoch;
  try {
    const [admin, who] = await Promise.all([api.isAdmin(), api.whoami().catch(() => null)]);
    if (epoch !== state.epoch) return;
    if (!admin) { clearPrivate(); notice('This account is not an admin.'); await api.client().auth.signOut(); return; }
    state.authorized = true; state.user = session.user;
    state.role = who?.role || 'owner';
    document.body.classList.toggle('role-viewer', state.role === 'viewer');
    $('role-note').hidden = state.role !== 'viewer';
    showLogin(false);
    $('signed-in').textContent = 'Signed in as ' + (session.user.email || session.user.id);
    refreshStats().catch(fail);
    await route();
  } catch (e) { if (epoch === state.epoch) { clearPrivate(); fail(e); } }
}

window.addEventListener('DOMContentLoaded', async () => {
  const config = window.KOVA_SUPABASE;
  if (!window.supabase || !config?.url || !config?.anonKey || config.anonKey === 'REPLACE_ME') {
    fail(new Error('Setup required: set the public anon key in config.js and make sure the Supabase client loaded.'));
    showLogin(true); qsa('#login button').forEach(b => { b.disabled = true; }); return;
  }
  const db = window.supabase.createClient(config.url, config.anonKey);
  api.init(db);
  const redirect = () => { const u = new URL('./', location.href); u.hash = ''; u.search = ''; return u.href; };
  $('google-signin').onclick = async () => { clearBanner(); try { api.unwrap(await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect() } })); } catch (e) { fail(e); } };
  $('login-form').onsubmit = async e => {
    e.preventDefault(); $('send-link').disabled = true; clearBanner();
    try { api.unwrap(await db.auth.signInWithOtp({ email: $('email').value.trim(), options: { emailRedirectTo: redirect() } })); notice('Check your email for the sign-in link.'); }
    catch (err) { fail(err); } finally { $('send-link').disabled = false; }
  };
  $('signout').onclick = async () => { clearPrivate(); try { api.unwrap(await db.auth.signOut()); notice('Signed out.'); } catch (e) { fail(e); } };
  // Do not await Supabase calls inside onAuthStateChange: schedule them after its auth lock releases.
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { clearPrivate(); return; }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setTimeout(() => acceptSession(session), 0);
  });
  try { const { data, error } = await db.auth.getSession(); if (error) throw error; await acceptSession(data.session); } catch (e) { fail(e); }
});
