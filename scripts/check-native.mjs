import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const nativeRoot = resolve(projectRoot, 'native')

function run(command, arguments_, cwd = projectRoot) {
  process.stdout.write(`native check: ${command} ${arguments_.join(' ')}\n`)
  const result = spawnSync(command, arguments_, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`)
  }
}

function capture(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: projectRoot, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}: ${result.stderr.trim()}`)
  }
  return result.stdout
}

function visionSimulatorId() {
  const simulatorList = JSON.parse(capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']))
  const runtimes = Object.entries(simulatorList.devices ?? {})
    .filter(([runtime]) => runtime.includes('xrOS'))
    .sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true }))

  for (const [, devices] of runtimes) {
    if (!Array.isArray(devices)) continue
    const preferred = devices.find((device) => device.isAvailable !== false && device.name?.includes('Apple Vision Pro'))
      ?? devices.find((device) => device.isAvailable !== false)
    if (preferred?.udid) return preferred.udid
  }
  throw new Error('No available visionOS simulator was found. Install a stable visionOS simulator runtime in Xcode.')
}

if (process.platform !== 'darwin') {
  throw new Error('GameXR native verification requires macOS with Xcode and the stable iOS/visionOS simulator runtimes.')
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'gamexr-native-check-'))
try {
  run('swift', ['test', '--package-path', 'native'])
  run('xcodebuild', [
    '-quiet', '-scheme', 'GameXRNative',
    '-destination', 'generic/platform=iOS Simulator',
    '-derivedDataPath', resolve(temporaryRoot, 'ios'),
    'CODE_SIGNING_ALLOWED=NO', 'build',
  ], nativeRoot)
  run('xcodebuild', [
    '-quiet', '-scheme', 'GameXRNative',
    '-sdk', 'xrsimulator',
    '-destination', `id=${visionSimulatorId()}`,
    '-derivedDataPath', resolve(temporaryRoot, 'visionos'),
    'CODE_SIGNING_ALLOWED=NO', 'build',
  ], nativeRoot)
  process.stdout.write('native check passed: Swift tests, iOS Simulator build, visionOS Simulator build\n')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
