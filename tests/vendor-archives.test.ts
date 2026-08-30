import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

type LockPackage = { integrity?: string }
type PackageLock = { packages?: Record<string, LockPackage> }
type TarMember = Readonly<{ name: string; payload: Buffer }>

const packageLock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
) as PackageLock
const forbiddenArchiveTokens = [
  new RegExp(['know', 'grph'].join(''), 'iu'),
  new RegExp(['agnt', 'grph'].join(''), 'iu'),
  new RegExp(
    `\\b(?:${[
      ['KNOW', 'GRPH_'].join(''),
      ['AGNT', 'GRPH_'].join(''),
      ['K', 'G_'].join(''),
    ].join('|')})[A-Z0-9_]*`,
    'u',
  ),
] as const

function readTarText(bytes: Buffer, start: number, length: number): string {
  return bytes.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '')
}

function readTarSize(bytes: Buffer): number {
  const value = readTarText(bytes, 124, 12).trim()
  const size = value === '' ? 0 : Number.parseInt(value, 8)
  assert.ok(Number.isSafeInteger(size) && size >= 0, `invalid tar member size: ${value}`)
  return size
}

function unpackTar(bytes: Buffer): readonly TarMember[] {
  const members: TarMember[] = []
  let offset = 0

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break

    const name = readTarText(header, 0, 100)
    const prefix = readTarText(header, 345, 155)
    const memberName = prefix ? `${prefix}/${name}` : name
    const size = readTarSize(header)
    const payloadStart = offset + 512
    const payloadEnd = payloadStart + size
    assert.ok(payloadEnd <= bytes.length, `${memberName} exceeds its tar payload`)
    members.push({ name: memberName, payload: bytes.subarray(payloadStart, payloadEnd) })
    offset = payloadStart + Math.ceil(size / 512) * 512
  }

  assert.ok(members.length > 0, 'archive must contain at least one tar member')
  return members
}

function assertCanonicalArchiveText(value: string, label: string): void {
  for (const token of forbiddenArchiveTokens) assert.doesNotMatch(value, token, label)
}

for (const dependency of [
  {
    archive: '../vendor/agenticgraph-apple-spatial-input-0.1.0.tgz',
    lockKey: 'node_modules/@agenticgraph/apple-spatial-input',
    packageName: '@agenticgraph/apple-spatial-input',
    sha256: '06ce0ee14b53a97f5981df38d66f0b83bdb0aedd8b54a313b02aa47ca4a7028b',
    requiredText: [
      'agenticgraph.flight-model/v1',
      '@agenticgraph/apple-spatial-input',
    ],
  },
  {
    archive: '../vendor/grph-shared-0.0.0.tgz',
    lockKey: 'node_modules/grph-shared',
    packageName: 'grph-shared',
    sha256: '12b943cd79be56c258b3fd4a97dac1c0db7ffc334719942376fb5f3c38ad5363',
    requiredText: [
      'agenticgraph.inspect_game_os',
      'agenticgraph.control_local_world',
      'agenticgraph.game-os-world/v1',
      'GitHub/agenticgraph/docs',
      'AG_TOKEN_DEFS',
    ],
  },
] as const) {
  test(`${dependency.archive} is canonical, snapshot-bound, and contains no retired identity`, () => {
    const archiveBytes = readFileSync(new URL(dependency.archive, import.meta.url))
    const expectedIntegrity = packageLock.packages?.[dependency.lockKey]?.integrity
    const actualIntegrity = `sha512-${createHash('sha512').update(archiveBytes).digest('base64')}`
    const actualSha256 = createHash('sha256').update(archiveBytes).digest('hex')
    const tarBytes = gunzipSync(archiveBytes)
    const members = unpackTar(tarBytes)
    const packageManifest = members.find(member => member.name === 'package/package.json')

    assert.equal(actualIntegrity, expectedIntegrity)
    assert.equal(actualSha256, dependency.sha256)
    assert.ok(packageManifest, 'archive must contain package/package.json')
    assert.equal(JSON.parse(packageManifest.payload.toString('utf8')).name, dependency.packageName)

    assertCanonicalArchiveText(dependency.archive, 'archive filename contains a retired identity')
    assertCanonicalArchiveText(tarBytes.toString('latin1'), 'raw tar payload contains a retired identity')
    for (const member of members) {
      assertCanonicalArchiveText(member.name, `tar member name is not canonical: ${member.name}`)
      assertCanonicalArchiveText(
        member.payload.toString('latin1'),
        `tar member content is not canonical: ${member.name}`,
      )
    }

    const archiveText = tarBytes.toString('latin1')
    for (const requiredText of dependency.requiredText) assert.match(archiveText, new RegExp(requiredText.replaceAll('.', '\\.')))
  })
}
