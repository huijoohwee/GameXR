import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

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

function gitOutput(arguments_, { trim = true } = {}) {
  try {
    const output = execFileSync('git', arguments_, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return trim ? output.trim() : output
  } catch {
    return null
  }
}

function inspectSource() {
  const repository = gitOutput(['rev-parse', '--is-inside-work-tree']) === 'true'
  if (!repository) {
    return {
      versionControl: 'unavailable',
      head: 'unknown',
      worktree: 'unknown',
      statusDigest: null,
      revision: null,
    }
  }

  const revision = gitOutput(['rev-parse', '--verify', 'HEAD'])
  const status = gitOutput(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { trim: false })
  return {
    versionControl: 'git',
    head: revision ? 'resolved' : 'unborn',
    worktree: status === null ? 'unknown' : status.length > 0 ? 'dirty' : 'clean',
    statusDigest: status === null ? null : sha256(status),
    revision,
  }
}

function candidateStatus(source) {
  if (source.versionControl !== 'git') return 'unsealed-no-source-repository'
  if (!source.revision) {
    if (source.worktree === 'dirty') return 'unsealed-unborn-dirty'
    if (source.worktree === 'clean') return 'unsealed-unborn'
    return 'unsealed-unborn-status-unknown'
  }
  if (source.worktree === 'clean') return 'source-bound-clean'
  if (source.worktree === 'dirty') return 'unsealed-dirty-source'
  return 'unsealed-source-status-unknown'
}

const root = resolve(option('root', 'dist/gamexr'))
const basePath = option('base', '/gamexr/')
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const paths = (await filesUnder(root))
  .filter((path) => !path.endsWith('/release-manifest.json'))
  .sort((left, right) => left.localeCompare(right))
const artifacts = await Promise.all(paths.map(async (path) => {
  const bytes = await readFile(path)
  return {
    path: relative(root, path).replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  }
}))
const joinedDigestInput = artifacts.map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}`).join('\n')
const source = inspectSource()
const manifest = {
  schema: 'gamexr-release-artifact/v1',
  application: 'GameXR',
  version: packageJson.version,
  basePath,
  candidateStatus: candidateStatus(source),
  sourceRevision: source.revision,
  source: {
    versionControl: source.versionControl,
    head: source.head,
    worktree: source.worktree,
    statusDigest: source.statusDigest,
  },
  artifactDigest: sha256(joinedDigestInput),
  defaultScene: 'schemas/default-scene.json',
  sceneSchema: 'schemas/gamexr.scene.schema.json',
  spatialInputSchema: 'schemas/apple-spatial-input.schema.json',
  cost: { modelCalls: 0, paidCalls: 0, estimatedCostUsd: 0 },
  deploymentAuthorized: false,
  artifacts,
}
await writeFile(resolve(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`GameXR ${manifest.candidateStatus}: ${manifest.artifactDigest}\n`)
