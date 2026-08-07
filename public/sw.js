const CACHE_PREFIX = 'gamexr-shell-'
const PRECACHE_MANIFEST_PATH = './precache-manifest.json'

let precacheManifestPromise

function scopedRequest(path) {
  return new Request(new URL(path, self.registration.scope), { cache: 'reload' })
}

function validatePrecacheManifest(value) {
  if (!value || value.schema !== 'gamexr-precache/v1' || !Array.isArray(value.entries)) {
    throw new Error('GameXR precache manifest is invalid.')
  }
  if (!/^[a-f0-9]{64}$/u.test(value.buildDigest)) {
    throw new Error('GameXR precache digest is invalid.')
  }
  for (const entry of value.entries) {
    if (!entry || typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.includes('..')) {
      throw new Error('GameXR precache path is invalid.')
    }
  }
  return value
}

async function loadPrecacheManifest() {
  if (!precacheManifestPromise) {
    precacheManifestPromise = fetch(scopedRequest(PRECACHE_MANIFEST_PATH))
      .then((response) => {
        if (!response.ok) throw new Error(`GameXR precache manifest returned ${response.status}.`)
        return response.json()
      })
      .then(validatePrecacheManifest)
  }
  return precacheManifestPromise
}

function cacheNameFor(manifest) {
  return `${CACHE_PREFIX}${manifest.buildDigest.slice(0, 20)}`
}

async function activeCacheName() {
  try {
    return cacheNameFor(await loadPrecacheManifest())
  } catch {
    const cacheNames = await caches.keys()
    const existing = cacheNames.filter((name) => name.startsWith(CACHE_PREFIX)).sort().at(-1)
    if (existing) return existing
    throw new Error('GameXR has no active offline cache.')
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const manifest = await loadPrecacheManifest()
    const cache = await caches.open(cacheNameFor(manifest))
    const paths = [PRECACHE_MANIFEST_PATH, ...manifest.entries.map((entry) => `./${entry.path}`)]
    await cache.addAll(paths.map(scopedRequest))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const currentCacheName = await activeCacheName()
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== currentCacheName)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

async function networkFirstNavigation(request) {
  const cache = await caches.open(await activeCacheName())
  const fallback = scopedRequest('./index.html')
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(fallback, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(fallback)
    if (cached) return cached
    throw error
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(await activeCacheName())
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(request.mode === 'navigate'
    ? networkFirstNavigation(request)
    : cacheFirstAsset(request))
})

self.addEventListener('message', (event) => {
  if (event.data === 'gamexr:skip-waiting') void self.skipWaiting()
})
