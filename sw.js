// Tower service worker: makes the home-screen app open instantly and show the last loaded shell offline.
// Same-origin files only, network first (so a deploy shows up on the next open), cache as fallback.
// Supabase and other cross-origin requests are never touched, so data is always live.
const CACHE = 'tower-shell-v1'; // bump when SHELL changes
const SHELL = ['./', './index.html', './styles.css', './config.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || caches.match('./index.html'))));
});
