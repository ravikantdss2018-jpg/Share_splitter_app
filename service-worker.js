const CACHE_NAME = "expense-splitter-v15";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=15",
  "./app.js?v=15",
  "./manifest.webmanifest?v=15",
  "./icons/icon-48.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function networkFirst(request, fallbackUrl = null) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) return cache.match(fallbackUrl);
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
      })
      .catch(() => {});
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Supabase authentication and database requests must always use the network.
  if (url.hostname.endsWith(".supabase.co")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Page navigation: load the newest page, fall back to the cached app shell.
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  // Configuration and executable files should update quickly.
  if (
    url.origin === self.location.origin &&
    (
      url.pathname.endsWith("/config.js") ||
      url.pathname.endsWith("/app.js") ||
      url.pathname.endsWith("/styles.css") ||
      url.pathname.endsWith("/manifest.webmanifest")
    )
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Icons and the Supabase browser library can be served from cache.
  event.respondWith(cacheFirst(event.request));
});
