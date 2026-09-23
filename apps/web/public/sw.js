/*
 * The service worker, deliberately the smallest one that does its job.
 *
 * Chromium browsers will not offer to install a site without one, which is why this exists at
 * all — a reader on Brave could not find the install option because we shipped no manifest and
 * no worker.
 *
 * WHAT IT DOES NOT DO is the important half. It caches no HTML, no JavaScript and no CSS. A
 * worker that caches app code can serve a stale build to somebody who has already reloaded, and
 * undoing that on a live site means shipping ANOTHER worker and waiting for every installed copy
 * to pick it up. That failure is slow, silent and hard to reverse, so the code path does not
 * exist here: every navigation goes to the network exactly as it would without a worker.
 *
 * The one thing it holds is an offline page, served only when the network has actually failed.
 */
const OFFLINE_CACHE = 'nostrich-offline-v1'
const OFFLINE_PAGE = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then(cache => cache.add(OFFLINE_PAGE))
      // Take over immediately rather than waiting for every tab to close. Safe precisely
      // because this worker owns no app code — there is no old version to be inconsistent with.
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== OFFLINE_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  /*
   * NAVIGATIONS ONLY. Everything else — scripts, styles, images, relay websockets, Blossom
   * uploads — is left entirely alone: no `respondWith`, so the browser handles it as though no
   * worker were installed. Uploads especially must not pass through here; the bytes go straight
   * to third-party Blossom servers and nothing of ours belongs in that path.
   */
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_PAGE)
      return cached ?? Response.error()
    }),
  )
})
