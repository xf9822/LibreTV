const APP_VERSION = '202610281330';
const APP_SHELL_CACHE = `libretv-shell-${APP_VERSION}`;
const OFFLINE_URL = '/offline.html';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/player.html',
  '/cast.html',
  '/watch.html',
  '/about.html',
  '/diagnostics.html',
  OFFLINE_URL,
  '/manifest.json',
  '/css/modals.css',
  '/css/styles.css',
  '/css/index.css',
  '/css/player.css',
  '/css/watch.css',
  '/css/theme.css',
  '/css/tailwind.css',
  '/js/config.js',
  '/js/proxy-auth.js',
  '/js/source-speed.js',
  '/js/quick-play.js',
  '/js/source-availability.js',
  '/js/source-autopilot.js',
  '/js/source-hosts.js',
  '/js/experience.js',
  '/js/player-recommendations.js',
  '/js/mobile-fullscreen.js',
  '/js/episode-context.js',
  '/js/modal-accessibility.js',
  '/js/customer_site.js',
  '/js/ui.js',
  '/js/api.js',
  '/js/douban-filter.js',
  '/js/douban.js',
  '/js/password.js',
  '/js/search.js',
  '/js/search-filter.js',
  '/js/config-manager.js',
  '/js/source-health.js',
  '/js/onboarding.js',
  '/js/app.js',
  '/js/player-errors.js',
  '/js/hls-ad-filter.js',
  '/js/player-enhancements.js',
  '/js/player-stats.js',
  '/js/player-download.js',
  '/js/video-enhance.js',
  '/js/player.js',
  '/js/cast-receiver.js',
  '/js/diagnostics.js',
  '/js/watch.js',
  '/js/index-page.js',
  '/js/version-check.js',
  '/js/pwa-register.js',
  '/libs/sha256.min.js',
  '/libs/hls.min.js',
  '/libs/artplayer.min.js',
  '/image/logo.png',
  '/image/logo-black.png',
  '/image/icon-192.png',
  '/image/icon-512-maskable.png'
];

function isNetworkOnlyRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();

  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/proxy/') ||
    pathname.includes('/api.php/') ||
    pathname.endsWith('.m3u8') ||
    pathname.endsWith('.ts') ||
    pathname.endsWith('.m4s') ||
    pathname.endsWith('.mp4') ||
    pathname.endsWith('.webm') ||
    request.destination === 'video' ||
    request.destination === 'audio'
  );
}

async function networkFirst(request) {
  const cache = await caches.open(APP_SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    return cached || cache.match(OFFLINE_URL) || cache.match('/');
  }
}

// Third-party libraries and images rarely change, so serve them from cache.
// App scripts and styles go network-first: a cached copy from an older release
// must never be combined with freshly fetched HTML.
function isLongLivedAsset(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin &&
    (url.pathname.startsWith('/libs/') || url.pathname.startsWith('/image/'));
}

async function cacheFirstWithRefresh(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || refresh || fetch(request);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName.startsWith('libretv-shell-') && cacheName !== APP_SHELL_CACHE)
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || isNetworkOnlyRequest(event.request)) {
    return;
  }

  // Third-party requests (posters, CDNs) are not part of the app shell.
  if (new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate' || !isLongLivedAsset(event.request)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirstWithRefresh(event.request));
});
