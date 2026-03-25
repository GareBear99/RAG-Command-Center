const CACHE = 'rag-v6';
const ASSETS = [
  './', './index.html', './deals.html', './directory.html', './team.html',
  './mortgage.html', './blog.html', './buyer-resources.html', './seller-resources.html',
  './listing-detail.html', './command-center.html', './contacts.html',
  './pipeline.html', './commission.html', './signals.html', './email-templates.html',
  './analytics.html', './settings.html',
  './assets/css/styles.css', './assets/js/utils.js', './assets/js/public.js',
  './assets/js/command.js', './assets/js/eve.js', './assets/js/gps-fallback-map.js',
  './assets/js/auth.js', './assets/js/resolver.js', './assets/js/compiler.js',
  './assets/js/settings.js', './data/bootstrap.js', './data/team.json',
  './data/blog/posts.json', './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
