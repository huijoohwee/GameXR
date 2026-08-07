import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

function option(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  }))
  return nested.flat()
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function artifactDigest(basePath, artifacts) {
  const entries = artifacts.map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}`)
  return sha256([basePath, ...entries].join('\n'))
}

function releaseArtifactDigest(artifacts) {
  return sha256(artifacts.map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}`).join('\n'))
}

function isSafeRelativePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function expectedCandidateStatus(source, revision) {
  if (source?.versionControl !== 'git') return 'unsealed-no-source-repository'
  if (!revision) {
    if (source.worktree === 'dirty') return 'unsealed-unborn-dirty'
    if (source.worktree === 'clean') return 'unsealed-unborn'
    return 'unsealed-unborn-status-unknown'
  }
  if (source.worktree === 'clean') return 'source-bound-clean'
  if (source.worktree === 'dirty') return 'unsealed-dirty-source'
  return 'unsealed-source-status-unknown'
}

let failureCount = 0
function fail(message) {
  failureCount += 1
  process.stderr.write(`release check failed: ${message}\n`)
}

const root = resolve(option('root', 'dist/gamexr'))
const basePath = option('base', '/gamexr/')
const required = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'precache-manifest.json', 'icons/gamexr.svg',
  '.well-known/runtime-readiness.json', 'schemas/default-scene.json',
  'schemas/gamexr.scene.schema.json', 'schemas/apple-spatial-input.schema.json',
  'release-manifest.json',
]
for (const path of required) {
  try { await access(resolve(root, path)) } catch { fail(`missing ${path}`) }
}
if (failureCount > 0) process.exit(1)

const files = await filesUnder(root)
const relativeFiles = files
  .map((path) => relative(root, path).replaceAll('\\', '/'))
  .sort((left, right) => left.localeCompare(right))
