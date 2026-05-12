(function() {
  "use strict";

  var CACHE_NAME = "minutario-dashboard-v1";
  var protocol = (self.location && self.location.protocol) || "";
  var isExtensionProtocol = protocol === "chrome-extension:" || protocol === "moz-extension:";

  var STATIC_ASSETS = [
    "/dashboard/index.html",
    "/dashboard/dashboard.css",
    "/dashboard/dashboard.js",
    "/dashboard/manifest.json",
    "/lib/supabase.min.js",
    "/shared/config.js",
    "/shared/db.js",
    "/shared/api.js",
    "/shared/sync.js"
  ];

  self.addEventListener("install", function(event) {
    if (!isExtensionProtocol) {
      event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
          return cache.addAll(STATIC_ASSETS);
        })
      );
    }
    self.skipWaiting();
  });

  self.addEventListener("activate", function(event) {
    event.waitUntil(
      caches.keys().then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(name) {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        );
      })
    );
    self.clients.claim();
  });

  self.addEventListener("fetch", function(event) {
    if (isExtensionProtocol || event.request.method !== "GET") {
      return;
    }

    event.respondWith(
      caches.match(event.request).then(function(cachedResponse) {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).catch(function() {
          return new Response("Offline", { status: 503 });
        });
      })
    );
  });
})();
