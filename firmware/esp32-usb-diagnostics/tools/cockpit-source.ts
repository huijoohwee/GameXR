// SPDX-License-Identifier: MIT
// Admission for exact, owner-built browser bytes. Does not rebuild or edit the owner.
import { createHash, type BinaryLike } from 'node:crypto';
import { execFileSync } from 'node:child_process';
type CockpitLock = { schema: string; sourceRevision: string; artifactDigest: string;
  physicalAircraft: boolean; embeddedPathExecution: boolean; pathExecution: string };
type Artifact = { path: string; bytes: number; sha256: string };
export const sha256 = (bytes: BinaryLike) => createHash('sha256').update(bytes).digest('hex');

export function assertCockpitCheckout(source: string, lock: CockpitLock) {
  const git = (args: string[]) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== lock.sourceRevision
    || git(['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('Cockpit source must be the pinned clean candidate');
  }
}

export function validateCockpitArtifact(entries: Map<string, Buffer>, lock: CockpitLock) {
  if (lock.schema !== 'gamexr/cockpit-source-lock/v1' || lock.physicalAircraft !== false
    || lock.embeddedPathExecution !== false || lock.pathExecution !== 'host-simulated-receiver-only') {
    throw new Error('Unsupported cockpit boundary');
  }
  const manifest = JSON.parse(entries.get('release-manifest.json')?.toString() ?? 'null');
  if (manifest?.schema !== 'gamexr-release-artifact/v1' || manifest.sourceRevision !== lock.sourceRevision
    || manifest.candidateStatus !== 'source-bound-clean' || manifest.source?.worktree !== 'clean'
    || manifest.basePath !== '/gamexr/' || manifest.deploymentAuthorized !== false
    || manifest.artifactDigest !== lock.artifactDigest || !Array.isArray(manifest.artifacts)) {
    throw new Error('Cockpit build must match the pinned clean release');
  }
  const paths = new Set();
  for (const artifact of manifest.artifacts) {
    const path = artifact.path;
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\')
      || path.split('/').some(part => !part || part === '.' || part === '..')
      || path === 'release-manifest.json' || paths.has(path)) throw new Error('Invalid cockpit artifact path');
    paths.add(path);
    const bytes = entries.get(path);
    if (!bytes || bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`Cockpit artifact bytes changed: ${path}`);
    }
    if (/\.(js|css)$/.test(path) && bytes.length >= 500000) throw new Error('Cockpit chunk exceeds 500kB');
  }
  if (entries.size !== paths.size + 1 || [...entries.keys()].some(path => path !== 'release-manifest.json' && !paths.has(path))) {
    throw new Error('Cockpit artifact has unlisted files');
  }
  const digest = sha256(manifest.artifacts.map((a: Artifact) => `${a.path}\0${a.bytes}\0${a.sha256}`).join('\n'));
  if (digest !== lock.artifactDigest) throw new Error('Cockpit artifact digest changed');
  return { sourceRevision: lock.sourceRevision, artifactDigest: digest, releaseManifestSha256: sha256(entries.get('release-manifest.json')!) };
}
