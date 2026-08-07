const CACHE_PREFIX = 'gamexr-shell-'
const PRECACHE_MANIFEST_PATH = './precache-manifest.json'
const CACHE_READY_MARKER_PATH = './.gamexr-cache-ready'
const CACHE_ACTIVE_MARKER_PATH = './.gamexr-cache-active'
const PRECACHE_BUILD_DIGEST = '__GAME_XR_PRECACHE_BUILD_DIGEST__'

let precacheManifestPromise
let activeCacheNamePromise
let activeManifestPromise

function scopedRequest(path) {
  return new Request(new URL(path, self.registration.scope), { cache: 'reload' })
}

function isSafeRelativePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function validatePrecacheManifest(value) {
  if (!value || value.schema !== 'gamexr-precache/v1' || !Array.isArray(value.entries)) {
    throw new Error('GameXR precache manifest is invalid.')
  }
  const scopePath = new URL(self.registration.scope).pathname
  if (value.basePath !== scopePath || value.serviceWorkerRegistrationEnabled !== true) {
    throw new Error('GameXR precache manifest does not match the active service-worker scope.')
  }
  if (!/^[a-f0-9]{64}$/u.test(value.buildDigest)) {
    throw new Error('GameXR precache digest is invalid.')
  }
  if (value.buildDigest !== PRECACHE_BUILD_DIGEST) {
    throw new Error('GameXR precache manifest does not match this service-worker revision.')
  }

  const paths = new Set()
  const reservedPaths = new Set([
    new URL(PRECACHE_MANIFEST_PATH, self.registration.scope).pathname.slice(scopePath.length),
    new URL(CACHE_READY_MARKER_PATH, self.registration.scope).pathname.slice(scopePath.length),
    new URL(CACHE_ACTIVE_MARKER_PATH, self.registration.scope).pathname.slice(scopePath.length),
  ])
  for (const entry of value.entries) {
    if (!entry || !isSafeRelativePath(entry.path)) {
      throw new Error('GameXR precache path is invalid.')
    }
    if (paths.has(entry.path)) throw new Error(`GameXR precache path is duplicated: ${entry.path}.`)
    if (reservedPaths.has(entry.path)) throw new Error(`GameXR precache path is reserved: ${entry.path}.`)
    paths.add(entry.path)
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`GameXR precache byte count is invalid for ${entry.path}.`)
    }
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256) || typeof entry.kind !== 'string' || entry.kind.length === 0) {
      throw new Error(`GameXR precache metadata is invalid for ${entry.path}.`)
    }
  }

  const digestInput = [
    value.basePath,
    ...value.entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`),
  ].join('\n')
  const aggregateDigest = await sha256Hex(new TextEncoder().encode(digestInput))
  if (aggregateDigest !== value.buildDigest) {
    throw new Error('GameXR precache aggregate digest does not match its entries.')
  }
  return value
}

async function loadNetworkPrecacheManifest() {
  const response = await fetch(scopedRequest(PRECACHE_MANIFEST_PATH))
  if (!response.ok || response.type === 'opaque') {
    throw new Error(`GameXR precache manifest returned ${response.status}.`)
  }
  const manifest = await validatePrecacheManifest(await response.clone().json())
  return { manifest, response }
}

function cacheNameFor(manifest) {
  return `${CACHE_PREFIX}${manifest.buildDigest}`
}

function cacheInventoryUrls(manifest, { includeActive = false } = {}) {
  const urls = new Set([
    scopedRequest(PRECACHE_MANIFEST_PATH).url,
    ...manifest.entries.map((entry) => scopedRequest(`./${entry.path}`).url),
    scopedRequest(CACHE_READY_MARKER_PATH).url,
  ])
  if (includeActive) urls.add(scopedRequest(CACHE_ACTIVE_MARKER_PATH).url)
  return urls
}

function cacheServedUrls(manifest) {
  return new Set([
    scopedRequest(PRECACHE_MANIFEST_PATH).url,
    ...manifest.entries.map((entry) => scopedRequest(`./${entry.path}`).url),
  ])
}

async function verifyEntryResponse(entry, response) {
  if (!response || !response.ok || response.type === 'opaque') {
    throw new Error(`GameXR precache entry could not be read: ${entry.path}.`)
  }
  const bytes = await response.clone().arrayBuffer()
  if (bytes.byteLength !== entry.bytes) {
    throw new Error(`GameXR precache byte count changed for ${entry.path}.`)
  }
  if (await sha256Hex(bytes) !== entry.sha256) {
    throw new Error(`GameXR precache hash changed for ${entry.path}.`)
  }
  return response
}

function markerResponse(manifest, state) {
  return new Response(JSON.stringify({
    schema: 'gamexr-cache-marker/v1',
    state,
    buildDigest: manifest.buildDigest,
  }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

async function markerMatches(cache, path, manifest, state) {
  const response = await cache.match(scopedRequest(path))
  if (!response) return false
  try {
    const marker = await response.json()
    return marker?.schema === 'gamexr-cache-marker/v1'
      && marker.state === state
      && marker.buildDigest === manifest.buildDigest
  } catch {
    return false
  }
}

async function verifyCache(cacheName, manifest, { requireActive = false } = {}) {
  if (cacheName !== cacheNameFor(manifest)) throw new Error('GameXR cache name does not match its build digest.')
  const cache = await caches.open(cacheName)
  const allowedUrls = cacheInventoryUrls(manifest, { includeActive: requireActive })
  const cachedRequests = await cache.keys()
  const cachedUrls = new Set()
  for (const request of cachedRequests) {
    if (request.method !== 'GET' || !allowedUrls.has(request.url) || cachedUrls.has(request.url)) {
      throw new Error(`GameXR cache contains an undeclared key: ${request.method} ${request.url}.`)
    }
    cachedUrls.add(request.url)
  }
  if (cachedUrls.size !== allowedUrls.size) {
    throw new Error('GameXR cache inventory does not exactly match its precache manifest and markers.')
  }
  if (!await markerMatches(cache, CACHE_READY_MARKER_PATH, manifest, 'ready')) {
    throw new Error('GameXR cache is not marked ready.')
  }
  if (requireActive && !await markerMatches(cache, CACHE_ACTIVE_MARKER_PATH, manifest, 'active')) {
    throw new Error('GameXR cache is not marked active.')
  }

  const cachedManifestResponse = await cache.match(scopedRequest(PRECACHE_MANIFEST_PATH))
  if (!cachedManifestResponse) throw new Error('GameXR cache is missing its precache manifest.')
  const cachedManifest = await validatePrecacheManifest(await cachedManifestResponse.json())
  if (cachedManifest.buildDigest !== manifest.buildDigest) {
    throw new Error('GameXR cached manifest does not match the selected release.')
  }

  for (const entry of manifest.entries) {
    const response = await cache.match(scopedRequest(`./${entry.path}`))
    await verifyEntryResponse(entry, response)
  }
  return cache
}

async function writeVerifiedCache(loaded) {
  const { manifest, response: manifestResponse } = loaded
  const cacheName = cacheNameFor(manifest)
  const verifiedEntries = await Promise.all(manifest.entries.map(async (entry) => {
    const response = await fetch(scopedRequest(`./${entry.path}`))
    return { entry, response: await verifyEntryResponse(entry, response) }
  }))

  await caches.delete(cacheName)
  const cache = await caches.open(cacheName)
  try {
    await cache.put(scopedRequest(PRECACHE_MANIFEST_PATH), manifestResponse)
    for (const { entry, response } of verifiedEntries) {
      await cache.put(scopedRequest(`./${entry.path}`), response)
    }
    await cache.put(scopedRequest(CACHE_READY_MARKER_PATH), markerResponse(manifest, 'ready'))
    await verifyCache(cacheName, manifest)
  } catch (error) {
    await caches.delete(cacheName)
    throw error
  }
  return cacheName
}

async function ensureVerifiedCache(loaded) {
  const cacheName = cacheNameFor(loaded.manifest)
  try {
    await verifyCache(cacheName, loaded.manifest, { requireActive: true })
    return cacheName
  } catch {
    try {
      await verifyCache(cacheName, loaded.manifest)
      return cacheName
    } catch {
      return writeVerifiedCache(loaded)
    }
  }
}

async function cachedManifestFor(cacheName, markerPath, markerState) {
  const cache = await caches.open(cacheName)
  const response = await cache.match(scopedRequest(PRECACHE_MANIFEST_PATH))
  if (!response) return null
  try {
    const manifest = await validatePrecacheManifest(await response.json())
    if (!await markerMatches(cache, markerPath, manifest, markerState)) return null
    await verifyCache(cacheName, manifest, { requireActive: markerState === 'active' })
    return manifest
  } catch {
    return null
  }
}

async function findMarkedCaches(markerPath, markerState) {
  const cacheNames = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX))
  const matches = []
  for (const cacheName of cacheNames) {
    const manifest = await cachedManifestFor(cacheName, markerPath, markerState)
    if (manifest) matches.push({ cacheName, manifest })
  }
  return matches
}

async function resolveActiveCacheName() {
  const activeCaches = await findMarkedCaches(CACHE_ACTIVE_MARKER_PATH, 'active')
  if (activeCaches.length === 1) return activeCaches[0].cacheName

  try {
    const loaded = await loadNetworkPrecacheManifest()
    const cacheName = cacheNameFor(loaded.manifest)
    await verifyCache(cacheName, loaded.manifest)
    return cacheName
  } catch (error) {
    if (activeCaches.length > 1) throw new Error('GameXR has multiple active offline caches.')
    const readyCaches = await findMarkedCaches(CACHE_READY_MARKER_PATH, 'ready')
    if (readyCaches.length === 1) return readyCaches[0].cacheName
    throw error
  }
}

function activeCacheName() {
  if (!activeCacheNamePromise) activeCacheNamePromise = resolveActiveCacheName()
  return activeCacheNamePromise
}

async function activeCacheRecord() {
  const cacheName = await activeCacheName()
  if (!activeManifestPromise) {
    activeManifestPromise = (async () => {
      const cache = await caches.open(cacheName)
      const response = await cache.match(scopedRequest(PRECACHE_MANIFEST_PATH))
      if (!response) throw new Error('GameXR active cache is missing its precache manifest.')
      const manifest = await validatePrecacheManifest(await response.json())
      await verifyCache(cacheName, manifest, { requireActive: true })
      return manifest
    })()
  }
  return { cacheName, manifest: await activeManifestPromise }
}

async function matchDeclaredCachedResponse(cache, manifest, request) {
  if (!cacheServedUrls(manifest).has(request.url)) return undefined
  return cache.match(request)
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    precacheManifestPromise = loadNetworkPrecacheManifest()
    const loaded = await precacheManifestPromise
    await ensureVerifiedCache(loaded)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    let loaded
    try {
      loaded = await (precacheManifestPromise ?? loadNetworkPrecacheManifest())
    } catch {
      const readyCaches = await findMarkedCaches(CACHE_READY_MARKER_PATH, 'ready')
      if (readyCaches.length !== 1) throw new Error('GameXR cannot identify one verified cache to activate.')
      loaded = { manifest: readyCaches[0].manifest }
    }

    const currentCacheName = cacheNameFor(loaded.manifest)
    const candidateCache = await caches.open(currentCacheName)
    const isAlreadyActive = await markerMatches(
      candidateCache,
      CACHE_ACTIVE_MARKER_PATH,
      loaded.manifest,
      'active',
    )
    const currentCache = await verifyCache(currentCacheName, loaded.manifest, {
      requireActive: isAlreadyActive,
    })
    if (!isAlreadyActive) {
      await currentCache.put(scopedRequest(CACHE_ACTIVE_MARKER_PATH), markerResponse(loaded.manifest, 'active'))
    }
    await verifyCache(currentCacheName, loaded.manifest, { requireActive: true })
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== currentCacheName)
      .map((name) => caches.delete(name)))
    activeCacheNamePromise = Promise.resolve(currentCacheName)
    activeManifestPromise = Promise.resolve(loaded.manifest)
    await self.clients.claim()
  })())
})

async function networkFirstNavigation(request) {
  const { cacheName, manifest } = await activeCacheRecord()
  const cache = await caches.open(cacheName)
  const fallback = scopedRequest('./index.html')
  try {
    const response = await fetch(request)
    if (response.ok) return response
    return await matchDeclaredCachedResponse(cache, manifest, fallback) ?? response
  } catch (error) {
    const cached = await matchDeclaredCachedResponse(cache, manifest, fallback)
    if (cached) return cached
    throw error
  }
}

async function cacheFirstAsset(request) {
  const { cacheName, manifest } = await activeCacheRecord()
  const cache = await caches.open(cacheName)
  const cached = await matchDeclaredCachedResponse(cache, manifest, request)
  return cached ?? fetch(request)
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