const fileSet = new Set(relativeFiles)
const index = await readFile(resolve(root, 'index.html'), 'utf8')
if (!index.includes(`src="${basePath}assets/`)) fail(`index does not use expected base path ${basePath}`)
if (/https?:\/\//u.test(index)) fail('index contains a network URL')

const javascript = relativeFiles.filter((path) => path.endsWith('.js') && path !== 'sw.js')
let serviceWorkerRegistrationFound = false
for (const path of javascript) {
  const bytes = await readFile(resolve(root, path))
  if (bytes.byteLength > 500_000) fail(`${path} exceeds the 500 kB chunk ceiling (${bytes.byteLength} bytes)`)
  const source = bytes.toString('utf8')
  if (/\b(?:fetch|WebSocket)\s*\(\s*["']https?:/u.test(source)) {
    fail(`${path} contains a direct network endpoint`)
  }
  if (/serviceWorker\.register\s*\(/u.test(source)) serviceWorkerRegistrationFound = true
}
if (serviceWorkerRegistrationFound !== (basePath !== '/')) {
  fail('compiled service-worker registration does not match the build base path')
}

const initialScripts = [...index.matchAll(/(?:src|href)="([^"]+\.js)"/gu)].map((match) => match[1])
let initialCompressedBytes = 0
for (const urlPath of initialScripts) {
  const relativePath = urlPath.startsWith(basePath) ? urlPath.slice(basePath.length) : urlPath.replace(/^\//u, '')
  initialCompressedBytes += gzipSync(await readFile(resolve(root, relativePath))).byteLength
}
if (initialCompressedBytes > 220_000) {
  fail(`initial JavaScript exceeds the 220 kB gzip ceiling (${initialCompressedBytes} bytes)`)
}

const precache = JSON.parse(await readFile(resolve(root, 'precache-manifest.json'), 'utf8'))
if (precache.schema !== 'gamexr-precache/v1' || !Array.isArray(precache.entries)) {
  fail('precache manifest schema or entries are invalid')
} else {
  if (precache.basePath !== basePath) fail(`precache base path is ${precache.basePath}, expected ${basePath}`)
  if (precache.serviceWorkerRegistrationEnabled !== (basePath !== '/')) {
    fail('precache service-worker registration flag does not match the build base path')
  }

  const seenPrecachePaths = new Set()
  const recomputedEntries = []
  for (const entry of precache.entries) {
    if (!entry || !isSafeRelativePath(entry.path)) {
      fail(`invalid precache path ${String(entry?.path)}`)
      continue
    }
    if (seenPrecachePaths.has(entry.path)) fail(`duplicate precache path ${entry.path}`)
    seenPrecachePaths.add(entry.path)
    if (!fileSet.has(entry.path)) {
      fail(`precache entry is missing from the build: ${entry.path}`)
      continue
    }
    const bytes = await readFile(resolve(root, entry.path))
    const digest = sha256(bytes)
    if (entry.bytes !== bytes.byteLength) fail(`precache byte count changed for ${entry.path}`)
    if (entry.sha256 !== digest) fail(`precache hash changed for ${entry.path}`)
    recomputedEntries.push({ path: entry.path, bytes: bytes.byteLength, sha256: digest })
  }

  const sortedEntries = recomputedEntries.sort((left, right) => left.path.localeCompare(right.path))
  const sortedPaths = sortedEntries.map((entry) => entry.path)
  if (JSON.stringify(sortedPaths) !== JSON.stringify(precache.entries.map((entry) => entry.path))) {
    fail('precache entries are not in deterministic path order')
  }
  if (precache.buildDigest !== artifactDigest(basePath, sortedEntries)) fail('precache aggregate digest changed')

  const runtimeFiles = relativeFiles.filter((path) => /\.(?:css|js)$/u.test(path) && path !== 'sw.js')
  const precachedRuntimeFiles = sortedPaths.filter((path) => /\.(?:css|js)$/u.test(path) && path !== 'sw.js')
  if (JSON.stringify(runtimeFiles) !== JSON.stringify(precachedRuntimeFiles)) {
    fail('precache manifest does not exactly cover every emitted runtime JavaScript and CSS file')
  }
  if (seenPrecachePaths.has('sw.js')) fail('service worker must not participate in its own precache digest')
}

const serviceWorker = await readFile(resolve(root, 'sw.js'), 'utf8')
if (!serviceWorker.includes('precache-manifest.json') || !serviceWorker.includes('manifest.entries')) {
  fail('service worker does not consume the generated precache manifest')
}
for (const contract of [
  "crypto.subtle.digest('SHA-256'",
  'entry.bytes',
  'entry.sha256',
  "schema: 'gamexr-cache-marker/v1'",
  'CACHE_READY_MARKER_PATH',
  'PRECACHE_BUILD_DIGEST',
  'verifyCache(cacheName, manifest)',
]) {
  if (!serviceWorker.includes(contract)) fail(`service worker is missing integrity contract ${contract}`)
}
if (/cache\.put\(\s*(?:fallback|request)\b/u.test(serviceWorker)) {
  fail('service worker must not overwrite its sealed cache from an unverified runtime response')
}
const boundWorkerDigest = serviceWorker.match(/const PRECACHE_BUILD_DIGEST = '([a-f0-9]{64})'/u)?.[1]
if (boundWorkerDigest !== precache.buildDigest
  || serviceWorker.includes('__GAME_XR_PRECACHE_BUILD_DIGEST__')) {
  fail('service worker revision is not bound to the exact precache build digest')
}

const readiness = JSON.parse(await readFile(resolve(root, '.well-known/runtime-readiness.json'), 'utf8'))
if (readiness.productionVerified !== false || readiness.modelCalls !== 0 || readiness.paidCalls !== 0) {
  fail('runtime readiness must preserve honest Dev-only and zero-spend claims')
}
if (!readiness.offline
  || !readiness.offline.registeredBasePaths?.includes('/gamexr/')
  || !readiness.offline.disabledBasePaths?.includes('/')) {
  fail('runtime readiness does not describe the scoped offline/Apex boundary')
}
if (readiness.networkRequiredForPlay?.['/gamexr/'] !== 'first-load-only'
  || readiness.networkRequiredForPlay?.['/'] !== true) {
  fail('runtime readiness does not scope the network requirement by base path')
}
if (readiness.offline.cacheIdentity !== 'full-build-digest'
  || readiness.offline.cacheAdmission !== 'manifest-aggregate-byte-count-and-sha256'
  || readiness.offline.readyMarker !== 'gamexr-cache-marker/v1'
  || readiness.offline.workerRevision !== 'exact-precache-build-digest'
  || readiness.offline.navigationFallback !== 'sealed-index-without-network-cache-mutation'
  || !readiness.offline.automatedVerification?.includes('cache-entry-byte-and-sha256')
  || !readiness.offline.automatedVerification?.includes('offline-navigation-and-reload')) {
  fail('runtime readiness does not describe byte-exact offline cache convergence')
}
if (readiness.chaseCamera?.automatedBrowserVerification !== 'local-and-exact-production-targetable'
  || readiness.chaseCamera?.physicalAppleDeviceVerified !== false
  || readiness.verification?.exactProductionTargetEnvironmentVariable !== 'GAME_XR_E2E_URL'
  || readiness.verification?.expectedSourceRevisionEnvironmentVariable !== 'GAME_XR_EXPECTED_SOURCE_REVISION'
  || readiness.verification?.expectedArtifactDigestEnvironmentVariable !== 'GAME_XR_EXPECTED_ARTIFACT_DIGEST'
  || readiness.verification?.physicalScopeVerified !== false) {
  fail('runtime readiness does not preserve automated-versus-physical verification boundaries')
}

const headers = await readFile(resolve('deployment/cloudflare/headers.fragment'), 'utf8')
if (!headers.includes('/gamexr/*\n')
  || !headers.includes('  ! X-Frame-Options\n  X-Frame-Options: SAMEORIGIN\n')
  || !headers.includes('  ! Permissions-Policy\n')
  || !headers.includes('  ! Referrer-Policy\n  Referrer-Policy: no-referrer\n')
  || !headers.includes('  ! X-Content-Type-Options\n  X-Content-Type-Options: nosniff\n')
  || !/Permissions-Policy:[^\n]*accelerometer=\(self\)[^\n]*gyroscope=\(self\)[^\n]*microphone=\(\)[^\n]*xr-spatial-tracking=\(self\)/u.test(headers)) {
  fail('Cloudflare header fragment does not replace inherited GameXR policy')
}
for (const path of [
  '/gamexr',
  '/gamexr/',
  '/gamexr/index.html',
  '/gamexr/sw.js',
  '/gamexr/manifest.webmanifest',
  '/gamexr/precache-manifest.json',
  '/gamexr/release-manifest.json',
  '/gamexr/llms.txt',
  '/gamexr/.well-known/*',
  '/gamexr/schemas/*',
  '/gamexr/icons/*',
]) {
  const block = `${path}\n  Cache-Control: public, no-store, no-cache, no-transform, must-revalidate, max-age=0`
  if (!headers.includes(block)) fail(`Cloudflare header fragment does not preserve sealed metadata bytes for ${path}`)
}
if (!headers.includes('/gamexr/assets/*\n  Cache-Control: public, max-age=31536000, immutable, no-transform')) {
  fail('Cloudflare header fragment does not preserve immutable asset bytes')
}

const defaultScene = JSON.parse(await readFile(resolve(root, 'schemas/default-scene.json'), 'utf8'))
const sceneSchema = JSON.parse(await readFile(resolve(root, 'schemas/gamexr.scene.schema.json'), 'utf8'))
const spatialInputSchema = JSON.parse(await readFile(resolve(root, 'schemas/apple-spatial-input.schema.json'), 'utf8'))
if (defaultScene.$schema !== './gamexr.scene.schema.json') fail('default scene schema path is not colocated')
if (sceneSchema.$defs?.motion?.properties?.deviceOrientation?.$ref !== 'apple-spatial-input.schema.json') {
  fail('scene schema does not use the portable Apple spatial-input contract')
}
if (spatialInputSchema.properties?.schema?.const !== 'airvio.apple-spatial-input/v1') {
  fail('Apple spatial-input schema identity is invalid')
}
const assetCondition = sceneSchema.$defs?.asset?.allOf?.find((condition) => condition.if?.properties?.kind?.const === 'procedural')
if (assetCondition?.then?.properties?.localAssetId?.type !== 'null'
  || assetCondition?.else?.properties?.localAssetId?.$ref !== '#/$defs/id') {
  fail('scene schema does not conditionally bind procedural/local asset identifiers')
}

const releaseManifest = JSON.parse(await readFile(resolve(root, 'release-manifest.json'), 'utf8'))
if (releaseManifest.schema !== 'gamexr-release-artifact/v1') fail('release manifest schema is invalid')
if (releaseManifest.basePath !== basePath) fail(`release base path is ${releaseManifest.basePath}, expected ${basePath}`)
if (releaseManifest.deploymentAuthorized !== false) fail('release manifest must not authorize deployment')
if (releaseManifest.spatialInputSchema !== 'schemas/apple-spatial-input.schema.json') {
  fail('release manifest does not identify the Apple spatial-input contract')
}
if (releaseManifest.source?.head === 'resolved') {
  if (typeof releaseManifest.sourceRevision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(releaseManifest.sourceRevision)) {
    fail('resolved release source must contain a full 40- or 64-hex Git revision')
  }
} else if (releaseManifest.sourceRevision !== null) fail('unresolved release source must have a null revision')
if (releaseManifest.candidateStatus !== expectedCandidateStatus(releaseManifest.source, releaseManifest.sourceRevision)) {
  fail('release candidate status does not exactly match source head/worktree state')
}
if (releaseManifest.source?.versionControl === 'git') {
  if (!['resolved', 'unborn'].includes(releaseManifest.source.head)) fail('Git source head status is invalid')
  if (!['clean', 'dirty', 'unknown'].includes(releaseManifest.source.worktree)) fail('Git worktree status is invalid')
  if (typeof releaseManifest.source.statusDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(releaseManifest.source.statusDigest)) {
    fail('Git source status digest is invalid')
  }
}
if (!Array.isArray(releaseManifest.artifacts)) {
  fail('release artifact list is invalid')
} else {
  const listedPaths = new Set()
  const recomputedArtifacts = []
  for (const artifact of releaseManifest.artifacts) {
    if (!artifact || !isSafeRelativePath(artifact.path)) {
      fail(`invalid release artifact path ${String(artifact?.path)}`)
      continue
    }
    if (listedPaths.has(artifact.path)) fail(`duplicate release artifact ${artifact.path}`)
    listedPaths.add(artifact.path)
    if (!fileSet.has(artifact.path) || artifact.path === 'release-manifest.json') {
      fail(`release artifact is missing or self-referential: ${artifact.path}`)
      continue
    }
    const bytes = await readFile(resolve(root, artifact.path))
    const digest = sha256(bytes)
    if (artifact.bytes !== bytes.byteLength) fail(`release artifact byte count changed for ${artifact.path}`)
    if (artifact.sha256 !== digest) fail(`release artifact hash changed for ${artifact.path}`)
    recomputedArtifacts.push({ path: artifact.path, bytes: bytes.byteLength, sha256: digest })
  }

  const expectedPaths = relativeFiles.filter((path) => path !== 'release-manifest.json')
  const actualPaths = [...listedPaths].sort((left, right) => left.localeCompare(right))
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    fail('release manifest does not list exactly every build artifact')
  }
  const sortedArtifacts = recomputedArtifacts.sort((left, right) => left.path.localeCompare(right.path))
  if (releaseManifest.artifactDigest !== releaseArtifactDigest(sortedArtifacts)) {
    fail('release aggregate artifact digest changed')
  }
}

if (failureCount > 0) process.exitCode = 1
else process.stdout.write(`release check passed: ${files.length} files, ${initialCompressedBytes} initial gzip bytes\n`)
